// @vitest-environment jsdom
import { render, cleanup, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutputApp } from './OutputApp';
import type { OutputPayload } from '../../shared/types';

afterEach(cleanup);

function installHelmStub(): (p: OutputPayload) => void {
  let push: (p: OutputPayload) => void = () => {};
  (window as unknown as { helm: unknown }).helm = {
    output: { onSlide: (cb: (p: OutputPayload) => void) => { push = cb; return () => {}; } },
    presentation: { get: () => Promise.resolve({ output: 'black', liveKey: null, liveSnap: null }), onState: () => () => {} },
    songs: { get: () => Promise.resolve(null) },
  };
  return (p) => act(() => push(p));
}

const LYRICS: OutputPayload['slide'] = { kind: 'lyrics', accent: '#e0a341', label: 'Test · Verse 1', lines: ['Amazing grace'] };

// React itself also logs a dev-mode console.error for any error an error boundary catches,
// on top of whatever the boundary logs — so we count only OUR boundary's message to pin the
// double-fire regression, rather than the raw console.error call count (which includes React's
// own unrelated noise and isn't a reliable count of our componentDidCatch invocations).
const BOUNDARY_LOG = '[helm] output view crashed, falling back to slides:';
function boundaryCatchCount(spy: ReturnType<typeof vi.spyOn>): number {
  return spy.mock.calls.filter(([msg]) => msg === BOUNDARY_LOG).length;
}

describe('OutputApp view branching', () => {
  it('renders the slides view by default', () => {
    const push = installHelmStub();
    const r = render(<OutputApp />);
    push({ slide: LYRICS, variant: 'audience', view: 'slides' });
    expect(r.getByText('Amazing grace')).toBeTruthy();
  });

  it('renders MirrorView for view=mirror', () => {
    const push = installHelmStub();
    const r = render(<OutputApp />);
    push({ slide: LYRICS, variant: 'stage', view: 'mirror' });
    expect(r.getByTestId('mirror-view')).toBeTruthy();
    expect(r.queryByText('Amazing grace')).toBeNull();
  });

  it('renders LeaderView for view=leader', () => {
    const push = installHelmStub();
    const r = render(<OutputApp />);
    push({ slide: LYRICS, variant: 'stage', view: 'leader' });
    expect(r.getByTestId('leader-view')).toBeTruthy();
  });

  it('falls back to the slides render when a view crashes', () => {
    const push = installHelmStub();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});   // React logs boundary catches
    const r = render(<OutputApp _forceCrashViewForTest />);
    push({ slide: LYRICS, variant: 'stage', view: 'leader' });
    expect(r.getByText('Amazing grace')).toBeTruthy();                     // fallback = slides
    expect(boundaryCatchCount(spy)).toBe(1);                               // boundary caught exactly once, no double-fire
    spy.mockRestore();
  });

  it('re-arms after switching away from the crashed view, without double-firing the boundary', () => {
    const push = installHelmStub();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});   // React logs boundary catches
    const r = render(<OutputApp _forceCrashViewForTest />);
    push({ slide: LYRICS, variant: 'stage', view: 'leader' });
    expect(r.getByText('Amazing grace')).toBeTruthy();                     // fallback = slides
    push({ slide: LYRICS, variant: 'audience', view: 'slides' });
    expect(r.getByText('Amazing grace')).toBeTruthy();                     // re-armed, healthy slides render
    expect(boundaryCatchCount(spy)).toBe(1);                               // still exactly one catch — no same-commit double fire
    spy.mockRestore();
  });
});
