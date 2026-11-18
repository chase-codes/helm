import { beforeEach, describe, expect, test } from 'vitest';
import type Database from 'better-sqlite3';
import { openTestDb } from './testDb';
import { createSongsRepo, type SongsRepo } from './songsRepo';
import { seedIfEmpty } from './seed';
import type { MusicKey, MusicKeySource } from '../shared/songs/musicKey';
import type { Song } from '../shared/types';

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
test('a typo in the distinguishing token is rescued even when a common token clears 30 hits (#13, via vocab expansion)', () => {
  // 30 decoys all match "holy"; the target matches only "reckless", and only fuzzily.
  // The old mechanism full-scanned; the new one expands "reckelss" against song_vocab
  // to the nearest tier ("reckless") and re-runs the FTS gate. Same observable rescue.
  for (let i = 0; i < 30; i++) repo.add({ title: `Holy Hymn ${i}`, text: `Verse 1\nHoly, holy is the Lord number ${i}` });
  repo.add({ title: 'Reckless Love', text: 'Chorus\nOh the overwhelming never-ending reckless love of God' });
  const r = repo.search('holy reckelss', 'all').map((x) => x.song.title);
  expect(r).toContain('Reckless Love');
});
test('an all-digit token with no FTS hit still finds its song via the full scan ("10000")', () => {
  // "10,000" indexes as "10"/"000": nothing prefixes "10000" and vocab expansion
  // would fuzz it away (measured regression) — digits keep the full-scan path where
  // matchDist's digit-prefix rule rescues them.
  repo.add({ title: '10,000 Reasons (Bless the Lord)', text: 'Chorus\nBless the Lord O my soul' });
  for (let i = 0; i < 30; i++) repo.add({ title: `Hymn ${i}`, text: `Verse 1\nsing praise number ${i}` });
  const r = repo.search('10000', 'all').map((x) => x.song.title);
  expect(r[0]).toBe('10,000 Reasons (Bless the Lord)');
});
test('vocabulary expansion sees terms from songs added after the first search', () => {
  repo.add({ title: 'Cornerstone', text: 'Chorus\nChrist alone cornerstone' });
  repo.search('cornerstoen', 'all'); // warms the vocab cache
  repo.add({ title: 'Wellspring', text: 'Verse 1\nwellspring of wonder' });
  const r = repo.search('wellspirng', 'all').map((x) => x.song.title); // needs post-add vocab
  expect(r).toContain('Wellspring');
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

// --- Apostrophe words: norm() joins them ("i'd" → "id") but a pre-norm FTS index split
// them ("i", "d"), so the candidate gate missed and expandToken (< 3 chars) couldn't
// rescue. The index now stores norm()'d text, so gate and scorer agree.
test('search "i\'d" finds "I\'d Rather Have Jesus" when it is the only token', () => {
  repo.add({ title: "I'd Rather Have Jesus", text: "Verse 1\nI'd rather have Jesus than silver or gold" });
  expect(repo.search("i'd", 'all').map((x) => x.song.title)).toContain("I'd Rather Have Jesus");
  expect(repo.search("I'd", 'title').map((x) => x.song.title)).toContain("I'd Rather Have Jesus");
  expect(repo.search('id', 'all').map((x) => x.song.title)).toContain("I'd Rather Have Jesus");
});

// --- Song keys (spec 2026-11-17-song-keys-design.md, Phase 1a) ---
describe('song keys', () => {
  let db: Database.Database;
  let keys: SongsRepo;
  beforeEach(() => {
    db = openTestDb();
    keys = createSongsRepo(db);
  });
  const raw = (id: string): { music_key: string; music_key_source: string; key_skipped_at: number | null } =>
    db.prepare('SELECT music_key, music_key_source, key_skipped_at FROM songs WHERE id = ?').get(id) as
      { music_key: string; music_key_source: string; key_skipped_at: number | null };

  test('setMusicKey writes key and source, returns the Song, and get() sees it past the cache', () => {
    const s = keys.add({ title: 'Cornerstone', text: 'Verse 1\nMy hope is built on nothing less' });
    keys.get(s.id); // warm the cache
    const out = keys.setMusicKey(s.id, 'Bb', 'typed');
    expect(out).toMatchObject({ id: s.id, title: 'Cornerstone', key: 'Bb', keySource: 'typed' });
    expect(keys.get(s.id)).toMatchObject({ key: 'Bb', keySource: 'typed' });
    expect(keys.get(s.id)?.sections).toEqual(s.sections);
  });

  test('setMusicKey(null) clears key and source', () => {
    const s = keys.add({ title: 'T', text: 'Verse 1\nx' });
    keys.setMusicKey(s.id, 'G', 'typed');
    const out = keys.setMusicKey(s.id, null, 'typed');
    expect(out.key).toBeUndefined();
    expect(out.keySource).toBeUndefined();
    expect(raw(s.id)).toMatchObject({ music_key: '', music_key_source: '' });
  });

  test('setMusicKey rejects an unknown id, a non-canonical key, an unknown source, and legacy with a key', () => {
    const s = keys.add({ title: 'T', text: 'Verse 1\nx' });
    expect(() => keys.setMusicKey('nope', 'G', 'typed')).toThrow('Song not found');
    expect(() => keys.setMusicKey(s.id, 'bb' as MusicKey, 'typed')).toThrow('Not a key');
    expect(() => keys.setMusicKey(s.id, 'capo 2 G' as MusicKey, 'typed')).toThrow('Not a key');
    expect(() => keys.setMusicKey(s.id, 'G', 'guess' as MusicKeySource)).toThrow('Unknown key source');
    expect(() => keys.setMusicKey(s.id, 'G', 'legacy')).toThrow();
    expect(raw(s.id).music_key).toBe('');
  });

  test('setMusicKey leaves title, lyrics and the search index alone', () => {
    const s = keys.add({ title: 'Findable Anthem', text: 'Verse 1\nwonderful unique zebra' });
    keys.setMusicKey(s.id, 'D', 'typed');
    expect(keys.search('zebra', 'lyric').map((r) => r.song.id)).toEqual([s.id]);
    expect(keys.search('findable', 'title')[0]?.song).toMatchObject({ id: s.id, key: 'D' });
  });

  test('skipMusicKey stamps key_skipped_at, and setting a key clears it', () => {
    const s = keys.add({ title: 'T', text: 'Verse 1\nx' });
    keys.skipMusicKey(s.id);
    expect(raw(s.id).key_skipped_at).toEqual(expect.any(Number));
    keys.setMusicKey(s.id, 'A', 'typed');
    expect(raw(s.id).key_skipped_at).toBeNull();
    expect(() => keys.skipMusicKey('nope')).toThrow('Song not found');
  });

  test('setMusicKeys writes every key in batch order and returns the Songs', () => {
    const a = keys.add({ title: 'A', text: 'Verse 1\na' });
    const b = keys.add({ title: 'B', text: 'Verse 1\nb' });
    keys.setMusicKey(b.id, 'E', 'typed');
    const out = keys.setMusicKeys([
      { id: a.id, key: 'Eb', source: 'title' },
      { id: b.id, key: null, source: 'typed' },
    ]);
    expect(out.map((s) => [s.id, s.key, s.keySource])).toEqual([[a.id, 'Eb', 'title'], [b.id, undefined, undefined]]);
    expect(keys.get(a.id)?.key).toBe('Eb');
    expect(keys.get(b.id)?.key).toBeUndefined();
  });

  test('setMusicKeys with a title renames the song and its FTS row in the same transaction', () => {
    const s = keys.add({ title: 'A Child Of The King (Eb)', text: 'Verse 1\nMy Father is rich in houses and lands' });
    keys.search('king', 'title'); // warm the vocab, which a rename must invalidate
    const [out] = keys.setMusicKeys([{ id: s.id, key: 'Eb', source: 'title', title: 'A Child Of The Kingdom' }]);
    expect(out).toMatchObject({ title: 'A Child Of The Kingdom', key: 'Eb', keySource: 'title' });
    expect(keys.get(s.id)?.title).toBe('A Child Of The Kingdom');
    expect(keys.search('kingdom', 'title').map((r) => r.song.id)).toContain(s.id);
    const fts = db.prepare("SELECT count(*) AS n FROM song_fts WHERE song_fts MATCH 'title:eb'").get() as { n: number };
    expect(fts.n).toBe(0); // the old title is gone from the index, not just from songs
    expect(keys.search('father', 'lyric').map((r) => r.song.id)).toEqual([s.id]); // lyrics untouched
  });

  test('setMusicKeys validates the whole batch first: one bad entry writes nothing', () => {
    const a = keys.add({ title: 'A', text: 'Verse 1\na' });
    expect(() => keys.setMusicKeys([
      { id: a.id, key: 'G', source: 'title', title: 'Renamed' },
      { id: 'nope', key: 'G', source: 'title' },
    ])).toThrow('Song not found');
    expect(() => keys.setMusicKeys([{ id: a.id, key: 'G', source: 'title', title: '   ' }])).toThrow('A song needs a title');
    expect(keys.get(a.id)).toMatchObject({ title: 'A' });
    expect(keys.get(a.id)?.key).toBeUndefined();
  });

  test('keyList returns light rows with the first lyric line', () => {
    const s = keys.add({ title: 'Cornerstone', author: 'Hillsong', text: 'Verse 1\nMy hope is built on nothing less\nThan Jesus blood\n\nChorus\nChrist alone' });
    keys.setMusicKey(s.id, 'C', 'typed');
    expect(keys.keyList({ tab: 'all' })).toEqual([{
      id: s.id, title: 'Cornerstone', author: 'Hillsong', firstLine: 'My hope is built on nothing less',
      key: 'C', keySource: 'typed', liveDays: 0, lastLiveAt: null, skippedAt: null,
    }]);
  });

  test('keyList none: keyless and legacy songs, by live days, then last live, then title, skipped last', () => {
    const mk = (title: string, liveDays = 0, lastLiveAt: number | null = null): Song => {
      const s = keys.add({ title, text: `Verse 1\n${title} line` });
      db.prepare('UPDATE songs SET live_days = ?, last_live_at = ? WHERE id = ?').run(liveDays, lastLiveAt, s.id);
      return s;
    };
    const keyed = mk('Has Key', 9, 9);
    keys.setMusicKey(keyed.id, 'G', 'typed');
    const legacy = mk('Legacy', 1, 1);
    db.prepare(`UPDATE songs SET music_key = 'capo 2 G', music_key_source = 'legacy' WHERE id = ?`).run(legacy.id);
    const skipped = mk('Skipped But Popular', 50, 50);
    keys.skipMusicKey(skipped.id);
    mk('Bravo', 0); mk('alpha', 0);
    mk('Recent', 3, 200); mk('Older', 3, 100);
    expect(keys.keyList({ tab: 'none' }).map((r) => r.title))
      .toEqual(['Recent', 'Older', 'Legacy', 'alpha', 'Bravo', 'Skipped But Popular']);
    expect(keys.keyList({ tab: 'none' }).find((r) => r.id === legacy.id)).toMatchObject({ key: 'capo 2 G', keySource: 'legacy' });
  });

  test('keyList lately: songs live in the last 8 weeks, with or without a key, newest first', () => {
    const now = Date.now();
    const week = 7 * 24 * 60 * 60 * 1000;
    const mk = (title: string, lastLiveAt: number | null): Song => {
      const s = keys.add({ title, text: 'Verse 1\nx' });
      db.prepare('UPDATE songs SET last_live_at = ? WHERE id = ?').run(lastLiveAt, s.id);
      return s;
    };
    keys.setMusicKey(mk('Last Week', now - week).id, 'A', 'typed');
    mk('Seven Weeks', now - 7 * week);
    mk('Nine Weeks', now - 9 * week);
    mk('Never', null);
    expect(keys.keyList({ tab: 'lately' }).map((r) => r.title)).toEqual(['Last Week', 'Seven Weeks']);
  });

  test('keyList all is by title, and q filters by title or author, accent- and case-blind', () => {
    keys.add({ title: 'Renuévame', author: 'Marcos Witt', text: 'Coro\nRenuévame Señor' });
    keys.add({ title: 'Cornerstone', author: 'Hillsong', text: 'Verse 1\nMy hope is built' });
    keys.add({ title: 'amazing grace', author: 'John Newton', text: 'Verse 1\nhow sweet the sound' });
    expect(keys.keyList({ tab: 'all' }).map((r) => r.title)).toEqual(['amazing grace', 'Cornerstone', 'Renuévame']);
    expect(keys.keyList({ tab: 'all', q: 'RENUEV' }).map((r) => r.title)).toEqual(['Renuévame']);
    expect(keys.keyList({ tab: 'all', q: 'hill corner' }).map((r) => r.title)).toEqual(['Cornerstone']);
    expect(keys.keyList({ tab: 'all', q: 'sweet' })).toEqual([]); // lyrics are not searched
    expect(keys.keyList({ tab: 'none', q: 'newton' }).map((r) => r.title)).toEqual(['amazing grace']);
  });

  test('keyList rejects an unknown tab', () => {
    expect(() => keys.keyList({ tab: 'keyed' as 'all' })).toThrow('Unknown tab');
  });

  test('update keeps working and reads back the stored key source and CCLI', () => {
    const s = keys.add({ title: 'T', text: 'Verse 1\nx' });
    db.prepare(`UPDATE songs SET ccli_no = '12345' WHERE id = ?`).run(s.id); // before the write that drops the cache
    keys.setMusicKey(s.id, 'G', 'import');
    const out = keys.update(s.id, { title: 'T2', key: 'G', sections: s.sections });
    expect(out).toEqual(keys.get(s.id));
    expect(out).toMatchObject({ title: 'T2', key: 'G', keySource: 'import', ccli: '12345' });
  });
});
