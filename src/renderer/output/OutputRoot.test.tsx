// @vitest-environment jsdom
import { render, cleanup, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutputRoot } from './OutputRoot';
import type { OutputPayload } from '../../shared/types';

afterEach(cleanup);

function installHelmStub(): (p: OutputPayload) => void {
  let push: (p: OutputPayload) => void = () => {};
  (window as unknown as { helm: unknown }).helm = {
    output: { onSlide: (cb: (p: OutputPayload) => void) => { push = cb; return () => {}; } },
    presentation: { get: () => Promise.resolve({ output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null }), onState: () => () => {} },
    songs: { get: () => Promise.resolve(null) },
  };
  return (p) => act(() => push(p));
}

// Log strings are asserted as literals (not imported) — component files must only export components (react-refresh).
const ROOT_BOUNDARY_LOG = '[helm] output root crashed, falling back to a black screen:';

const LYRICS: OutputPayload['slide'] = { kind: 'lyrics', accent: '#e0a341', label: 'Test · Verse 1', lines: ['Amazing grace'] };

const logCount = (spy: ReturnType<typeof vi.spyOn>, msg: string): number =>
  spy.mock.calls.filter(([m]) => m === msg).length;

describe('OutputRoot (#30)', () => {
  it('renders the app normally when the bridge is healthy', () => {
    const push = installHelmStub();
    const r = render(<OutputRoot />);
    push({ slide: LYRICS, variant: 'audience', view: 'slides' });
    expect(r.getByText('Amazing grace')).toBeTruthy();
  });

  it('degrades to a black screen when OutputApp itself throws', () => {
    (window as unknown as { helm: unknown }).helm = {
      output: { onSlide: () => { throw new Error('bridge gone'); } },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = render(<OutputRoot />);
    expect(r.getByTestId('output-root-fallback')).toBeTruthy();
    expect(logCount(spy, ROOT_BOUNDARY_LOG)).toBe(1);
    spy.mockRestore();
  });

  it('a view crash is still handled by the inner boundary, not the root', () => {
    const push = installHelmStub();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = render(<OutputRoot _forceCrashViewForTest />);
    push({ slide: LYRICS, variant: 'stage', view: 'leader' });
    expect(r.getByText('Amazing grace')).toBeTruthy(); // inner fallback = slides
    expect(logCount(spy, ROOT_BOUNDARY_LOG)).toBe(0);
    expect(logCount(spy, '[helm] output view crashed, falling back to slides:')).toBe(1);
    spy.mockRestore();
  });
});
