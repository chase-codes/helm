// Startup upgrades for the `songs` table, run once per launch from openDb(). Kept out of
// db.ts (which loads the native better-sqlite3 binary) so tests can run them on node:sqlite.
import type Database from 'better-sqlite3';
import { SONG_ADDED_COLUMNS } from './schema';
import { isMusicKey, normalizeKey } from '../shared/songs/musicKey';

/** Adds any SONG_ADDED_COLUMNS column an older helm.db lacks. A fresh DB already has
 * them all (SCHEMA's CREATE TABLE derives from the same list), so this is a no-op there. */
export function ensureSongColumns(db: Database.Database): void {
  const have = new Set((db.prepare('PRAGMA table_info(songs)').all() as { name: string }[]).map((c) => c.name));
  for (const { column, ddl } of SONG_ADDED_COLUMNS)
    if (!have.has(column)) db.exec(`ALTER TABLE songs ADD COLUMN ${column} ${ddl}`);
}

export interface MusicKeyCleanup { canonicalized: number; legacy: number; cleared: number }

/** Song keys spec, Phase 1a: every stored `music_key` goes through normalizeKey once per
 * launch. A value that parses is rewritten to its canonical spelling. A value that does not
 * parse is kept exactly as typed and marked `music_key_source = 'legacy'`, so the No key tab
 * can show "Was: capo 2 G" and a person decides. Idempotent, and an already-canonical key is
 * never written (it is skipped before normalizeKey even runs).
 *
 * Two cases the spec leaves open, decided here:
 * - A modulation ("G-A" → key G, endKey A) stays legacy: the field holds one key, and
 *   rewriting it to "G" would silently drop the A.
 * - A placeholder normalizeKey reads as empty ("N/A", "TBD", "-") is cleared to no key.
 *   It says nothing a person needs to decide on, and the song lands on No key either way. */
export function canonicalizeStoredMusicKeys(db: Database.Database): MusicKeyCleanup {
  const rows = db.prepare(`SELECT id, music_key, music_key_source FROM songs WHERE music_key != ''`).all() as
    { id: string; music_key: string; music_key_source: string }[];
  const write = db.prepare('UPDATE songs SET music_key = ?, music_key_source = ? WHERE id = ?');
  const out: MusicKeyCleanup = { canonicalized: 0, legacy: 0, cleared: 0 };
  db.transaction(() => {
    for (const r of rows) {
      // Canonical already: untouched, whatever its source (including '' on pre-feature songs).
      // A canonical key still marked legacy (QuickAdd's songs:update fixed it) loses the mark.
      if (isMusicKey(r.music_key)) {
        if (r.music_key_source === 'legacy') { write.run(r.music_key, 'typed', r.id); out.canonicalized++; }
        continue;
      }
      const parsed = normalizeKey(r.music_key, 'field');
      if (parsed.kind === 'key' && (!parsed.endKey || parsed.endKey === parsed.key)) {
        const source = r.music_key_source === '' || r.music_key_source === 'legacy' ? 'typed' : r.music_key_source;
        write.run(parsed.key, source, r.id);
        out.canonicalized++;
      } else if (parsed.kind === 'empty') {
        write.run('', '', r.id);
        out.cleared++;
      } else if (r.music_key_source !== 'legacy') {
        write.run(r.music_key, 'legacy', r.id);
        out.legacy++;
      }
    }
  })();
  return out;
}
