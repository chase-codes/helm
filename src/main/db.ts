import Database from 'better-sqlite3';
import { SCHEMA } from './schema';
import { createBiblesRepo } from './biblesRepo';

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  const songCols = db.prepare('PRAGMA table_info(songs)').all() as { name: string }[];
  if (!songCols.some((c) => c.name === 'music_key'))
    db.exec(`ALTER TABLE songs ADD COLUMN music_key TEXT NOT NULL DEFAULT ''`);
  createBiblesRepo(db).ensureSearchIndex();
  return db;
}
