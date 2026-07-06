# Slice 6a — Display Roles Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Helm's outputs "roles, not monitors" — fingerprint external displays, assign each a role (`audience | stage | livestream`) that renders the matching SlideCanvas variant, persist assignments by fingerprint, and auto-attach on plug-in.

**Architecture:** A pure, dependency-free planner (`src/shared/displays/roles.ts`) turns a `DisplaySnapshot[]` + operator-display id + saved roles into an `Attachment[]`. The `displays.ts` shell stays imperative: it gathers snapshots from Electron `screen`, calls the pure planner, and reconciles `BrowserWindow`s. The presentation payload becomes per-window so a `stage` display and an `audience` display render different variants of the same live state.

**Tech Stack:** Electron (main + preload), React (renderer), TypeScript, Vitest. Main-process tests run directly on `node:sqlite` (no better-sqlite3 rebuild).

## Global Constraints

- **Scope is 6a (engine) only.** Do NOT build: Settings → Displays UI card, "identify" flash tool, output test-card picker, output crash-supervision. Those are 6b.
- **Do NOT touch** (parallel bible agent owns these): `src/main/preserviceEngine.ts`, `src/main/preCardsRepo.ts`, `src/shared/preservice/cards.ts`, `src/renderer/operator/PreServiceMode.tsx`, `src/main/biblesRepo.ts`, `src/main/bibleInstaller.ts`, `src/renderer/operator/VersionPicker.tsx`, `src/renderer/operator/ChapterRail.tsx`, the Settings → Bibles section, and anything bible/verse-related. Add no bible/verse references.
- **`src/shared/types.ts` edits are APPEND-ONLY and localized.** Add new members at the END of their block (`CH`, `HelmApi.displays`), never interleaved — a parallel agent also appends here. Add `OutputRole` next to `OutputVariant`; add `DisplayInfo`/enriched `DisplayStatus` next to the existing `DisplayStatus`.
- **`OutputRole` is declared ONCE** in `types.ts` and imported by `roles.ts`. One-way import (`roles.ts` → `types.ts`), never back. No duplicate definition, no `any`.
- **Commit messages:** concise conventional-commit subject, body only when it adds clarity. NO `Co-Authored-By` or `Claude-Session` trailers.
- **Gate (must stay clean in this worktree):** `npm run typecheck`; `npm test` (full vitest suite, runs directly); `npx eslint .` → 0 errors (pre-existing ~3500 prettier warnings are fine; add 0 new errors).
- Commit only to branch `slice-6-displays`. Do NOT merge to master.

---

### Task 1: Pure roles core + type surface

**Files:**
- Create: `src/shared/displays/roles.ts`
- Create: `src/shared/displays/roles.test.ts`
- Modify: `src/shared/types.ts` (append `OutputRole` near `OutputVariant`; add `DisplayInfo` + enriched `DisplayStatus` replacing the current `DisplayStatus`)

**Interfaces:**
- Consumes: `OutputVariant` (existing, `types.ts:53`).
- Produces:
  - `src/shared/types.ts`: `export type OutputRole = 'audience' | 'stage' | 'livestream'`; `export interface DisplayInfo { id: number; fingerprint: string; label: string; width: number; height: number; scaleFactor: number; role: OutputRole | null; isOperator: boolean }`; `export interface DisplayStatus { outputs: number; displays: DisplayInfo[] }`.
  - `src/shared/displays/roles.ts`: `OUTPUT_ROLES: OutputRole[]`; `DEFAULT_ROLE: OutputRole`; `ROLE_VARIANT: Record<OutputRole, OutputVariant>`; `interface DisplaySnapshot { id: number; label: string; size: { width: number; height: number }; scaleFactor: number; rotation: number; bounds: { x: number; y: number; width: number; height: number }; internal: boolean }`; `interface Attachment { displayId: number; fingerprint: string; role: OutputRole; bounds: { x: number; y: number; width: number; height: number } }`; `fingerprintDisplay(d: DisplaySnapshot): string`; `planAttachments(displays: DisplaySnapshot[], operatorDisplayId: number, savedRoles: Record<string, OutputRole>): Attachment[]`.

