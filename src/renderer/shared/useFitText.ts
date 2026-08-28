import { useLayoutEffect, type RefObject } from 'react';
import { fitFontSize, refineFitSize } from '../../shared/slides/fitText';

/**
 * Custom property carrying the fitted size. Set on the slide container; read by the text
 * styles inside it. `cqmin` in the value resolves against that container, which is what
 * keeps the operator's small preview an accurate miniature of the projector.
 */
export const FIT_SIZE_VAR = '--helm-fit-size';

/** The `font-size` a fitted style should use: the fitted value, or `fallback` before/without measurement. */
export function fitSizeValue(fallback: string): string {
  return `var(${FIT_SIZE_VAR}, ${fallback})`;
}

/**
 * The `font-size` for a style that must track a fitted element proportionally rather than
 * read the fitted size directly — e.g. the scripture version label, which scales off
 * the verse text so each verse block moves as one unit (and the fit search stays monotonic:
 * nothing inside the measured box grows when the fitted size shrinks).
 * `ratio` is this element's original size relative to `fallback`'s (e.g. the version label
 * was `2.2cqmin` when the verse was `4.7cqmin`: `2.2/4.7 ≈ 0.47`), so the proportion holds both
 * before measurement (via `fallback`) and after (via the fitted value). `floorPx` is this
 * element's own px floor, independent of the base element's.
 */
export function fitSizeScaled(floorPx: number, fallback: string, ratio: number): string {
  return `max(${floorPx}px, calc(${fitSizeValue(fallback)} * ${ratio}))`;
}

/**
 * Sizes `contentRef`'s text to fit inside `rootRef` by trying `candidates` largest-first.
 *
 * Pass `candidates: null` for slide kinds that are not auto-fitted — the property is left
 * unset and their styles keep their own `clamp()`. An empty array is a caller bug (see the
 * guard inside for why it's handled the same as `null` here rather than left to throw), not
 * a value any current caller produces.
 *
 * Runs in a layout effect so the fitted size is applied before the browser paints; the
 * operator never sees a frame at the wrong size.
 */
export function useFitText(
  rootRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  candidates: number[] | null,
  deps: unknown[]
): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (candidates === null) {
      // React reuses the same root element across slide-kind changes (e.g. lyrics ->
      // title). Leaving a stale fitted value set here is inert today — only the fitted
      // styles read the var — but it's a trap for any future style that adopts
      // fitSizeValue()/fitSizeScaled(), and it's inconsistent with the zero-size path
      // below, which already clears the property rather than leaving stale evidence.
      root.style.removeProperty(FIT_SIZE_VAR);
      return;
    }
    if (candidates.length === 0) {
      // fitFontSize() throws on an empty array, and that's the right contract for it — a
      // pure, directly-tested utility should fail loudly on a caller bug. But measure()
      // below runs synchronously inside a layout effect, directly in the render path of
      // the live projector output. OutputErrorBoundary would catch a propagated throw,
      // but tripping it degrades the live output to the fallback render mid-service over
      // what is, today, an unreachable case (SlideCanvas only ever passes `null` or a
      // non-empty bandCandidates() result). Failing soft locally is strictly better:
      // behave like `candidates: null` — clear
      // the property so the style's own clamp() renders, same as the zero-size path below.
      // Logged so the bug doesn't vanish in development.
      console.error('useFitText: candidates must not be an empty array; treating as unfitted');
      root.style.removeProperty(FIT_SIZE_VAR);
      return;
    }
    const content = contentRef.current;
    if (!content) return;

    let cancelled = false;

    const measure = (): void => {
      // No layout yet (hidden panel, zero-size container, jsdom): leave the property unset
      // so the style's own clamp() renders. Measuring here would compare 0 <= 0 and
      // "fit" the largest candidate on no evidence.
      if (root.clientHeight === 0 || root.clientWidth === 0) {
        root.style.removeProperty(FIT_SIZE_VAR);
        return;
      }
      const check = (cqmin: number): boolean => {
        root.style.setProperty(FIT_SIZE_VAR, `${cqmin}cqmin`);
        // `content` is a child of the overflow-hidden root, so its own scroll size is its
        // natural content height — compare that against the box it has to live in.
        return content.scrollHeight <= root.clientHeight && content.scrollWidth <= root.clientWidth;
      };
      const coarse = fitFontSize(candidates, check);
      const idx = candidates.indexOf(coarse);
      const last = candidates.length - 1;
      // Refine between the found candidate and the next larger one, so the size tracks
      // the box continuously instead of stepping by the band's 0.25cqmin. Skippable
      // exactly when there is nothing to refine toward: the largest candidate fit
      // (idx === 0), or nothing fit at all — the walk's degrade case, distinguishable
      // from a genuine smallest-candidate fit only by re-probing when idx === last.
      const size = idx > 0 && (idx < last || check(coarse)) ? refineFitSize(coarse, candidates[idx - 1], check) : coarse;
      // Round for var readability/determinism; 3 decimals ≈ 0.001cqmin, far inside the
      // refinement precision.
      root.style.setProperty(FIT_SIZE_VAR, `${Number(size.toFixed(3))}cqmin`);
    };

    // Must stay synchronous: this runs in a layout effect specifically so the fitted size
    // is applied before paint. Deferring it (even to a rAF) would let one frame paint at
    // the fallback clamp() size.
    measure();

    // `@fontsource` imports ship `font-display: swap`, and nothing else awaits the real
    // faces loading — so this first measurement can be taken against fallback-font metrics.
    // Once the real face swaps in, nothing else re-measures: the ResizeObserver below can't
    // fire, because the root's box is content-independent (aspectRatio + overflow: hidden).
    // Feature-detect the same way ResizeObserver is below — jsdom has no `document.fonts`.
    if (typeof document !== 'undefined' && document.fonts) {
      void document.fonts.ready.then(() => {
        // The effect may have cleaned up (unmount, or deps changed and a new instance of
        // this effect is now running) before the fonts promise settles.
        if (!cancelled) measure();
      });
    }

    // Re-fit when the slide box changes: plugging in a projector, a DPI change, or the
    // operator resizing the window all change what fits.
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        cancelled = true;
      };
    }

    // Coalesce through a frame: each measure() forces a synchronous style+layout flush
    // per probe (the walk's up-to-29 candidates plus ~4 refinement bisections), and
    // dragging the operator window edge fires many ResizeObserver notifications in quick
    // succession. Only the last one before a frame paints needs to actually run.
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(root);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
