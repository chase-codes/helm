import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { CH, type DisplayInfo, type DisplayStatus, type OutputRole, type OutputVariant, type OutputViewMode } from '../shared/types';
import {
  DEFAULT_ROLE,
  DEFAULT_LEADER_SPLIT,
  ROLE_VARIANT,
  fingerprintDisplay,
  planAttachments,
  resolveView,
  resolveLeaderSplit,
  clampLeaderSplit,
  type DisplaySnapshot,
  type ActiveOutputRole,
} from '../shared/displays/roles';
import type { SettingsRepo } from './settingsRepo';
import { presentation } from './stateStore';

const ROLES_KEY = 'displays:roles';
const VIEWS_KEY = 'displays:views';
const SPLITS_KEY = 'displays:leaderSplits';

interface Tracked { win: BrowserWindow; fingerprint: string; role: ActiveOutputRole; view: OutputViewMode; leaderSplit: number }
const byDisplayId = new Map<number, Tracked>();
const testOutputs = new Set<BrowserWindow>();

let resync: (() => void) | null = null;
let getOperator: () => BrowserWindow | null = () => null;
let settings: SettingsRepo | null = null;
let lastDisplays: DisplayInfo[] = [];

// Transient release: while true, sync() plans nothing so every screen belongs to other
// apps — including displays plugged in while released. Deliberately NOT persisted; a
// relaunch always claims screens per saved roles (#51).
let released = false;

