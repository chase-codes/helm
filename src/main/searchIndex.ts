// FTS rebuild on norm() change. The FTS tables store norm()'d text so the index
// tokenizes exactly like the query side (see fuzzy.ts NORM_VERSION) — which makes the
// on-disk index a snapshot of norm() at write time. This stamp check re-tokenizes an
// existing library whenever the shipped norm() differs from the one that built it:
// first launch after this feature ships (no stamp), and any future NORM_VERSION bump.
import type Database from 'better-sqlite3';
import { norm, NORM_VERSION } from '../shared/search/fuzzy';
import { lyricsOfSections } from '../shared/songs/lyrics';

const STAMP_KEY = 'ftsNormVersion';

export function ensureFtsNormVersion(db: Database.Database): void {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(STAMP_KEY) as { value_json: string } | undefined;
  if (row !== undefined && (JSON.parse(row.value_json) as number) === NORM_VERSION) return;
  db.transaction(() => {
    // verse_fts is only wiped here: openDb runs biblesRepo.ensureSearchIndex() right
    // after, and its backfill (the repo's own norm'd insert) refills per version.
    db.exec('DELETE FROM song_fts; DELETE FROM paragraph_fts; DELETE FROM verse_fts;');
    const insertSongFts = db.prepare('INSERT INTO song_fts (rowid, title, author, lyrics) VALUES (?,?,?,?)');
    const songs = db.prepare('SELECT rowid, title, author, sections_json FROM songs').all() as
      { rowid: number; title: string; author: string; sections_json: string }[];
    for (const s of songs)
      insertSongFts.run(s.rowid, norm(s.title), norm(s.author), norm(lyricsOfSections(JSON.parse(s.sections_json))));
    const insertParaFts = db.prepare('INSERT INTO paragraph_fts (rowid, text) VALUES (?,?)');
    const paras = db.prepare('SELECT rowid, text FROM paragraphs').all() as { rowid: number; text: string }[];
    for (const p of paras) insertParaFts.run(p.rowid, norm(p.text));
    db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
      .run(STAMP_KEY, JSON.stringify(NORM_VERSION));
  })();
}
