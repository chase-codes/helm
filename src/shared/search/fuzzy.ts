// Letters with no combining-mark decomposition (NFD leaves them whole), folded by hand.
const FOLD: Record<string, string> = { ß: 'ss', ø: 'o', đ: 'd', ł: 'l', æ: 'ae', œ: 'oe', þ: 'th' };

/** Fold to [a-z0-9 ]: accents are STRIPPED, not replaced by spaces — `Renuévame` must norm
 * to `renuevame`, not `renu vame`, or the fuzzy scorer never matches the word and the song
 * drops out of results entirely (#12). Matches what FTS does (`remove_diacritics 2`). */
export function norm(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[ßøđłæœþ]/g, (c) => FOLD[c])
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
  }
  return d[m][n];
}
// Levenshtein restricted to distances <= tol: exact inside the band, `tol + 1`
// beyond it, with a per-row early exit. Two rolling rows instead of the full
// matrix; cells with |i-j| > tol are clamped to tol+1 (their true distance is at
// least |i-j|, so the clamp can never fake an admissible path). `lev` stays
// exported and exact — tests and any caller needing true distances keep using it.
export function levWithin(a: string, b: string, tol: number): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > tol) return tol + 1;
  if (!m || !n) return Math.max(m, n); // <= tol by the guard above
  const BIG = tol + 1;
  let prev = Array.from({ length: n + 1 }, (_, j) => (j <= tol ? j : BIG));
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    let rowMin = BIG;
    for (let j = 0; j <= n; j++) {
      if (Math.abs(i - j) > tol) { cur[j] = BIG; continue; }
      if (j === 0) { cur[0] = i; rowMin = i; continue; }
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      cur[j] = v > BIG ? BIG : v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > tol) return BIG;
    const t = prev; prev = cur; cur = t;
  }
  return prev[n] > tol ? BIG : prev[n];
}
// Single source of truth for fuzzy-match tolerance by token length: short tokens
// (≤4) allow 1 edit, longer tokens allow 2. Used by fuzzyTok, songScore, and
// messageScore so every scorer agrees on len-5 (→ 2) and every other length.
export function matchTol(tokLen: number): number {
  return tokLen <= 4 ? 1 : 2;
}
export function fuzzyTok(tok: string, words: string[]): boolean {
  const tol = matchTol(tok.length);
  return words.some((w) => Math.abs(w.length - tok.length) <= 2 && lev(tok, w) <= tol);
}

// A token matches a word exactly (0), as an anchored prefix (1 — type-ahead: "wonder"
// finds "wonderful"; digit tokens prefix at any length so a partial tape number or
// "10" for "10000" keeps matching, word tokens need >=3 chars so short ones rely on
// edit tolerance), or within fuzzy edit tolerance. Anchoring at the word start is
// what keeps "son" from matching "person".
export function matchDist(t: string, w: string): number {
  if (w === t) return 0;
  if (w.length > t.length && w.startsWith(t) && (t.length >= 3 || /^[0-9]+$/.test(t))) return 1;
  // No caller admits a distance above 2 (matchTol's ceiling), so the DP may bail
  // early and report 3 for "too far" instead of computing the exact distance.
  return Math.abs(w.length - t.length) <= 2 ? levWithin(t, w, 2) : 99;
}

// Best matchDist of token `t` against any word in `words`, or 99 if nothing is
// within tolerance.
export function bestMatch(t: string, words: string[]): number {
  let best = 99;
  for (const w of words) {
    const dd = matchDist(t, w);
    if (dd === 0) return 0;
    if (dd < best) best = dd;
  }
  return best <= matchTol(t.length) ? best : 99;
}

// A match is "solid": exact, prefix, or a fuzz into a word at least as long as the
// token — OR a single-edit fuzz onto a word of 5+ chars (too long to be
// stopword-noise, e.g. an insertion typo like recukless→reckless). Fuzzing INTO a
// shorter word that's itself stopword-length (hand→and, your→you) cannot anchor a
// match on its own (W2). Single source of truth for textSignals' strongSolid and
// bestSolidMatch below.
function isSolidMatch(t: string, w: string, d: number): boolean {
  return w.length >= t.length || (w.length >= 5 && d <= 1);
}

