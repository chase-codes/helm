import { BrowserWindow } from 'electron';
import {
  CH,
  type OutputMode,
  type OutputPayload,
  type OutputVariant,
  type OutputViewMode,
  type PresentationState,
  type Slide,
} from '../shared/types';
import { applyCue, goLive, initialPresentation, invalidate, outputPayload, setOutput, showLive, takeLive } from '../shared/presentation/core';
import { DEFAULT_LEADER_SPLIT, clampLeaderSplit } from '../shared/displays/roles';
import { broadcastAll } from './broadcast';

let state: PresentationState = initialPresentation();
const outputWindows = new Map<BrowserWindow, { variant: OutputVariant; view: OutputViewMode; leaderSplit: number }>();

function payloadFor(t: { variant: OutputVariant; view: OutputViewMode; leaderSplit: number }): OutputPayload {
  return { ...outputPayload(state, t.variant, t.view), leaderSplit: t.leaderSplit };
}
const sendPresState = broadcastAll(CH.presState);
function broadcast(): void {
  sendPresState(state);
  // Output windows get a per-window payload (variant/view/split differ) — not broadcastAll.
  for (const [w, t] of outputWindows) if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, payloadFor(t));
}
export const presentation = {
  get: () => state,
  cue: (key: string, slide: Slide) => { state = applyCue(state, key, slide); broadcast(); },
  goLive: (key: string, slide: Slide) => { state = goLive(state, key, slide); broadcast(); },
  // Same identity-skip as `take`: showLive returns its input on every refusal (output
  // down, cross-kind), and the show effect fires on activation/output flips too — a
  // refused show must not re-push identical payloads at the output windows.
  show: (key: string, slide: Slide) => { const next = showLive(state, key, slide); if (next === state) return; state = next; broadcast(); },
  // No broadcast when takeLive hands back the state it was given (already live on this
  // key): re-sending an identical outputSlide would disturb a playing video for nothing.
  take: (key: string, slide: Slide) => { const next = takeLive(state, key, slide); if (next === state) return; state = next; broadcast(); },
  setOutput: (mode: OutputMode) => { state = setOutput(state, mode); broadcast(); },
  // Deleted content (#40). Same identity-skip as `take`: most deletes touch nothing live.
  invalidate: (key: string) => { const next = invalidate(state, key); if (next === state) return; state = next; broadcast(); },
  registerOutput(w: BrowserWindow, variant: OutputVariant, view: OutputViewMode = 'slides', leaderSplit: number = DEFAULT_LEADER_SPLIT) {
    outputWindows.set(w, { variant, view, leaderSplit });
    w.on('closed', () => outputWindows.delete(w));
    w.webContents.on('did-finish-load', () => {
      const t = outputWindows.get(w) ?? { variant: 'audience', view: 'slides', leaderSplit: DEFAULT_LEADER_SPLIT };
      w.webContents.send(CH.outputSlide, payloadFor(t));
    });
  },
  setOutputVariant(w: BrowserWindow, variant: OutputVariant) {
    if (!outputWindows.has(w)) return;
    const t = outputWindows.get(w)!;
    outputWindows.set(w, { ...t, variant });
    if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, payloadFor({ ...t, variant }));
  },
  setOutputView(w: BrowserWindow, view: OutputViewMode) {
    if (!outputWindows.has(w)) return;
    const t = outputWindows.get(w)!;
    outputWindows.set(w, { ...t, view });
    if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, payloadFor({ ...t, view }));
  },
  setOutputLeaderSplit(w: BrowserWindow, leaderSplit: number) {
    if (!outputWindows.has(w)) return;
    const t = outputWindows.get(w)!;
    const clamped = clampLeaderSplit(leaderSplit);
    outputWindows.set(w, { ...t, leaderSplit: clamped });
    if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, payloadFor({ ...t, leaderSplit: clamped }));
  },
  outputCount: () => outputWindows.size,
};
