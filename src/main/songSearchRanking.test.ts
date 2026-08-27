// Ranking fixture for #53: a small fixed library plus queries with the expected
// top result asserted. Drives the REAL pipeline (createSongsRepo over node:sqlite's
// FTS5, bm25 included) so any scorer or repo change that regresses lyric ranking
// fails here as a diff, not as a hunch.
import { beforeAll, expect, test } from 'vitest';
import { openTestDb } from './testDb';
import { createSongsRepo, type SongsRepo } from './songsRepo';

let repo: SongsRepo;
const ids = new Map<string, string>();

const add = (key: string, title: string, text: string): void => {
  ids.set(key, repo.add({ title, author: '', text, source: 'seed' }).id);
};
const rankOf = (q: string, field: 'all' | 'title' | 'lyric', key: string): number => {
  const idx = repo.search(q, field).findIndex((r) => r.song.id === ids.get(key));
  return idx < 0 ? -1 : idx + 1;
};

beforeAll(() => {
  repo = createSongsRepo(openTestDb());

  // Target of the stopword-heavy collapse: contiguous phrase "the love of god",
  // deliberately given a LONG, alphabetically LATE title so that today's
  // titleLen-then-alphabetical ordering buries it behind the scatter songs.
  add('love-of-god', 'Wondrous Boundless Anthem', [
    'Verse 1', 'The love of God is greater far', 'Than tongue or pen can ever tell', '',
    'Chorus', 'O love of God how rich and pure', 'How measureless and strong',
  ].join('\n'));
  // Scatter competitors: contain every token of "the love of god" spread across
  // lines — with short, alphabetically early titles that win under today's ordering.
  add('scatter-a', 'Abide', [
    'Verse 1', 'In the morning we rise', 'Your love will find us here', '',
    'Chorus', 'Sing of mercy again', 'For god is near to all',
  ].join('\n'));
  add('scatter-b', 'Arise', [
    'Verse 1', 'Lift the banner on high', 'A love so deep and wide', '',
    'Chorus', 'King of every heart', 'Our god forever reigns',
  ].join('\n'));

  // Non-stopword phrase collapse, 'all' field: no query token in any title, so
  // title signals stay neutral and phrase adjacency must decide.
  add('never-fails', 'Zion Anthem Divine', [
    'Verse 1', 'When the night is long', 'You are with me still', '',
    'Chorus', 'Your love never fails and never gives up', 'Never runs out on me',
  ].join('\n'));
  add('fails-scatter', 'Anchor', [
    'Verse 1', 'Your grace goes before me', 'My strength never wavers', '',
    'Chorus', 'This hope never fails me now', 'Love has made a way',
  ].join('\n'));

  // Cross-line phrase target: "sweet the sound that saved a wretch" spans the
  // line break inside Verse 1.
  add('amazing-grace', 'Amazing Grace', [
    'Verse 1', 'Amazing grace how sweet the sound', 'That saved a wretch like me',
    'I once was lost but now am found', 'Was blind but now I see',
  ].join('\n'));
  add('sound-scatter', 'Echo', [
    'Verse 1', 'The sound of praise is rising', 'Sweet is your name to me', '',
    'Chorus', 'Saved by grace alone', 'A wretch no more I stand',
  ].join('\n'));

  // Section-boundary pair: "wonderful grace" contiguous within a line vs split
  // across a section boundary (end of Verse 1 → start of Verse 2).
  add('contiguous', 'Contiguous', [
    'Verse 1', 'Wonderful grace of Jesus', 'Reaching the most defiled',
  ].join('\n'));
  add('split', 'Splitline', [
    'Verse 1', 'We sing for you are wonderful', '',
    'Verse 2', 'Grace abounds where sin has been', 'Mercy flows forever more',
  ].join('\n'));

  // Term-frequency pair: "hallelujah" and "glory" never adjacent in either song;
  // 'repeat' carries them many times, 'once' a single time each. 'Aaron Hymn'
  // sorts before 'Zebulon Hymn' so alphabetical order is adversarial to the fix.
  add('tf-once', 'Aaron Hymn', [
    'Verse 1', 'Hallelujah sing to him', 'All the glory shines above',
  ].join('\n'));
  add('tf-repeat', 'Zebulon Hymn', [
    'Verse 1', 'Hallelujah to the king', 'Bring the glory in the highest', '',
    'Chorus', 'Hallelujah every heart', 'See the glory of his face',
    'Hallelujah once again', 'Crown him glory evermore',
  ].join('\n'));

  // Substring false positive: contains "standing" but never the word "and".
  add('standing', 'Standing Firm', [
    'Verse 1', 'Standing on the promises', 'Upheld forever by his word',
  ].join('\n'));
});

test('stopword-heavy phrase outranks scattered stopword matches (lyric field)', () => {
  expect(rankOf('the love of god', 'lyric', 'love-of-god')).toBe(1);
});

test('verbatim phrase outranks scattered matches in all-field search', () => {
  expect(rankOf('your love never fails', 'all', 'never-fails')).toBe(1);
});

test('phrase spanning a line break wins and yields a cross-line snippet', () => {
  const results = repo.search('sweet the sound that saved a wretch', 'lyric');
  expect(results[0].song.id).toBe(ids.get('amazing-grace'));
  expect(results[0].snippet).toContain('sweet the sound');
  expect(results[0].snippet).toContain('saved a wretch');
});

test('adjacency across a section boundary does not count as a phrase', () => {
  expect(rankOf('wonderful grace', 'lyric', 'contiguous')).toBe(1);
});

test('repeated terms outrank a single scattered occurrence', () => {
  expect(rankOf('hallelujah glory', 'lyric', 'tf-repeat')).toBe(1);
});

test('typo in a lyric token still ranks the song first, with a snippet', () => {
  const results = repo.search('swet the sound', 'lyric');
  expect(results[0].song.id).toBe(ids.get('amazing-grace'));
  expect(results[0].snippet).not.toBe('');
});

test('type-ahead: a mid-word lyric prefix keeps the song in the full-match band', () => {
  const rs = repo.search('sweet the sou', 'lyric');
  expect(rs[0].song.id).toBe(ids.get('amazing-grace'));
  expect(rs[0].score).toBeGreaterThanOrEqual(380); // "sou" counts as a match, not a lucky partial
});

test('a stopword-only match returns an honest empty list, not 50 junk rows', () => {
  expect(repo.search('zephaniah of', 'lyric')).toHaveLength(0);
});

test('an out-of-range search field does not reach SQL text', () => {
  expect(() => repo.search('grace', 'constructor' as never)).not.toThrow();
});

test('a bare substring inside a longer word does not put a song in results', () => {
  const hits = repo.search('and', 'lyric').map((r) => r.song.id);
  expect(hits).not.toContain(ids.get('standing'));
});

test('a word-interior title substring does not put a song in ALL-field results (W3)', () => {
  // the existing 'and' guard at the end of this file only proves the LYRIC field;
  // 'all' is what operators actually use, and pre-fix "Standing Firm" scored 998 here
  const hits = repo.search('and', 'all').map((r) => r.song.id);
  expect(hits).not.toContain(ids.get('standing'));
});