- [ ] **Step 1: Add the type surface to `types.ts`**

In `src/shared/types.ts`, immediately after the existing `OutputVariant` line (currently line 53) and its `OutputPayload` line, add `OutputRole`. Change the region so it reads:

```ts
export type OutputVariant = 'audience' | 'main' | 'stage' | 'leader' | 'livestream';
export type OutputRole = 'audience' | 'stage' | 'livestream';  // declared here; roles.ts imports it
export interface OutputPayload { slide: Slide; variant: OutputVariant }
export interface DisplayInfo {
  id: number;
  fingerprint: string;
  label: string;            // human label or '' — 6b shows resolution when empty
  width: number;            // logical size.width
  height: number;           // logical size.height
  scaleFactor: number;      // 6b renders "1920×1080 @2x" from size + scaleFactor
  role: OutputRole | null;  // null for the operator display (not an output)
  isOperator: boolean;
}
export interface DisplayStatus { outputs: number; displays: DisplayInfo[] }
```

(The old `export interface DisplayStatus { outputs: number }` line is replaced by the two-field version above.)

- [ ] **Step 2: Write the failing test `roles.test.ts`**

Create `src/shared/displays/roles.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  DEFAULT_ROLE,
  OUTPUT_ROLES,
  ROLE_VARIANT,
  fingerprintDisplay,
  planAttachments,
  type DisplaySnapshot,
} from './roles';
import type { OutputRole } from '../types';

const snap = (over: Partial<DisplaySnapshot> = {}): DisplaySnapshot => ({
  id: 1,
  label: 'DELL U2720Q',
  size: { width: 3840, height: 2160 },
  scaleFactor: 2,
  rotation: 0,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  internal: false,
  ...over,
});

test('ROLE_VARIANT maps each role to its SlideCanvas variant', () => {
  expect(ROLE_VARIANT).toEqual({ audience: 'audience', stage: 'stage', livestream: 'livestream' });
  expect(OUTPUT_ROLES).toEqual(['audience', 'stage', 'livestream']);
  expect(DEFAULT_ROLE).toBe('audience');
});

test('fingerprint uses a meaningful label', () => {
  expect(fingerprintDisplay(snap({ label: 'DELL U2720Q' }))).toBe('label:DELL U2720Q');
});

test('fingerprint falls back to geometry for empty or generic labels', () => {
  expect(fingerprintDisplay(snap({ label: '' }))).toBe('geo:3840x2160@2r0');
  expect(fingerprintDisplay(snap({ label: 'Built-in Retina Display' }))).toBe('geo:3840x2160@2r0');
  expect(fingerprintDisplay(snap({ label: 'Unknown' }))).toBe('geo:3840x2160@2r0');
});

test('scale and rotation change the geometry fingerprint', () => {
  expect(fingerprintDisplay(snap({ label: '', scaleFactor: 1 }))).toBe('geo:3840x2160@1r0');
  expect(fingerprintDisplay(snap({ label: '', rotation: 90 }))).toBe('geo:3840x2160@2r90');
});

test('planAttachments excludes the operator display', () => {
  const displays = [snap({ id: 1, label: 'OP' }), snap({ id: 2, label: 'EXT' })];
  const plan = planAttachments(displays, 1, {});
  expect(plan.map((a) => a.displayId)).toEqual([2]);
});

test('planAttachments resolves a known fingerprint to its saved role', () => {
  const saved: Record<string, OutputRole> = { 'label:EXT': 'stage' };
  const plan = planAttachments([snap({ id: 2, label: 'EXT' })], 1, saved);
  expect(plan[0]).toEqual({
    displayId: 2,
    fingerprint: 'label:EXT',
    role: 'stage',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  });
});

test('planAttachments defaults an unknown display to audience', () => {
  const plan = planAttachments([snap({ id: 2, label: 'EXT' })], 1, {});
  expect(plan[0].role).toBe('audience');
});

test('planAttachments handles a mix of known and unknown displays', () => {
  const displays = [snap({ id: 2, label: 'A' }), snap({ id: 3, label: 'B' })];
  const plan = planAttachments(displays, 1, { 'label:A': 'livestream' });
  expect(plan.map((a) => a.role)).toEqual(['livestream', 'audience']);
});

test('planAttachments returns [] for an empty display list', () => {
  expect(planAttachments([], 1, {})).toEqual([]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- src/shared/displays/roles.test.ts`
