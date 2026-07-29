// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, type JSX } from 'react';
import { FIT_SIZE_VAR, fitSizeScaled, fitSizeValue, useFitText } from './useFitText';

afterEach(cleanup);

function Probe({ candidates }: { candidates: number[] | null }): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useFitText(root, content, candidates, [candidates]);
  return (
    <div ref={root} data-testid="root">
      <div ref={content}>text</div>
    </div>
  );
}

describe('fitSizeValue', () => {
  it('falls back to the supplied clamp when the property is unset', () => {
    expect(fitSizeValue('clamp(10px,4.7cqmin,40px)')).toBe('var(--helm-fit-size, clamp(10px,4.7cqmin,40px))');
  });
});

describe('fitSizeScaled', () => {
  it('scales the fitted (or fallback) value and floors the result in px, with no ceiling', () => {
    expect(fitSizeScaled(8, '4.7cqmin', 0.62)).toBe('max(8px, calc(var(--helm-fit-size, 4.7cqmin) * 0.62))');
  });
});

describe('useFitText', () => {
  it('leaves the property unset when the container has no size', () => {
    // The real fallback case, and the one jsdom reproduces for free: every layout box
    // reads 0, so the hook must decline to measure rather than "fit" the largest
    // candidate on the evidence of 0 <= 0.
    const { getByTestId } = render(<Probe candidates={[8, 7, 6]} />);
    expect(getByTestId('root').style.getPropertyValue(FIT_SIZE_VAR)).toBe('');
  });

  it('leaves the property unset when candidates is null', () => {
    const { getByTestId } = render(<Probe candidates={null} />);
    expect(getByTestId('root').style.getPropertyValue(FIT_SIZE_VAR)).toBe('');
  });

  it('does not throw when ResizeObserver is unavailable', () => {
    const saved = globalThis.ResizeObserver;
    // @ts-expect-error — deleting a global for the duration of this test
    delete globalThis.ResizeObserver;
    expect(() => render(<Probe candidates={[8, 7, 6]} />)).not.toThrow();
    globalThis.ResizeObserver = saved;
  });

  it('clears a stale fitted value when a slide-kind change reuses the root (band -> null)', () => {
    // React reuses the same root element across slide-kind changes. Simulate a prior
    // measurement having actually landed (jsdom's own zero-size early return would clear
    // it anyway, which is exactly why this has to be set by hand) so the null path is
    // proven to clear it, not merely to have found it already clear.
    const { getByTestId, rerender } = render(<Probe candidates={[8, 7, 6]} />);
    getByTestId('root').style.setProperty(FIT_SIZE_VAR, '8cqmin');
    rerender(<Probe candidates={null} />);
    expect(getByTestId('root').style.getPropertyValue(FIT_SIZE_VAR)).toBe('');
  });

  it('observes the container so a projector resize re-fits, and disconnects on unmount', () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    const saved = globalThis.ResizeObserver;
    globalThis.ResizeObserver = vi.fn(function () {
      return { observe, disconnect, unobserve: vi.fn() };
    }) as unknown as typeof ResizeObserver;
    const { unmount } = render(<Probe candidates={[8, 7, 6]} />);
    expect(observe).toHaveBeenCalledTimes(1);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    globalThis.ResizeObserver = saved;
  });

  // jsdom has no layout engine: every box reads 0 by default, which is exactly what the
  // tests above rely on to hit the early return. The tests below stub clientHeight/
  // clientWidth/scrollHeight/scrollWidth on the actual nodes so the hook's measurement
  // loop — fitFontSize's walk, driven by real (fake) layout reads — is actually exercised.
  // Without this, replacing the walk with `candidates[0]` or inverting the fit comparison
  // is invisible to the suite.

  function LayoutProbe({ candidates }: { candidates: number[] }): JSX.Element {
    const root = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);

    // Callback refs run during React's commit phase, before layout effects fire — unlike
    // a useRef object ref, this lets the stub be in place *before* useFitText's
    // useLayoutEffect reads these properties for the first time.
    const attachRoot = (el: HTMLDivElement | null): void => {
      root.current = el;
      if (!el) return;
      Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 100 });
      Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 100 });
    };
    const attachContent = (el: HTMLDivElement | null): void => {
      content.current = el;
      if (!el) return;
      // Width is never the binding constraint here — keep it comfortably under clientWidth.
      Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => 10 });
      // The one property that must actually respond to the hook's probing: it derives
      // from whatever candidate the hook just wrote to --helm-fit-size, so each step of
      // the walk gets a different (fake) measurement, the way real layout would.
      Object.defineProperty(el, 'scrollHeight', {
        configurable: true,
        get: () => {
          const applied = parseFloat(root.current?.style.getPropertyValue(FIT_SIZE_VAR) || '0');
          // Crosses the 100-tall box once the candidate exceeds 6.25cqmin.
          return applied * 16;
        }
      });
    };

    useFitText(root, content, candidates, [candidates]);
    return (
      <div ref={attachRoot} data-testid="root">
        <div ref={attachContent}>text</div>
      </div>
    );
  }

  it('walks descending and lands on the largest candidate that actually fits — not first, not last', () => {
    // Of [8, 7, 6, 5, 4]cqmin only 6, 5, 4 fit the fake 100-tall box (see LayoutProbe).
    // A `candidates[0]` stand-in would report 8; an inverted fit comparison would also
    // report 8 (fits on the first, largest, candidate instead of stopping descent at the
    // real fit). Only a correct descending walk lands on 6.
    const { getByTestId } = render(<LayoutProbe candidates={[8, 7, 6, 5, 4]} />);
    expect(getByTestId('root').style.getPropertyValue(FIT_SIZE_VAR)).toBe('6cqmin');
  });

  it('does not re-measure when a re-render leaves the deps referentially unchanged', () => {
    let clientHeightReads = 0;

    function CountingProbe({ candidates, tick }: { candidates: number[]; tick: number }): JSX.Element {
      const root = useRef<HTMLDivElement>(null);
      const content = useRef<HTMLDivElement>(null);
      const attachRoot = (el: HTMLDivElement | null): void => {
        root.current = el;
        if (!el) return;
        Object.defineProperty(el, 'clientHeight', {
          configurable: true,
          get: () => {
            clientHeightReads++;
            return 0; // early-return path: only the read count matters here, not the fit
          }
        });
      };
      useFitText(root, content, candidates, [candidates]);
      return (
        <div ref={attachRoot} data-testid="root">
          <div ref={content}>tick {tick}</div>
        </div>
      );
    }

    // Same array *reference* across both renders — this is what a correctly module-scope-
    // hoisted band looks like from the hook's point of view.
    const stableCandidates = [8, 7, 6];
    const { rerender } = render(<CountingProbe candidates={stableCandidates} tick={0} />);
    const readsAfterMount = clientHeightReads;

    // Re-render changes only `tick`, an unrelated prop not in the deps array.
    rerender(<CountingProbe candidates={stableCandidates} tick={1} />);
    expect(clientHeightReads).toBe(readsAfterMount);
  });
});

