import { describe, expect, test } from 'vitest';
import { norm, lev, fuzzyTok } from './fuzzy';

describe('norm', () => {
  test('lowercases, strips apostrophes and punctuation, collapses spaces', () => {
    expect(norm("'Twas Grace  that taught!")).toBe('twas grace that taught');
    expect(norm("I'd Rather")).toBe('id rather');
  });
});
describe('lev', () => {
  test('edit distances', () => {
    expect(lev('grace', 'grace')).toBe(0);
    expect(lev('beleive', 'believe')).toBe(2);
    expect(lev('', 'abc')).toBe(3);
  });
});
describe('fuzzyTok', () => {
  test('tolerance scales with token length', () => {
    expect(fuzzyTok('beleive', ['believe'])).toBe(true);  // len 7 → tol 2
    expect(fuzzyTok('gras', ['grab'])).toBe(true);        // len 4 → tol 1, lev 1
    expect(fuzzyTok('cat', ['dog'])).toBe(false);
  });
});
