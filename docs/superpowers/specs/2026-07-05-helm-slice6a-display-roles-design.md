# Helm — Slice 6a: Display roles engine

**Date:** 2026-07-05
**Status:** Draft — awaiting user review
**Master spec:** `docs/superpowers/specs/2026-07-03-helm-design.md` (§6 "Multi-display engine", §8 "Settings → Displays", §9 output supervision)

> Slice 6 in the master build order ("Display hardening + settings card") is split into two shippable pieces:
> - **6a (this spec)** — the roles ENGINE: fingerprinting, role model, per-window variant rendering, persistence, auto-attach. No operator UI beyond the header status chip.
> - **6b (later spec)** — the Settings → Displays card (role-assignment UI, "identify" flash tool, output test card) and output crash-supervision (§9). 6b drives the `setDisplayRole` seam 6a exposes.

---

## 1. Purpose

Today's display engine (`src/main/displays.ts`) auto-spawns a fullscreen output window on every external display and tears it down on unplug — but **every window renders the identical `audience` payload** (`outputPayload` in `src/shared/presentation/core.ts` hardcodes `variant: 'audience'`), nothing is remembered across a replug, and there is no notion of a display's *role*.

Slice 6a makes outputs **roles, not monitors** (master spec §6): the operator can have a clean `audience` projector and a `stage` confidence monitor (clock + NEXT chrome) and/or a `livestream` lower-third feed simultaneously, each rendering the correct SlideCanvas variant; assignments persist by display fingerprint and re-attach automatically when a known display is plugged back in.

**In scope (6a):**
- Display **fingerprinting** (stable across replug within the platform's limits).
- **Role model** — `audience | stage | livestream` → existing SlideCanvas variants.
- **Per-window variant rendering** — each output window renders its role's variant.
- **Persistence** of role assignments by fingerprint (`settingsRepo`).
- **Auto-attach** on plug-in: known fingerprint → its saved role; unknown → `audience`.
- **Enriched display status** (`DisplayInfo[]`) so the header chip and 6b's UI have the data.
- A `setDisplayRole(fingerprint, role)` IPC seam (persists + re-tags live windows) — the hook 6b's UI will call.

**Deferred to 6b (do not build here):** the Settings → Displays card, the "identify" flash-a-number tool, the output test-card picker, and output crash-supervision/respawn (§9).

**Out (v1, master spec §12):** alpha-key hardware output (the `livestream` variant renders a keyable backplate only), remote/tablet display control.

---

## 2. Architecture

The decision logic is extracted into a **pure, dependency-free module** (`src/shared/displays/roles.ts`) so it is unit-testable with plain data; `displays.ts` stays a thin imperative shell that turns the plan into `BrowserWindow`s. This mirrors the `presentation/core.ts` (pure) ↔ `stateStore.ts` (shell) and `video/state.ts` (pure) ↔ `videoState.ts` (shell) splits already in the codebase.

```
screen events ─▶ displays.ts (shell) ──gathers DisplaySnapshot[] + operator display id + saved roles
                       │
                       ├─▶ planAttachments(...)  [pure]  ─▶ Attachment[] {displayId, fingerprint, role, bounds}
                       │
                       └─▶ reconcile windows: create/destroy/re-bounds; each output window
                           registered with its role's OutputVariant; broadcast is per-window.
Settings 6b ──IPC setDisplayRole(fp, role)──▶ persist(settingsRepo) + re-tag live windows + emit status
```

---

## 3. Pure core — `src/shared/displays/roles.ts`

`OutputRole` is declared in `src/shared/types.ts` (a pure type, next to `OutputVariant`); `roles.ts` imports it. This one-way direction (`roles.ts` → `types.ts`, never back) avoids an import cycle, since `types.ts` needs `OutputRole` for `DisplayInfo` and `HelmApi.setRole`.

```ts
import type { OutputVariant, OutputRole } from '../types';

export const OUTPUT_ROLES: OutputRole[] = ['audience', 'stage', 'livestream'];
export const DEFAULT_ROLE: OutputRole = 'audience';

// Roles map onto the SlideCanvas variants that already exist (src/shared/types.ts
// OutputVariant). 'main'/'leader' variants are not exposed as roles in v1.
export const ROLE_VARIANT: Record<OutputRole, OutputVariant> = {
  audience: 'audience',
  stage: 'stage',
  livestream: 'livestream',
};

export interface DisplaySnapshot {
  id: number;                 // Electron display.id (NOT stable across sessions/replug)
  label: string;              // display.label (monitor name on macOS; often '' on Win/Linux)
  size: { width: number; height: number };
  scaleFactor: number;
  rotation: number;           // 0 | 90 | 180 | 270
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

**Design note on the auto-attach rule.** Master spec §6 says "if unknown and exactly one non-operator display exists, default it to audience." 6a generalizes this to **any unknown display → `audience`**, because `audience` is always the safe, useful default (a new screen should show content, not stay dark) and the operator refines roles in 6b. The "exactly one" nuance is therefore subsumed, not lost.

---

## 4. Per-window variant rendering

Today all output windows receive one global payload. 6a makes the payload **per-window** so a `stage` display and an `audience` display differ.

### 4.1 `src/shared/presentation/core.ts` (pure)

`outputPayload` takes the variant as a parameter (currently hardcoded):

```ts
export function outputPayload(st: PresentationState, variant: OutputVariant = 'audience', logoTitle = 'HELM'): OutputPayload {
  const slide: Slide = st.output === 'black' ? { kind: 'black' }
    : st.output === 'logo' ? { kind: 'logo', title: logoTitle }
    : st.liveSnap ?? { kind: 'blank' };
  return { slide, variant };
}
```

### 4.2 `src/main/stateStore.ts` (shell)

`registerOutput` associates a variant with each window; broadcast is per-window; a setter re-tags a live window on role change:

```ts
const outputWindows = new Map<BrowserWindow, OutputVariant>();

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.presState, state);
  for (const [w, variant] of outputWindows) if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, outputPayload(state, variant));
}

