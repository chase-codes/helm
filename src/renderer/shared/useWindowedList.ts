import { useCallback, useLayoutEffect, useState, type UIEvent } from 'react';

export interface WindowedList {
  /** Attach to the scrolling container (`ref={win.setEl}`). A callback ref, not a ref
   * object: the element is state, so measuring re-runs when the container mounts. */
  setEl: (el: HTMLDivElement | null) => void;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
  /** Row index range to render: [start, end). */
  start: number;
  end: number;
  /** Spacer heights (px) standing in for the rows above and below the window. */
  topPad: number;
  bottomPad: number;
}

// Height assumed for the viewport until the container has been measured (jsdom reports
// 0, and the first paint has no scroll event yet). Generous on purpose: overshooting
// mounts a few dozen extra rows once; undershooting shows a blank band.
const UNMEASURED_VIEWPORT = 900;

/** Fixed-row-height windowing for long lists (#24): renders only the rows in view plus
 * `overscan` either side, with spacers keeping the scrollbar honest. Rows MUST be
 * exactly `rowHeight` tall including margins — the window is arithmetic, not measured. */
export function useWindowedList(count: number, rowHeight: number, overscan = 8): WindowedList {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useLayoutEffect(() => {
    if (!el) return;
    // Measured via an observer callback (never set-state-in-effect on the element alone):
    // ResizeObserver fires once on observe, which is the initial measurement.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop), []);

  const vh = viewport || UNMEASURED_VIEWPORT;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + vh) / rowHeight) + overscan);
  return { setEl, onScroll, start, end, topPad: start * rowHeight, bottomPad: (count - end) * rowHeight };
}