// `@fontsource` ships `font-display: swap`; nothing else in the app awaits the real faces
// loading. These tests stand in for that by controlling document.fonts.ready directly —
// jsdom doesn't implement the CSS Font Loading API at all, so without this stub the
// feature-detect (`document.fonts` undefined) just skips the re-measure path entirely,
// which is also exercised implicitly by every other test in this file.
describe('re-measuring after web fonts load', () => {
  function stubFonts(): { resolve: () => void; restore: () => void } {
    const saved = (document as unknown as { fonts?: unknown }).fonts;
    let resolve!: () => void;
    const ready = new Promise<void>((res) => {
      resolve = res;
    });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } });
    return {
      resolve,
      restore: () => Object.defineProperty(document, 'fonts', { configurable: true, value: saved })
    };
  }

  it('re-measures once document.fonts.ready resolves', async () => {
    const fonts = stubFonts();
    let clientHeightReads = 0;

    function CountingProbe({ candidates }: { candidates: number[] }): JSX.Element {
      const root = useRef<HTMLDivElement>(null);
      const content = useRef<HTMLDivElement>(null);
      const attachRoot = (el: HTMLDivElement | null): void => {
        root.current = el;
        if (!el) return;
        Object.defineProperty(el, 'clientHeight', {
          configurable: true,
          get: () => {
            clientHeightReads++;
            return 100;
          }
        });
        Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 100 });
      };
      const attachContent = (el: HTMLDivElement | null): void => {
        content.current = el;
        if (!el) return;
        Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => 10 });
        Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 10 });
      };
      useFitText(root, content, candidates, [candidates]);
      return (
        <div ref={attachRoot} data-testid="root">
          <div ref={attachContent}>text</div>
        </div>
      );
    }

    render(<CountingProbe candidates={[8, 7, 6]} />);
    const readsAfterMount = clientHeightReads;
    expect(readsAfterMount).toBeGreaterThan(0); // the synchronous initial measure() ran

    fonts.resolve();
    // Flush the microtask queue so the effect's `document.fonts.ready.then(...)` runs.
    await Promise.resolve();
    await Promise.resolve();

    // Reverting the fix (no re-measure on fonts.ready) leaves this at readsAfterMount.
    expect(clientHeightReads).toBeGreaterThan(readsAfterMount);
    fonts.restore();
  });

  it('does not write to the root if the component unmounts before fonts resolve', async () => {
    const fonts = stubFonts();
    const { getByTestId, unmount } = render(<Probe candidates={[8, 7, 6]} />);
    const root = getByTestId('root');
    const setProperty = vi.spyOn(root.style, 'setProperty');
    const removeProperty = vi.spyOn(root.style, 'removeProperty');

    unmount();
    setProperty.mockClear();
    removeProperty.mockClear();

    fonts.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Without the `cancelled` guard, the queued re-measure still fires post-unmount and
    // (jsdom reads clientHeight as 0 on this untouched node) calls removeProperty on a
    // detached node.
    expect(setProperty).not.toHaveBeenCalled();
    expect(removeProperty).not.toHaveBeenCalled();
    fonts.restore();
  });
});

