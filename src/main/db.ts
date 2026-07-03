import Database from 'better-sqlite3';
const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  sections_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'local',
  created_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS song_fts USING fts5(
  title, author, lyrics, tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bible_versions (
  id TEXT PRIMARY KEY, abbr TEXT NOT NULL, name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en', installed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS verses (
  version_id TEXT NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL, text TEXT NOT NULL,
  PRIMARY KEY (version_id, book, chapter, verse)
);
CREATE INDEX IF NOT EXISTS idx_verses_chapter ON verses (book, chapter, version_id);
CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS service_items (
  id TEXT PRIMARY KEY, service_id TEXT NOT NULL, kind TEXT NOT NULL,
  ref_json TEXT NOT NULL, position INTEGER NOT NULL
);
`;
export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
