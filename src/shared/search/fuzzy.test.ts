import { describe, expect, test } from 'vitest';
import { norm, lev, levWithin, matchTol, matchDist, textSignals, bestSolidMatch } from './fuzzy';

describe('norm', () => {
  test('lowercases, strips apostrophes and punctuation, collapses spaces', () => {
    expect(norm("’Twas Grace  that taught!")).toBe('twas grace that taught');
    expect(norm("I'd Rather")).toBe('id rather');
    expect(norm('It wasn’t me, I’d say')).toBe('it wasnt me id say');
  });
  test('folds accents instead of splitting words on them (#12)', () => {
    expect(norm('Renuévame')).toBe('renuevame');
    expect(norm('Señor, Dios')).toBe('senor dios');
    expect(norm('Größe Ærø Łódź')).toBe('grosse aero lodz');
    expect(norm('café crème')).toBe('cafe creme');
  });
  test('norm joins digit-group commas so "10,000" is one token (W8)', () => {
    expect(norm('10,000 Reasons (Bless the Lord)')).toBe('10000 reasons bless the lord');
    expect(norm('1,000,000')).toBe('1000000');
    // Comma joins ONLY between digits — word commas still split:
    expect(norm('Holy, Holy, Holy')).toBe('holy holy holy');
    // Comma followed by a space is a list separator, not a digit group:
    expect(norm('Psalm 23, 16')).toBe('psalm 23 16');
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
describe('textSignals dist', () => {
  test('sums best match distance per matched token: exact 0, prefix 1, fuzzy = edit distance', () => {
    expect(textSignals([['jesus', 'wept']], ['jesus', 'wept']).dist).toBe(0);
    expect(textSignals([['wonderful', 'grace']], ['wonder', 'grace']).dist).toBe(1); // "wonder" prefixes "wonderful"
    expect(textSignals([['grace']], ['grase']).dist).toBe(1); // 1 edit
    // one exact (0) + one prefix (1) + one fuzzy (2) → 3
    expect(textSignals([['jesus', 'wonderful', 'grasey']], ['jesus', 'wonder', 'grace']).dist).toBe(0 + 1 + 2);
  });
});
describe('textSignals bestDist', () => {
  test('exposes per-token best distance, 99 for unmatched', () => {
    const s = textSignals([['give', 'me', 'your', 'hand']], ['give', 'your', 'zz']);
    expect(s.bestDist).toEqual([0, 0, 99]);
  });
});
describe('textSignals strongSolid', () => {
  test('a fuzz into a SHORTER word is not solid; equal-or-longer is', () => {
    expect(textSignals([['and']], ['hand']).strongSolid).toBe(0);   // hand→and (4→3): noise signature
    expect(textSignals([['sweet']], ['swet']).strongSolid).toBe(1); // swet→sweet (4→5): typo fix
    expect(textSignals([['reckless']], ['reckelss']).strongSolid).toBe(1);
    expect(textSignals([['the']], ['the']).strongSolid).toBe(1);    // exact match is always solid
  });
});
describe('bestSolidMatch', () => {
  test('fuzzing into a shorter word is not solid (99), even within tolerance', () => {
    // your→you (4→3) is within tol but "you" is shorter than "your" and not >=5 chars
    expect(bestSolidMatch('your', ['you', 'reign'])).toBe(99);
  });
  test('an anchored prefix onto a longer word is solid', () => {
    expect(bestSolidMatch('grac', ['grace'])).toBe(1);
  });
  test('a single-edit fuzz onto a word >=5 chars is solid (typo, not noise)', () => {
    expect(bestSolidMatch('recukless', ['reckless'])).toBe(1);
  });
  test('a fuzz into a shorter stopword-length word is not solid', () => {
    expect(bestSolidMatch('hand', ['and'])).toBe(99);
  });
});
describe('matchDist stemming (#14)', () => {
  test('an inflected token and its base pair at the prefix tier (1), both directions', () => {
    for (const [a, b] of [
      ['praising', 'praise'],
      ['singing', 'sing'],
      ['sorrows', 'sorrow'],
      ['loved', 'love'],
      ['running', 'run'],
      ['mercies', 'mercy'],
      ['blesses', 'bless']
    ]) {
      expect(matchDist(a, b), `${a}→${b}`).toBe(1);
      expect(matchDist(b, a), `${b}→${a}`).toBe(1);
    }
  });
  test('never reports 0 — a stem hit must not feed the exact-gated idf tie-break', () => {
    expect(matchDist('praising', 'praise')).not.toBe(0);
  });
  test('stays a miss where stems do not pair', () => {
    expect(matchDist('son', 'person')).toBe(99); // anchored at the word start
    expect(matchDist('sing', 'singe')).toBe(1); // prefix, unchanged
    expect(matchDist('thing', 'thin')).toBe(1); // one edit, unchanged
    expect(matchDist('praising', 'prayer')).toBeGreaterThan(2); // beyond every tolerance
    expect(matchDist('praising', 'prairie')).toBeGreaterThan(2);
    expect(matchDist('evening', 'event')).toBeGreaterThan(2);
    expect(matchDist('kings', 'king')).toBe(1); // one edit today; stemming agrees
    expect(matchDist('this', 'thi')).toBe(1); // one edit, no folding under 5 chars
  });
  test('digit tokens never stem', () => {
    expect(matchDist('10000', '1000')).toBe(1); // one edit, as before
    expect(matchDist('1000s', '1000')).toBe(1);
  });
  test('opens the solid partial band and the title tie-break for an inflected query', () => {
    expect(textSignals([['praise', 'him']], ['praising']).strongSolid).toBe(1);
    expect(textSignals([['praising', 'my', 'saviour']], ['praise']).strongSolid).toBe(1);
    expect(bestSolidMatch('praising', ['praise'])).toBe(1);
  });
  test('counts a token matched ONLY through the stem tier as rescued', () => {
    expect(textSignals([['praise', 'my', 'saviour']], ['praising', 'my', 'saviour']).stemRescued).toBe(1);
    expect(textSignals([['praising', 'my', 'saviour']], ['praising', 'my', 'saviour']).stemRescued).toBe(0);
    // an exact hit elsewhere in the doc outranks the stem pairing: not rescued
    expect(textSignals([['praise'], ['praising']], ['praising']).stemRescued).toBe(0);
    // a prefix hit is not a rescue either
    expect(textSignals([['singing']], ['sing']).stemRescued).toBe(0);
  });
});
describe('levWithin', () => {
  test('exact within tolerance, sentinel beyond', () => {
    expect(levWithin('grace', 'grace', 2)).toBe(0);
    expect(levWithin('beleive', 'believe', 2)).toBe(2);
    expect(levWithin('cat', 'dog', 2)).toBeGreaterThan(2);
    expect(levWithin('abcdefgh', 'a', 2)).toBeGreaterThan(2); // length-gap short-circuit
    expect(levWithin('', 'ab', 2)).toBe(2);
  });
  test('agrees with exact lev for every pair of a realistic word list', () => {
    const words = ['grace', 'grase', 'graces', 'worship', 'worsh', 'and', 'hand', 'sweet',
      'swet', 'believe', 'beleive', 'a', '', 'ab', 'faithfulness', 'faithfullness'];
    for (const a of words) for (const b of words) {
      const exact = lev(a, b);
      const banded = levWithin(a, b, 2);
      if (exact <= 2) expect(banded).toBe(exact);
      else expect(banded).toBeGreaterThan(2);
    }
  });
});
