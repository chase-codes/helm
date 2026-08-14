import type { Song, SongSection, SongSearchResult, SearchField } from '../types';
import { norm, lev, matchTol } from './fuzzy';

// A token matches a word exactly (0), as an anchored prefix (1 — type-ahead: "wonder"
// finds "wonderful"; ≥3 chars so short tokens rely on edit tolerance), or within fuzzy
// edit tolerance. Anchoring at the word start is what keeps "son" from matching "person".
function matchDist(t: string, w: string): number {
  if (w === t) return 0;
  if (t.length >= 3 && w.length > t.length && w.startsWith(t)) return 1;
  return Math.abs(w.length - t.length) <= 2 ? lev(t, w) : 99;
}

// Best matchDist of token `t` against any word in `words`, or 99 if nothing is within
// tolerance. Used for title words and snippet lines.
function bestMatch(t: string, words: string[]): number {
  let best = 99;
  for (const w of words) {
    const dd = matchDist(t, w);
    if (dd === 0) return 0;
    if (dd < best) best = dd;
  }
  return best <= matchTol(t.length) ? best : 99;
}

// Primary `score` (unchanged flat buckets) plus deterministic relevance sub-signals
// used only to break score ties (BUG-002, extended for #53). The sub-signals never
// affect ranking when scores differ; within a bucket they order by phrase adjacency,
// coverage, bm25 and term frequency before falling back to title length/lexicographic.
export interface ScoredSong {
  score: number;
  snippet: string;
  titleCoverage: number;   // # query tokens fuzzy-matching a title word (higher wins)
  titleCloseness: number;  // total edit distance of those title matches (lower wins)
  phrase: number;          // longest run of consecutive query tokens found consecutively
                           // in the text (fuzzy per-word; line breaks transparent,
                           // section boundaries block) — a verbatim phrase wins (#53)
  coverage: number;        // # query tokens matched anywhere in the blob (higher wins)
  rel: number;             // -bm25 relevance from FTS (0 when FTS didn't match) (#53)
  tf: number;              // total exact occurrences of query tokens (higher wins)
  titleStartsWith: boolean;// title begins with the whole query (wins)
  titleLen: number;        // shorter title wins
  title: string;           // lexicographic final tiebreak → fully insertion-order-independent
}

// Query tokens beyond this index don't participate in phrase runs (bitmask width);
// coverage/tf still count them. No real query comes close.
const PHRASE_MAX_TOKENS = 30;

// Snippet: the line (or two-line window) with the most distinct query-token matches,
// whole-word with fuzzy tolerance — never an unanchored substring, and independent of
// the score (#53). A two-line window wins only when it genuinely beats every single line,
// so cross-line phrases surface as "line one / line two".
function bestSnippet(qts: string[], sections: SongSection[]): string {
  const density = (words: string[]): number => {
    let n = 0;
    for (const t of qts) if (bestMatch(t, words) < 99) n++;
    return n;
  };
  let single = { d: 0, text: '' };
  let pair = { d: 0, text: '' };
  for (const sc of sections) {
    const words = sc.lines.map((ln) => norm(ln).split(' ').filter(Boolean));
    for (let i = 0; i < sc.lines.length; i++) {
      const d1 = density(words[i]);
      if (d1 > single.d) single = { d: d1, text: sc.lines[i] };
      if (i + 1 < sc.lines.length) {
        const d2 = density(words[i].concat(words[i + 1]));
        if (d2 > pair.d) pair = { d: d2, text: `${sc.lines[i]} / ${sc.lines[i + 1]}` };
      }
    }
  }
  return pair.d > single.d ? pair.text : single.text;
}

export function scoreSong(query: string, song: Song, field: SearchField, rel = 0): ScoredSong {
  return scoreSignals(query, song, field, rel, true);
}

