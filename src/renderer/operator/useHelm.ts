import { useEffect, useState } from 'react';
import type { DisplayStatus, PresentationState, PreState } from '../../shared/types';

export function usePresentationState(): PresentationState {
  const [st, setSt] = useState<PresentationState>({ output: 'black', liveKey: null, liveSnap: null });
  useEffect(() => {
    let live = true;
    void window.helm.presentation.get().then((s) => { if (live) setSt(s); });
    const off = window.helm.presentation.onState(setSt);
    return () => { live = false; off(); };
  }, []);
  return st;
}
export function usePreState(): PreState {
  const [s, setS] = useState<PreState>({ engaged: false, loopOn: true, idx: 0, dwellS: 12, countdownText: '10:00', paused: false, cards: [] });
  useEffect(() => {
    let live = true;
    void window.helm.preservice.getState().then((st) => { if (live) setS(st); });
    const off = window.helm.preservice.onState(setS);
    return () => { live = false; off(); };
  }, []);
  return s;
}
export function useDisplayStatus(): DisplayStatus {
  const [d, setD] = useState<DisplayStatus>({ outputs: 0 });
  useEffect(() => {
    void window.helm.displays.get().then(setD);
    return window.helm.displays.onStatus(setD);
  }, []);
  return d;
}
export function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const p = (n: number): string => (n < 10 ? '0' : '') + n;
  return `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}
