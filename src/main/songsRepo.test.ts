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
test('a typo in the distinguishing token is rescued even when a common token clears the 30-hit gate (#13)', () => {
  // 30 decoys all match "holy"; the target matches only "reckless", and only fuzzily.
  for (let i = 0; i < 30; i++) repo.add({ title: `Holy Hymn ${i}`, text: `Verse 1\nHoly, holy is the Lord number ${i}` });
  repo.add({ title: 'Reckless Love', text: 'Chorus\nOh the overwhelming never-ending reckless love of God' });
  const r = repo.search('holy reckelss', 'all').map((x) => x.song.title);
  expect(r).toContain('Reckless Love');
});
test('accented songs are found by accented and unaccented queries (#12)', () => {
  repo.add({ title: 'Renuévame', text: 'Coro\nRenuévame Señor Jesús, no quiero ser igual' });
  repo.add({ title: 'Holy Holy Holy', text: 'Verse 1\nHoly, holy, holy! Lord God Almighty!' });
  expect(repo.search('renuevame', 'all')[0]?.song.title).toBe('Renuévame');
  expect(repo.search('Renuévame', 'all')[0]?.song.title).toBe('Renuévame');
  expect(repo.search('señor', 'lyric')[0]?.song.title).toBe('Renuévame');
});
test('addBatch isolates a failing song with a savepoint and keeps the rest', () => {
  const out = repo.addBatch([
    { title: 'A', text: 'a line' },
    { title: 'Bad', text: '' },
    { title: 'C', text: 'c line' }
  ]);
  expect(out.map((r) => ('song' in r ? r.song.title : `!${r.error}`))).toEqual(['A', '!Song has no content', 'C']);
  expect(repo.count()).toBe(2);
  expect(repo.search('c line', 'lyric')[0]?.song.title).toBe('C'); // FTS row landed too
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

test('add persists an optional musical key and round-trips it', () => {
  const withKey = repo.add({ title: 'Blessed Assurance', text: 'Verse 1\nBlessed assurance', key: 'D' });
  expect(repo.get(withKey.id)?.key).toBe('D');
  const without = repo.add({ title: 'No Key', text: 'Verse 1\nx' });
  expect(repo.get(without.id)?.key).toBeUndefined();
});

test('update rewrites title, author, key and sections', () => {
  const s = repo.add({ title: 'Old Title', author: 'Old Author', text: 'Verse 1\nold line one', key: 'C' });
  const updated = repo.update(s.id, {
    title: 'New Title',
    author: 'New Author',
    key: 'G',
    sections: [{ label: 'Verse 1', lines: ['new line one', 'new line two'] }],
  });
  expect(updated.title).toBe('New Title');
  const got = repo.get(s.id);
  expect(got?.title).toBe('New Title');
  expect(got?.author).toBe('New Author');
  expect(got?.key).toBe('G');
  expect(got?.sections).toEqual([{ label: 'Verse 1', lines: ['new line one', 'new line two'] }]);
});

test('update preserves source and createdAt, and can clear the key', () => {
  const s = repo.add({ title: 'T', text: 'Verse 1\nx', source: 'web', key: 'D' });
  const updated = repo.update(s.id, { title: 'T', sections: s.sections });
  expect(updated.source).toBe('web');
  expect(updated.createdAt).toBe(s.createdAt);
  expect(repo.get(s.id)?.key).toBeUndefined();
});

test('update reindexes FTS: new lyrics match, removed lyrics do not', () => {
  const s = repo.add({ title: 'Findable', text: 'Verse 1\nwonderful unique zebra' });
  repo.update(s.id, { title: 'Findable', sections: [{ label: 'Verse 1', lines: ['gracious mighty falcon'] }] });
  expect(repo.search('falcon', 'lyric').map((r) => r.song.id)).toContain(s.id);
  expect(repo.search('zebra', 'lyric').map((r) => r.song.id)).not.toContain(s.id);
});

test('update throws on unknown id and on empty sections', () => {
  const s = repo.add({ title: 'T', text: 'Verse 1\nx' });
  expect(() => repo.update('nope', { title: 'T', sections: s.sections })).toThrow('Song not found');
  expect(() => repo.update(s.id, { title: 'T', sections: [] })).toThrow('Song has no content');
  expect(() => repo.update(s.id, { title: 'T', sections: [{ label: 'Verse 1', lines: ['  '] }] })).toThrow('Song has no content');
  // failed update leaves the row untouched
  expect(repo.get(s.id)?.sections[0].lines).toEqual(['x']);
});

test('remove deletes the row and returns the remaining library', () => {
  const a = repo.add({ title: 'Keep Me', text: 'Verse 1\nx' });
  const b = repo.add({ title: 'Drop Me', text: 'Verse 1\ny' });
  const after = repo.remove(b.id);
  expect(after.map((s) => s.id)).toEqual([a.id]);
  expect(repo.get(b.id)).toBeNull();
  expect(repo.count()).toBe(1);
});

test('remove deindexes FTS: the removed song stops matching its own lyric', () => {
  const s = repo.add({ title: 'Findable', text: 'Verse 1\nwonderful unique zebra' });
  repo.add({ title: 'Other', text: 'Verse 1\nzebra crossing' });
  expect(repo.search('zebra', 'lyric').map((r) => r.song.id)).toContain(s.id);
  repo.remove(s.id);
  expect(repo.search('zebra', 'lyric').map((r) => r.song.id)).not.toContain(s.id);
});

test('removing then re-adding does not resurrect the old FTS row', () => {
  const s = repo.add({ title: 'Gone', text: 'Verse 1\npeculiar walrus' });
  repo.remove(s.id);
  const fresh = repo.add({ title: 'Fresh', text: 'Verse 1\npeculiar walrus' });
  const hits = repo.search('walrus', 'lyric').map((r) => r.song.id);
  expect(hits).toEqual([fresh.id]);
});

test('remove of an unknown id is a no-op', () => {
  const a = repo.add({ title: 'A', text: 'Verse 1\nx' });
  expect(repo.remove('nope').map((s) => s.id)).toEqual([a.id]);
});

test('FTS-path candidate order matches list() order, so full ties rank identically on both paths (W7)', () => {
  const db = openTestDb();
  const r = createSongsRepo(db);
  // Two byte-identical arrangements: every relevance signal ties, so candidate
  // order is the only decider. Give the LATER rowid the EARLIER created_at.
  const a = r.add({ title: 'Duplicate Anthem', text: 'Verse 1\nduplicate light shines' });
  const b = r.add({ title: 'Duplicate Anthem', text: 'Verse 1\nduplicate light shines' });
  db.prepare('UPDATE songs SET created_at = ? WHERE id = ?').run(1000, b.id);
  db.prepare('UPDATE songs SET created_at = ? WHERE id = ?').run(2000, a.id);
  // 30 decoys sharing the token, so the FTS path (not the full scan) runs.
  for (let i = 0; i < 30; i++) r.add({ title: `Filler ${i}`, text: 'Verse 1\nduplicate voices sing' });
  const viaFts = r.search('duplicate', 'all').map((x) => x.song.id);
  expect(viaFts.indexOf(b.id)).toBeLessThan(viaFts.indexOf(a.id)); // created_at order, like list()
  // and the full-scan path agrees ("duplicqte" has no FTS hit → library scan)
  const viaScan = r.search('duplicqte', 'all').map((x) => x.song.id);
  expect(viaScan.indexOf(b.id)).toBeLessThan(viaScan.indexOf(a.id));
});

// --- P1: the repo memoizes Song objects so the scorer's doc cache can key on identity ---
test('search returns the same Song object across searches until the song is written (P1)', () => {
  const s = repo.add({ title: 'Cache Song', text: 'Verse 1\nwonderful unique zebra' });
  const first = repo.search('zebra', 'lyric')[0].song;
  const second = repo.search('zebra', 'lyric')[0].song;
  expect(second).toBe(first); // identity, not equality — this is what makes doc caching safe
  repo.update(s.id, { title: 'Cache Song', sections: [{ label: 'Verse 1', lines: ['wonderful unique zebra rides'] }] });
  const third = repo.search('zebra', 'lyric')[0].song;
  expect(third).not.toBe(first); // a write invalidates: fresh object → fresh doc
  expect(third.sections[0].lines[0]).toBe('wonderful unique zebra rides');
});
