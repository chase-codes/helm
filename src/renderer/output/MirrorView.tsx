import type { JSX } from 'react';

// Stub for Task 4; real implementation lands in Task 6.
export function MirrorView(): JSX.Element {
  return <div data-testid="mirror-view" style={{ position: 'fixed', inset: 0, background: '#000' }} />;
}
