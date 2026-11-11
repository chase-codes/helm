import { norm, textSignals } from './fuzzy';
import { canonicalBookIndex } from '../scripture/books';
import { modernWord } from './wording';

export interface VerseHit {
  book: string; chapter: number; verse: number; text: string;
  /** Set on a CLOSE match: the verse holds all but one of the query's words. Listed after
   * the exact hits, never counted in `total` — see rankNearVerses. */
  near?: boolean;
}
export interface VerseSignals { score: number; phrase: number; covWeight: number; dist: number }

export const verseKey = (v: { book: string; chapter: number; verse: number }): string => `${v.book}:${v.chapter}:${v.verse}`;

// The bundled KJV writes some compound proper nouns with an en dash — "Beth–lehem",
// "Beer–sheba" — and the shared word tokenizer (norm) treats any dash as a word
// boundary, splitting them into two unmatchable halves. Joining the dash away before
// indexing/scoring fixes search without touching the DISPLAY text (callers pass the
// original verse.text to getChapter/insertVerse; only the FTS/scoring copy is folded).
export function foldCompoundNames(text: string): string {
  return text.replace(/(?<=[A-Za-z])[–—-](?=[A-Za-z])/g, '');
}

/** Tokens via the shared normaliser; a query wrapped in double quotes is a phrase query
 * (the words must appear in order). A lone leading quote — the entry's "force text search"
 * escape — is just stripped. */
export function parseVerseQuery(q: string): { tokens: string[]; phrase: boolean } {
  const raw = (q || '').trim();
  const phrase = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
  const tokens = norm(raw).split(' ').filter(Boolean);
  return { tokens, phrase };
}

/** Flat primary score (every token matches or the verse is out), plus the sub-signals that
 * order the plateau — same shape as scoreQuote. One segment: a verse is one unit. */
export function scoreVerse(qts: string[], phrase: boolean, text: string, near = false): VerseSignals {
  const none = { score: 0, phrase: 0, covWeight: 0, dist: 0 };
  if (!qts.length) return none;
  // Both sides in modern spelling (wording.ts): "your" finds "thy", "loves" finds "loveth".
  const words = norm(foldCompoundNames(text)).split(' ').filter(Boolean).map(modernWord);
  const s = textSignals([words], qts.map(modernWord));
  if (near) {
    // Exactly one word short, and at least two real words (3+ letters, solidly matched)
    // holding it up — "the lord is my xyz" must not admit a verse on "the … is my" alone.
    if (s.matched !== qts.length - 1 || s.strongSolid < 2) return none;
  } else {
    if (s.matched < qts.length) return none;
    if (phrase && s.phrase < qts.length) return none;
  }
  return { score: 300 + s.matched * 12, phrase: s.phrase, covWeight: s.covWeight, dist: s.dist };
}

/** A query has a CLOSE-match tier only when it is three or more words and not a quoted
 * phrase: with two words, "all but one" is a one-word search ("prodigal son" would list
 * every verse with "son"), and a quoted phrase asked for exactly those words. */
export function hasNearTier(q: string): boolean {
  const { tokens, phrase } = parseVerseQuery(q);
  return !phrase && tokens.length >= 3;
}

/** Order: score ↓, phrase run ↓, covWeight ↓, dist ↑, then canonical (book, chapter, verse) ↑
 * so the result never depends on FTS return order. dist is the sum of each matched token's
 * best match distance (exact 0 < anchored prefix 1 < fuzzy edit distance) — an exact/closer
 * match outranks a looser one covering the same words. Neither bm25 nor raw term-frequency
 * is a tie-break: bm25's length normalisation would rank "Zaccheus, make haste" over the
 * verse the story starts on, and raw tf rewards a long verse's incidental repeats of short
 * words ("in", "the"...) as much as a real second mention of the query's actual subject.
 * bm25 only decides which candidates survive the repo's LIMIT. */
export function rankVerses(q: string, rows: VerseHit[], limit = 50, near = false): VerseHit[] {
  const { tokens, phrase } = parseVerseQuery(q);
  if (!tokens.length) return [];
  return rows
    .map((r) => ({ r, s: scoreVerse(tokens, phrase, r.text, near) }))
    .filter((x) => x.s.score > 0)
    .sort((a, b) => {
      if (b.s.score !== a.s.score) return b.s.score - a.s.score;
      if (b.s.phrase !== a.s.phrase) return b.s.phrase - a.s.phrase;
      if (b.s.covWeight !== a.s.covWeight) return b.s.covWeight - a.s.covWeight;
      if (a.s.dist !== b.s.dist) return a.s.dist - b.s.dist;
      const bi = canonicalBookIndex(a.r.book) - canonicalBookIndex(b.r.book);
      if (bi) return bi;
      if (a.r.chapter !== b.r.chapter) return a.r.chapter - b.r.chapter;
      return a.r.verse - b.r.verse;
    })
    .slice(0, limit)
    .map((x) => x.r);
}

/** The CLOSE-match tier: verses holding all but one of the query's words, for the misquote
 * and the other-translation wording ("for god so loved the earth", "love your neighbor" in
 * a KJV that says "thy neighbour"). Same ladder as rankVerses — phrase run first, so the
 * verse that says most of it in order leads, then matched weight, so the word that went
 * missing is the short one. Empty for queries with no near tier (see hasNearTier). */
export function rankNearVerses(q: string, rows: VerseHit[], limit = 50): VerseHit[] {
  if (!hasNearTier(q)) return [];
  return rankVerses(q, rows, limit, true).map((r) => ({ ...r, near: true }));
}
