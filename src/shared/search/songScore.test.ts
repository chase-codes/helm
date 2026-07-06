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