// Like bestMatch, but only counts SOLID matches (see isSolidMatch) — a fuzz into a
// shorter, stopword-length word doesn't count even if it's within tolerance. Used
// where a fuzz match should carry relevance credit (e.g. title tie-break), not just
// admit a band (Task 14: "your"→"you" must not earn title relevance).
export function bestSolidMatch(t: string, words: string[]): number {
  let best = 99;
  for (const w of words) {
    const dd = matchDist(t, w);
    if (dd > matchTol(t.length) || !isSolidMatch(t, w, dd)) continue;
    if (dd === 0) return 0;
    if (dd < best) best = dd;
  }
  return best;
}

// Query tokens beyond this index don't take part in phrase runs (bitmask width);
// coverage/tf still count them. No real query comes close.
const PHRASE_MAX_TOKENS = 30;

export interface TextSignals {
  matched: number;   // # query tokens matched anywhere (whole-word: exact/prefix/fuzzy)
  strong: number;    // # matched tokens of length >= 3 — a 1-2 char stopword fuzzes into
                     // nearly anything, so it can never qualify a result on its own
  covWeight: number; // Σ length of matched tokens — a rare word outweighs two stopwords
  tf: number;        // total exact occurrences of query tokens
  phrase: number;    // longest run of consecutive query tokens found consecutively in a segment
  dist: number;      // Σ best match distance of each matched token (exact 0, prefix 1, fuzzy
                     // edit distance) — lower means closer/more exact matches overall.
                     // Additive: existing consumers (song/message scorers) ignore it.
  bestDist: number[]; // per query token: best admissible match distance, 99 = unmatched.
                      // Lets a caller see WHICH token missed (the trailing-token band
                      // exemption in songScore). Additive: other consumers ignore it.
  strongSolid: number; // strong tokens whose match is "solid": exact, prefix, or a fuzz
                       // into a word at least as long as the token — OR a single-edit
                       // fuzz onto a word of 5+ chars (too long to be stopword-noise,
                       // e.g. an insertion typo like recukless→reckless). Fuzzing INTO
                       // a shorter word that's itself stopword-length (hand→and,
                       // your→you) cannot anchor the partial band on its own (W2).
}

// Shared relevance pass for the song and message scorers. One fuzzy pass over the
// UNIQUE words of the segments (a repeated chorus is scored once): per word, a bitmask
// of query tokens it matches within tolerance (feeds the phrase run) and the best
// distance per token (feeds coverage). Phrase runs extend within a segment only —
// segment boundaries (sections, title vs body) block them.
export function textSignals(segs: string[][], qts: string[]): TextSignals {
  const counts = new Map<string, number>();
  for (const seg of segs) for (const w of seg) counts.set(w, (counts.get(w) ?? 0) + 1);
  const bestDist: number[] = qts.map(() => 99);
  const solid: boolean[] = qts.map(() => false);
  const wordMask = new Map<string, number>();
  for (const w of counts.keys()) {
    let mask = 0;
    for (let j = 0; j < qts.length; j++) {
      const d = matchDist(qts[j], w);
      if (d <= matchTol(qts[j].length)) {
        if (j < PHRASE_MAX_TOKENS) mask |= 1 << j;
        if (d < bestDist[j]) bestDist[j] = d;
        // Solid: see isSolidMatch — equal-or-longer word (exact/prefix/typo-fix), OR
        // a single-edit fuzz onto a word long enough (>=5) not to be stopword-noise.
        if (isSolidMatch(qts[j], w, d)) solid[j] = true;
      }
    }
    if (mask) wordMask.set(w, mask);
  }
  let matched = 0; let strong = 0; let strongSolid = 0; let covWeight = 0; let tf = 0; let dist = 0;
  for (let j = 0; j < qts.length; j++) {
    if (bestDist[j] < 99) {
      matched++; covWeight += qts[j].length; dist += bestDist[j];
      if (qts[j].length >= 3) { strong++; if (solid[j]) strongSolid++; }
    }
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
  return { matched, strong, strongSolid, covWeight, tf, phrase, dist, bestDist };
}
