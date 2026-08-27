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
    return song;
  };
  const list = (): Song[] => (db.prepare('SELECT rowid, * FROM songs ORDER BY created_at, title').all() as Row[]).map(toSong);
  const get = (id: string): Song | null => {
    const r = db.prepare('SELECT rowid, * FROM songs WHERE id = ?').get(id) as Row | undefined;
    return r ? toSong(r) : null;
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
      return song;
    },
    remove(id) {
      db.transaction(() => {
        deleteFts.run(id);
        deleteSong.run(id);
      })();
      return list();
    },
    search(q, field) {
      const tokens = norm(q).split(' ').filter(Boolean);
      if (!tokens.length) return rankSongs('', list(), field);
      const tokenHasHit = (t: string): boolean =>
        (db.prepare('SELECT 1 FROM song_fts WHERE song_fts MATCH ? LIMIT 1').get(ftsTerm(t, true)) as unknown) !== undefined;
      const match = orPrefixMatch(tokens);
      // bm25 gives TF-IDF relevance the JS scorer can't (#53): stopwords are IDF-damped
      // and repeated terms count. Column weights per field; negated so higher = better.
      // Songs FTS didn't match simply carry no prior. `field` arrives over IPC, so it is
      // whitelisted before touching SQL text. The LIMIT keeps a common-token query's hit
      // list under the bound-variable cap of the IN() below — best-ranked hits survive.
      const bm25 = Object.hasOwn(BM25, field) ? BM25[field] : BM25.all;
      const hits = db.prepare(`SELECT s.rowid AS rowid, s.id AS id, -${bm25} AS rel FROM song_fts JOIN songs s ON s.rowid = song_fts.rowid WHERE song_fts MATCH ? ORDER BY rel DESC LIMIT ${FTS_CANDIDATE_LIMIT}`)
        .all(match) as { rowid: number; id: string; rel: number }[];
      const rel = new Map(hits.map((h) => [h.id, h.rel]));
      let candidates: Song[];
      // Typo detection is per TOKEN, not per hit count (#13): "holy reckelss" clears 30
      // hits on "holy" alone, and the song that matches only the misspelled token is then
      // never a candidate for the fuzzy scorer to rescue. Any token with no FTS hit of its
      // own → scan the library (FTS rows keep their bm25 prior via `rel`).
      if (hits.length >= 30 && tokens.every((t) => tokenHasHit(t))) {
        const qs = hits.map(() => '?').join(',');
        candidates = (db.prepare(`SELECT rowid, * FROM songs WHERE rowid IN (${qs}) ORDER BY created_at, title`).all(...hits.map((h) => h.rowid)) as Row[]).map(toSong);
      } else candidates = list(); // sparse hits or an unmatched token → typo likely; scorer handles fuzz
      return rankSongs(q, candidates, field, rel, 50);
    },
  };
}
