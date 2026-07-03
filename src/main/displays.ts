import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { CH, type DisplayStatus } from '../shared/types';
import { presentation } from './stateStore';

const byDisplayId = new Map<number, BrowserWindow>();

function loadOutput(win: BrowserWindow): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/output/index.html`);
  else win.loadFile(join(__dirname, '../renderer/output/index.html'));
}
export function createOutputWindow(bounds: Electron.Rectangle, frameless = true): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds, frame: !frameless, resizable: !frameless, movable: !frameless,
    backgroundColor: '#000000', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false },
  });
  if (frameless) { win.setAlwaysOnTop(true, 'screen-saver'); win.setSkipTaskbar(true); win.setBounds(bounds); }
  loadOutput(win);
  presentation.registerOutput(win);
  return win;
}
export function displayStatus(): DisplayStatus { return { outputs: byDisplayId.size }; }

export function initDisplays(): void {
  const sync = (): void => {
    const primary = screen.getPrimaryDisplay();
    const externals = screen.getAllDisplays().filter((d) => d.id !== primary.id);
    for (const [id, win] of byDisplayId) if (!externals.some((d) => d.id === id)) { win.destroy(); byDisplayId.delete(id); }
    for (const d of externals) {
      const existing = byDisplayId.get(d.id);
      if (existing && !existing.isDestroyed()) { existing.setBounds(d.bounds); continue; }
      byDisplayId.set(d.id, createOutputWindow(d.bounds));
    }
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.displaysStatus, displayStatus());
  };
  screen.on('display-added', sync); screen.on('display-removed', sync); screen.on('display-metrics-changed', sync);
  sync();
}
// Dev helper: windowed output for single-display machines
export function openTestOutput(): void { createOutputWindow({ x: 80, y: 80, width: 960, height: 540 }, false); }