Expected: FAIL — cannot resolve `./roles`.

- [ ] **Step 4: Implement `roles.ts`**

Create `src/shared/displays/roles.ts`:

```ts
import type { OutputVariant, OutputRole } from '../types';

export const OUTPUT_ROLES: OutputRole[] = ['audience', 'stage', 'livestream'];
export const DEFAULT_ROLE: OutputRole = 'audience';

// Roles map onto the SlideCanvas variants that already exist (types.ts OutputVariant).
// 'main'/'leader' variants are not exposed as roles in v1.
export const ROLE_VARIANT: Record<OutputRole, OutputVariant> = {
  audience: 'audience',
  stage: 'stage',
  livestream: 'livestream',
};

export interface DisplaySnapshot {
  id: number; // Electron display.id (NOT stable across sessions/replug)
  label: string; // display.label (monitor name on macOS; often '' on Win/Linux)
  size: { width: number; height: number };
  scaleFactor: number;
  rotation: number; // 0 | 90 | 180 | 270
  bounds: { x: number; y: number; width: number; height: number };
  internal: boolean;
}

export interface Attachment {
  displayId: number;
  fingerprint: string;
  role: OutputRole;
  bounds: { x: number; y: number; width: number; height: number };
}

// Stable-ish identity that survives a replug. Electron's Display does NOT expose EDID
// vendor/model/serial cross-platform, so we prefer a meaningful label and otherwise fall
// back to geometry. KNOWN LIMITATION (documented, acceptable for v1): two identical,
// unlabeled monitors produce the same fingerprint and therefore share a role.
export function fingerprintDisplay(d: DisplaySnapshot): string {
  const label = d.label.trim();
  const generic = label === '' || /^(built-?in|display|monitor|unknown)\b/i.test(label);
  return generic
    ? `geo:${d.size.width}x${d.size.height}@${d.scaleFactor}r${d.rotation}`
    : `label:${label}`;
}

// Pure planner: for every NON-operator display, resolve its role from saved assignments,
// defaulting an unknown display to 'audience' (a plugged-in screen shows the audience feed
// until the operator assigns it a role in 6b). The operator's own display is never an output.
export function planAttachments(
  displays: DisplaySnapshot[],
  operatorDisplayId: number,
  savedRoles: Record<string, OutputRole>,
): Attachment[] {
  return displays
    .filter((d) => d.id !== operatorDisplayId)
    .map((d) => {
      const fingerprint = fingerprintDisplay(d);
      const role = savedRoles[fingerprint] ?? DEFAULT_ROLE;
      return { displayId: d.id, fingerprint, role, bounds: d.bounds };
    });
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- src/shared/displays/roles.test.ts && npm run typecheck`
Expected: roles tests PASS; typecheck PASS. (Note: `useDisplayStatus` in `useHelm.ts` still returns `{ outputs: 0 }` and `displays.ts` `displayStatus()` still returns `{ outputs: ... }` — these now fail typecheck because `DisplayStatus` gained a required `displays` field. Fix both minimally in the next step so this task stays green.)

- [ ] **Step 6: Repair the two `DisplayStatus` construction sites**

In `src/renderer/operator/useHelm.ts` (line ~25), change the initial state:

