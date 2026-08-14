import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { NewSongInput, SearchField, Song, SongSearchResult } from '../shared/types';
import { SONG_FTS_COLUMNS } from './schema';
import { norm } from '../shared/search/fuzzy';
import { rankSongs } from '../shared/search/songScore';
import { splitToSlides } from '../shared/songs/splitToSlides';
import { lyricsOf } from '../shared/songs/lyrics';

export interface SongsRepo {
  list(): Song[];
  get(id: string): Song | null;
  add(input: NewSongInput): Song;
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
  const list = (): Song[] => (db.prepare('SELECT rowid, * FROM songs ORDER BY created_at, title').all() as Row[]).map(toSong);
  return {
    list,
    get: (id) => { const r = db.prepare('SELECT rowid, * FROM songs WHERE id = ?').get(id) as Row | undefined; return r ? toSong(r) : null; },
    count: () => (db.prepare('SELECT COUNT(*) AS n FROM songs').get() as { n: number }).n,
    add(input) {
      const sections = splitToSlides(input.text);
      if (!sections.length) throw new Error('Song has no content');
      const key = input.key?.trim();
      const song: Song = { id: randomUUID(), title: input.title.trim() || 'Untitled Song', author: input.author?.trim() ?? '', sections, source: input.source ?? 'local', createdAt: Date.now(), ...(key ? { key } : {}) };
      db.transaction(() => {
        insertSong.run(song.id, song.title, song.author, JSON.stringify(song.sections), song.source, song.createdAt, key ?? '');
        insertFts.run(song.id, song.title, song.author, lyricsOf(song));
      })();
      return song;
    },
    search(q, field) {
      const tokens = norm(q).split(' ').filter(Boolean);
      if (!tokens.length) return rankSongs('', list(), field);
      const match = tokens.map((t) => `"${t}"*`).join(' OR ');
      // bm25 gives TF-IDF relevance the JS scorer can't (#53): stopwords are IDF-damped
      // and repeated terms count. Column weights per field; negated so higher = better.
      // Songs FTS didn't match simply carry no prior. `field` arrives over IPC, so it is
      // whitelisted before touching SQL text. The LIMIT keeps a common-token query's hit
      // list under the bound-variable cap of the IN() below — best-ranked hits survive.
      const bm25 = Object.hasOwn(BM25, field) ? BM25[field] : BM25.all;
      const hits = db.prepare(`SELECT s.rowid AS rowid, s.id AS id, -${bm25} AS rel FROM song_fts JOIN songs s ON s.rowid = song_fts.rowid WHERE song_fts MATCH ? ORDER BY rel DESC LIMIT 1000`)
        .all(match) as { rowid: number; id: string; rel: number }[];
      const rel = new Map(hits.map((h) => [h.id, h.rel]));
      let candidates: Song[];
      if (hits.length >= 30) {
        const qs = hits.map(() => '?').join(',');
        candidates = (db.prepare(`SELECT rowid, * FROM songs WHERE rowid IN (${qs})`).all(...hits.map((h) => h.rowid)) as Row[]).map(toSong);
      } else candidates = list(); // sparse FTS hits → typo likely; scan library, scorer handles fuzz
      return rankSongs(q, candidates, field, rel, 50);
    },
  };
}
