import type { OutputMode, OutputPayload, OutputVariant, PresentationState, Slide } from '../types';

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
/** Coarser than `sameFlow`: only the leading kind segment (`song`, `scr`, `pre`, `msg`,
 * media, …) has to match. Lets navigation follow a cursor across books and chapters within
 * one track while still refusing to hand one track's screen to another. */
export function sameKind(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.split(':')[0] === b.split(':')[0];
}
export function applyCue(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output === 'live' && sameFlow(st.liveKey, key)) return { ...st, liveKey: key, liveSnap: slide };
  return st;
}
export function goLive(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output === 'live' && st.liveKey === key) return { ...st, output: 'black' };
  return { output: 'live', liveKey: key, liveSnap: slide };
}
/** Navigation's route to the screen: updates what's live when output is already live,
 * anywhere within the SAME kind of content, and never toggles. Distinct from both
 * neighbours on purpose — `applyCue` refuses any cross-*flow* update (Songs needs that:
 * cueing another song must not jump the screen), which is too strict for a scripture
 * cursor that must be free to cross books and chapters; `goLive` blacks the output when
 * fired on the key already live (right for a Go live / Take down button, wrong for a tap
 * or an arrow).
 *
 * The `sameKind` guard is what stops a scripture cursor moving in a background tab from
 * seizing a projector showing a song. `liveKey === null` while live is reachable
 * (SermonMode's logo toggle can leave output live having never gone live) and must still
 * be fillable, or the screen stays blank with no way to recover from the rail. */
export function showLive(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output !== 'live') return st;
  if (!(st.liveKey === null || sameKind(st.liveKey, key))) return st;
  return { ...st, liveKey: key, liveSnap: slide };
}
export function setOutput(st: PresentationState, mode: OutputMode): PresentationState {
  return { ...st, output: mode };
}
export function outputPayload(st: PresentationState, variant: OutputVariant = 'audience', logoTitle = 'HELM'): OutputPayload {
  const slide: Slide = st.output === 'black' ? { kind: 'black' }
    : st.output === 'logo' ? { kind: 'logo', title: logoTitle }
    : st.liveSnap ?? { kind: 'blank' };
  return { slide, variant };
}
