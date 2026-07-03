import { BrowserWindow } from 'electron';
import { CH, type OutputMode, type PresentationState, type Slide } from '../shared/types';
import { applyCue, goLive, initialPresentation, outputPayload, setOutput } from '../shared/presentation/core';

let state: PresentationState = initialPresentation();
const outputWindows = new Set<BrowserWindow>();

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.presState, state);
  const payload = outputPayload(state);
  for (const w of outputWindows) if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, payload);
}
export const presentation = {
  get: () => state,
  cue: (key: string, slide: Slide) => { state = applyCue(state, key, slide); broadcast(); },
  goLive: (key: string, slide: Slide) => { state = goLive(state, key, slide); broadcast(); },
  setOutput: (mode: OutputMode) => { state = setOutput(state, mode); broadcast(); },
  registerOutput(w: BrowserWindow) {
    outputWindows.add(w);
    w.on('closed', () => outputWindows.delete(w));
    w.webContents.on('did-finish-load', () => w.webContents.send(CH.outputSlide, outputPayload(state)));
  },
  outputCount: () => outputWindows.size,
};
