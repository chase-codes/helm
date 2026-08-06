import { useEffect, useState, type JSX } from 'react';
import type { OutputPayload } from '../../shared/types';
import { SlidesView } from './SlidesView';
import { LeaderView } from './LeaderView';
import { MirrorView } from './MirrorView';
import { OutputErrorBoundary } from './OutputErrorBoundary';

export function OutputApp({ _forceCrashViewForTest = false }: { _forceCrashViewForTest?: boolean }): JSX.Element {
  const [payload, setPayload] = useState<OutputPayload>({ slide: { kind: 'black' }, variant: 'audience', view: 'slides' });
  useEffect(() => window.helm.output.onSlide(setPayload), []);
  useEffect(() => {
    document.body.style.cursor = 'none';
    document.body.style.background = '#000';
  }, []);
  const view =
    payload.view === 'mirror' ? <MirrorView />
    : payload.view === 'leader' ? (_forceCrashViewForTest ? <CrashForTest /> : <LeaderView payload={payload} />)
    : <SlidesView payload={payload} />;
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <OutputErrorBoundary resetKey={payload.view} fallback={<SlidesView payload={payload} />}>
        {view}
      </OutputErrorBoundary>
    </div>
  );
}

function CrashForTest(): JSX.Element { throw new Error('forced crash for boundary test'); }
