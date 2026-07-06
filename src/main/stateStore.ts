import { BrowserWindow } from 'electron';
import { CH, type OutputMode, type OutputVariant, type PresentationState, type Slide } from '../shared/types';
import { applyCue, goLive, initialPresentation, outputPayload, setOutput } from '../shared/presentation/core';

let state: PresentationState = initialPresentation();
const outputWindows = new Map<BrowserWindow, OutputVariant>();

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.presState, state);
  for (const [w, variant] of outputWindows) if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, outputPayload(state, variant));
}
export const presentation = {
  get: () => state,
  cue: (key: string, slide: Slide) => { state = applyCue(state, key, slide); broadcast(); },
  goLive: (key: string, slide: Slide) => { state = goLive(state, key, slide); broadcast(); },
  setOutput: (mode: OutputMode) => { state = setOutput(state, mode); broadcast(); },
  registerOutput(w: BrowserWindow, variant: OutputVariant) {
    outputWindows.set(w, variant);
    w.on('closed', () => outputWindows.delete(w));
    w.webContents.on('did-finish-load', () => {
      const v = outputWindows.get(w) ?? 'audience';
      w.webContents.send(CH.outputSlide, outputPayload(state, v));
    });
  },
  setOutputVariant(w: BrowserWindow, variant: OutputVariant) {
    if (!outputWindows.has(w)) return;
    outputWindows.set(w, variant);
    if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, outputPayload(state, variant));
  },
  outputCount: () => outputWindows.size,
};
