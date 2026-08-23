import { describe, expect, test } from 'vitest';
import { norm, lev, fuzzyTok, matchTol, textSignals } from './fuzzy';

describe('norm', () => {
  test('lowercases, strips apostrophes and punctuation, collapses spaces', () => {
    expect(norm("’Twas Grace  that taught!")).toBe('twas grace that taught');
    expect(norm("I'd Rather")).toBe('id rather');
    expect(norm('It wasn’t me, I’d say')).toBe('it wasnt me id say');
  });
});
describe('lev', () => {
  test('edit distances', () => {
    expect(lev('grace', 'grace')).toBe(0);
    expect(lev('beleive', 'believe')).toBe(2);
    expect(lev('', 'abc')).toBe(3);
  });
});
describe('matchTol', () => {
  test('short tokens (≤4) allow 1 edit, longer allow 2 — resolves len-5 divergence', () => {
    expect(matchTol(4)).toBe(1);
    expect(matchTol(5)).toBe(2);
    expect(matchTol(6)).toBe(2);
  });
});
describe('fuzzyTok', () => {
  test('tolerance scales with token length', () => {
    expect(fuzzyTok('beleive', ['believe'])).toBe(true);  // len 7 → tol 2
    expect(fuzzyTok('gras', ['grab'])).toBe(true);        // len 4 → tol 1, lev 1
    expect(fuzzyTok('cat', ['dog'])).toBe(false);
  });
});
describe('textSignals dist', () => {
  test('sums best match distance per matched token: exact 0, prefix 1, fuzzy = edit distance', () => {
    expect(textSignals([['jesus', 'wept']], ['jesus', 'wept']).dist).toBe(0);
    expect(textSignals([['wonderful', 'grace']], ['wonder', 'grace']).dist).toBe(1); // "wonder" prefixes "wonderful"
    expect(textSignals([['grace']], ['grase']).dist).toBe(1); // 1 edit
    // one exact (0) + one prefix (1) + one fuzzy (2) → 3
    expect(textSignals([['jesus', 'wonderful', 'grasey']], ['jesus', 'wonder', 'grace']).dist).toBe(0 + 1 + 2);
  });
});
