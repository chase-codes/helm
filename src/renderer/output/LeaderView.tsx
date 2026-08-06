import type { JSX } from 'react';
import type { OutputPayload } from '../../shared/types';
import { SlidesView } from './SlidesView';

// Stub for Task 4; real implementation lands in Task 5.
export function LeaderView({ payload }: { payload: OutputPayload }): JSX.Element {
  return (
    <div data-testid="leader-view" style={{ position: 'fixed', inset: 0 }}>
      <SlidesView payload={payload} />
    </div>
  );
}
