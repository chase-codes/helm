import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { CH, type DisplayInfo, type DisplayStatus, type OutputRole, type OutputVariant } from '../shared/types';
import {
  DEFAULT_ROLE,
  ROLE_VARIANT,
  fingerprintDisplay,
  planAttachments,
  type DisplaySnapshot,
} from '../shared/displays/roles';
import type { SettingsRepo } from './settingsRepo';
import { presentation } from './stateStore';

const ROLES_KEY = 'displays:roles';

interface Tracked { win: BrowserWindow; fingerprint: string; role: OutputRole }
const byDisplayId = new Map<number, Tracked>();
const testOutputs = new Set<BrowserWindow>();

let resync: (() => void) | null = null;
let getOperator: () => BrowserWindow | null = () => null;
let settings: SettingsRepo | null = null;
let lastDisplays: DisplayInfo[] = [];

function loadOutput(win: BrowserWindow): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/output/index.html`);
  else win.loadFile(join(__dirname, '../renderer/output/index.html'));
}
export function createOutputWindow(bounds: Electron.Rectangle, frameless = true, variant: OutputVariant = 'audience'): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds, frame: !frameless, resizable: !frameless, movable: !frameless,
    backgroundColor: '#000000', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  if (frameless) { win.setAlwaysOnTop(true, 'screen-saver'); win.setSkipTaskbar(true); win.setBounds(bounds); }
  loadOutput(win);
  presentation.registerOutput(win, variant);
  return win;
}

function snapshot(d: Electron.Display): DisplaySnapshot {
  return {
    id: d.id,
    label: d.label ?? '',
    size: { width: d.size.width, height: d.size.height },
    scaleFactor: d.scaleFactor,
    rotation: d.rotation,
    bounds: d.bounds,
    internal: d.internal,
  };
}

// The operator display is the one the operator window sits on; it is never an output.
// Falls back to the primary display id when there is no operator window (e.g. after Cmd+W).
function operatorDisplayId(): number {
  const opWin = getOperator();
  if (opWin && !opWin.isDestroyed()) return screen.getDisplayMatching(opWin.getBounds()).id;
  return screen.getPrimaryDisplay().id;
}

function savedRoles(): Record<string, OutputRole> {
  return settings?.get<Record<string, OutputRole>>(ROLES_KEY, {}) ?? {};
}

function broadcastStatus(): void {
  const status = displayStatus();
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.displaysStatus, status);
}

function sync(): void {
  const snaps = screen.getAllDisplays().map(snapshot);
  const opId = operatorDisplayId();
  const plan = planAttachments(snaps, opId, savedRoles());
  const plannedIds = new Set(plan.map((a) => a.displayId));

  // Destroy windows for displays that are no longer planned (unplugged or became operator).
  for (const [id, t] of byDisplayId) {
    if (!plannedIds.has(id)) { if (!t.win.isDestroyed()) t.win.destroy(); byDisplayId.delete(id); }
  }
  // Create / re-bounds / re-tag for each planned attachment.
  for (const a of plan) {
    const existing = byDisplayId.get(a.displayId);
    if (existing && !existing.win.isDestroyed()) {
      existing.win.setBounds(a.bounds);
      existing.fingerprint = a.fingerprint;
      if (existing.role !== a.role) {
        existing.role = a.role;
        presentation.setOutputVariant(existing.win, ROLE_VARIANT[a.role]);
      }
      continue;
    }
    const win = createOutputWindow(a.bounds, true, ROLE_VARIANT[a.role]);
    // Symmetric to testOutputs' 'closed' cleanup: if this output is torn down by any path
    // other than our own sync/closeAllOutputs (e.g. Cmd+W), drop the stale map entry so
    // displayStatus() doesn't over-count. Guard against clobbering a replacement window a
    // later sync may have already put under this display id.
    win.on('closed', () => { if (byDisplayId.get(a.displayId)?.win === win) byDisplayId.delete(a.displayId); });
    byDisplayId.set(a.displayId, { win, fingerprint: a.fingerprint, role: a.role });
  }

  // Build enriched DisplayInfo[] for ALL displays (operator included) for the header/6b.
  lastDisplays = snaps.map((d) => {
    const isOperator = d.id === opId;
    const tracked = byDisplayId.get(d.id);
    return {
      id: d.id,
      fingerprint: fingerprintDisplay(d),
      label: d.label ?? '',
      width: d.size.width,
      height: d.size.height,
      scaleFactor: d.scaleFactor,
      role: isOperator ? null : (tracked?.role ?? DEFAULT_ROLE),
      isOperator,
    };
  });
  broadcastStatus();
}

export function displayStatus(): DisplayStatus {
  return { outputs: byDisplayId.size, displays: lastDisplays };
}

// Persist a role for a fingerprint and live-re-tag every matching window (no re-spawn —
// a variant swap is a live re-tag). Called from IPC (Task 4) and 6b's UI later.
export function setDisplayRole(fingerprint: string, role: OutputRole): void {
  const roles = savedRoles();
  roles[fingerprint] = role;
  settings?.set(ROLES_KEY, roles);
  for (const t of byDisplayId.values()) {
    if (t.fingerprint === fingerprint && !t.win.isDestroyed()) {
      t.role = role;
      presentation.setOutputVariant(t.win, ROLE_VARIANT[role]);
    }
  }
  // Refresh the DisplayInfo[] role values and re-broadcast.
  lastDisplays = lastDisplays.map((d) =>
    !d.isOperator && d.fingerprint === fingerprint ? { ...d, role } : d,
  );
  broadcastStatus();
}

export function initDisplays(getOperatorWindow: () => BrowserWindow | null, settingsRepo: SettingsRepo): void {
  getOperator = getOperatorWindow;
  settings = settingsRepo;
  screen.on('display-added', sync);
  screen.on('display-removed', sync);
  screen.on('display-metrics-changed', sync);
  resync = sync;
  sync();
}

// Re-attach output windows to external displays on demand — e.g. when the operator
// window is recreated after an accidental Cmd+W tore all outputs down; without this,
// outputs would only come back on a display add/remove/metrics event.
export function resyncDisplays(): void { resync?.(); }

// Dev helper: windowed output for single-display machines.
export function openTestOutput(): void {
  const win = createOutputWindow({ x: 80, y: 80, width: 960, height: 540 }, false);
  testOutputs.add(win);
  win.on('closed', () => testOutputs.delete(win));
}

// Destroys every output window (real-display and test) so none are left orphaned once the
// operator window closes — always-on-top outputs would otherwise survive with no way for
// the user to close them (esp. on Win/Linux, where there's no dock icon / activate handler
// to bring the operator window back).
export function closeAllOutputs(): void {
  for (const t of byDisplayId.values()) if (!t.win.isDestroyed()) t.win.destroy();
  byDisplayId.clear();
  for (const w of testOutputs) if (!w.isDestroyed()) w.destroy();
  testOutputs.clear();
}
