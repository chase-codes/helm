import { describe, it, expect } from 'vitest';
import { bandCandidates, fitFontSize, refineFitSize } from './fitText';

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
  it('emits the documented minimum even when the division lands just under the integer boundary', () => {
    // (0.3 - 0.1) / 0.1 === 1.9999999999999998 in IEEE 754 — Math.floor of that is 1, not
    // 2, which silently drops 0.1 from the band without the epsilon fix.
    expect(bandCandidates(0.3, 0.1, 0.1)).toContain(0.1);
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

describe('refineFitSize', () => {
  const fitsUpTo = (boundary: number) => (c: number) => c <= boundary;

  it('converges to the true boundary within the default precision', () => {
    const out = refineFitSize(6, 7, fitsUpTo(6.6));
    expect(out).toBeLessThanOrEqual(6.6);
    expect(out).toBeGreaterThan(6.6 - 0.02);
  });
  it('returns a size that actually fits, never the failing bound', () => {
    const fits = fitsUpTo(6.001);
    expect(fits(refineFitSize(6, 7, fits))).toBe(true);
  });
  it('returns the known fit unchanged when nothing between fits', () => {
    // Boundary sits exactly on the lower bracket: every probe fails, lo never moves.
    expect(refineFitSize(6, 7, fitsUpTo(6))).toBe(6);
  });
  it('finds an exact boundary landed on by a probe', () => {
    // 6.25 is a bisection midpoint of [6, 7], so the walk hits the boundary exactly.
    expect(refineFitSize(6, 7, fitsUpTo(6.25))).toBe(6.25);
  });
  it('respects a custom precision with a bounded number of probes', () => {
    let probes = 0;
    refineFitSize(3.5, 10.5, (c) => {
      probes++;
      return c <= 7.1;
    });
    // ceil(log2(7 / 0.02)) = 9 halvings of the bracket.
    expect(probes).toBeLessThanOrEqual(9);
  });
});
