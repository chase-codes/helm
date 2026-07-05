import { beforeEach, expect, test } from 'vitest';
import { openTestDb } from './testDb';
import { createSongsRepo, type SongsRepo } from './songsRepo';
import { seedIfEmpty } from './seed';

let repo: SongsRepo;
beforeEach(() => {
  repo = createSongsRepo(openTestDb());
});

test('add parses text into sections and persists', () => {
  const s = repo.add({
    title: 'Amazing Grace',
    author: 'John Newton',
    text: 'Verse 1\nAmazing grace! how sweet the sound,\n\nChorus\nPraise God',
  });
  expect(s.sections).toHaveLength(2);
  expect(repo.get(s.id)?.title).toBe('Amazing Grace');
  expect(repo.count()).toBe(1);
});
test('search finds by typo’d lyric via re-rank fallback', () => {
  repo.add({ title: 'Only Believe', text: 'Chorus\nOnly believe, only believe,\nAll things are possible' });
  repo.add({ title: 'Holy Holy Holy', text: 'Verse 1\nHoly, holy, holy! Lord God Almighty!' });
  const r = repo.search('only beleive', 'all');
  expect(r[0].song.title).toBe('Only Believe');
});
test('empty query lists everything', () => {
  repo.add({ title: 'A', text: 'x' });
  repo.add({ title: 'B', text: 'y' });
  expect(repo.search('', 'all')).toHaveLength(2);
});

test('seedIfEmpty adds 10 hymns to an empty repo', () => {
  seedIfEmpty(repo);
  expect(repo.count()).toBe(10);
});

test('seedIfEmpty is idempotent', () => {
  seedIfEmpty(repo);
  seedIfEmpty(repo);
  expect(repo.count()).toBe(10);
});
