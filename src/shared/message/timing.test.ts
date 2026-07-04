import { describe, expect, it } from 'vitest';
import { activeOrdAt } from './timing';

const MAP = [
  { ord: 0, tStart: 0, tEnd: 5 },
  { ord: 1, tStart: 5, tEnd: 12 },
  { ord: 2, tStart: 12, tEnd: 20 },
];

describe('activeOrdAt', () => {
  it('returns the span whose range contains t', () => {
    expect(activeOrdAt(MAP, 0)).toBe(0);
    expect(activeOrdAt(MAP, 6)).toBe(1);
    expect(activeOrdAt(MAP, 19.9)).toBe(2);
  });
  it('holds the last ord past the end and first ord before the start', () => {
    expect(activeOrdAt(MAP, -1)).toBe(0);
    expect(activeOrdAt(MAP, 99)).toBe(2);
  });
  it('holds the previous ord inside a gap between spans', () => {
    expect(activeOrdAt([{ ord: 0, tStart: 0, tEnd: 5 }, { ord: 1, tStart: 8, tEnd: 12 }], 6)).toBe(0);
  });
  it('returns 0 for an empty map', () => {
    expect(activeOrdAt([], 10)).toBe(0);
  });
});
