import { norm, textSignals } from './fuzzy';
import { BOOKS } from '../scripture/books';

export interface VerseHit { book: string; chapter: number; verse: number; text: string }
export interface VerseSignals { score: number; phrase: number; covWeight: number; tf: number }

export const verseKey = (v: { book: string; chapter: number; verse: number }): string => `${v.book}:${v.chapter}:${v.verse}`;

const BOOK_INDEX = new Map(BOOKS.map((b, i) => [b.name, i]));
const bookIndex = (name: string): number => BOOK_INDEX.get(name) ?? Number.MAX_SAFE_INTEGER;

/** Tokens via the shared normaliser; a query wrapped in double quotes is a phrase query
 * (the words must appear in order). A lone leading quote — the entry's "force text search"
 * escape — is just stripped. */
export function parseVerseQuery(q: string): { tokens: string[]; phrase: boolean } {
  const raw = (q || '').trim();
  const phrase = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
  const tokens = norm(raw).split(' ').filter(Boolean);
  return { tokens, phrase };
}

// tf counts exact repeats, but only for tokens with real content (length >= 4). Short
// query words ("in", "the", "art"...) repeat by grammatical accident in any long verse —
// letting them decide a tie would rank a verse ahead of a phrase's own source purely
// because it happens to be a longer sentence. bm25 is deliberately not this filter's
// job: it's a candidate-limit cut, not a tie-break (see rankVerses below).
const CONTENT_TOKEN_MIN = 4;

/** Flat primary score (every token matches or the verse is out), plus the sub-signals that
 * order the plateau — same shape as scoreQuote. One segment: a verse is one unit. */
export function scoreVerse(qts: string[], phrase: boolean, text: string): VerseSignals {
  if (!qts.length) return { score: 0, phrase: 0, covWeight: 0, tf: 0 };
  const words = norm(text).split(' ').filter(Boolean);
  const s = textSignals([words], qts);
  if (s.matched < qts.length) return { score: 0, phrase: 0, covWeight: 0, tf: 0 };
  if (phrase && s.phrase < qts.length) return { score: 0, phrase: 0, covWeight: 0, tf: 0 };
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  let tf = 0;
  for (const t of qts) if (t.length >= CONTENT_TOKEN_MIN) tf += counts.get(t) ?? 0;
  return { score: 300 + s.matched * 12, phrase: s.phrase, covWeight: s.covWeight, tf };
}

/** Order: score ↓, phrase run ↓, covWeight ↓, tf ↓, then canonical (book, chapter, verse) ↑
 * so the result never depends on FTS return order. bm25 is deliberately NOT a tie-break:
 * its length normalisation would rank "Zaccheus, make haste" over the verse the story
 * starts on; it only decides which candidates survive the repo's LIMIT. */
export function rankVerses(q: string, rows: VerseHit[], limit = 50): VerseHit[] {
  const { tokens, phrase } = parseVerseQuery(q);
  if (!tokens.length) return [];
  return rows
    .map((r) => ({ r, s: scoreVerse(tokens, phrase, r.text) }))
    .filter((x) => x.s.score > 0)
    .sort((a, b) => {
      if (b.s.score !== a.s.score) return b.s.score - a.s.score;
      if (b.s.phrase !== a.s.phrase) return b.s.phrase - a.s.phrase;
      if (b.s.covWeight !== a.s.covWeight) return b.s.covWeight - a.s.covWeight;
      if (b.s.tf !== a.s.tf) return b.s.tf - a.s.tf;
      const bi = bookIndex(a.r.book) - bookIndex(b.r.book);
      if (bi) return bi;
      if (a.r.chapter !== b.r.chapter) return a.r.chapter - b.r.chapter;
      return a.r.verse - b.r.verse;
    })
    .slice(0, limit)
    .map((x) => x.r);
}
