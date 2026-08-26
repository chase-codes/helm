import { type JSX } from 'react';
import { OutputApp } from './OutputApp';
import { OutputErrorBoundary } from './OutputErrorBoundary';

/** Boundary above OutputApp itself (#30): a throw in OutputApp's own effects or initial
 * state (e.g. a broken preload bridge) must degrade to black, never unmount to a white
 * window the congregation is watching. The fallback shows no message — this surface is
 * projector-facing. resetKey is constant on purpose, so the root boundary latches: a
 * broken bridge won't heal by re-rendering, and staying black until relaunch beats a
 * crash loop. The view-level boundary inside OutputApp still handles view crashes. */
export function OutputRoot({ _forceCrashViewForTest = false }: { _forceCrashViewForTest?: boolean }): JSX.Element {
  return (
    <OutputErrorBoundary
      resetKey="root"
      logMessage="[helm] output root crashed, falling back to a black screen:"
      fallback={<div data-testid="output-root-fallback" style={{ position: 'fixed', inset: 0, background: '#000' }} />}
    >
      <OutputApp _forceCrashViewForTest={_forceCrashViewForTest} />
    </OutputErrorBoundary>
  );
}
