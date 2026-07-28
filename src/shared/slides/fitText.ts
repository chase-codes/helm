/**
 * Font-size selection for slide text that must fit its box, kept free of the DOM so the
 * rule is unit-testable and the measurement can be faked. Sizes are `cqmin` values —
 * 1% of the slide container's shorter side — so one result is correct for both the
 * projector and the operator's small preview panes.
 */

/** Descending candidate sizes from `max` down to `min`, inclusive, stepping by `step`. */
export function bandCandidates(max: number, min: number, step = 0.25): number[] {
  const steps = Math.floor((max - min) / step);
  const out: number[] = [];
  // Multiply rather than subtract repeatedly: 8 - 0.25*3 is exact, but 8-0.25-0.25-0.25
  // accumulates binary drift and yields sizes like 7.249999999999999.
  for (let i = 0; i <= steps; i++) out.push(Number((max - i * step).toFixed(4)));
  return out;
}

/**
 * The largest candidate for which `fits` is true, or the smallest candidate if none fit —
 * something must go on the screen, so an impossible constraint degrades to the smallest
 * size rather than to nothing. Walks descending and stops at the first fit, so `fits` (a
 * layout read) runs as few times as possible.
 */
export function fitFontSize(candidates: number[], fits: (cqmin: number) => boolean): number {
  if (candidates.length === 0) throw new Error('fitFontSize: candidates must not be empty');
  for (const c of candidates) if (fits(c)) return c;
  return candidates[candidates.length - 1];
}