```ts
const [d, setD] = useState<DisplayStatus>({ outputs: 0, displays: [] });
```

In `src/main/displays.ts` (line ~26), change `displayStatus()`:

```ts
export function displayStatus(): DisplayStatus { return { outputs: byDisplayId.size, displays: [] }; }
```

(The real `displays` payload is populated in Task 3; `[]` keeps the type honest and the app green until then.)

- [ ] **Step 7: Run the full gate**

Run: `npm run typecheck && npm test && npx eslint src/shared/displays/roles.ts src/shared/displays/roles.test.ts src/shared/types.ts src/renderer/operator/useHelm.ts src/main/displays.ts`
Expected: typecheck PASS; full suite PASS; 0 eslint errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/displays/roles.ts src/shared/displays/roles.test.ts src/shared/types.ts src/renderer/operator/useHelm.ts src/main/displays.ts
git commit -m "feat(displays): pure role planner + display info types"
```

---

### Task 2: Per-window variant rendering

**Files:**
- Modify: `src/shared/presentation/core.ts` (`outputPayload` gains a `variant` param)
- Modify: `src/shared/presentation/core.test.ts` (extend)
- Modify: `src/main/stateStore.ts` (per-window variant map, per-window broadcast, `setOutputVariant`)
- Modify: `src/main/displays.ts` (`createOutputWindow` gains a `variant` param, passed to `registerOutput`)

**Interfaces:**
- Consumes: `outputPayload` (existing), `OutputVariant`, `presentation` singleton.
- Produces:
  - `outputPayload(st: PresentationState, variant?: OutputVariant, logoTitle?: string): OutputPayload` — variant defaults to `'audience'`.
  - `presentation.registerOutput(w: BrowserWindow, variant: OutputVariant): void`.
  - `presentation.setOutputVariant(w: BrowserWindow, variant: OutputVariant): void`.
  - `createOutputWindow(bounds: Electron.Rectangle, frameless?: boolean, variant?: OutputVariant): BrowserWindow` — variant defaults to `'audience'`.

- [ ] **Step 1: Extend the `outputPayload` test**

In `src/shared/presentation/core.test.ts`, replace the final `outputPayload` test (lines 38–43) with:

```ts
test('outputPayload derives the audience slide by default', () => {
  expect(outputPayload(initialPresentation()).slide.kind).toBe('black');
  expect(outputPayload(initialPresentation()).variant).toBe('audience');
  expect(outputPayload(setOutput(initialPresentation(), 'logo')).slide).toEqual({ kind: 'logo', title: 'HELM' });
  const live = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  expect(outputPayload(live).slide.label).toBe('V1');
});
test('outputPayload passes through the requested variant', () => {
  expect(outputPayload(initialPresentation(), 'stage').variant).toBe('stage');
  expect(outputPayload(initialPresentation(), 'livestream').variant).toBe('livestream');
  // variant does not change slide derivation
  expect(outputPayload(setOutput(initialPresentation(), 'logo'), 'stage').slide).toEqual({ kind: 'logo', title: 'HELM' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/shared/presentation/core.test.ts`
Expected: FAIL — `outputPayload(..., 'stage')` currently ignores the 2nd arg and returns `variant: 'audience'`.

- [ ] **Step 3: Implement the `variant` param in `core.ts`**

In `src/shared/presentation/core.ts`, replace `outputPayload` (lines 27–32):

```ts
export function outputPayload(st: PresentationState, variant: OutputVariant = 'audience', logoTitle = 'HELM'): OutputPayload {
  const slide: Slide = st.output === 'black' ? { kind: 'black' }
    : st.output === 'logo' ? { kind: 'logo', title: logoTitle }
    : st.liveSnap ?? { kind: 'blank' };
  return { slide, variant };
}
```

Add `OutputVariant` to the type import at the top of the file:

```ts
import type { OutputMode, OutputPayload, OutputVariant, PresentationState, Slide } from '../types';
```

- [ ] **Step 4: Run the core test to verify it passes**

Run: `npm test -- src/shared/presentation/core.test.ts`
Expected: PASS.

- [ ] **Step 5: Make `stateStore.ts` per-window**

Replace the whole body of `src/main/stateStore.ts` with:

```ts
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
```

- [ ] **Step 6: Thread `variant` through `createOutputWindow`**

In `src/main/displays.ts`, change the signature and the `registerOutput` call (lines ~15–24). Add the `OutputVariant` import:

```ts
import { CH, type DisplayStatus, type OutputVariant } from '../shared/types';
```

```ts
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
```

(The existing `sync()` call `createOutputWindow(d.bounds)` and `openTestOutput`'s `createOutputWindow({...}, false)` both keep working via the `'audience'` default. Task 3 replaces the `sync()` call with a role-driven variant.)

- [ ] **Step 7: Run the full gate**

Run: `npm run typecheck && npm test && npx eslint src/shared/presentation/core.ts src/main/stateStore.ts src/main/displays.ts`
Expected: typecheck PASS; full suite PASS; 0 eslint errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/presentation/core.ts src/shared/presentation/core.test.ts src/main/stateStore.ts src/main/displays.ts
git commit -m "feat(displays): per-window output variant rendering"
```

---

### Task 3: Role-driven engine + enriched status

**Files:**
- Modify: `src/main/displays.ts` (planAttachments-driven sync, fingerprint/role tracking, operator-display exclusion, enriched `DisplayInfo[]` status, `setDisplayRole`)
- Modify: `src/main/index.ts` (pass operator-window getter + settingsRepo into `initDisplays`)

**Interfaces:**
- Consumes: `planAttachments`, `fingerprintDisplay`, `ROLE_VARIANT`, `DisplaySnapshot`, `DEFAULT_ROLE` from `../shared/displays/roles`; `SettingsRepo` from `./settingsRepo`; `presentation.setOutputVariant`; `DisplayInfo`, `OutputRole` from `../shared/types`.
- Produces:
  - `initDisplays(getOperatorWindow: () => BrowserWindow | null, settingsRepo: SettingsRepo): void`.
  - `setDisplayRole(fingerprint: string, role: OutputRole): void` (exported; wired to IPC in Task 4).
  - `displayStatus(): DisplayStatus` now returns real `{ outputs, displays: DisplayInfo[] }`.

**Notes:** `displays.ts` is a thin Electron shell (no unit test — needs real `screen`/`BrowserWindow`). Its deliverable is verified by typecheck + eslint + the full suite staying green here, and by the manual multi-display drive-through in Task 4. Persisted roles live under the settings key `displays:roles` (a `Record<fingerprint, OutputRole>`).

- [ ] **Step 1: Rewrite `displays.ts` with role tracking**

Replace `src/main/displays.ts` in full with the version below. It keeps `loadOutput`, `createOutputWindow` (with the Task 2 `variant` param), `openTestOutput`, `closeAllOutputs`, `resyncDisplays` behavior; it upgrades the tracking map, the `sync()` planner, `displayStatus()`, and adds `setDisplayRole`.

```ts
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
      label: d.label,
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
```

- [ ] **Step 2: Wire the operator getter + settingsRepo in `index.ts`**

In `src/main/index.ts`, the `initDisplays()` call is at line ~168 and `settingsRepo` is created at line ~117 (both inside `app.whenReady().then(...)`); `operatorWindow` is the module-level variable set in `createWindow()`. Change the call:

```ts
initDisplays(() => operatorWindow, settingsRepo)
```

- [ ] **Step 3: Run the full gate**

Run: `npm run typecheck && npm test && npx eslint src/main/displays.ts src/main/index.ts`
Expected: typecheck PASS; full suite PASS (no test imports `displays.ts`); 0 eslint errors.

- [ ] **Step 4: Smoke-launch the app once (single display OK)**

Run: `npm run dev` (or the project's launch — see `/run`). Confirm the app boots, the operator window opens, and no console errors from `displays.ts`. On a single-display dev machine no external output spawns — that is correct. Close the app.

- [ ] **Step 5: Commit**

```bash
git add src/main/displays.ts src/main/index.ts
git commit -m "feat(displays): role-driven attach engine with fingerprint persistence"
```

---

### Task 4: `setDisplayRole` IPC seam + header chip

**Files:**
- Modify: `src/shared/types.ts` (append `CH.displaysSetRole`; append `setRole` to `HelmApi.displays`)
- Modify: `src/main/ipc.ts` (append handler; import `setDisplayRole`)
- Modify: `src/preload/index.ts` (append `setRole` binding)
- Modify: `src/renderer/operator/Header.tsx` ("· LIVE" chip label tweak)

**Interfaces:**
- Consumes: `setDisplayRole` from `./displays`; `OutputRole` from `../shared/types`.
- Produces: `CH.displaysSetRole = 'displays:setRole'`; `HelmApi.displays.setRole(fingerprint: string, role: OutputRole): void`; renderer call `window.helm.displays.setRole(fp, role)`.

- [ ] **Step 1: Append the channel + API type in `types.ts`**

In `src/shared/types.ts`, append `displaysSetRole` at the END of the displays group inside the `CH` object (keep it localized to the displays lines, but as the last displays entry so a parallel append elsewhere won't conflict):

```ts
  displaysGet: 'displays:get', displaysStatus: 'displays:status',
  displaysOpenTest: 'displays:openTest', displaysSetRole: 'displays:setRole',
```

In the `HelmApi.displays` block, append `setRole` as the last member:

```ts
  displays: {
    get(): Promise<DisplayStatus>;
    onStatus(cb: (d: DisplayStatus) => void): () => void;
    openTest(): void;
    setRole(fingerprint: string, role: OutputRole): void;
  };
```

- [ ] **Step 2: Wire the main-process handler in `ipc.ts`**

In `src/main/ipc.ts`, extend the `displays` import (line ~26) and add the handler next to the other displays handlers (after `CH.displaysOpenTest`, line ~50):

```ts
import { displayStatus, openTestOutput, setDisplayRole } from './displays';
```

```ts
  ipcMain.handle(CH.displaysGet, () => displayStatus());
  ipcMain.on(CH.displaysOpenTest, () => openTestOutput());
  ipcMain.on(CH.displaysSetRole, (_e, fp: string, role: OutputRole) => setDisplayRole(fp, role));
```

Add `OutputRole` to the type import block at the top of `ipc.ts`:

```ts
import {
  CH,
  type MessageImportResult,
  type NewSongInput,
  type OutputMode,
  type OutputRole,
  type PreCard,
  type ScriptureReading,
  type SearchField,
  type Slide,
} from '../shared/types';
```

- [ ] **Step 3: Wire the preload binding**

In `src/preload/index.ts`, append `setRole` to the `displays` block (line ~24):

```ts
  displays: {
    get: () => ipcRenderer.invoke(CH.displaysGet),
    onStatus: sub(CH.displaysStatus),
    openTest: () => ipcRenderer.send(CH.displaysOpenTest),
    setRole: (fp, role) => ipcRenderer.send(CH.displaysSetRole, fp, role),
  },
```

- [ ] **Step 4: Header "· LIVE" chip tweak**

In `src/renderer/operator/Header.tsx`, the outputs chip is at lines ~136–138. Change it so it reads `N OUTPUTS · LIVE` when `output === 'live'` (the `isLive` boolean is already computed at line 26):

```tsx
      <span style={outputsChipStyle}>
        {outputs} OUTPUT{outputs === 1 ? '' : 'S'}{isLive ? ' · LIVE' : ''}
      </span>
```

- [ ] **Step 5: Run the full gate**

Run: `npm run typecheck && npm test && npx eslint src/shared/types.ts src/main/ipc.ts src/preload/index.ts src/renderer/operator/Header.tsx`
Expected: typecheck PASS; full suite PASS; 0 eslint errors.

- [ ] **Step 6: Manual multi-display drive-through**

With two displays (physical or virtual — on macOS use `System Settings → Displays` or a virtual-display tool; if only one display is available, note what could not be verified). Launch the app (`/run` or `npm run dev`). Confirm:
  1. **Plug in / second display present** → an `audience` output window appears fullscreen on it (clean content, no clock/NEXT chrome). Header shows `1 OUTPUT` (`· LIVE` when live).
  2. **Set the display to `stage`** via the seam — from the operator window devtools console run `window.helm.displays.setRole('<fingerprint>', 'stage')` (read the fingerprint from `await window.helm.displays.get()` → `displays[].fingerprint` for the non-operator entry). That screen switches to the `stage` confidence variant (clock / NEXT chrome) with NO re-spawn; the audience feed elsewhere stays clean.
  3. **Unplug + replug** the same display → its role is remembered (comes back as `stage`, not `audience`), because the fingerprint resolves to the persisted `displays:roles` entry.
  4. **Drag the operator window onto the external display** → after the `display-metrics`/move settles, that display is treated as the operator display and is excluded (its output window is torn down; no output on the operator's screen).

Record exactly what was and wasn't verified (GUI multi-display checks may need a human at the machine).

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/ipc.ts src/preload/index.ts src/renderer/operator/Header.tsx
git commit -m "feat(displays): setDisplayRole IPC seam + live chip"
```

---

## Final whole-branch review & rebase

After all four tasks are committed and green:

- [ ] **Whole-branch review** — use `superpowers:requesting-code-review` against the full `slice-6-displays` diff vs `master`. Confirm: no bible/verse references added; `types.ts` edits are append-only; `OutputRole` defined once; pure/shell split intact; no `any`.
- [ ] **Rebase onto latest master** from this worktree: `git fetch && git rebase master`. Resolve at most one trivial `types.ts` append conflict — **keep BOTH** this branch's additions and the bible agent's. Re-run the full gate (`npm run typecheck && npm test && npx eslint .`) after rebasing.
- [ ] **Stop and report** — do NOT merge. Summarize what was verified vs. what needs a human at a multi-display machine.

---

## Self-Review (author checklist — completed)

**Spec coverage:**
- §3 pure core (`fingerprintDisplay`, `planAttachments`, `ROLE_VARIANT`, `OUTPUT_ROLES`, `DEFAULT_ROLE`) → Task 1. ✅
- §4 per-window variant (`outputPayload(variant)`, per-window map, `setOutputVariant`, `createOutputWindow(variant)`) → Task 2. ✅
- §5 engine shell (planAttachments-driven sync, operator exclusion via getter, fingerprint/role tracking, `setDisplayRole`, enriched status) → Task 3. ✅
- §6.1 types (`OutputRole`, `DisplayInfo`, enriched `DisplayStatus`) → Task 1. §6.2 channels/API (`CH.displaysSetRole`, `HelmApi.displays.setRole`, ipc, preload) → Task 4. §6.3 header chip → Task 4. ✅
- §7 testing (roles unit tests, `ROLE_VARIANT` map, `outputPayload` variant, settings round-trip covered by existing `settingsRepo.test.ts`, manual drive-through) → Tasks 1, 2, 4. ✅
- §8 files touched — every listed file has a task. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"write tests for the above" — all code and commands are concrete. ✅

**Type consistency:** `OutputRole` declared in `types.ts`, imported everywhere. `registerOutput(w, variant)` / `setOutputVariant(w, variant)` / `createOutputWindow(bounds, frameless, variant)` / `initDisplays(getOperatorWindow, settingsRepo)` / `setDisplayRole(fingerprint, role)` / `displayStatus(): DisplayStatus` consistent across tasks. `ROLES_KEY = 'displays:roles'` matches spec §5. ✅
</content>
</invoke>
