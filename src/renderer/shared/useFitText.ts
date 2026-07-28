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
 * Sizes `contentRef`'s text to fit inside `rootRef` by trying `candidates` largest-first.
 *
 * Pass `candidates: null` for slide kinds that are not auto-fitted — the property is left
 * unset and their styles keep their own `clamp()`.
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
    const content = contentRef.current;
    if (!root || !content || candidates === null || candidates.length === 0) return;

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

    measure();

    // Re-fit when the slide box changes: plugging in a projector, a DPI change, or the
    // operator resizing the window all change what fits.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
