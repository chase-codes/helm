import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { NewSongInput, SearchField, Song, SongSearchResult, UpdateSongInput } from '../shared/types';
import { SONG_FTS_COLUMNS } from './schema';
import { norm } from '../shared/search/fuzzy';
import { rankSongs } from '../shared/search/songScore';
import { splitToSlides } from '../shared/songs/splitToSlides';
import { lyricsOf, lyricsOfSections } from '../shared/songs/lyrics';
import { orPrefixMatch, ftsTerm, FTS_CANDIDATE_LIMIT } from './ftsQuery';

export interface SongsRepo {
  list(): Song[];
  get(id: string): Song | null;
  add(input: NewSongInput): Song;
  /** Insert many songs under ONE transaction (one fsync), with per-song failure isolation:
   * each song runs inside its own SAVEPOINT, so a bad one rolls back alone and its
   * neighbours still land. Result is positional — `{ song }` or `{ error }` per input. */
  addBatch(inputs: NewSongInput[]): ({ song: Song } | { error: string })[];
  update(id: string, input: UpdateSongInput): Song;
  /** Permanent removal from the library (#90). Deletes the FTS row in the same
   * transaction — song_fts is a plain external-content-free fts5 table with no triggers,
   * so a `songs` delete alone would leave an orphan row that keeps matching searches and
   * then mis-attributes itself to whatever song later reuses that rowid. */
  remove(id: string): Song[];
  search(q: string, field: SearchField): SongSearchResult[];
  count(): number;
}
interface Row { id: string; title: string; author: string; sections_json: string; source: string; created_at: number; music_key: string; rowid: number }
// bm25() weights per search field, keyed by song_fts column name and rendered in
// SONG_FTS_COLUMNS order so the positional bm25() args can never drift from the DDL.
// Literal constants in the SQL, not bound parameters — FTS5 auxiliary-function args
// must be constant in some builds, and these never vary at runtime.
type FtsColumn = (typeof SONG_FTS_COLUMNS)[number];
const bm25For = (w: Record<FtsColumn, number>): string =>
  `bm25(song_fts, ${SONG_FTS_COLUMNS.map((c) => w[c].toFixed(1)).join(', ')})`;
const BM25: Record<SearchField, string> = {
  all: bm25For({ title: 8, author: 2, lyrics: 1 }),
  title: bm25For({ title: 1, author: 0, lyrics: 0 }),
  lyric: bm25For({ title: 0, author: 0, lyrics: 1 }),
};
const toSong = (r: Row): Song => ({
  id: r.id, title: r.title, author: r.author, sections: JSON.parse(r.sections_json),
  source: r.source, createdAt: r.created_at, ...(r.music_key ? { key: r.music_key } : {})
});

