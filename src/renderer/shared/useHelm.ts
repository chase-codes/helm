import { useEffect, useState } from 'react';
import type { DisplayStatus, PresentationState, PreState, UpdateStatus, VideoStateWire } from '../../shared/types';

/**
 * Fetch-then-subscribe bridge to a main-process state channel. A pushed event
 * is always at least as fresh as the in-flight initial fetch, so once one
 * arrives (or the host unmounts), the fetch's stale result is ignored.
 */
function useMainState<T>(initial: T, get: () => Promise<T>, subscribe: (cb: (v: T) => void) => () => void): T {
  const [st, setSt] = useState<T>(initial);
  useEffect(() => {
    let gotPush = false;
    const off = subscribe((v) => { gotPush = true; setSt(v); });
    void get().then((v) => { if (!gotPush) setSt(v); });
    return () => { gotPush = true; off(); };
  }, [get, subscribe]);
  return st;
}

export function usePresentationState(): PresentationState {
  return useMainState<PresentationState>(
    { output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null },
    window.helm.presentation.get,
    window.helm.presentation.onState
  );
}
export function usePreState(): PreState {
  return useMainState<PreState>(
    { engaged: false, loopOn: true, idx: 0, dwellS: 12, cards: [] },
    window.helm.preservice.getState,
    window.helm.preservice.onState
  );
}
export function useDisplayStatus(): DisplayStatus {
  return useMainState<DisplayStatus>(
    { outputs: 0, displays: [], released: false },
    window.helm.displays.get,
    window.helm.displays.onStatus
  );
}
export function useUpdateStatus(): UpdateStatus {
  return useMainState<UpdateStatus>(
    { state: 'idle', version: null },
    window.helm.updates.getStatus,
    window.helm.updates.onStatus
  );
}
const fmtClock = (): string => {
  const now = new Date();
  const p = (n: number): string => (n < 10 ? '0' : '') + n;
  const h = now.getHours() % 12 || 12;
  return `${h}:${p(now.getMinutes())} ${now.getHours() < 12 ? 'AM' : 'PM'}`;
};
// Stores the formatted no-seconds string, so 59 of every 60 ticks bail out
// with an identical value instead of re-rendering the host.
export function useClock(): string {
  const [label, setLabel] = useState(fmtClock);
  useEffect(() => { const t = setInterval(() => setLabel(fmtClock()), 1000); return () => clearInterval(t); }, []);
  return label;
}
export function useVideoState(): VideoStateWire {
  return useMainState<VideoStateWire>(
    { key: null, src: null, playing: false, positionMs: 0, durationMs: 0, volume: 1, muted: false },
    window.helm.video.get,
    window.helm.video.onState
  );
}