// `withSnippet=false` skips the snippet scan: it never affects ranking, so rankSongs
// only pays for it on the rows it actually returns.
function scoreSignals(query: string, song: Song, field: SearchField, rel: number, withSnippet: boolean): ScoredSong {
  const q = norm(query);
  const title = norm(song.title);
  const empty: ScoredSong = { score: 1, snippet: '', titleCoverage: 0, titleCloseness: 0, phrase: 0, coverage: 0, rel: 0, tf: 0, titleStartsWith: false, titleLen: title.length, title };
  if (!q) return empty;
  const qts = q.split(' ');

  // Token segments: phrase adjacency is transparent across line breaks (people
  // remember lyrics as continuous text) but blocked at section boundaries; the
  // title/author segment likewise never bridges into the lyrics.
  const segs: string[][] = [];
  if (field === 'title') segs.push(title.split(' '));
  else {
    if (field !== 'lyric') { const tw = norm(`${song.title} ${song.author}`).split(' ').filter(Boolean); if (tw.length) segs.push(tw); }
    for (const sc of song.sections) { const ws = norm(sc.lines.join(' ')).split(' ').filter(Boolean); if (ws.length) segs.push(ws); }
  }

  // One fuzzy pass over UNIQUE words — a repeated chorus is scored once. Per word:
  // a bitmask of query tokens it matches within tolerance (feeds the phrase run) and
  // the best distance per token (feeds coverage).
  const counts = new Map<string, number>();
  for (const seg of segs) for (const w of seg) counts.set(w, (counts.get(w) ?? 0) + 1);
  const bestDist: number[] = qts.map(() => 99);
  const wordMask = new Map<string, number>();
  for (const w of counts.keys()) {
    let mask = 0;
    for (let j = 0; j < qts.length; j++) {
      const t = qts[j];
      const d = matchDist(t, w);
      if (d <= matchTol(t.length)) {
        if (j < PHRASE_MAX_TOKENS) mask |= 1 << j;
        if (d < bestDist[j]) bestDist[j] = d;
      }
    }
    if (mask) wordMask.set(w, mask);
  }
  let matched = 0; let tf = 0;
  for (let j = 0; j < qts.length; j++) {
    if (bestDist[j] < 99) matched++;
    tf += counts.get(qts[j]) ?? 0;
  }

  // Longest run of consecutive query tokens appearing consecutively in a segment:
  // run[j] extends run[j-1] from the previous word. O(words × tokens), no lev calls.
  let phrase = 0;
  let prev: number[] = qts.map(() => 0);
  let cur: number[] = qts.map(() => 0);
  for (const seg of segs) {
    prev.fill(0);
    for (const w of seg) {
      const mask = wordMask.get(w) ?? 0;
      for (let j = 0; j < qts.length; j++) {
        cur[j] = j < PHRASE_MAX_TOKENS && (mask >> j) & 1 ? (j > 0 ? prev[j - 1] : 0) + 1 : 0;
        if (cur[j] > phrase) phrase = cur[j];
      }
      const swap = prev; prev = cur; cur = swap;
    }
  }

  let score = 0;
  if (field !== 'lyric') { if (title === q) score = 1200; else if (title.includes(q)) score = 1000 - title.indexOf(q); }
  if (matched === qts.length && matched > 0) score = Math.max(score, 380 + matched * 12);
  else if (matched > 0 && field !== 'title') score = Math.max(score, 360);
  const snippet = withSnippet && score > 0 && field !== 'title' ? bestSnippet(qts, song.sections) : '';

  // Tie-break signals. Title-based signals only apply when the title is in scope; a
  // lyric-only search has no title relevance, so they stay neutral and the lyric
  // signals (phrase/coverage/rel/tf) decide.
  let titleCoverage = 0; let titleCloseness = 0;
  if (field !== 'lyric') {
    const titleWords = title.split(' ');
    for (const t of qts) { const d = bestMatch(t, titleWords); if (d < 99) { titleCoverage++; titleCloseness += d; } }
  }
  const titleStartsWith = field !== 'lyric' && title.startsWith(q);
  return { score, snippet, titleCoverage, titleCloseness, phrase, coverage: matched, rel, tf, titleStartsWith, titleLen: title.length, title };
}

// Order by primary score, then by relevance sub-signals, then lexicographically by
// title. Insertion order can no longer decide a winner between two distinct titles.
function compareRelevance(a: ScoredSong, b: ScoredSong): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.titleCoverage !== a.titleCoverage) return b.titleCoverage - a.titleCoverage;
  if (a.titleCloseness !== b.titleCloseness) return a.titleCloseness - b.titleCloseness;
  if (b.phrase !== a.phrase) return b.phrase - a.phrase;
  if (b.coverage !== a.coverage) return b.coverage - a.coverage;
  if (b.rel !== a.rel) return b.rel - a.rel;
  if (b.tf !== a.tf) return b.tf - a.tf;
  if (a.titleStartsWith !== b.titleStartsWith) return a.titleStartsWith ? -1 : 1;
  if (a.titleLen !== b.titleLen) return a.titleLen - b.titleLen;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

export function rankSongs(query: string, songs: Song[], field: SearchField, rel?: Map<string, number>, limit = Infinity): SongSearchResult[] {
  const q = norm(query);
  if (!q) return songs.map((song) => ({ song, score: 1, snippet: '' }));
  const qts = q.split(' ');
  return songs
    .map((song) => ({ song, s: scoreSignals(query, song, field, rel?.get(song.id) ?? 0, false) }))
    .filter((r) => r.s.score > 0)
    .sort((a, b) => compareRelevance(a.s, b.s))
    .slice(0, limit)
    .map(({ song, s }) => ({ song, score: s.score, snippet: field !== 'title' ? bestSnippet(qts, song.sections) : '' }));
}
