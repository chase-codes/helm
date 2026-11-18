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
    const s = keys.add({ title: 'Cornerstone', author: 'Hillsong', ccli: 'CCLI # 3006130', text: 'Verse 1\nMy hope is built on nothing less\nThan Jesus blood\n\nChorus\nChrist alone' });
    keys.setMusicKey(s.id, 'C', 'typed');
    expect(keys.keyList({ tab: 'all' })).toEqual([{
      id: s.id, title: 'Cornerstone', author: 'Hillsong', firstLine: 'My hope is built on nothing less', ccli: '3006130',
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

  // --- Phase 1c: the Song keys window's undo, counts and usage capture ---
  test('restoreMusicKey writes a legacy value and its source back verbatim, past the cache', () => {
    const s = keys.add({ title: 'T', text: 'Verse 1\nx', key: 'A (capo 2)' });
    expect(raw(s.id)).toMatchObject({ music_key: 'A (capo 2)', music_key_source: 'legacy' });
    keys.setMusicKey(s.id, 'A', 'typed');
    keys.get(s.id); // warm the cache
    const out = keys.restoreMusicKey(s.id, 'A (capo 2)', 'legacy');
    expect(out).toMatchObject({ key: 'A (capo 2)', keySource: 'legacy' });
    expect(keys.get(s.id)).toMatchObject({ key: 'A (capo 2)', keySource: 'legacy' });
    expect(raw(s.id)).toMatchObject({ music_key: 'A (capo 2)', music_key_source: 'legacy' });
  });

  test('restoreMusicKey puts back a canonical key with its source, or no key at all', () => {
    const s = keys.add({ title: 'T', text: 'Verse 1\nx' });
    keys.setMusicKey(s.id, 'Eb', 'title');
    keys.setMusicKey(s.id, 'E', 'typed');
    expect(keys.restoreMusicKey(s.id, 'Eb', 'title')).toMatchObject({ key: 'Eb', keySource: 'title' });
    const cleared = keys.restoreMusicKey(s.id, '', '');
    expect(cleared.key).toBeUndefined();
    expect(raw(s.id)).toMatchObject({ music_key: '', music_key_source: '' });
  });

  test('restoreMusicKey restores the skip stamp only when given one', () => {
    const s = keys.add({ title: 'T', text: 'Verse 1\nx', key: 'G or A' });
    keys.skipMusicKey(s.id);
    const skipped = raw(s.id).key_skipped_at;
    keys.setMusicKey(s.id, 'G', 'typed'); // a save clears the skip
    keys.restoreMusicKey(s.id, 'G or A', 'legacy');
    expect(raw(s.id).key_skipped_at).toBeNull();
    keys.restoreMusicKey(s.id, 'G or A', 'legacy', skipped);
    expect(raw(s.id).key_skipped_at).toBe(skipped);
    keys.restoreMusicKey(s.id, 'G or A', 'legacy', null);
    expect(raw(s.id).key_skipped_at).toBeNull();
  });

  test('restoreMusicKey refuses a bad id, a non-string, an unknown source, a source without a key, and free text as typed', () => {
    const s = keys.add({ title: 'T', text: 'Verse 1\nx' });
    keys.setMusicKey(s.id, 'D', 'typed');
    expect(() => keys.restoreMusicKey('nope', 'G', 'typed')).toThrow('Song not found');
    expect(() => keys.restoreMusicKey(s.id, 7 as unknown as string, 'typed')).toThrow('Expected the previous key');
    expect(() => keys.restoreMusicKey(s.id, 'G', 'guess' as MusicKeySource)).toThrow('Unknown key source');
    expect(() => keys.restoreMusicKey(s.id, '', 'typed')).toThrow('No key has no source');
    expect(() => keys.restoreMusicKey(s.id, 'capo 2 G', 'typed')).toThrow('Not a key');
    expect(() => keys.restoreMusicKey(s.id, 'G', 'typed', Number.NaN)).toThrow('Expected a skip time');
    expect(raw(s.id)).toMatchObject({ music_key: 'D', music_key_source: 'typed' });
  });

  test('keyCounts: No key counts legacy values, Sung lately counts the last 8 weeks and how many have a key', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    expect(keys.keyCounts()).toEqual({ total: 0, noKey: 0, lately: 0, latelyWithKey: 0, anyLive: false });
    const a = keys.add({ title: 'A', text: 'Verse 1\na' });
    const b = keys.add({ title: 'B', text: 'Verse 1\nb', key: 'G' });
    const c = keys.add({ title: 'C', text: 'Verse 1\nc', key: 'G or A' });
    keys.add({ title: 'D', text: 'Verse 1\nd' });
    const e = keys.add({ title: 'E', text: 'Verse 1\ne', key: 'A' });
    expect(keys.keyCounts()).toEqual({ total: 5, noKey: 3, lately: 0, latelyWithKey: 0, anyLive: false });
    keys.recordLive(a.id, now - day);
    keys.recordLive(b.id, now - 7 * day);
    keys.recordLive(c.id, now - 2 * day);
    keys.recordLive(e.id, now - 90 * day); // went live, but not lately
    expect(keys.keyCounts()).toEqual({ total: 5, noKey: 3, lately: 3, latelyWithKey: 1, anyLive: true });
  });

  test('recordLive sets last_live_at and counts a new day only when the last go-live was on another day', () => {
    const usage = (id: string): { last_live_at: number | null; live_days: number } =>
      db.prepare('SELECT last_live_at, live_days FROM songs WHERE id = ?').get(id) as { last_live_at: number | null; live_days: number };
    const s = keys.add({ title: 'T', text: 'Verse 1\nx' });
    const sun9 = new Date(2026, 10, 15, 9, 0).getTime();
    const sun11 = new Date(2026, 10, 15, 11, 30).getTime();
    const mon = new Date(2026, 10, 16, 0, 5).getTime();
    keys.recordLive(s.id, sun9);
    expect(usage(s.id)).toEqual({ last_live_at: sun9, live_days: 1 });
    keys.recordLive(s.id, sun11);
    expect(usage(s.id)).toEqual({ last_live_at: sun11, live_days: 1 });
    keys.recordLive(s.id, mon);
    expect(usage(s.id)).toEqual({ last_live_at: mon, live_days: 2 });
    expect(() => keys.recordLive('gone', mon)).not.toThrow();
  });

  test('update stamps typed when the key changes, clears the source with the key, and leaves an unchanged key alone', () => {
    const s = keys.add({ title: 'T', text: 'Verse 1\nx' });
    keys.setMusicKey(s.id, 'G', 'import');
    // Unchanged key (a lyric fix): the import source survives.
    expect(keys.update(s.id, { title: 'T', key: 'G', sections: s.sections }).keySource).toBe('import');
    expect(raw(s.id)).toMatchObject({ music_key: 'G', music_key_source: 'import' });
    // A different spelling of the same key is not a change either.
    keys.update(s.id, { title: 'T', key: 'g major', sections: s.sections });
    expect(raw(s.id)).toMatchObject({ music_key: 'G', music_key_source: 'import' });
    // Changed: a person typed it.
    const changed = keys.update(s.id, { title: 'T', key: 'A', sections: s.sections });
    expect(changed).toMatchObject({ key: 'A', keySource: 'typed' });
    expect(changed).toEqual(keys.get(s.id));
    expect(raw(s.id)).toMatchObject({ music_key: 'A', music_key_source: 'typed' });
    // Cleared: no key, no source.
    const cleared = keys.update(s.id, { title: 'T', sections: s.sections });
    expect(cleared.key).toBeUndefined();
    expect(cleared.keySource).toBeUndefined();
    expect(raw(s.id)).toMatchObject({ music_key: '', music_key_source: '' });
  });

  test('update and add canonicalise a key that parses, and keep one that does not as typed (legacy)', () => {
    const a = keys.add({ title: 'A', text: 'Verse 1\nx', key: ' bb ' });
    expect(a).toMatchObject({ key: 'Bb', keySource: 'typed' });
    expect(raw(a.id)).toMatchObject({ music_key: 'Bb', music_key_source: 'typed' });
    expect(keys.add({ title: 'B', text: 'Verse 1\nx', key: 'N/A' }).key).toBeUndefined();
    const odd = keys.add({ title: 'C', text: 'Verse 1\nx', key: 'G or A' });
    expect(raw(odd.id)).toMatchObject({ music_key: 'G or A', music_key_source: 'legacy' });
    expect(keys.update(a.id, { title: 'A', key: 'C#', sections: a.sections }).key).toBe('Db');
    // A stored legacy value handed straight back (QuickAdd's Save changes) still saves, untouched.
    const kept = keys.update(odd.id, { title: 'C2', key: 'G or A', sections: odd.sections });
    expect(kept).toMatchObject({ title: 'C2', key: 'G or A', keySource: 'legacy' });
    // A modulation is not one key: kept as typed.
    expect(keys.update(a.id, { title: 'A', key: 'D - E', sections: a.sections })).toMatchObject({ key: 'D - E', keySource: 'legacy' });
  });

  test('a section quick-edit that passes the key back keeps key and source', () => {
    const s = keys.add({ title: 'T', text: 'Verse 1\nx' });
    keys.setMusicKey(s.id, 'Eb', 'title');
    keys.update(s.id, { title: 'T', key: 'Eb', sections: [{ label: 'Verse 1', lines: ['y'] }] });
    expect(raw(s.id)).toMatchObject({ music_key: 'Eb', music_key_source: 'title' });
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

// Song keys spec, Phase 1d: keys that are already in the library's titles.
describe('title sweep', () => {
  let db: Database.Database;
  let keys: SongsRepo;
  beforeEach(() => {
    db = openTestDb();
    keys = createSongsRepo(db);
  });
  const raw = (id: string): { title: string; music_key: string; music_key_source: string; key_skipped_at: number | null } =>
    db.prepare('SELECT title, music_key, music_key_source, key_skipped_at FROM songs WHERE id = ?').get(id) as
      { title: string; music_key: string; music_key_source: string; key_skipped_at: number | null };
  const ftsTitle = (id: string): string =>
    (db.prepare('SELECT title FROM song_fts WHERE rowid = (SELECT rowid FROM songs WHERE id = ?)').get(id) as { title: string }).title;
  const add = (title: string): Song => keys.add({ title, text: `Verse 1\n${title} words` });

  test('lists titles that end in a key, unflagged ones last, with the clean title', () => {
    const king = add('A Child Of The King      (Eb)');
    add('Holy Ground (Live)');
    add('Plain Song');
    const oceans = add('Oceans (D - E)');
    const female = add('Song (F)');
    const two = add('Two (G, A)');
    const out = keys.titleKeyCandidates();
    expect(out.map((c) => c.id)).toEqual([oceans.id, female.id, two.id, king.id]);
    expect(out.find((c) => c.id === king.id)).toEqual({
      id: king.id, title: 'A Child Of The King      (Eb)', cleanTitle: 'A Child Of The King', key: 'Eb',
      currentKey: '', currentSource: '', skippedAt: null,
    });
    // A modulation keeps its title and offers the start key.
    expect(out.find((c) => c.id === oceans.id)).toMatchObject({ cleanTitle: 'Oceans (D - E)', key: 'D', endKey: 'E', flag: 'modulation' });
    expect(out.find((c) => c.id === female.id)).toMatchObject({ cleanTitle: 'Song', key: 'F', flag: 'single-letter' });
    expect(out.find((c) => c.id === two.id)).toMatchObject({ cleanTitle: 'Two (G, A)', flag: 'two-keys' });
    expect(out.find((c) => c.id === two.id)).not.toHaveProperty('key');
  });

  test("never offers to replace a person's key: a different key is flagged has-key", () => {
    const typed = add('Way Maker (Bb)');
    keys.setMusicKey(typed.id, 'C', 'typed');
    const same = add('Cornerstone (Db)');
    keys.setMusicKey(same.id, 'Db', 'typed');
    const [a, b] = [keys.titleKeyCandidates().find((c) => c.id === typed.id), keys.titleKeyCandidates().find((c) => c.id === same.id)];
    expect(a).toMatchObject({ key: 'Bb', flag: 'has-key', currentKey: 'C', currentSource: 'typed' });
    // The same key is not a conflict: only the title would change.
    expect(b).toMatchObject({ key: 'Db', cleanTitle: 'Cornerstone', currentKey: 'Db' });
    expect(b).not.toHaveProperty('flag');
  });

  test('a legacy value is somebody\'s key too: flagged has-key', () => {
    const s = add('Song (G)');
    db.prepare(`UPDATE songs SET music_key = 'capo 2 G', music_key_source = 'legacy' WHERE id = ?`).run(s.id);
    expect(keys.titleKeyCandidates()[0]).toMatchObject({ flag: 'has-key', currentKey: 'capo 2 G', currentSource: 'legacy' });
  });

  test('drops a song once its key has moved, including a modulation whose title stays', () => {
    const king = add('A Child Of The King (Eb)');
    const oceans = add('Oceans (D - E)');
    keys.setMusicKeys([
      { id: king.id, key: 'Eb', source: 'title', title: 'A Child Of The King' },
      { id: oceans.id, key: 'D', source: 'title' },
    ]);
    expect(keys.titleKeyCandidates()).toEqual([]);
  });

  test('apply then batch Undo puts every title, FTS row, key, source and skip time back exactly', () => {
    const king = add('A Child Of The King      (Eb)');
    const typed = add('Way Maker (Bb)');
    keys.setMusicKey(typed.id, 'C', 'typed');
    keys.skipMusicKey(king.id);
    const legacy = add('Song (G)');
    db.prepare(`UPDATE songs SET music_key = 'capo 2 G', music_key_source = 'legacy' WHERE id = ?`).run(legacy.id);
    const before = [king, typed, legacy].map((s) => ({ ...raw(s.id), fts: ftsTitle(s.id) }));
    const cands = keys.titleKeyCandidates();

    keys.setMusicKeys(cands.map((c) => ({ id: c.id, key: c.key!, source: 'title' as const, title: c.cleanTitle })));
    expect(raw(king.id)).toMatchObject({ title: 'A Child Of The King', music_key: 'Eb', music_key_source: 'title', key_skipped_at: null });
    expect(keys.search('king eb', 'title')[0]?.song.title).toBe('A Child Of The King');
    keys.search('king', 'title'); // warm the vocab, which the restore must invalidate

    const out = keys.restoreMusicKeys(cands.map((c) => ({
      id: c.id, key: c.currentKey, source: c.currentSource, skippedAt: c.skippedAt, title: c.title,
    })));
    expect(out.map((s) => s.id)).toEqual(cands.map((c) => c.id));
    expect([king, typed, legacy].map((s) => ({ ...raw(s.id), fts: ftsTitle(s.id) }))).toEqual(before);
    expect(keys.get(king.id)?.title).toBe('A Child Of The King      (Eb)');
    // Search finds the old title again: "(Eb)" is back in the index.
    const fts = db.prepare("SELECT count(*) AS n FROM song_fts WHERE song_fts MATCH 'title:eb'").get() as { n: number };
    expect(fts.n).toBe(1);
    expect(keys.search('child king eb', 'title')[0]?.song.id).toBe(king.id);
    expect(keys.titleKeyCandidates().map((c) => c.id)).toEqual(cands.map((c) => c.id));
  });

  test('restoreMusicKeys validates the whole batch first: one bad entry writes nothing', () => {
    const a = add('A (Eb)');
    keys.setMusicKeys([{ id: a.id, key: 'Eb', source: 'title', title: 'A' }]);
    expect(() => keys.restoreMusicKeys([
      { id: a.id, key: '', source: '', skippedAt: null, title: 'A (Eb)' },
      { id: 'nope', key: '', source: '', skippedAt: null },
    ])).toThrow('Song not found');
    expect(() => keys.restoreMusicKeys([{ id: a.id, key: 'bb', source: 'typed', skippedAt: null }])).toThrow('Not a key');
    expect(() => keys.restoreMusicKeys([{ id: a.id, key: '', source: '', skippedAt: null, title: ' ' }])).toThrow('A song needs a title');
    expect(raw(a.id)).toMatchObject({ title: 'A', music_key: 'Eb', music_key_source: 'title' });
  });

  test('addBatch keeps an import key source and the CCLI number', () => {
    const [r] = keys.addBatch([{ title: 'A Child Of The King', text: 'Verse 1\nx', key: 'Eb', musicKeySource: 'title', ccli: 'CCLI# 0022025' }]);
    expect('song' in r && r.song).toMatchObject({ key: 'Eb', keySource: 'title', ccli: '22025' });
    const id = 'song' in r ? r.song.id : '';
    expect(keys.get(id)).toMatchObject({ key: 'Eb', keySource: 'title', ccli: '22025' });
    // No source given is a person's; a junk CCLI number is dropped.
    const [t] = keys.addBatch([{ title: 'T', text: 'Verse 1\nx', key: 'G', ccli: 'N/A' }]);
    expect('song' in t && t.song).toMatchObject({ key: 'G', keySource: 'typed' });
    expect('song' in t && t.song.ccli).toBeUndefined();
    const [bad] = keys.addBatch([{ title: 'B', text: 'Verse 1\nx', key: 'G', musicKeySource: 'legacy' }]);
    expect(bad).toEqual({ error: expect.stringContaining('Unknown key source') });
  });

  test('fillBlanks writes only empty keys and CCLI numbers', () => {
    const empty = add('Empty');
    const typed = add('Typed');
    keys.setMusicKey(typed.id, 'C', 'typed');
    const legacy = add('Legacy');
    db.prepare(`UPDATE songs SET music_key = 'capo 2 G', music_key_source = 'legacy', ccli_no = '111' WHERE id = ?`).run(legacy.id);
    keys.skipMusicKey(empty.id);
    expect(keys.fillBlanks([
      { id: empty.id, key: 'Eb', ccli: '22025' },
      { id: typed.id, key: 'Bb', ccli: '33' },
      { id: legacy.id, key: 'G', ccli: '222' },
    ], 'title')).toEqual({ keys: 1, ccli: 2 });
    expect(keys.get(empty.id)).toMatchObject({ key: 'Eb', keySource: 'title', ccli: '22025' });
    expect(raw(empty.id).key_skipped_at).toBeNull();
    expect(keys.get(typed.id)).toMatchObject({ key: 'C', keySource: 'typed', ccli: '33' });
    expect(keys.get(legacy.id)).toMatchObject({ key: 'capo 2 G', keySource: 'legacy', ccli: '111' });
  });
});
