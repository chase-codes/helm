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
});