function loadOutput(win: BrowserWindow): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/output/index.html`);
  else win.loadFile(join(__dirname, '../renderer/output/index.html'));
}
export function createOutputWindow(bounds: Electron.Rectangle, frameless = true, variant: OutputVariant = 'audience', view: OutputViewMode = 'slides', leaderSplit: number = DEFAULT_LEADER_SPLIT): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds, frame: !frameless, resizable: !frameless, movable: !frameless,
    backgroundColor: '#000000', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  if (frameless) { win.setAlwaysOnTop(true, 'screen-saver'); win.setSkipTaskbar(true); win.setBounds(bounds); }
  loadOutput(win);
  presentation.registerOutput(win, variant, view, leaderSplit);
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
export function operatorDisplayId(): number {
  const opWin = getOperator();
  if (opWin && !opWin.isDestroyed()) return screen.getDisplayMatching(opWin.getBounds()).id;
  return screen.getPrimaryDisplay().id;
}

function savedRoles(): Record<string, OutputRole> {
  return settings?.get<Record<string, OutputRole>>(ROLES_KEY, {}) ?? {};
}

function savedViews(): Record<string, OutputViewMode> {
  return settings?.get<Record<string, OutputViewMode>>(VIEWS_KEY, {}) ?? {};
}

function savedSplits(): Record<string, number> {
  return settings?.get<Record<string, number>>(SPLITS_KEY, {}) ?? {};
}

function broadcastStatus(): void {
  const status = displayStatus();
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.displaysStatus, status);
}

function sync(): void {
  const snaps = screen.getAllDisplays().map(snapshot);
  const opId = operatorDisplayId();
  const roles = savedRoles();
  const plan = released ? [] : planAttachments(snaps, opId, roles);
  const plannedIds = new Set(plan.map((a) => a.displayId));
  const views = savedViews();
  const splits = savedSplits();

  // Destroy windows for displays that are no longer planned (unplugged or became operator).
  for (const [id, t] of byDisplayId) {
    if (!plannedIds.has(id)) { if (!t.win.isDestroyed()) t.win.destroy(); byDisplayId.delete(id); }
  }
  // Create / re-bounds / re-tag for each planned attachment.
  for (const a of plan) {
    const view = resolveView(views, a.fingerprint);
    const leaderSplit = resolveLeaderSplit(splits, a.fingerprint);
    const existing = byDisplayId.get(a.displayId);
    if (existing && !existing.win.isDestroyed()) {
      existing.win.setBounds(a.bounds);
      existing.fingerprint = a.fingerprint;
      if (existing.role !== a.role) {
        existing.role = a.role;
        presentation.setOutputVariant(existing.win, ROLE_VARIANT[a.role]);
      }
      if (existing.view !== view) {
        existing.view = view;
        presentation.setOutputView(existing.win, view);
      }
      if (existing.leaderSplit !== leaderSplit) {
        existing.leaderSplit = leaderSplit;
        presentation.setOutputLeaderSplit(existing.win, leaderSplit);
      }
      continue;
    }
    const win = createOutputWindow(a.bounds, true, ROLE_VARIANT[a.role], view, leaderSplit);
    // Symmetric to testOutputs' 'closed' cleanup: if this output is torn down by any path
    // other than our own sync/closeAllOutputs (e.g. Cmd+W), drop the stale map entry so
    // displayStatus() doesn't over-count. Guard against clobbering a replacement window a
    // later sync may have already put under this display id.
    win.on('closed', () => { if (byDisplayId.get(a.displayId)?.win === win) byDisplayId.delete(a.displayId); });
    byDisplayId.set(a.displayId, { win, fingerprint: a.fingerprint, role: a.role, view, leaderSplit });
  }

  // Build enriched DisplayInfo[] for ALL displays (operator included) for the header/6b.
  lastDisplays = snaps.map((d) => {
    const isOperator = d.id === opId;
    const fingerprint = fingerprintDisplay(d);
    return {
      id: d.id,
      fingerprint,
      label: d.label ?? '',
      width: d.size.width,
      height: d.size.height,
      scaleFactor: d.scaleFactor,
      role: isOperator ? null : (roles[fingerprint] ?? DEFAULT_ROLE),
      isOperator,
      view: isOperator ? null : resolveView(views, fingerprint),
      leaderSplit: isOperator ? null : resolveLeaderSplit(splits, fingerprint),
    };
  });
  broadcastStatus();
}

export function displayStatus(): DisplayStatus {
  const liveTestOutputs = [...testOutputs].filter((w) => !w.isDestroyed()).length;
  return { outputs: byDisplayId.size + liveTestOutputs, displays: lastDisplays, released };
}

// Toggle transient release of every output. Dev test outputs are framed windows that
// don't claim a screen — release leaves them alone.
export function toggleOutputsReleased(): void {
  released = !released;
  sync();
}

// Persist a role for a fingerprint and live-re-tag every matching window — a variant swap
// is a live re-tag, except crossing the off boundary, which forces a full resync below.
export function setDisplayRole(fingerprint: string, role: OutputRole): void {
  const roles = savedRoles();
  const prev = roles[fingerprint] ?? DEFAULT_ROLE;
  roles[fingerprint] = role;
  settings?.set(ROLES_KEY, roles);
  // Crossing the off boundary needs a window destroyed or created — full sync (which
  // also rebuilds lastDisplays and broadcasts). Everything else is a cheap live re-tag.
  if (role === 'off' || prev === 'off') {
    resync?.();
    return;
  }
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

// Persist a view for a fingerprint and live-re-tag every matching window (no re-spawn).
// The literal fingerprint 'test' targets dev test-output windows instead, so the driver
// script (and a dev on a one-display machine) can exercise leader/mirror.
export function setDisplayView(fingerprint: string, view: OutputViewMode): void {
  if (fingerprint === 'test') {
    for (const w of testOutputs) if (!w.isDestroyed()) presentation.setOutputView(w, view);
    return;
  }
  const views = savedViews();
  views[fingerprint] = view;
  settings?.set(VIEWS_KEY, views);
  for (const t of byDisplayId.values()) {
    if (t.fingerprint === fingerprint && !t.win.isDestroyed()) {
      t.view = view;
      presentation.setOutputView(t.win, view);
    }
  }
  lastDisplays = lastDisplays.map((d) =>
    !d.isOperator && d.fingerprint === fingerprint ? { ...d, view } : d,
  );
  broadcastStatus();
}

// Persist a leader split for a fingerprint and live-re-tag every matching window (no re-spawn).
// Same 'test' special-case as setDisplayView: targets dev test-output windows, no persistence.
export function setLeaderSplitByFingerprint(fingerprint: string, px: number): void {
  if (fingerprint === 'test') {
    for (const w of testOutputs) if (!w.isDestroyed()) presentation.setOutputLeaderSplit(w, clampLeaderSplit(px));
    return;
  }
  const clamped = clampLeaderSplit(px);
  const splits = savedSplits();
  splits[fingerprint] = clamped;
  settings?.set(SPLITS_KEY, splits);
  for (const t of byDisplayId.values()) {
    if (t.fingerprint === fingerprint && !t.win.isDestroyed()) {
      t.leaderSplit = clamped;
      presentation.setOutputLeaderSplit(t.win, clamped);
    }
  }
  lastDisplays = lastDisplays.map((d) =>
    !d.isOperator && d.fingerprint === fingerprint ? { ...d, leaderSplit: clamped } : d,
  );
  broadcastStatus();
}
// The leader window reports its own drag; it doesn't know its fingerprint, but main can
// resolve it from the sending WebContents. Test outputs (dev windows, no fingerprint)
// get a live re-tag only — nothing to persist against.
export function setLeaderSplitFromSender(sender: Electron.WebContents, px: number): void {
  for (const t of byDisplayId.values()) {
    if (t.win.webContents === sender) { setLeaderSplitByFingerprint(t.fingerprint, px); return; }
  }
  for (const w of testOutputs) {
    if (w.webContents === sender && !w.isDestroyed()) presentation.setOutputLeaderSplit(w, clampLeaderSplit(px));
  }
}

export function initDisplays(getOperatorWindow: () => BrowserWindow | null, settingsRepo: SettingsRepo): void {
  released = false;
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
// Test outputs count toward displayStatus()'s `outputs` (the update pill guard) same as real
// display outputs, so both directions need an explicit broadcast — the 'closed' handler below
// doesn't get one for free the way sync()'s real-display teardown does via its own broadcast.
export function openTestOutput(): void {
  const win = createOutputWindow({ x: 80, y: 80, width: 960, height: 540 }, false);
  testOutputs.add(win);
  win.on('closed', () => { testOutputs.delete(win); broadcastStatus(); });
  broadcastStatus();
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
