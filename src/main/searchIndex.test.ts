import { expect, test } from 'vitest';
import { openTestDb } from './testDb';
import { createSongsRepo } from './songsRepo';
import { createBiblesRepo } from './biblesRepo';
import { ensureFtsNormVersion } from './searchIndex';
import { NORM_VERSION } from '../shared/search/fuzzy';
import type Database from 'better-sqlite3';

// Simulate a library indexed before norm-at-write shipped: raw text in every FTS table,
// no version stamp — exactly what an existing install's helm.db looks like on upgrade.
function seedPreNormDb(): Database.Database {
  const db = openTestDb();
  db.prepare('INSERT INTO songs (id, title, author, sections_json, source, created_at) VALUES (?,?,?,?,?,?)')
    .run('s1', "I'd Rather Have Jesus", '', JSON.stringify([{ label: 'Verse 1', lines: ["I'd rather have Jesus than silver or gold"] }]), 'local', 1);
  db.prepare('INSERT INTO song_fts (rowid, title, author, lyrics) VALUES ((SELECT rowid FROM songs WHERE id = ?),?,?,?)')
    .run('s1', "I'd Rather Have Jesus", '', "I'd rather have Jesus than silver or gold");
  db.prepare('INSERT INTO paragraphs (message_id, ord, label, text) VALUES (?,?,?,?)')
    .run('m1', 0, '1', "I'd rather have Him in my heart");
  db.prepare("INSERT INTO paragraph_fts (rowid, text) VALUES ((SELECT rowid FROM paragraphs WHERE message_id = 'm1'), ?)")
    .run("I'd rather have Him in my heart");
  db.prepare('INSERT INTO bible_versions (id, abbr, name, language, installed_at) VALUES (?,?,?,?,?)')
    .run('kjv', 'KJV', 'King James Version', 'en', 1);
  db.prepare('INSERT INTO verses (version_id, book, chapter, verse, text) VALUES (?,?,?,?,?)')
    .run('kjv', 'Psalms', 118, 23, "This is the LORD'S doing; it is marvellous in our eyes.");
  db.prepare('INSERT INTO verse_fts (version_id, book, chapter, verse, text) VALUES (?,?,?,?,?)')
    .run('kjv', 'Psalms', 118, 23, "This is the LORD'S doing; it is marvellous in our eyes.");
  return db;
}

const matchCount = (db: Database.Database, table: string, match: string): number =>
  (db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${table} MATCH ?`).get(match) as { n: number }).n;

test('rebuilds a pre-norm index on version mismatch: apostrophe words become searchable everywhere', () => {
  const db = seedPreNormDb();
  expect(createSongsRepo(db).search("i'd", 'all')).toHaveLength(0); // the bug, pre-rebuild

  ensureFtsNormVersion(db);
  createBiblesRepo(db).ensureSearchIndex(); // verse_fts is wiped above and backfilled here, as openDb does

  expect(createSongsRepo(db).search("i'd", 'all').map((x) => x.song.title)).toContain("I'd Rather Have Jesus");
  expect(matchCount(db, 'paragraph_fts', '"id"*')).toBe(1);
  expect(matchCount(db, 'verse_fts', '"lords"')).toBe(1);
});

test('a current stamp skips the rebuild; a bumped version triggers it again', () => {
  const db = seedPreNormDb();
  ensureFtsNormVersion(db);
  const stamp = db.prepare("SELECT value_json FROM settings WHERE key = 'ftsNormVersion'").get() as { value_json: string };
  expect(JSON.parse(stamp.value_json)).toBe(NORM_VERSION);

  // Plant a sentinel FTS row: a skipped run must leave it; a rebuild would drop it.
  db.prepare('INSERT INTO song_fts (rowid, title, author, lyrics) VALUES (999, ?, ?, ?)').run('sentinel', '', '');
  ensureFtsNormVersion(db);
  expect(matchCount(db, 'song_fts', '"sentinel"')).toBe(1); // untouched → skipped

  db.prepare("UPDATE settings SET value_json = '0' WHERE key = 'ftsNormVersion'").run();
  ensureFtsNormVersion(db);
  expect(matchCount(db, 'song_fts', '"sentinel"')).toBe(0); // rebuilt from the songs table
  expect(createSongsRepo(db).search("i'd", 'all').map((x) => x.song.title)).toContain("I'd Rather Have Jesus");
});
