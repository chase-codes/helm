import { describe, it, expect } from 'vitest';
import { bandCandidates, fitFontSize } from './fitText';

describe('bandCandidates', () => {
  it('descends from max to min inclusive', () => {
    expect(bandCandidates(4, 3, 0.25)).toEqual([4, 3.75, 3.5, 3.25, 3]);
  });
  it('never emits a value below min when the step does not divide evenly', () => {
    const c = bandCandidates(4, 3.1, 0.5);
    expect(c[0]).toBe(4);
    expect(Math.min(...c)).toBeGreaterThanOrEqual(3.1);
  });
  it('avoids floating-point drift', () => {
    // 8.0 -> 3.5 by 0.25 is the real lyrics band; repeated subtraction yields 7.249999…
    const c = bandCandidates(8, 3.5, 0.25);
    expect(c).toHaveLength(19);
    expect(c).toContain(7.25);
    expect(c[c.length - 1]).toBe(3.5);
  });
  it('returns a single value when max equals min', () => {
    expect(bandCandidates(5, 5, 0.25)).toEqual([5]);
  });
});

describe('fitFontSize', () => {
  const band = [4, 3.75, 3.5, 3.25, 3];

  it('returns the largest candidate that fits', () => {
    expect(fitFontSize(band, (c) => c <= 3.5)).toBe(3.5);
  });
  it('returns the largest when everything fits', () => {
    expect(fitFontSize(band, () => true)).toBe(4);
  });
  it('returns the smallest when nothing fits', () => {
    expect(fitFontSize(band, () => false)).toBe(3);
  });
  it('handles a single candidate', () => {
    expect(fitFontSize([5], () => false)).toBe(5);
  });
  it('only ever returns a supplied candidate', () => {
    const out = fitFontSize(band, (c) => c < 3.6);
    expect(band).toContain(out);
  });
  it('stops asking once it finds a fit', () => {
    const asked: number[] = [];
    fitFontSize(band, (c) => { asked.push(c); return c <= 3.75; });
    expect(asked).toEqual([4, 3.75]); // never measured the smaller sizes
  });
  it('throws on an empty candidate list', () => {
    expect(() => fitFontSize([], () => true)).toThrow();
  });
});
