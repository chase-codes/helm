import { expect, test } from 'vitest';
import { andGroupsMatch, ftsTerm, orPrefixMatch, FTS_CANDIDATE_LIMIT } from './ftsQuery';

test('ftsTerm quotes, escapes embedded quotes, and appends * for prefix', () => {
  expect(ftsTerm('love', true)).toBe('"love"*');
  expect(ftsTerm('love', false)).toBe('"love"');
  expect(ftsTerm('a"b', false)).toBe('"a""b"');
});

test('orPrefixMatch is the songs/quotes shape: prefix terms joined by OR', () => {
  expect(orPrefixMatch(['amaz', 'grace'])).toBe('"amaz"* OR "grace"*');
});

test('andGroupsMatch ANDs groups; the first alternative of each group is a prefix, the rest exact', () => {
  expect(andGroupsMatch([['zacch'], ['rich', 'riches']])).toBe('("zacch"*) AND ("rich"* OR "riches")');
});

test('candidate limit is shared', () => {
  expect(FTS_CANDIDATE_LIMIT).toBe(1000);
});
