import type {
  OutputMode,
  OutputPayload,
  OutputVariant,
  OutputViewMode,
  PresentationState,
  Slide
} from '../types'

export function initialPresentation(): PresentationState {
  return { output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null }
}
export function keyForSong(songId: string, section: number): string {
  return `song:${songId}:${section}`
}
/** Inverse of keyForSong. Splits on the LAST colon so a song id containing ':' can't break it. */
export function parseSongKey(key: string | null): { songId: string; section: number } | null {
  if (!key || !key.startsWith('song:')) return null
  const i = key.lastIndexOf(':')
  if (i <= 'song:'.length - 1) return null
  const songId = key.slice('song:'.length, i)
  const section = Number(key.slice(i + 1))
  if (songId === '' || !Number.isInteger(section) || section < 0) return null
  return { songId, section }
}
export function sameFlow(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const pa = a.split(':'),
    pb = b.split(':')
  if (pa[0] !== pb[0]) return false
  if (pa[0] === 'scr') return pa[1] === pb[1] && pa[2] === pb[2]
  return pa[1] === pb[1]
}
/** Coarser than `sameFlow`: only the leading kind segment (`song`, `scr`, `pre`, `msg`,
 * media, …) has to match. Lets navigation follow a cursor across books and chapters within
 * one track while still refusing to hand one track's screen to another. */
export function sameKind(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return a.split(':')[0] === b.split(':')[0]
}
export function applyCue(st: PresentationState, key: string, slide: Slide): PresentationState {
  const cued = { ...st, cuedKey: key, cuedSnap: slide }
  if (st.output === 'live' && sameFlow(st.liveKey, key))
    return { ...cued, liveKey: key, liveSnap: slide }
  return cued
}
/** Taking the screen also records the cue — the leader display renders `cuedKey ?? liveKey`,
 * and must follow what actually goes live rather than show a stale cue. The take-down
 * branch (already-live key → black) leaves cue state untouched. */
export function goLive(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output === 'live' && st.liveKey === key) return { ...st, output: 'black' }
  return { ...st, output: 'live', liveKey: key, liveSnap: slide, cuedKey: key, cuedSnap: slide }
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
 * seizing a projector showing a song. The `liveKey === null` allowance is defense in
 * depth: `setOutput` now refuses 'live' with no key (BUG-021), so the state should be
 * unreachable — but if some future path recreates it, a blank live screen must still be
 * fillable from the rail, or it stays blank with no way to recover.
 *
 * When it does take the screen, it also records the cue (leader tracks it). It must NOT
 * do so in the refusal paths above: showLive fires from background-tab cursors, and
 * recording a refused show would make the leader jump to a background tab's content
 * while something else is live. */
export function showLive(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output !== 'live') return st
  if (!(st.liveKey === null || sameKind(st.liveKey, key))) return st
  return { ...st, liveKey: key, liveSnap: slide, cuedKey: key, cuedSnap: slide }
}
/** Going 'live' with no live key is refused and lands on 'black' instead: there is nothing
 * to show, so the audience sees a dark screen either way — but 'live'+null is an incoherent
 * state (badges read it as ANOTHER FLOW LIVE, and BUG-018's tap rule can't hold in it, see
 * BUG-021). The logo toggles (Songs/Sermon/Message/Slides) all route through here, so the
 * state can no longer be produced. */
export function setOutput(st: PresentationState, mode: OutputMode): PresentationState {
  if (mode === 'live' && st.liveKey === null) return { ...st, output: 'black' }
  return { ...st, output: mode }
}
export function outputPayload(
  st: PresentationState,
  variant: OutputVariant = 'audience',
  view: OutputViewMode = 'slides',
  logoTitle = 'HELM'
): OutputPayload {
  const slide: Slide =
    st.output === 'black'
      ? { kind: 'black' }
      : st.output === 'logo'
        ? { kind: 'logo', title: logoTitle }
        : (st.liveSnap ?? { kind: 'blank' })
  return { slide, variant, view }
}
