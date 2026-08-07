import { BrowserWindow } from 'electron';
import { CH, type OutputMode, type OutputVariant, type OutputViewMode, type PresentationState, type Slide } from '../shared/types';
import { applyCue, goLive, initialPresentation, outputPayload, setOutput, showLive } from '../shared/presentation/core';
import { DEFAULT_LEADER_SPLIT, clampLeaderSplit } from '../shared/displays/roles';

let state: PresentationState = initialPresentation();
const outputWindows = new Map<BrowserWindow, { variant: OutputVariant; view: OutputViewMode; leaderSplit: number }>();

function payloadFor(t: { variant: OutputVariant; view: OutputViewMode; leaderSplit: number }) {
  return { ...outputPayload(state, t.variant, t.view), leaderSplit: t.leaderSplit };
}
function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.presState, state);
  for (const [w, t] of outputWindows) if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, payloadFor(t));
}
export const presentation = {
  get: () => state,
  cue: (key: string, slide: Slide) => { state = applyCue(state, key, slide); broadcast(); },
  goLive: (key: string, slide: Slide) => { state = goLive(state, key, slide); broadcast(); },
  show: (key: string, slide: Slide) => { state = showLive(state, key, slide); broadcast(); },
  setOutput: (mode: OutputMode) => { state = setOutput(state, mode); broadcast(); },
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