describe('coalescing resize-driven measurement into a frame', () => {
  function stubRaf(): {
    raf: ReturnType<typeof vi.fn>;
    caf: ReturnType<typeof vi.fn>;
    callbacks: FrameRequestCallback[];
    restore: () => void;
  } {
    const savedRaf = globalThis.requestAnimationFrame;
    const savedCaf = globalThis.cancelAnimationFrame;
    const callbacks: FrameRequestCallback[] = [];
    const raf = vi.fn((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    const caf = vi.fn();
    globalThis.requestAnimationFrame = raf as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = caf as unknown as typeof cancelAnimationFrame;
    return {
      raf,
      caf,
      callbacks,
      restore: () => {
        globalThis.requestAnimationFrame = savedRaf;
        globalThis.cancelAnimationFrame = savedCaf;
      }
    };
  }

  function stubResizeObserver(): { trigger: () => void; restore: () => void } {
    const saved = globalThis.ResizeObserver;
    let callback: (() => void) | undefined;
    globalThis.ResizeObserver = vi.fn(function (this: unknown, cb: () => void) {
      callback = cb;
      return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
    }) as unknown as typeof ResizeObserver;
    return {
      trigger: () => callback?.(),
      restore: () => {
        globalThis.ResizeObserver = saved;
      }
    };
  }

  it('coalesces several notifications in one frame into a single measurement', () => {
    const raf = stubRaf();
    const ro = stubResizeObserver();
    let clientHeightReads = 0;

    function CountingProbe(): JSX.Element {
      const root = useRef<HTMLDivElement>(null);
      const content = useRef<HTMLDivElement>(null);
      const attachRoot = (el: HTMLDivElement | null): void => {
        root.current = el;
        if (!el) return;
        Object.defineProperty(el, 'clientHeight', {
          configurable: true,
          get: () => {
            clientHeightReads++;
            return 0; // early-return path: reads are all that matter here
          }
        });
      };
      useFitText(root, content, [8, 7, 6], []);
      return (
        <div ref={attachRoot} data-testid="root">
          <div ref={content}>text</div>
        </div>
      );
    }

    render(<CountingProbe />);
    const readsAfterMount = clientHeightReads; // the synchronous initial measure()

    // Three resize notifications land before any frame has a chance to paint.
    ro.trigger();
    ro.trigger();
    ro.trigger();

    // A frame is requested each time, and the implementation unconditionally cancels
    // whatever was previously scheduled first (a cancel of "no frame yet" is a harmless
    // no-op) — that's the coalescing. Reverting the fix (calling measure() straight from
    // the ResizeObserver callback) would never touch requestAnimationFrame at all.
    expect(raf.raf).toHaveBeenCalledTimes(3);
    expect(raf.caf).toHaveBeenCalledTimes(3);
    expect(clientHeightReads).toBe(readsAfterMount); // nothing has measured yet

    // Only the last scheduled frame actually runs (the two earlier ones were cancelled).
    raf.callbacks[raf.callbacks.length - 1](0);
    expect(clientHeightReads).toBe(readsAfterMount + 1); // one measurement, not three

    raf.restore();
    ro.restore();
  });

  it('cancels a pending frame on unmount', () => {
    const raf = stubRaf();
    const ro = stubResizeObserver();

    function Probe2(): JSX.Element {
      const root = useRef<HTMLDivElement>(null);
      const content = useRef<HTMLDivElement>(null);
      useFitText(root, content, [8, 7, 6], []);
      return (
        <div ref={root} data-testid="root">
          <div ref={content}>text</div>
        </div>
      );
    }

    const { unmount } = render(<Probe2 />);
    ro.trigger(); // schedules a frame that never gets to run
    expect(raf.raf).toHaveBeenCalledTimes(1);
    const scheduledId = raf.raf.mock.results[0]!.value as number;

    unmount();

    expect(raf.caf).toHaveBeenCalledWith(scheduledId);

    raf.restore();
    ro.restore();
  });
});