export function createSongsRepo(db: Database.Database): SongsRepo {
  const insertSong = db.prepare('INSERT INTO songs (id, title, author, sections_json, source, created_at, music_key) VALUES (?,?,?,?,?,?,?)');
  const insertFts = db.prepare('INSERT INTO song_fts (rowid, title, author, lyrics) VALUES ((SELECT rowid FROM songs WHERE id = ?),?,?,?)');
  const updateSong = db.prepare('UPDATE songs SET title = ?, author = ?, sections_json = ?, music_key = ? WHERE id = ?');
  const updateFts = db.prepare('UPDATE song_fts SET title = ?, author = ?, lyrics = ? WHERE rowid = (SELECT rowid FROM songs WHERE id = ?)');
  // FTS row first, while `songs` still holds the rowid the subquery resolves through.
  const deleteFts = db.prepare('DELETE FROM song_fts WHERE rowid = (SELECT rowid FROM songs WHERE id = ?)');
  const deleteSong = db.prepare('DELETE FROM songs WHERE id = ?');
  // The insert itself, transaction-free: `add` wraps it in one, `addBatch` in a SAVEPOINT.
  const insertOne = (input: NewSongInput): Song => {
    const sections = splitToSlides(input.text);
    if (!sections.length) throw new Error('Song has no content');
    const key = input.key?.trim();
    const song: Song = { id: randomUUID(), title: input.title.trim() || 'Untitled Song', author: input.author?.trim() ?? '', sections, source: input.source ?? 'local', createdAt: Date.now(), ...(key ? { key } : {}) };
    insertSong.run(song.id, song.title, song.author, JSON.stringify(song.sections), song.source, song.createdAt, key ?? '');
    insertFts.run(song.id, song.title, song.author, lyricsOf(song));
    // No songCache.delete here: the id is freshly minted (randomUUID above), so the
    // cache can hold no stale entry for it.
    return song;
  };
  // Memoized Song objects by id: JSON.parse of sections_json was measured at up to
  // ~36 ms per keystroke at 10k songs, and object identity is what keys the scorer's
  // per-song doc cache. Writes DELETE from the cache (never insert) so a rolled-back
  // transaction can never leave a ghost — the next read lazily re-caches from the row.
  // Unbounded by design, never evicted on read: one list() call residents the whole
  // parsed library, and that IS the point — a song's memory cost is trivial next to
  // the JSON.parse it saves on every subsequent keystroke. Only a write ever shrinks it.
  const songCache = new Map<string, Song>();
  const toSongCached = (r: Row): Song => {
    const hit = songCache.get(r.id);
    if (hit) return hit;
    const s = toSong(r);
    songCache.set(r.id, s);
    return s;
  };
  // Both candidate paths must agree with list()'s ORDER BY created_at, title so a
  // full relevance tie ranks identically on either path (W7, guarded by the repo test).
  const libraryOrder = (a: Song, b: Song): number =>
    a.createdAt - b.createdAt || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  // P8: prepare once, not per keystroke (the probe was re-prepared per TOKEN).
  const probeStmt = db.prepare('SELECT 1 FROM song_fts WHERE song_fts MATCH ? LIMIT 1');
  // P7: the FTS query already JOINs songs — select the full row so the second
  // `rowid IN (...)` query (and the bound-variable dance) disappears. The LIMIT still
  // earns its keep even with the IN() gone: it caps the candidate set (and therefore
  // the JS scorer's per-keystroke work) a common token's match count would otherwise
  // blow past.
  const searchStmt = Object.fromEntries(
    (Object.keys(BM25) as SearchField[]).map((f) => [
      f,
      db.prepare(`SELECT s.rowid AS rowid, s.id AS id, s.title AS title, s.author AS author, s.sections_json AS sections_json, s.source AS source, s.created_at AS created_at, s.music_key AS music_key, -${BM25[f]} AS rel FROM song_fts JOIN songs s ON s.rowid = song_fts.rowid WHERE song_fts MATCH ? ORDER BY rel DESC LIMIT ${FTS_CANDIDATE_LIMIT}`),
    ])
  ) as Record<SearchField, ReturnType<typeof db.prepare>>;
  const list = (): Song[] => (db.prepare('SELECT rowid, * FROM songs ORDER BY created_at, title').all() as Row[]).map(toSongCached);
  const get = (id: string): Song | null => {
    const r = db.prepare('SELECT rowid, * FROM songs WHERE id = ?').get(id) as Row | undefined;
    return r ? toSongCached(r) : null;
  };
  return {
    list,
    get,
    count: () => (db.prepare('SELECT COUNT(*) AS n FROM songs').get() as { n: number }).n,
    add(input) {
      return db.transaction(() => insertOne(input))();
    },
    addBatch(inputs) {
      const out: ({ song: Song } | { error: string })[] = [];
      db.transaction(() => {
        for (const input of inputs) {
          // Raw SAVEPOINT rather than a nested db.transaction(): better-sqlite3 would
          // savepoint for us, but the node:sqlite test shim is non-nested, and the two
          // must behave identically for the isolation tests to mean anything.
          db.exec('SAVEPOINT song');
          try {
            out.push({ song: insertOne(input) });
            db.exec('RELEASE song');
          } catch (err) {
            db.exec('ROLLBACK TO song');
            db.exec('RELEASE song');
            out.push({ error: err instanceof Error ? err.message : String(err) });
          }
        }
      })();
      return out;
    },
    update(id, input) {
      const existing = get(id);
      if (!existing) throw new Error('Song not found');
      const sections = input.sections
        .map((s) => ({ label: s.label, lines: s.lines.map((l) => l.trim()).filter(Boolean) }))
        .filter((s) => s.lines.length);
      if (!sections.length) throw new Error('Song has no content');
      const title = input.title.trim() || 'Untitled Song';
      const author = input.author?.trim() ?? '';
      const key = input.key?.trim() ?? '';
      const song: Song = {
        id, title, author, sections,
        source: existing.source, createdAt: existing.createdAt,
        ...(key ? { key } : {})
      };
      db.transaction(() => {
        updateSong.run(title, author, JSON.stringify(sections), key, id);
        updateFts.run(title, author, lyricsOfSections(sections), id);
      })();
      songCache.delete(id);
      return song;
    },
    remove(id) {
      db.transaction(() => {
        deleteFts.run(id);
        deleteSong.run(id);
      })();
      songCache.delete(id);
      return list();
    },
    search(q, field) {
      const tokens = norm(q).split(' ').filter(Boolean);
      if (!tokens.length) return rankSongs('', list(), field);
      const tokenHasHit = (t: string): boolean => (probeStmt.get(ftsTerm(t, true)) as unknown) !== undefined;
      const match = orPrefixMatch(tokens);
      // bm25 gives TF-IDF relevance the JS scorer can't (#53); `field` arrives over
      // IPC, so it is whitelisted before selecting a prepared statement.
      const stmt = Object.hasOwn(searchStmt, field) ? searchStmt[field as SearchField] : searchStmt.all;
      const hits = stmt.all(match) as (Row & { rel: number })[];
      const rel = new Map(hits.map((h) => [h.id, h.rel]));
      let candidates: Song[];
      // Typo detection is per TOKEN, not per hit count (#13): any token with no FTS
      // hit of its own → scan the library (FTS rows keep their bm25 prior via `rel`).
      if (hits.length >= 30 && tokens.every((t) => tokenHasHit(t))) {
        candidates = hits.map(toSongCached).sort(libraryOrder);
      } else candidates = list(); // sparse hits or an unmatched token → typo likely; scorer handles fuzz
      return rankSongs(q, candidates, field, rel, 50);
    },
  };
}
