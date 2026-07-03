import type { OutputMode, OutputPayload, PresentationState, Slide } from '../types';

export function initialPresentation(): PresentationState {
  return { output: 'black', liveKey: null, liveSnap: null };
}
export function keyForSong(songId: string, section: number): string {
  return `song:${songId}:${section}`;
}
export function sameFlow(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const pa = a.split(':'), pb = b.split(':');
  if (pa[0] !== pb[0]) return false;
  if (pa[0] === 'scr') return pa[1] === pb[1] && pa[2] === pb[2];
  return pa[1] === pb[1];
}
export function applyCue(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output === 'live' && sameFlow(st.liveKey, key)) return { ...st, liveKey: key, liveSnap: slide };
  return st;
}
export function goLive(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output === 'live' && st.liveKey === key) return { ...st, output: 'black' };
  return { output: 'live', liveKey: key, liveSnap: slide };
}
export function setOutput(st: PresentationState, mode: OutputMode): PresentationState {
  return { ...st, output: mode };
}
export function outputPayload(st: PresentationState, logoTitle = 'HELM'): OutputPayload {
  const slide: Slide = st.output === 'black' ? { kind: 'black' }
    : st.output === 'logo' ? { kind: 'logo', title: logoTitle }
    : st.liveSnap ?? { kind: 'blank' };
  return { slide, variant: 'audience' };
}
