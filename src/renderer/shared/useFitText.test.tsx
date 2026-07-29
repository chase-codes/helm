// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, type JSX } from 'react';
import { FIT_SIZE_VAR, fitSizeValue, useFitText } from './useFitText';

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
