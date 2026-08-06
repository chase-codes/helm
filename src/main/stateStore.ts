import { BrowserWindow } from 'electron';
import { CH, type OutputMode, type OutputVariant, type OutputViewMode, type PresentationState, type Slide } from '../shared/types';
import { applyCue, goLive, initialPresentation, outputPayload, setOutput, showLive } from '../shared/presentation/core';

let state: PresentationState = initialPresentation();
const outputWindows = new Map<BrowserWindow, { variant: OutputVariant; view: OutputViewMode }>();

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.presState, state);
  for (const [w, t] of outputWindows) if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, outputPayload(state, t.variant, t.view));
}
export const presentation = {
  get: () => state,
  cue: (key: string, slide: Slide) => { state = applyCue(state, key, slide); broadcast(); },
  goLive: (key: string, slide: Slide) => { state = goLive(state, key, slide); broadcast(); },
  show: (key: string, slide: Slide) => { state = showLive(state, key, slide); broadcast(); },
  setOutput: (mode: OutputMode) => { state = setOutput(state, mode); broadcast(); },
  registerOutput(w: BrowserWindow, variant: OutputVariant, view: OutputViewMode = 'slides') {
    outputWindows.set(w, { variant, view });
    w.on('closed', () => outputWindows.delete(w));
    w.webContents.on('did-finish-load', () => {
      const t = outputWindows.get(w) ?? { variant: 'audience', view: 'slides' };
      w.webContents.send(CH.outputSlide, outputPayload(state, t.variant, t.view));
    });
  },
  setOutputVariant(w: BrowserWindow, variant: OutputVariant) {
    if (!outputWindows.has(w)) return;
    const t = outputWindows.get(w)!;
    outputWindows.set(w, { ...t, variant });
    if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, outputPayload(state, variant, t.view));
  },
  setOutputView(w: BrowserWindow, view: OutputViewMode) {
    if (!outputWindows.has(w)) return;
    const t = outputWindows.get(w)!;
    outputWindows.set(w, { ...t, view });
    if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, outputPayload(state, t.variant, view));
  },
  outputCount: () => outputWindows.size,
};
