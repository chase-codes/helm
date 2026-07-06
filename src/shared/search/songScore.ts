import type { Song, SongSearchResult, SearchField } from '../types';
import { norm, lev, matchTol } from './fuzzy';
import { lyricsOf } from '../songs/lyrics';

const blobOf = (s: Song): string => `${s.title} ${s.author} ${lyricsOf(s)}`;

// Best fuzzy edit distance of token `t` against any word in `words` (0 = exact),
// or 99 if nothing matches within tolerance. Shared shape as the blob match below.
function bestMatch(t: string, words: string[]): number {
  let best = 99;
  for (const w of words) {
    if (w === t) return 0;
    if (Math.abs(w.length - t.length) <= 2) { const dd = lev(t, w); if (dd < best) best = dd; }
  }
  return best <= matchTol(t.length) ? best : 99;
}

// Primary `score` (unchanged flat buckets) plus deterministic relevance sub-signals
// used only to break score ties (BUG-002). The sub-signals never affect ranking when
// scores differ; they replace the old fall-through to Array.sort insertion order.
export interface ScoredSong {
  score: number;
  snippet: string;
  titleCoverage: number;   // # query tokens fuzzy-matching a title word (higher wins)
  titleCloseness: number;  // total edit distance of those title matches (lower wins)
  coverage: number;        // # query tokens matched anywhere in the blob (higher wins)
  titleStartsWith: boolean;// title begins with the whole query (wins)
  titleLen: number;        // shorter title wins
  title: string;           // lexicographic final tiebreak → fully insertion-order-independent
}

export function scoreSong(query: string, song: Song, field: SearchField): ScoredSong {
  const q = norm(query);
  const title = norm(song.title);
  const empty: ScoredSong = { score: 1, snippet: '', titleCoverage: 0, titleCloseness: 0, coverage: 0, titleStartsWith: false, titleLen: title.length, title };
  if (!q) return empty;
  const blob = field === 'title' ? title : field === 'lyric' ? norm(lyricsOf(song)) : norm(blobOf(song));
  let score = 0; let snippet = '';
  if (field !== 'lyric') { if (title === q) score = 1200; else if (title.includes(q)) score = 1000 - title.indexOf(q); }
  const words = blob.split(' '); const qts = q.split(' '); let matched = 0;
  for (const t of qts) { if (bestMatch(t, words) < 99) matched++; }
  if (matched === qts.length && matched > 0) score = Math.max(score, 380 + matched * 12);
  for (const sc of song.sections) {
    for (const ln of sc.lines) { if (qts.some((t) => t.length > 2 && norm(ln).includes(t))) { snippet = ln; break; } }
    if (snippet) break;
  }
  if (field === 'title' && snippet) snippet = '';
  if (snippet && score < 360 && field !== 'title') score = 360;

  // Tie-break signals. Title-based signals only apply when the title is in scope; a
  // lyric-only search has no title relevance, so they stay neutral and coverage/length decide.
  let titleCoverage = 0; let titleCloseness = 0;
  if (field !== 'lyric') {
    const titleWords = title.split(' ');
    for (const t of qts) { const d = bestMatch(t, titleWords); if (d < 99) { titleCoverage++; titleCloseness += d; } }
  }
  const titleStartsWith = field !== 'lyric' && title.startsWith(q);
  return { score, snippet, titleCoverage, titleCloseness, coverage: matched, titleStartsWith, titleLen: title.length, title };
}

// Order by primary score, then by relevance sub-signals, then lexicographically by
// title. Insertion order can no longer decide a winner between two distinct titles.
function compareRelevance(a: ScoredSong, b: ScoredSong): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.titleCoverage !== a.titleCoverage) return b.titleCoverage - a.titleCoverage;
  if (a.titleCloseness !== b.titleCloseness) return a.titleCloseness - b.titleCloseness;
  if (b.coverage !== a.coverage) return b.coverage - a.coverage;
  if (a.titleStartsWith !== b.titleStartsWith) return a.titleStartsWith ? -1 : 1;
  if (a.titleLen !== b.titleLen) return a.titleLen - b.titleLen;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

export function rankSongs(query: string, songs: Song[], field: SearchField): SongSearchResult[] {
  if (!norm(query)) return songs.map((song) => ({ song, score: 1, snippet: '' }));
  return songs
    .map((song) => ({ song, s: scoreSong(query, song, field) }))
    .filter((r) => r.s.score > 0)
    .sort((a, b) => compareRelevance(a.s, b.s))
    .map(({ song, s }) => ({ song, score: s.score, snippet: s.snippet }));
}
