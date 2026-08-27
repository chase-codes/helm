import { expect, test } from 'vitest';
import { rankSongs, scoreSong } from './songScore';
import type { Song } from '../types';

const song = (id: string, title: string, author: string, secs: [string, string[]][]): Song => ({
  id, title, author, source: 'local', createdAt: 0,
  sections: secs.map(([label, lines]) => ({ label, lines })),
});
const AMAZING = song('amazing', 'Amazing Grace', 'John Newton', [
  ['Verse 1', ['Amazing grace! how sweet the sound,', 'That saved a wretch like me;']],
]);
const BELIEVE = song('onlybelieve', 'Only Believe', 'Paul Rader', [
  ['Chorus', ['Only believe, only believe,', 'All things are possible, only believe;']],
]);
const LIB = [AMAZING, BELIEVE];

test('empty query returns all songs in library order', () => {
  const r = rankSongs('', LIB, 'all');
  expect(r.map((x) => x.song.id)).toEqual(['amazing', 'onlybelieve']);
});
test('typo in title still matches: "amazin grace"', () => {
  const r = rankSongs('amazin grace', LIB, 'all');
  expect(r[0].song.id).toBe('amazing');
});
test('typo in lyric matches: "only beleive"', () => {
  const r = rankSongs('only beleive', LIB, 'all');
  expect(r[0].song.id).toBe('onlybelieve');
});
test('lyric line match yields snippet', () => {
  const r = rankSongs('sweet the sound', LIB, 'all');
  expect(r[0].snippet).toContain('sweet the sound');
});
test('exact title beats substring', () => {
  expect(scoreSong('amazing grace', AMAZING, 'all').score).toBeGreaterThanOrEqual(1200);
});
test('title field suppresses snippet', () => {
  expect(scoreSong('amazing', AMAZING, 'title').snippet).toBe('');
});
test('non-matching query excluded', () => {
  expect(rankSongs('zzzz qqqq', LIB, 'all')).toHaveLength(0);
});

// --- BUG-002: deterministic relevance tie-breaker (A1) ---
// Songs built to reproduce the measured score plateaus, where the primary score
// ties and insertion order used to decide the winner.
const AG = song('ag', 'Amazing Grace', '', [['V', ['amazing grace how sweet the sound']]]);
// "amazing" in the title, "grace" only in the lyric → same 404 score as AG for "grace amazing".
const AL = song('al', 'Amazing Love', '', [['V', ['your amazing grace and mercy']]]);
const AG2 = song('ag2', 'Amazing Grace', '', [['V', ['amazing grace']]]);
const TIAG = song('tiag', 'This Is Amazing Grace', '', [['V', ['this is amazing grace']]]);
const RF = song('rf', 'Rise Faithfulness', '', [['V', ['rise up and sing']]]);
const GITF = song('gitf', 'Great Is Thy Faithfulness', '', [['V', ['great is thy faithfulness']]]);

test('tie-breaker: title-token coverage beats a lyric-only token match', () => {
  // premise: both songs collapse to the same primary score
  expect(scoreSong('grace amazing', AG, 'all').score).toBe(scoreSong('grace amazing', AL, 'all').score);
  // AG matches both query tokens in its title; AL matches "grace" only in its lyric → AG wins, either order
  for (const lib of [[AL, AG], [AG, AL]]) {
    expect(rankSongs('grace amazing', lib, 'all')[0].song.id).toBe('ag');
  }
});

test('tie-breaker: shorter title wins when title-token coverage ties', () => {
  // both carry both query tokens in the title (coverage + closeness tie) → shorter title decides
  for (const lib of [[TIAG, AG2], [AG2, TIAG]]) {
    expect(rankSongs('grace amazing', lib, 'all')[0].song.id).toBe('ag2');
  }
});

test('tie-breaker: single-token plateau ranks deterministically regardless of insertion order', () => {
  // no title signal separates these (both have one title word "Faithfulness" at edit-distance 1);
  // the fix must still make the winner insertion-order-independent
  const first = rankSongs('faithfullness', [RF, GITF], 'all')[0].song.id;
  const second = rankSongs('faithfullness', [GITF, RF], 'all')[0].song.id;
  expect(first).toBe(second);
});

test('tie-breaker never overrides a higher score', () => {
  // exact title (1200) must stay on top of a fuzzy-plateau song, even inserted last
  expect(rankSongs('amazing grace', [AL, AG], 'all')[0].song.id).toBe('ag');
});

// --- #53: lyric relevance signals (phrase adjacency, tf, bm25 prior, honest snippet) ---
const TWO_LINES = song('twolines', 'Two Lines', '', [
  ['Verse 1', ['Amazing grace how sweet the sound', 'That saved a wretch like me']],
]);
const TWO_SECTIONS = song('twosections', 'Two Sections', '', [
  ['Verse 1', ['We sing for you are sweet']],
  ['Verse 2', ['The morning rises anew']],
]);

