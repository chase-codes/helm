import { expect, test } from 'vitest';
import { secondaryLyricRows } from './secondaryLyric';
import type { Song, SongSearchResult } from '../types';

const song = (id: string): Song => ({
  id, title: id, author: 'A', sections: [], source: 'seed', createdAt: 0,
});
const res = (id: string): SongSearchResult => ({ song: song(id), score: 100, snippet: `line-${id}` });

test('returns [] when title results are not thin (>= threshold)', () => {
  const title = [res('a'), res('b'), res('c')];
  const lyric = [res('d'), res('e')];
  expect(secondaryLyricRows(title, lyric, 3, 3)).toEqual([]);
});

test('returns lyric matches (capped at limit) when title results are thin', () => {
  const title = [res('a')];
  const lyric = [res('d'), res('e'), res('f'), res('g')];
  expect(secondaryLyricRows(title, lyric, 3, 3).map((r) => r.song.id)).toEqual(['d', 'e', 'f']);
});

test('excludes songs already present in the title results (dedup by song id)', () => {
  const title = [res('a'), res('b')];
  const lyric = [res('a'), res('c'), res('b'), res('d')];
  expect(secondaryLyricRows(title, lyric, 3, 3).map((r) => r.song.id)).toEqual(['c', 'd']);
});

test('empty lyric results → []', () => {
  expect(secondaryLyricRows([res('a')], [], 3, 3)).toEqual([]);
});

test('returns all lyric matches when fewer than limit', () => {
  expect(secondaryLyricRows([res('a')], [res('c')], 3, 3).map((r) => r.song.id)).toEqual(['c']);
});
