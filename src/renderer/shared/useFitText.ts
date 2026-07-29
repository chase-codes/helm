import { useLayoutEffect, type RefObject } from 'react';
import { fitFontSize } from '../../shared/slides/fitText';

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
 * read the fitted size directly — e.g. the scripture ref/version labels, which scale off
 * the verse text so the whole block moves as one unit (and the fit search stays monotonic:
 * nothing inside the measured box has a size that doesn't shrink when the fitted size does).
 * `ratio` is this element's original size relative to `fallback`'s (e.g. the ref was
 * `2.9cqmin` when the verse was `4.7cqmin`: `2.9/4.7 ≈ 0.62`), so the proportion holds both
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
 * unset and their styles keep their own `clamp()`. Pass a non-empty array for kinds that
 * are; an empty array is a caller bug, not a valid "don't fit" signal — `null` says that —
 * so it is left to `fitFontSize` to reject it loudly rather than silently doing nothing.
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
      const size = fitFontSize(candidates, (cqmin) => {
        root.style.setProperty(FIT_SIZE_VAR, `${cqmin}cqmin`);
        // `content` is a child of the overflow-hidden root, so its own scroll size is its
        // natural content height — compare that against the box it has to live in.
        return content.scrollHeight <= root.clientHeight && content.scrollWidth <= root.clientWidth;
      });
      root.style.setProperty(FIT_SIZE_VAR, `${size}cqmin`);
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

    // Coalesce through a frame: each measure() walk forces a synchronous style+layout
    // flush per candidate (up to 29 of them), and dragging the operator window edge fires
    // many ResizeObserver notifications in quick succession. Only the last one before a
    // frame paints needs to actually run.
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
