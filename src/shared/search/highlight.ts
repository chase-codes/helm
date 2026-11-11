import { foldCompoundNames } from './verseScore';
import { matchDist, matchTol, norm } from './fuzzy';
import { modernWord } from './wording';

export interface HighlightSeg { text: string; hit: boolean }

// "Does this word count for any query token" — the same asymmetric `matchDist` the scorer
// uses (prefix anchored on the TOKEN), so what is bold is exactly what scored.
// Both sides go through `modernWord` first, as the verse scorer does: a query for "your
// neighbor" bolds "thy neighbour".
const isHit = (w: string, qts: string[]): boolean => {
  const m = modernWord(w);
  return qts.some((t) => matchDist(t, m) <= matchTol(t.length));
};

/** Split `text` into runs, marking the words a query token matches (exact / anchored
 * prefix / within edit tolerance). Adjacent runs with the same flag are merged.
 *
 * The word regex treats a letter–dash–letter run as one word — the bundled KJV writes
 * some compound proper nouns with an en dash ("Beth–lehem") — and each candidate word is
 * folded through `foldCompoundNames` before matching, so "Beth–lehem" bolds as a whole for
 * the query "bethlehem" instead of splitting into two unmatchable halves. */
export function highlightTokens(text: string, qts: string[]): HighlightSeg[] {
  if (!qts.length) return [{ text, hit: false }];
  qts = qts.map(modernWord);
  const out: HighlightSeg[] = [];
  const push = (t: string, hit: boolean): void => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += t;
    else out.push({ text: t, hit });
  };
  const re = /[A-Za-z0-9'’`]+(?:[–—-][A-Za-z0-9'’`]+)*/g;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    push(text.slice(i, start), false);
    const w = norm(foldCompoundNames(m[0]));
    push(m[0], w !== '' && isHit(w, qts));
    i = start + m[0].length;
  }
  push(text.slice(i), false);
  return out;
}
