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
