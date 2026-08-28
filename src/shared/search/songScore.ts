import type { Song, SongSection, SongSearchResult, SearchField } from '../types';
import { norm, bestMatch, bestSolidMatch, textSignals } from './fuzzy';

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
  coverage: number;        // # query tokens matched anywhere in the blob
  covWeight: number;       // Σ length of matched tokens — rare words outweigh stopwords (higher wins)
  dist: number;            // Σ best match distance of matched tokens (exact 0, prefix 1,
                           // fuzzy = edit distance) — lower wins; the only match-quality
                           // signal that survives into lyric mode (W5)
  rel: number;             // -bm25 relevance from FTS (0 when FTS didn't match) (#53)
  tf: number;              // total exact occurrences of query tokens (higher wins)
  titleStartsWith: boolean;// title begins with the whole query (wins)
  titleLen: number;        // shorter title wins
  title: string;           // lexicographic final tiebreak → fully insertion-order-independent
}

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
  const empty: ScoredSong = { score: 1, snippet: '', titleCoverage: 0, titleCloseness: 0, phrase: 0, coverage: 0, covWeight: 0, dist: 0, rel: 0, tf: 0, titleStartsWith: false, titleLen: title.length, title };
  if (!q) return empty;
  const qts = q.split(' ');

  // Token segments: phrase adjacency is transparent across line breaks (people
  // remember lyrics as continuous text) but blocked at section boundaries; the
  // title/author segment likewise never bridges into the lyrics.
  const segs: string[][] = [];
  if (field === 'title') segs.push(title.split(' '));
  else {
    if (field !== 'lyric') {
      // Title and author are separate segments (W9): "grace john" must not earn a
      // phrase run bridging "Amazing Grace" into "John Newton".
      const tw = title.split(' ').filter(Boolean);
      if (tw.length) segs.push(tw);
      const aw = norm(song.author).split(' ').filter(Boolean);
      if (aw.length) segs.push(aw);
    }
    for (const sc of song.sections) { const ws = norm(sc.lines.join(' ')).split(' ').filter(Boolean); if (ws.length) segs.push(ws); }
  }

  const sig = textSignals(segs, qts);
  const { matched, strongSolid, covWeight, tf, phrase, dist } = sig;

  let score = 0;
  // Title-substring band anchors at a WORD START (W3): "art" may hit "How Great
  // Thou Art" but never the inside of "Heart". A word-start hit at index i keeps
  // the exact legacy weight 1000 - i, so earlier-in-title still ranks higher and
  // word-start type-ahead ("wor" → Worship) is unchanged.
  if (field !== 'lyric') {
    if (title === q) score = 1200;
    else if (title.startsWith(q)) score = 1000;
    else {
      const i = title.indexOf(` ${q}`);
      if (i >= 0) score = 1000 - (i + 1);
    }
  }
  // Mid-word type-ahead: the operator's unfinished LAST token (<3 chars — too short
  // for prefix credit, fuzz-blind) must not collapse the full-match band the query
  // held one keystroke ago ("give me your ha" after "give me your h") (W2).
  const last = qts.length - 1;
  const trailingExempt = qts.length > 1 && qts[last].length < 3
    && sig.bestDist[last] === 99 && matched === qts.length - 1;
  if ((matched === qts.length || trailingExempt) && matched > 0) score = Math.max(score, 380 + matched * 12);
  // The partial band needs at least one significant matched token — 1-2 char stopwords
  // fuzz into nearly anything and must not qualify a song on their own.
  else if (strongSolid > 0 && field !== 'title') score = Math.max(score, 360);
  const snippet = withSnippet && score > 0 && field !== 'title' ? bestSnippet(qts, song.sections) : '';

  // Tie-break signals. Title-based signals only apply when the title is in scope; a
  // lyric-only search has no title relevance, so they stay neutral and the lyric
  // signals (phrase/coverage/rel/tf) decide.
  let titleCoverage = 0; let titleCloseness = 0;
  if (field !== 'lyric') {
    const titleWords = title.split(' ');
    for (const t of qts) {
      if (t.length < 3) continue; // mirror `strong`: a 1-2 char stopword fuzzes into any title (W2)
      // Title credit requires a SOLID match (mirrors strongSolid, Task 14): fuzzing
      // a token into a shorter, stopword-length title word — e.g. "your"→"you" in
      // "Great Are You Lord" — is noise, not signal, and must not win a tie-break
      // over a song whose real match is a longer, cleaner run in the lyrics.
      const d = bestSolidMatch(t, titleWords);
      if (d < 99) { titleCoverage++; titleCloseness += d; }
    }
  }
  const titleStartsWith = field !== 'lyric' && title.startsWith(q);
  return { score, snippet, titleCoverage, titleCloseness, phrase, coverage: matched, covWeight, dist, rel, tf, titleStartsWith, titleLen: title.length, title };
}

// Order by primary score, then by relevance sub-signals, then lexicographically by
// title. Insertion order can no longer decide a winner between two distinct titles.
function compareRelevance(a: ScoredSong, b: ScoredSong): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.titleCoverage !== a.titleCoverage) return b.titleCoverage - a.titleCoverage;
  if (b.covWeight !== a.covWeight) return b.covWeight - a.covWeight; // more of the query matched (W1) — stopwords weigh less
  if (a.titleCloseness !== b.titleCloseness) return a.titleCloseness - b.titleCloseness;
  if (a.dist !== b.dist) return a.dist - b.dist;                     // closer/more exact matches win (W5)
  if (b.phrase !== a.phrase) return b.phrase - a.phrase;             // …then contiguity of what matched
  if (b.coverage !== a.coverage) return b.coverage - a.coverage;
  if (b.rel !== a.rel) return b.rel - a.rel;
  if (b.tf !== a.tf) return b.tf - a.tf;
  if (a.titleStartsWith !== b.titleStartsWith) return a.titleStartsWith ? -1 : 1;
  if (a.titleLen !== b.titleLen) return a.titleLen - b.titleLen;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

export function rankSongs(query: string, songs: Song[], field: SearchField, rel?: Map<string, number>, limit = Infinity): SongSearchResult[] {
  const q = norm(query);
  if (!q) return songs.slice(0, limit).map((song) => ({ song, score: 1, snippet: '' }));
  const qts = q.split(' ');
  return songs
    .map((song) => ({ song, s: scoreSignals(query, song, field, rel?.get(song.id) ?? 0, false) }))
    .filter((r) => r.s.score > 0)
    .sort((a, b) => compareRelevance(a.s, b.s))
    .slice(0, limit)
    .map(({ song, s }) => ({ song, score: s.score, snippet: field !== 'title' ? bestSnippet(qts, song.sections) : '' }));
}
