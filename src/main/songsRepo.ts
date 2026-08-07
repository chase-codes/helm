import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { NewSongInput, SearchField, Song, SongSearchResult } from '../shared/types';
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
      const rowids = (db.prepare('SELECT rowid FROM song_fts WHERE song_fts MATCH ?').all(match) as { rowid: number }[]).map((r) => r.rowid);
      let candidates: Song[];
      if (rowids.length >= 30) {
        const qs = rowids.map(() => '?').join(',');
        candidates = (db.prepare(`SELECT rowid, * FROM songs WHERE rowid IN (${qs})`).all(...rowids) as Row[]).map(toSong);
      } else candidates = list(); // sparse FTS hits → typo likely; scan library, scorer handles fuzz
      return rankSongs(q, candidates, field).slice(0, 50);
    },
  };
}
