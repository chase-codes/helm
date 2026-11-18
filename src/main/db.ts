import Database from 'better-sqlite3';
import { SCHEMA } from './schema';
import { createBiblesRepo } from './biblesRepo';
import { ensureFtsNormVersion } from './searchIndex';
import { canonicalizeStoredMusicKeys, ensureSongColumns } from './songMigrations';

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  ensureSongColumns(db);
  // Best effort: a bad stored key must never stop Helm from opening. The cleanup is one
  // transaction, so a throw rolls it back whole and the next launch simply tries again.
  try {
    canonicalizeStoredMusicKeys(db);
  } catch (err) {
    console.error('music key cleanup failed', err);
  }
  // Order matters: a norm() version mismatch wipes verse_fts too, and the backfill
  // below is what refills it.
  ensureFtsNormVersion(db);
  createBiblesRepo(db).ensureSearchIndex();
  return db;
}
