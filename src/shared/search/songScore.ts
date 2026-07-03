import type { Song, SongSearchResult, SearchField } from '../types';
import { norm, lev } from './fuzzy';

const lyricsOf = (s: Song) => s.sections.map((sc) => sc.lines.join(' ')).join(' ');
const blobOf = (s: Song) => `${s.title} ${s.author} ${lyricsOf(s)}`;

export function scoreSong(query: string, song: Song, field: SearchField): { score: number; snippet: string } {
  const q = norm(query);
  if (!q) return { score: 1, snippet: '' };
  const title = norm(song.title);
  const blob = field === 'title' ? title : field === 'lyric' ? norm(lyricsOf(song)) : norm(blobOf(song));
  let score = 0; let snippet = '';
  if (field !== 'lyric') { if (title === q) score = 1200; else if (title.includes(q)) score = 1000 - title.indexOf(q); }
  const words = blob.split(' '); const qts = q.split(' '); let matched = 0;
  for (const t of qts) {
    let best = 99;
    for (const w of words) {
      if (w === t) { best = 0; break; }
      if (Math.abs(w.length - t.length) <= 2) { const dd = lev(t, w); if (dd < best) best = dd; }
    }
    const tol = t.length <= 4 ? 1 : 2; if (best <= tol) matched++;
  }
  if (matched === qts.length && matched > 0) score = Math.max(score, 380 + matched * 12);
  for (const sc of song.sections) {
    for (const ln of sc.lines) { if (qts.some((t) => t.length > 2 && norm(ln).includes(t))) { snippet = ln; break; } }
    if (snippet) break;
  }
  if (field === 'title' && snippet) snippet = '';
  if (snippet && score < 360 && field !== 'title') score = 360;
  return { score, snippet };
}

export function rankSongs(query: string, songs: Song[], field: SearchField): SongSearchResult[] {
  if (!norm(query)) return songs.map((song) => ({ song, score: 1, snippet: '' }));
  return songs
    .map((song) => ({ song, ...scoreSong(query, song, field) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}
