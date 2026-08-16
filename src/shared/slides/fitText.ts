/**
 * Font-size selection for slide text that must fit its box, kept free of the DOM so the
 * rule is unit-testable and the measurement can be faked. Sizes are `cqmin` values —
 * 1% of the slide container's shorter side — so one result is correct for both the
 * projector and the operator's small preview panes.
 */

/** Descending candidate sizes from `max` down to `min`, inclusive, stepping by `step`. */
export function bandCandidates(max: number, min: number, step = 0.25): number[] {
  // Add a small epsilon before flooring: division can land a hair under the true integer
  // boundary — (0.3 - 0.1) / 0.1 is 1.9999999999999998, not 2 — which silently drops the
  // documented minimum candidate. 1e-9 is many orders of magnitude larger than the float
  // error this compensates for, but far smaller than one step, so it can only push a
  // boundary case up to the correct integer — it can never invent an extra candidate.
  const steps = Math.floor((max - min) / step + 1e-9);
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

/**
 * Continuous refinement between a size known to fit and a larger size known not to:
 * bisects until the bracket is narrower than `precision` and returns the largest probed
 * size that fit. The walk above quantizes to the band step (0.25cqmin ≈ 2px in an
 * operator pane), which reads as visible stair-steps while a panel is being dragged;
 * refining to 0.02cqmin makes the fitted size track the box continuously.
 *
 * Bisection, not a proportional solve: it only needs `fits` to be monotone (a size that
 * fits still fits when smaller — which the fit contract already guarantees, see
 * fitSizeScaled), so it stays correct for wrapped text whose height moves in whole-line
 * jumps rather than linearly with font size.
 */
export function refineFitSize(
  fitLo: number,
  failHi: number,
  fits: (cqmin: number) => boolean,
  precision = 0.02
): number {
  let lo = fitLo;
  let hi = failHi;
  while (hi - lo > precision) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