test('phrase run spans line breaks within a section', () => {
  expect(scoreSong('sweet the sound that saved', TWO_LINES, 'lyric').phrase).toBe(5);
});

test('phrase run is blocked at a section boundary', () => {
  // "sweet" ends Verse 1, "the" opens Verse 2 — bridging them would make a run of 2
  expect(scoreSong('sweet the', TWO_SECTIONS, 'lyric').phrase).toBe(1);
});

test('snippet picks the densest line, not the first line with any hit', () => {
  const s = song('dense', 'Dense', '', [['Verse 1', [
    'The morning breaks anew',
    'Morning by morning new mercies I see',
  ]]]);
  expect(scoreSong('morning new mercies', s, 'lyric').snippet).toBe('Morning by morning new mercies I see');
});

test('snippet matches whole words — a substring inside a longer word neither scores nor snips', () => {
  const s = song('person', 'Person', '', [['Verse 1', ['A person of peace came near']]]);
  const r = scoreSong('son', s, 'lyric');
  expect(r.score).toBe(0);
  expect(r.snippet).toBe('');
});

test('fuzzy partial match is included with a snippet even without an exact substring', () => {
  // "swet" fuzzy-matches "sweet" (no exact substring anywhere) → 360 band, real snippet
  const r = scoreSong('swet zzzzz', TWO_LINES, 'lyric');
  expect(r.score).toBe(360);
  expect(r.snippet).toContain('sweet');
});

test('bm25 prior breaks ties ahead of title length, in either insertion order', () => {
  const a = song('a', 'Longer Title Here', '', [['V', ['sing hallelujah forever']]]);
  const b = song('b', 'Short', '', [['V', ['sing hallelujah tonight']]]);
  const rel = new Map([['a', 4.2], ['b', 1.1]]);
  for (const lib of [[a, b], [b, a]]) {
    expect(rankSongs('hallelujah', lib, 'lyric', rel)[0].song.id).toBe('a');
  }
});

test('a mid-word prefix matches like type-ahead: "wonder" finds "wonderful"', () => {
  const s = song('wonderful', 'Hymn', '', [['Verse 1', ['Wonderful grace of Jesus']]]);
  expect(scoreSong('wonder', s, 'lyric').score).toBeGreaterThan(0);
});

test('incremental typing mid-word keeps the full-match band and the phrase run', () => {
  // operator is mid-word in "sound" — the song must not flicker out of results
  const r = scoreSong('sweet the sou', TWO_LINES, 'lyric');
  expect(r.score).toBeGreaterThanOrEqual(380);
  expect(r.phrase).toBe(3);
});

test('a match on stopwords alone does not qualify a song', () => {
  // "zephaniah" is beyond fuzz reach and "of" (len 2) fuzzes into nearly anything —
  // without a significant matched token (len >= 3) the partial band must stay closed
  const s = song('noise', 'Noise', '', [['V', ['come on up to the house']]]);
  expect(scoreSong('zephaniah of', s, 'lyric').score).toBe(0);
});

test('a rare matched word outweighs two matched stopwords (length-weighted coverage)', () => {
  const a = song('stopwords', 'Alpha', '', [['V', ['the light of morning']]]);
  const b = song('rareword', 'Zulu', '', [['V', ['mighty armies rising high']]]);
  for (const lib of [[a, b], [b, a]]) {
    expect(rankSongs('the god of angel armies', lib, 'lyric')[0].song.id).toBe('rareword');
  }
});

test('empty-normalizing query respects the limit parameter', () => {
  expect(rankSongs('...', LIB, 'all', undefined, 1)).toHaveLength(1);
});

test('matching more of the query beats a stopword bigram (coverage before phrase)', () => {
  // partial band for "the love of god": B matches three tokens scattered, A only a
  // contiguous "the love" — B is the fuller match and must win, either order
  const a = song('bigram', 'Alpha', '', [['V', ['sing the love again today']]]);
  const b = song('fuller', 'Zulu', '', [['V', ['the morning breaks', 'love comes from god above']]]);
  for (const lib of [[a, b], [b, a]]) {
    expect(rankSongs('the love of god', lib, 'lyric')[0].song.id).toBe('fuller');
  }
});

test('term frequency breaks ties when phrase and coverage are equal', () => {
  const once = song('once', 'Alpha Hymn', '', [['V', ['hallelujah sing to him', 'all the glory shines']]]);
  const many = song('many', 'Omega Hymn', '', [['V', ['hallelujah to the king', 'bring the glory down', 'hallelujah every heart', 'see the glory rise']]]);
  for (const lib of [[once, many], [many, once]]) {
    expect(rankSongs('hallelujah glory', lib, 'lyric')[0].song.id).toBe('many');
  }
});

