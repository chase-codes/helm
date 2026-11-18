import { expect, test } from 'vitest';
import type Database from 'better-sqlite3';
import { openTestDb } from './testDb';
import { canonicalizeStoredMusicKeys, ensureSongColumns } from './songMigrations';
import { createSongsRepo } from './songsRepo';

const NEW_COLUMNS = ['music_key', 'music_key_source', 'key_skipped_at', 'ccli_no', 'last_live_at', 'live_days'];
const columns = (db: Database.Database): string[] =>
  (db.prepare('PRAGMA table_info(songs)').all() as { name: string }[]).map((c) => c.name);

test('a fresh DB already has every song column, so ensureSongColumns changes nothing', () => {
  const db = openTestDb();
  expect(columns(db)).toEqual(expect.arrayContaining(NEW_COLUMNS));
  const before = columns(db);
  ensureSongColumns(db);
  expect(columns(db)).toEqual(before);
});

test('ensureSongColumns adds the missing columns to an old DB, with their defaults on existing rows', () => {
  const db = openTestDb();
  // The songs table as the first shipped versions created it: no music_key, no key columns.
  db.exec(`DROP TABLE songs; CREATE TABLE songs (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '',
    sections_json TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'local', created_at INTEGER NOT NULL)`);
  db.prepare('INSERT INTO songs (id, title, sections_json, created_at) VALUES (?,?,?,?)').run('s1', 'Old Song', '[]', 1);
  ensureSongColumns(db);
  expect(columns(db)).toEqual(['id', 'title', 'author', 'sections_json', 'source', 'created_at', ...NEW_COLUMNS]);
  expect(db.prepare('SELECT music_key, music_key_source, key_skipped_at, ccli_no, last_live_at, live_days FROM songs').get())
    .toEqual({ music_key: '', music_key_source: '', key_skipped_at: null, ccli_no: '', last_live_at: null, live_days: 0 });
  ensureSongColumns(db); // second launch: nothing left to add
  expect(columns(db)).toHaveLength(6 + NEW_COLUMNS.length);
});

const seed = (rows: [id: string, musicKey: string, source?: string][]): Database.Database => {
  const db = openTestDb();
  const ins = db.prepare('INSERT INTO songs (id, title, sections_json, created_at, music_key, music_key_source) VALUES (?,?,?,?,?,?)');
  for (const [id, musicKey, source = ''] of rows) ins.run(id, id, '[]', 1, musicKey, source);
  return db;
};
const stored = (db: Database.Database): Record<string, [string, string]> =>
  Object.fromEntries((db.prepare('SELECT id, music_key, music_key_source FROM songs').all() as
    { id: string; music_key: string; music_key_source: string }[]).map((r) => [r.id, [r.music_key, r.music_key_source]]));
const totalChanges = (db: Database.Database): number =>
  (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;

test('cleanup clears a placeholder (N/A) and keeps a modulation as legacy rather than drop its end key', () => {
  const db = seed([['na', 'N/A', 'import'], ['mod', 'G-A']]);
  expect(canonicalizeStoredMusicKeys(db)).toEqual({ canonicalized: 0, legacy: 1, cleared: 1 });
  expect(stored(db)).toEqual({ na: ['', ''], mod: ['G-A', 'legacy'] });
});

test('cleanup never writes a song whose key is already canonical, nor one with no key', () => {
  const db = seed([['g', 'G'], ['bb', 'Bb', 'import'], ['fsm', 'F#m', 'typed'], ['none', '']]);
  const before = totalChanges(db);
  expect(canonicalizeStoredMusicKeys(db)).toEqual({ canonicalized: 0, legacy: 0, cleared: 0 });
  expect(totalChanges(db)).toBe(before);
  expect(stored(db)).toEqual({ g: ['G', ''], bb: ['Bb', 'import'], fsm: ['F#m', 'typed'], none: ['', ''] });
});

test('cleanup canonicalizes keys that parse and keeps the rest, exactly as typed, as legacy', () => {
  const db = seed([
    ['bb', 'bb'], ['spaced', ' G ', 'import'], ['capo', 'capo 2 G'], // spec B2 row 46: G shapes + 2 = A
    ['ambiguous', 'A (capo 2)'], ['junk', 'hello'], ['ok', 'Bb'],
  ]);
  expect(canonicalizeStoredMusicKeys(db)).toEqual({ canonicalized: 3, legacy: 2, cleared: 0 });
  expect(stored(db)).toEqual({
    bb: ['Bb', 'typed'], // empty source becomes typed
    spaced: ['G', 'import'], // a known source is kept
    capo: ['A', 'typed'],
    ambiguous: ['A (capo 2)', 'legacy'], // sounding A, or A shapes? A person decides
    junk: ['hello', 'legacy'],
    ok: ['Bb', ''],
  });
  const repo = createSongsRepo(db);
  expect(repo.get('junk')).toMatchObject({ key: 'hello', keySource: 'legacy' });
  expect(repo.keyList({ tab: 'none' }).map((r) => r.id).sort()).toEqual(['ambiguous', 'junk']);
});

test('cleanup is idempotent: a second launch writes nothing', () => {
  const db = seed([['bb', 'bb'], ['junk', 'hello'], ['ok', 'G']]);
  canonicalizeStoredMusicKeys(db);
  const after = stored(db);
  const before = totalChanges(db);
  expect(canonicalizeStoredMusicKeys(db)).toEqual({ canonicalized: 0, legacy: 0, cleared: 0 });
  expect(totalChanges(db)).toBe(before);
  expect(stored(db)).toEqual(after);
});

test('a canonical key still marked legacy (fixed through songs:update) loses the mark', () => {
  const db = seed([['fixed', 'A', 'legacy']]);
  expect(canonicalizeStoredMusicKeys(db)).toEqual({ canonicalized: 1, legacy: 0, cleared: 0 });
  expect(stored(db)).toEqual({ fixed: ['A', 'typed'] });
});