registerOutput(w: BrowserWindow, variant: OutputVariant) {
  outputWindows.set(w, variant);
  w.on('closed', () => outputWindows.delete(w));
  w.webContents.on('did-finish-load', () => { const v = outputWindows.get(w) ?? 'audience'; w.webContents.send(CH.outputSlide, outputPayload(state, v)); });
},
setOutputVariant(w: BrowserWindow, variant: OutputVariant) {
  if (!outputWindows.has(w)) return;
  outputWindows.set(w, variant);
  if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, outputPayload(state, variant));
},
outputCount: () => outputWindows.size,
```

The output renderer (`OutputApp.tsx`) already renders `payload.variant` through `SlideCanvas`/`VideoCanvas` — **no renderer change needed**; it simply starts receiving non-`audience` variants. Video sync is unaffected (the video-state channel is independent of the presentation variant).

---

## 5. Engine shell — `src/main/displays.ts`

- **Track richer per-display state:** `byDisplayId: Map<number, { win: BrowserWindow; fingerprint: string; role: OutputRole }>`.
- **Operator display exclusion:** `initDisplays(getOperatorWindow)` receives a getter for the operator `BrowserWindow`; the operator display id is `screen.getDisplayMatching(opWin.getBounds()).id` (falls back to `getPrimaryDisplay().id` when no operator window). This replaces the current "primary display" assumption so the engine is correct when the operator drags their window to a non-primary screen.
- **sync():** build `DisplaySnapshot[]` from `screen.getAllDisplays()`; read saved roles from `settingsRepo.get('displays:roles', {})`; `plan = planAttachments(snapshots, operatorDisplayId, savedRoles)`. Reconcile: destroy windows for display ids no longer planned; for each planned attachment, if a window exists re-bounds it (and re-tag variant if its role changed), else `createOutputWindow(bounds, true, ROLE_VARIANT[role])` and record it. Then broadcast enriched status.
- **`createOutputWindow(bounds, frameless, variant)`** gains a `variant` param and calls `presentation.registerOutput(win, variant)`. `openTestOutput()` passes `'audience'`.
- **`setDisplayRole(fingerprint, role)`:** persist into `settingsRepo` (`displays:roles`); for every live window whose stored fingerprint matches, update `role`, call `presentation.setOutputVariant(win, ROLE_VARIANT[role])`, and re-emit status. (No re-spawn; a variant swap is a live re-tag.)
- **Enriched status** (see §6) emitted on every sync, on role change, and on display add/remove/metrics.

`closeAllOutputs`, `resyncDisplays`, and the `screen` event wiring are unchanged in spirit (still add/remove/metrics → sync).

---

## 6. Status & IPC surface

### 6.1 Types (`src/shared/types.ts`, additive at end of each block)

```ts
export type OutputRole = 'audience' | 'stage' | 'livestream';  // declared here; roles.ts imports it

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
```

`DisplayStatus` grows a list (keep the existing `outputs` count for the header):

```ts
export interface DisplayStatus { outputs: number; displays: DisplayInfo[] }
```

`OutputRole` is declared in `types.ts` (§6.1 above) and imported by `roles.ts` — a single definition, no duplicate, no `any`.

### 6.2 Channels & API (append at end of `CH`, `HelmApi.displays`, `ipc.ts`, `preload`)

```
CH.displaysSetRole = 'displays:setRole'   // renderer → main
```

```ts
// HelmApi.displays gains:
setRole(fingerprint: string, role: OutputRole): void;
```

`displays.get()` already returns `DisplayStatus` and `onStatus` already broadcasts it — both now carry the richer `DisplayInfo[]` for free. `ipc.ts` adds `ipcMain.on(CH.displaysSetRole, (_e, fp, role) => setDisplayRole(fp, role))`; `preload` adds `setRole: (fp, role) => ipcRenderer.send(CH.displaysSetRole, fp, role)`.

### 6.3 Header chip (`src/renderer/operator/Header.tsx`)

Minor: the existing "N OUTPUTS" chip becomes "N OUTPUTS · LIVE" when `output === 'live'` (the `live` state is already available via `usePresentationState`; do not add it to `DisplayStatus`). Purely a label tweak in the existing component.

---

## 7. Testing (vitest)

- **Pure `roles.ts`:** `fingerprintDisplay` (meaningful label → `label:` key; empty/generic label → `geo:` key; scale & rotation change the key); `planAttachments` (excludes the operator display; known fingerprint → saved role; unknown → `audience`; empty display list → `[]`; two displays one known one unknown).
- **`ROLE_VARIANT`** maps each role to the expected `OutputVariant`.
- **`outputPayload(state, variant)`** returns the passed variant and still maps `black`/`logo` correctly (extend `presentation/core` tests).
- **`settingsRepo`** round-trip for a `displays:roles` record (existing repo test pattern).
- **Not unit-tested (thin shell / needs real screens):** `displays.ts` `BrowserWindow` orchestration and the live variant re-tag — covered by the manual multi-display drive-through below.
- **Manual (drive-the-app):** two physical/virtual displays — plug in → audience output appears; assign `stage` via the temporary test seam (or 6b later) → that screen shows clock/NEXT chrome while audience stays clean; unplug + replug the same display → its role is remembered; drag the operator window to the external display → it is excluded (no output on the operator's screen).

---

## 8. Files touched

**New:**
- `src/shared/displays/roles.ts` + `src/shared/displays/roles.test.ts`

**Modified (additive/localized):**
- `src/shared/presentation/core.ts` — `outputPayload` takes a `variant` param (+ test).
- `src/main/stateStore.ts` — per-window variant map, `setOutputVariant`, per-window broadcast.
- `src/main/displays.ts` — fingerprint/role tracking, `planAttachments`-driven sync, operator-display exclusion, `setDisplayRole`, enriched status, `createOutputWindow(variant)`.
- `src/main/index.ts` — pass the operator-window getter into `initDisplays`.
- `src/shared/types.ts` — `DisplayInfo`, enriched `DisplayStatus`, `OutputRole` surface, `CH.displaysSetRole`, `HelmApi.displays.setRole` (all appended at the end of their blocks — expect at most a trivial conflict if the bible agent also appended to `types.ts`).
- `src/main/ipc.ts` — `displaysSetRole` handler (appended).
- `src/preload/index.ts` — `setRole` binding (appended).
- `src/renderer/operator/Header.tsx` — "· LIVE" chip label tweak.

**Do NOT touch** (bible/pre-service agent's territory): `src/main/preserviceEngine.ts`, `src/main/preCardsRepo.ts`, `src/shared/preservice/cards.ts`, `src/renderer/operator/PreServiceMode.tsx`, `src/main/biblesRepo.ts`, `src/main/bibleInstaller.ts`, `src/renderer/operator/VersionPicker.tsx`, `src/renderer/operator/ChapterRail.tsx`, the Settings **Bibles** section, and anything bible/verse-lookup-related.

---

## 9. Build order (sub-tasks, each shippable/green)

1. **Pure roles core** — `roles.ts` (`OutputRole`, `ROLE_VARIANT`, `fingerprintDisplay`, `planAttachments`) + tests; add `OutputRole`/`DisplayInfo`/enriched `DisplayStatus` to `types.ts`.
2. **Per-window variants** — `outputPayload(variant)` + test; `stateStore` per-window map + `setOutputVariant` + per-window broadcast; `createOutputWindow(variant)`.
3. **Engine** — `displays.ts` driven by `planAttachments`, operator-display exclusion (operator-window getter through `index.ts`), fingerprint/role tracking, enriched status.
4. **Role seam + header** — `setDisplayRole` IPC (CH/ipc/preload/API) + `Header.tsx` "· LIVE" chip. *(Full manual multi-display drive-through.)*

---

## 10. Notes for the implementing agent

- Master switched main-process tests to `node:sqlite` — the better-sqlite3 ABI dance is **gone**; `npm test` runs the full suite directly.
- Keep `types.ts` edits append-only (a parallel agent may also be appending) — one trivial conflict at most.
- The renderer output path (`OutputApp.tsx`, `SlideCanvas`, `VideoCanvas`) already honors `payload.variant`; 6a only changes which variant each window receives. No output-renderer change expected.
</content>