// --- W1: how much of the query matched outranks how closely one title word matched ---
test('more of the query matched beats a closer single-word title fuzz (W1)', () => {
  // "praise" matches Rise Praise exactly (tClose 0) but covers 6 chars of the query;
  // "recukless"~"reckless" is 1 edit (tClose 1) but covers 9. The fuller match wins.
  const praise = song('praise', 'Rise Praise', '', [['V', ['rise up and praise']]]);
  const reckless = song('reckless', 'Reckless Love', '', [['V', ['oh the overwhelming never ending reckless love of god']]]);
  for (const lib of [[praise, reckless], [reckless, praise]]) {
    expect(rankSongs('praise recukless', lib, 'all')[0].song.id).toBe('reckless');
  }
});

// --- W3: the title-substring band must anchor at a word start ---
test('a word-interior substring does not take the title band: "art" vs "Heart" (W3)', () => {
  const heart = song('heart', 'Heart of Worship', '', [['V', ['when the music fades']]]);
  const thouArt = song('thouart', 'How Great Thou Art', '', [['V', ['then sings my soul']]]);
  for (const lib of [[heart, thouArt], [thouArt, heart]]) {
    expect(rankSongs('art', lib, 'all')[0].song.id).toBe('thouart');
  }
  // and the interior hit contributes no title band at all
  expect(scoreSong('art', heart, 'all').score).toBe(0);
});

test('word-start type-ahead keeps its exact band values (W3)', () => {
  const wellspring = song('wellspring', 'Wellspring', '', [['V', ['water rises']]]);
  expect(scoreSong('well', wellspring, 'all').score).toBe(1000);           // startsWith
  const itIsWell = song('itiswell', 'It Is Well With My Soul', '', [['V', ['it is well']]]);
  expect(scoreSong('well', itIsWell, 'all').score).toBe(994);              // ' well' found at index 5 → word starts at 6 → 1000-6
});

// --- W5: lyric mode gains edit-distance discrimination via the dist signal ---
test('an exact match outranks an equally covered fuzzy match in lyric mode (W5)', () => {
  // Constructed so every pre-dist signal ties: both match both tokens (covW 10),
  // both have a 2-run phrase, and tf ties at 2 ("sanor" is not an exact occurrence
  // but "jesus" appears twice). Pre-fix the shorter title wins; dist must decide.
  const exact = song('exact', 'Alphabet Song', '', [['V', ['senor jesus reigns']]]);
  const fuzz = song('fuzz', 'Beta', '', [['V', ['sanor jesus jesus']]]);
  for (const lib of [[exact, fuzz], [fuzz, exact]]) {
    expect(rankSongs('senor jesus', lib, 'lyric')[0].song.id).toBe('exact');
  }
});

// --- W9: phrase runs must not bridge from title into author ---
test('a phrase run cannot bridge title into author (W9)', () => {
  expect(scoreSong('grace john', AMAZING, 'all').phrase).toBe(1);
});

// --- W2 hardening: 1-2 char tokens fuzz into any title and earn no title credit ---
test('a 1-2 char query token earns no title relevance credit (W2)', () => {
  // pre-fix "me"~"we" (lev 1, tol 1) inflated titleCoverage to 2 / titleCloseness to 1
  const s = song('wesing', 'We Sing', '', [['V', ['we sing together']]]);
  const r = scoreSong('me sing', s, 'all');
  expect(r.titleCoverage).toBe(1);   // "sing" only
  expect(r.titleCloseness).toBe(0);
});

// --- W2: the operator's unfinished trailing token must not collapse the band ---
test('a short trailing mid-word token keeps the full-match band (W2)', () => {
  // "ha" (2 chars) cannot match "hand" yet; the three complete tokens still carry
  // the band ("give me your h" held 428 one keystroke earlier)
  const s = song('takemyhand', 'Take My Hand', '', [['V', ['give me your hand tonight']]]);
  expect(scoreSong('give me your ha', s, 'all').score).toBe(416); // 380 + 3*12
  // only the TRAILING token is exempt — an unmatched short middle token is not
  expect(scoreSong('give zx your hand', s, 'all').score).toBe(360);
});

// --- W2: stopword-fuzz alone cannot open the partial band ---
test('a fuzz into a shorter stopword cannot open the partial band (W2)', () => {
  // "hand" edit-matches "and" — present in essentially every worship lyric; that
  // alone must not admit a song
  const s = song('andsong', 'Faithful Anthem', '', [['V', ['faithful and true forever']]]);
  expect(scoreSong('give me your hand', s, 'all').score).toBe(0);
});
