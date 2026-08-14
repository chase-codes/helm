# Display Opt-Out (`off` role) + Release/Take Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix issue #51 — let a display be marked `off` (Helm never touches it, persisted per fingerprint) and give the operator a transient "release all screens / take back" toggle in the header with a hotkey.

**Architecture:** `'off'` joins the `OutputRole` union; the pure planner (`src/shared/displays/roles.ts`) drops off displays so no window is ever created for them. The main process (`src/main/displays.ts`) gains a non-persisted `released` flag that makes `sync()` plan nothing. UI: an Off option in the Displays settings dropdown, a `ReleaseToggle` button in the header, and a global `displays.release` hotkey (`Mod+B`).

**Tech Stack:** Electron + TypeScript, React renderer, vitest (+ jsdom/@testing-library for renderer tests).

**Spec:** `docs/superpowers/specs/2026-08-13-display-optout-release-design.md`

## Global Constraints

- Window layering stays `setAlwaysOnTop(true, 'screen-saver')` — do NOT change it.
- `DEFAULT_ROLE` stays `'audience'` — a never-seen display still lights up automatically.
- `released` is never persisted; `initDisplays()` always starts un-released.
- Commit messages: concise conventional-commit subject, NO `Co-Authored-By`/`Claude-Session` trailers (house rule).
- Verification commands: `npx vitest run <file>` per task; `npm run typecheck`, `npm run lint`, `npm run test` at the end.
- Hotkey note: the matcher (`eventToBinding`) normalizes Shift away for printable keys, so a `Mod+Shift+B` binding string can never match a letter keypress. The stored default is therefore `'Mod+B'`, which matches both Cmd/Ctrl+B and Cmd/Ctrl+Shift+B presses.

---

### Task 1: `off` role through the planner and main process

**Files:**
- Modify: `src/shared/types.ts:149` (OutputRole union)
- Modify: `src/shared/displays/roles.ts`
- Modify: `src/main/displays.ts`
- Test: `src/shared/displays/roles.test.ts`
- Test: `src/main/displays.test.ts`

**Interfaces:**
- Consumes: existing `planAttachments`, `setDisplayRole`, `sync()` machinery.
- Produces: `OutputRole = 'audience' | 'stage' | 'livestream' | 'off'`; `type ActiveOutputRole = Exclude<OutputRole, 'off'>` exported from `roles.ts`; `Attachment.role: ActiveOutputRole`; `ROLE_VARIANT: Record<ActiveOutputRole, OutputVariant>`; `planAttachments` skips off displays; `DisplayInfo.role` reports `'off'` for off displays. Later tasks rely on `OUTPUT_ROLES` containing `'off'` (Settings dropdown renders from it) and on `setDisplayRole(fp, 'off')` destroying the window.

- [ ] **Step 1: Write the failing planner tests**

In `src/shared/displays/roles.test.ts`, update the constants test (line 27–31) and add off-role tests:

```ts
test('ROLE_VARIANT maps each active role to its SlideCanvas variant', () => {
  expect(ROLE_VARIANT).toEqual({ audience: 'audience', stage: 'stage', livestream: 'livestream' });
  expect(OUTPUT_ROLES).toEqual(['audience', 'stage', 'livestream', 'off']);
  expect(DEFAULT_ROLE).toBe('audience');
});

test('planAttachments skips a display whose saved role is off', () => {
  const displays = [snap({ id: 2, label: 'EXT' }), snap({ id: 3, label: 'TV' })];
  const plan = planAttachments(displays, 1, { 'label:EXT': 'off' });
  expect(plan.map((a) => a.displayId)).toEqual([3]);
});

test('planAttachments still defaults an unknown display to audience when others are off', () => {
  const plan = planAttachments([snap({ id: 2, label: 'NEW' })], 1, { 'label:EXT': 'off' });
  expect(plan[0].role).toBe('audience');
});
```

- [ ] **Step 2: Write the failing main-process tests**

Append to `src/main/displays.test.ts`. This needs an init harness the file doesn't have yet — add it below the existing describe block:

```ts
import { screen } from 'electron';
import {
  displayStatus,
  closeAllOutputs,
  initDisplays,
  resyncDisplays,
  setDisplayRole,
} from './displays';
import type { SettingsRepo } from './settingsRepo';
```

(Merge these into the existing import of `./displays` at line 60 — one import statement, not two. `import type { SettingsRepo }` is type-only, so better-sqlite3 never loads.)

```ts
// Enough Electron.Display surface for snapshot(): id/label/size/scaleFactor/rotation/bounds/internal.
function disp(id: number, over: Record<string, unknown> = {}): Electron.Display {
  return {
    id,
    label: `EXT${id}`,
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
    rotation: 0,
    bounds: { x: 1920 * id, y: 0, width: 1920, height: 1080 },
    internal: false,
    ...over,
  } as unknown as Electron.Display;
}

// In-memory SettingsRepo; exposes the map so tests can assert persistence.
function memRepo(seed: Record<string, unknown> = {}): { repo: SettingsRepo; map: Map<string, unknown> } {
  const map = new Map(Object.entries(seed));
  const repo: SettingsRepo = {
    get: <T,>(key: string, fallback: T): T => (map.has(key) ? (map.get(key) as T) : fallback),
    set: (key, value) => void map.set(key, value),
  };
  return { repo, map };
}

describe('off role (#51)', () => {
  beforeEach(() => {
    closeAllOutputs();
    vi.mocked(screen.getAllDisplays).mockReturnValue([]);
  });

  // getOperator returns null → operatorDisplayId falls back to the mocked primary, id 1.
  it('creates no window for a display saved as off and reports its role', () => {
    vi.mocked(screen.getAllDisplays).mockReturnValue([disp(1), disp(2)]);
    initDisplays(() => null, memRepo({ 'displays:roles': { 'label:EXT2': 'off' } }).repo);
    expect(displayStatus().outputs).toBe(0);
    expect(displayStatus().displays.find((d) => d.id === 2)?.role).toBe('off');
  });

  it('setDisplayRole off destroys the window; back to audience recreates it', () => {
    vi.mocked(screen.getAllDisplays).mockReturnValue([disp(1), disp(2)]);
    const { repo, map } = memRepo();
    initDisplays(() => null, repo);
    expect(displayStatus().outputs).toBe(1);

    setDisplayRole('label:EXT2', 'off');
    expect(displayStatus().outputs).toBe(0);
    expect(map.get('displays:roles')).toEqual({ 'label:EXT2': 'off' });

    setDisplayRole('label:EXT2', 'audience');
    expect(displayStatus().outputs).toBe(1);
  });

  it('an off display stays off across a resync', () => {
    vi.mocked(screen.getAllDisplays).mockReturnValue([disp(1), disp(2)]);
    initDisplays(() => null, memRepo({ 'displays:roles': { 'label:EXT2': 'off' } }).repo);
    resyncDisplays();
    expect(displayStatus().outputs).toBe(0);
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npx vitest run src/shared/displays/roles.test.ts src/main/displays.test.ts`
Expected: FAIL — `OUTPUT_ROLES` has 3 entries not 4; off display still gets a window (`outputs` 1 not 0) and reports role `'audience'`.

- [ ] **Step 4: Implement the shared types and planner**

`src/shared/types.ts` line 149:

```ts
export type OutputRole = 'audience' | 'stage' | 'livestream' | 'off';  // declared here; roles.ts imports it
```

`src/shared/displays/roles.ts`:

```ts
/** Roles that actually drive a window; 'off' means Helm leaves the screen alone. */
export type ActiveOutputRole = Exclude<OutputRole, 'off'>;

export const OUTPUT_ROLES: OutputRole[] = ['audience', 'stage', 'livestream', 'off'];
export const DEFAULT_ROLE: OutputRole = 'audience';
```

`ROLE_VARIANT` retyped (values unchanged) so the compiler forbids a window for an off display:

```ts
export const ROLE_VARIANT: Record<ActiveOutputRole, OutputVariant> = {
  audience: 'audience',
  stage: 'stage',
  livestream: 'livestream',
};
```

`Attachment.role` narrowed:

```ts
export interface Attachment {
  displayId: number;
  fingerprint: string;
  role: ActiveOutputRole;
  bounds: { x: number; y: number; width: number; height: number };
}
```

`planAttachments` body (comment updated to mention off):

```ts
// Pure planner: for every NON-operator display, resolve its role from saved assignments,
// defaulting an unknown display to 'audience' (a plugged-in screen shows the audience feed
// until the operator assigns it a role). A display saved as 'off' produces no attachment at
// all — Helm leaves it alone. The operator's own display is never an output.
export function planAttachments(
  displays: DisplaySnapshot[],
  operatorDisplayId: number,
  savedRoles: Record<string, OutputRole>,
): Attachment[] {
  const out: Attachment[] = [];
  for (const d of displays) {
    if (d.id === operatorDisplayId) continue;
    const fingerprint = fingerprintDisplay(d);
    const role = savedRoles[fingerprint] ?? DEFAULT_ROLE;
    if (role === 'off') continue;
    out.push({ displayId: d.id, fingerprint, role, bounds: d.bounds });
  }
  return out;
}
```

- [ ] **Step 5: Implement the main-process side**

`src/main/displays.ts`:

1. Import `ActiveOutputRole` from `../shared/displays/roles` (type import) and narrow `Tracked`:

```ts
interface Tracked { win: BrowserWindow; fingerprint: string; role: ActiveOutputRole; view: OutputViewMode; leaderSplit: number }
```

2. In `sync()` (line 86): hoist the roles map and resolve `lastDisplays` roles/views from saved state, not from `tracked` — an off display has no tracked window and would otherwise mis-report as `audience`:

```ts
function sync(): void {
  const snaps = screen.getAllDisplays().map(snapshot);
  const opId = operatorDisplayId();
  const roles = savedRoles();
  const plan = planAttachments(snaps, opId, roles);
  ...
```

and in the `lastDisplays` mapping replace the `role:`/`view:` lines:

```ts
      role: isOperator ? null : (roles[fingerprint] ?? DEFAULT_ROLE),
      isOperator,
      view: isOperator ? null : resolveView(views, fingerprint),
```

(The `tracked` variable becomes unused in that mapping — delete `const tracked = byDisplayId.get(d.id);`.)

3. `setDisplayRole` (line 157): crossing the off boundary in either direction means a window must be destroyed or created — run the full sync (it also rebuilds `lastDisplays` and broadcasts). The early return narrows `role` to `ActiveOutputRole` for the retag path below it:

```ts
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
    ...unchanged retag loop and lastDisplays patch...
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/shared/displays/roles.test.ts src/main/displays.test.ts`
Expected: PASS (all, including the pre-existing tests in both files).

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean. (If `typecheck:web` flags renderer code over the widened `OutputRole`, note it — Task 3 covers the renderer — but no renderer file should break: the dropdown renders `OUTPUT_ROLES` generically.)

```bash
git add src/shared/types.ts src/shared/displays/roles.ts src/shared/displays/roles.test.ts src/main/displays.ts src/main/displays.test.ts
git commit -m "feat(displays): off role — planner skips displays marked off (#51)"
```

---

### Task 2: Release / take in the main process, wired over IPC

**Files:**
- Modify: `src/main/displays.ts`
- Modify: `src/shared/types.ts` (DisplayStatus, CH, HelmApi.displays)
- Modify: `src/main/ipc.ts:65-69`
- Modify: `src/preload/index.ts:25-31`
- Modify: `src/renderer/operator/useHelm.ts` (useDisplayStatus default)
- Modify (fixtures only, for typecheck): `src/renderer/operator/DisplaysSettings.test.tsx`, `src/renderer/operator/OutputViewPopover.test.tsx`, `src/renderer/operator/UpdatePill.test.tsx`
- Test: `src/main/displays.test.ts`

**Interfaces:**
- Consumes: Task 1's harness (`disp`, `memRepo`, `initDisplays`) in displays.test.ts.
- Produces: `toggleOutputsReleased(): void` exported from `src/main/displays.ts`; `DisplayStatus` gains required `released: boolean`; new channel `CH.displaysToggleReleased = 'displays:toggleReleased'`; preload/HelmApi method `displays.toggleReleased(): void`. Tasks 4–5 call `window.helm.displays.toggleReleased()` and read `useDisplayStatus().released`.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/displays.test.ts` (add `toggleOutputsReleased` to the `./displays` import):

```ts
describe('release / take (#51)', () => {
  beforeEach(() => {
    closeAllOutputs();
    vi.mocked(screen.getAllDisplays).mockReturnValue([disp(1), disp(2), disp(3)]);
    initDisplays(() => null, memRepo().repo);
  });

  it('release destroys every output and flags status; take restores them', () => {
    expect(displayStatus().outputs).toBe(2);
    expect(displayStatus().released).toBe(false);

    toggleOutputsReleased();
    expect(displayStatus().outputs).toBe(0);
    expect(displayStatus().released).toBe(true);

    toggleOutputsReleased();
    expect(displayStatus().outputs).toBe(2);
    expect(displayStatus().released).toBe(false);
  });

  it('a display plugged in while released is left alone until take', () => {
    toggleOutputsReleased();
    vi.mocked(screen.getAllDisplays).mockReturnValue([disp(1), disp(2), disp(3), disp(4)]);
    resyncDisplays(); // what the display-added handler runs
    expect(displayStatus().outputs).toBe(0);

    toggleOutputsReleased();
    expect(displayStatus().outputs).toBe(3);
  });

  it('released is transient: re-init starts un-released', () => {
    toggleOutputsReleased();
    expect(displayStatus().released).toBe(true);
    initDisplays(() => null, memRepo().repo); // relaunch equivalent
    expect(displayStatus().released).toBe(false);
    expect(displayStatus().outputs).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/displays.test.ts`
Expected: FAIL — `toggleOutputsReleased` is not exported; `displayStatus().released` is undefined.

- [ ] **Step 3: Implement release/take in `src/main/displays.ts`**

Module state, next to `lastDisplays`:

```ts
// Transient release: while true, sync() plans nothing so every screen belongs to other
// apps — including displays plugged in while released. Deliberately NOT persisted; a
// relaunch always claims screens per saved roles (#51).
let released = false;
```

In `sync()`:

```ts
  const plan = released ? [] : planAttachments(snaps, opId, roles);
```

In `displayStatus()`:

```ts
export function displayStatus(): DisplayStatus {
  const liveTestOutputs = [...testOutputs].filter((w) => !w.isDestroyed()).length;
  return { outputs: byDisplayId.size + liveTestOutputs, displays: lastDisplays, released };
}
```

New export (dev test outputs are framed windows that don't claim a screen — release leaves them alone):

```ts
export function toggleOutputsReleased(): void {
  released = !released;
  sync();
}
```

In `initDisplays()`, first line of the body:

```ts
  released = false;
```

- [ ] **Step 4: Wire types, IPC, preload, hook defaults**

`src/shared/types.ts`:

```ts
export interface DisplayStatus { outputs: number; displays: DisplayInfo[]; released: boolean }
```

In `CH` (next to the other displays channels, line ~178):

```ts
  displaysToggleReleased: 'displays:toggleReleased',
```

In `HelmApi.displays` (line ~278):

```ts
    toggleReleased(): void;
```

`src/main/ipc.ts` (add `toggleOutputsReleased` to the `./displays` import):

```ts
  ipcMain.on(CH.displaysToggleReleased, () => toggleOutputsReleased());
```

`src/preload/index.ts` displays block:

```ts
    toggleReleased: () => ipcRenderer.send(CH.displaysToggleReleased),
```

`src/renderer/operator/useHelm.ts` `useDisplayStatus`:

```ts
  const [d, setD] = useState<DisplayStatus>({ outputs: 0, displays: [], released: false });
```

Fixture updates (typecheck only — every explicitly-typed `DisplayStatus` literal gains `released: false`):
- `DisplaysSettings.test.tsx` `STATUS` object: add `released: false` after `outputs: 2,`.
- `OutputViewPopover.test.tsx` `STATUS` object: same.
- `UpdatePill.test.tsx`: line ~25 `Promise.resolve<DisplayStatus>({ outputs: 0, displays: [] })` → `{ outputs: 0, displays: [], released: false }`; line ~57 `displaysCb({ outputs: 1, displays: [] })` → `displaysCb({ outputs: 1, displays: [], released: false })` (and any other `DisplayStatus` literals in that file).

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/main/displays.test.ts && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/displays.ts src/main/displays.test.ts src/shared/types.ts src/main/ipc.ts src/preload/index.ts src/renderer/operator/useHelm.ts src/renderer/operator/DisplaysSettings.test.tsx src/renderer/operator/OutputViewPopover.test.tsx src/renderer/operator/UpdatePill.test.tsx
git commit -m "feat(displays): transient release/take of all outputs over IPC (#51)"
```

---

### Task 3: Settings UI — Off option, hidden view control, hint copy

**Files:**
- Modify: `src/renderer/operator/DisplaysSettings.tsx`
- Test: `src/renderer/operator/DisplaysSettings.test.tsx`

**Interfaces:**
- Consumes: `OUTPUT_ROLES` (already contains `'off'` after Task 1 — the dropdown grows the option with no code change), `DisplayInfo.role === 'off'`.
- Produces: settings pane behavior only; nothing downstream depends on it.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/operator/DisplaysSettings.test.tsx`, add a fourth display to `STATUS.displays`:

```ts
    {
      id: 4,
      fingerprint: 'label:Lobby TV',
      label: 'Lobby TV',
      width: 1280,
      height: 720,
      scaleFactor: 1,
      role: 'off',
      view: 'slides',
      isOperator: false,
      leaderSplit: 320
    }
```

New tests in the describe block:

```ts
  it('offers an off option in the role dropdown', async () => {
    installHelmStub()
    const r = renderPane()
    await waitFor(() => expect(r.getByText('Projector')).toBeTruthy())
    const select = r.getByTestId('role-label:Projector') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toContain('off')
  })

  it('hides the view control for an off display but keeps its role picker', async () => {
    installHelmStub()
    const r = renderPane()
    await waitFor(() => expect(r.getByText('Lobby TV')).toBeTruthy())
    expect(r.getByTestId('role-label:Lobby TV')).toBeTruthy()
    expect(r.queryByTestId('view-label:Lobby TV-slides')).toBeNull()
    // A driven display still shows its view buttons.
    expect(r.getByTestId('view-label:Projector-slides')).toBeTruthy()
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/operator/DisplaysSettings.test.tsx`
Expected: the off-option test PASSES already (dropdown renders `OUTPUT_ROLES`); the hidden-view test FAILS — view buttons render for the off display.

- [ ] **Step 3: Implement**

In `DisplaysSettings.tsx`, wrap the view segmented control (the `segWrapStyle` div, lines 109–120) so it only renders for driven displays:

```tsx
                {d.role !== 'off' && (
                  <div style={segWrapStyle}>
                    {OUTPUT_VIEWS.map((v) => (
                      <button
                        key={v}
                        style={segStyle(d.view === v)}
                        data-testid={`view-${d.fingerprint}-${v}`}
                        onClick={() => window.helm.displays.setView(d.fingerprint, v)}
                      >
                        {VIEW_LABEL[v]}
                      </button>
                    ))}
                  </div>
                )}
```

Update the hint copy (lines 79–82) to cover Off and the twin-monitor caveat:

```tsx
      <div style={sectionHintStyle}>
        Each screen Helm drives has a role (what feed it gets) and a view (how it shows it). Mirror
        shows this operator screen; Leader shows a clean song view for the pulpit. Off leaves a
        screen entirely alone — note two identical unlabeled monitors share one identity, so
        marking one off marks both.
      </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/DisplaysSettings.test.tsx`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/DisplaysSettings.tsx src/renderer/operator/DisplaysSettings.test.tsx
git commit -m "feat(settings): off option per display, view control hidden when off (#51)"
```

---

### Task 4: Header `ReleaseToggle` + popover skips off displays

**Files:**
- Create: `src/renderer/operator/ReleaseToggle.tsx`
- Test: `src/renderer/operator/ReleaseToggle.test.tsx`
- Modify: `src/renderer/operator/Header.tsx` (mount the toggle)
- Modify: `src/renderer/operator/OutputViewPopover.tsx:23` (filter off displays)
- Test: `src/renderer/operator/OutputViewPopover.test.tsx`

**Interfaces:**
- Consumes: `useDisplayStatus().released`, `window.helm.displays.toggleReleased()` (Task 2), `formatBinding` from `src/shared/hotkeys/match.ts`.
- Produces: `ReleaseToggle(): JSX.Element` (no props), rendered by Header.

- [ ] **Step 1: Write the failing ReleaseToggle tests**

Create `src/renderer/operator/ReleaseToggle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReleaseToggle } from './ReleaseToggle'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { DisplayStatus } from '../../shared/types'

afterEach(cleanup)

function installHelmStub(status: DisplayStatus): { toggleReleased: ReturnType<typeof vi.fn> } {
  const toggleReleased = vi.fn()
  ;(window as unknown as { helm: unknown }).helm = {
    displays: {
      get: () => Promise.resolve(status),
      onStatus: () => () => {},
      toggleReleased
    }
  }
  return { toggleReleased }
}

const renderToggle = (): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <ReleaseToggle />
    </ThemeCtx.Provider>
  )

describe('ReleaseToggle', () => {
  it('offers to release and fires toggleReleased on click', async () => {
    const { toggleReleased } = installHelmStub({ outputs: 1, displays: [], released: false })
    const r = renderToggle()
    await waitFor(() => expect(r.getByText('RELEASE SCREENS')).toBeTruthy())
    fireEvent.click(r.getByTestId('release-toggle'))
    expect(toggleReleased).toHaveBeenCalledTimes(1)
  })

  it('shows the released state loudly and offers to take back', async () => {
    installHelmStub({ outputs: 0, displays: [], released: true })
    const r = renderToggle()
    await waitFor(() => expect(r.getByText('SCREENS RELEASED · TAKE BACK')).toBeTruthy())
  })
})
```

- [ ] **Step 2: Write the failing popover test**

In `src/renderer/operator/OutputViewPopover.test.tsx`, add a fourth display to `STATUS.displays`:

```ts
    {
      id: 4,
      fingerprint: 'label:Lobby TV',
      label: 'Lobby TV',
      width: 1280,
      height: 720,
      scaleFactor: 1,
      role: 'off',
      view: 'slides',
      isOperator: false,
      leaderSplit: 320
    }
```

New test (`renderPopover` is the file's existing mount helper):

```tsx
  it('skips off displays — they have no view to switch', async () => {
    installHelmStub()
    const r = renderPopover()
    await waitFor(() => expect(r.getByText('Projector')).toBeTruthy())
    expect(r.queryByText('Lobby TV')).toBeNull()
  })
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/renderer/operator/ReleaseToggle.test.tsx src/renderer/operator/OutputViewPopover.test.tsx`
Expected: ReleaseToggle FAILS (module doesn't exist); popover test FAILS ('Lobby TV' renders).

- [ ] **Step 4: Implement**

Create `src/renderer/operator/ReleaseToggle.tsx`:

```tsx
import { useContext, type CSSProperties, type JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import { useDisplayStatus } from './useHelm'
import { formatBinding } from '../../shared/hotkeys/match'

/** Transient release/take of every output screen (#51): releasing destroys all output
 * windows so another app can present, without touching saved roles; taking back re-syncs.
 * State lives in main and arrives via displayStatus, so every window agrees. */
export function ReleaseToggle(): JSX.Element {
  const T = useContext(ThemeCtx)
  const { released } = useDisplayStatus()
  const chip = formatBinding('Mod+B')
  const style: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '10px',
    letterSpacing: '0.07em',
    fontWeight: 700,
    padding: '5px 9px',
    borderRadius: '7px',
    whiteSpace: 'nowrap',
    color: released ? T.live : T.dim,
    background: released ? T.live + '22' : 'transparent',
    boxShadow: released ? `inset 0 0 0 1px ${T.live}88` : `inset 0 0 0 1px ${T.hairline}`
  }
  return (
    <button
      data-testid="release-toggle"
      style={style}
      onClick={() => window.helm.displays.toggleReleased()}
      title={
        released
          ? `Take the screens back (${chip})`
          : `Release every screen to other apps (${chip})`
      }
    >
      {released ? 'SCREENS RELEASED · TAKE BACK' : 'RELEASE SCREENS'}
    </button>
  )
}
```

In `src/renderer/operator/Header.tsx`: `import { ReleaseToggle } from './ReleaseToggle'` and mount it right after `<div style={{ flex: 1 }} />` (line 148), before the outputs-chip container:

```tsx
      <div style={{ flex: 1 }} />
      <ReleaseToggle />
      <div ref={outputsContainerRef} style={{ position: 'relative' }}>
```

In `src/renderer/operator/OutputViewPopover.tsx` line 23:

```ts
  const outputs = displays.filter((d) => !d.isOperator && d.role !== 'off')
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/ReleaseToggle.test.tsx src/renderer/operator/OutputViewPopover.test.tsx`
Expected: PASS (all, including pre-existing popover tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/ReleaseToggle.tsx src/renderer/operator/ReleaseToggle.test.tsx src/renderer/operator/Header.tsx src/renderer/operator/OutputViewPopover.tsx src/renderer/operator/OutputViewPopover.test.tsx
git commit -m "feat(header): release/take screens toggle; popover skips off displays (#51)"
```

---

### Task 5: `displays.release` hotkey (Mod+B)

**Files:**
- Modify: `src/shared/hotkeys/actions.ts`
- Modify: `src/renderer/operator/keyDispatch.ts`
- Modify: `src/renderer/operator/App.tsx` (onAppAction, ~line 93)
- Test: `src/renderer/operator/keyDispatch.test.ts`

**Interfaces:**
- Consumes: `window.helm.displays.toggleReleased()` (Task 2).
- Produces: `AppActionId` gains `'displays.release'`; global action `{ id: 'displays.release', label: 'Release / take screens', defaults: ['Mod+B'] }` (auto-appears in the Shortcuts pane, which renders from `HOTKEY_ACTIONS`).

- [ ] **Step 1: Write the failing tests**

In `src/renderer/operator/keyDispatch.test.ts` (the file's `ev` helper + `baseCtx` already exist; `isMac: false` so `ctrl` is Mod):

```ts
  it('Mod+B dispatches displays.release', () => {
    const onAppAction = vi.fn()
    const e = ev('b', { ctrl: true })
    dispatchModeKey(e, { ...baseCtx({ onAppAction }), handler: makeHandler() })
    expect(onAppAction).toHaveBeenCalledWith('displays.release')
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('Mod+B works even with settings open or a modal up — it is a panic control', () => {
    const onAppAction = vi.fn()
    dispatchModeKey(ev('b', { ctrl: true }), {
      ...baseCtx({ settingsOpen: true, onAppAction }),
      handler: makeHandler({ isModalOpen: vi.fn(() => true) })
    })
    expect(onAppAction).toHaveBeenCalledWith('displays.release')
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/operator/keyDispatch.test.ts`
Expected: FAIL — `onAppAction` not called (no such action resolves).

- [ ] **Step 3: Implement**

`src/shared/hotkeys/actions.ts`:

```ts
export type AppActionId = 'page.pre' | 'page.songs' | 'page.sermon' | 'scripture.lookup' | 'displays.release'
```

Add to `HOTKEY_ACTIONS` after `'scripture.lookup'` (Mod+B: the matcher drops Shift for printable keys, so this also catches Mod+Shift+B; no conflict — songs-scope bare `B` is a different binding):

```ts
  { id: 'displays.release', label: 'Release / take screens', scope: 'global', defaults: ['Mod+B'] },
```

`src/renderer/operator/keyDispatch.ts` — new case at the top of the switch, before the `'page.pre'` group (deliberately NOT behind the settings/modal guard):

```ts
    case 'displays.release':
      // Panic control — releasing/taking the screens must work even behind Settings
      // or a modal; it touches no operator-window UI state.
      e.preventDefault();
      ctx.onAppAction('displays.release');
      return;
```

`src/renderer/operator/App.tsx` `onAppAction` (~line 93) — new branch before the lookup fallback:

```ts
  const onAppAction = useCallback((id: AppActionId): void => {
    if (id === 'page.pre') setMode('pre');
    else if (id === 'page.songs') setMode('songs');
    else if (id === 'page.sermon') setMode('sermon');
    else if (id === 'displays.release') window.helm.displays.toggleReleased();
    else {
      setMode('sermon');
      setLookupNonce((n) => n + 1);
    }
  }, []);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/keyDispatch.test.ts src/shared/hotkeys/actions.test.ts src/shared/hotkeys/match.test.ts src/renderer/operator/ShortcutsSettings.test.tsx`
Expected: PASS — including the pre-existing hotkey suites (the new action must not break sanitize/conflict/pane tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/hotkeys/actions.ts src/renderer/operator/keyDispatch.ts src/renderer/operator/App.tsx src/renderer/operator/keyDispatch.test.ts
git commit -m "feat(hotkeys): Mod+B releases/takes all screens (#51)"
```

---

### Task 6: Full verification sweep

**Files:** none new — verification only.

**Interfaces:** n/a.

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all suites PASS.

- [ ] **Step 2: Typecheck both projects**

Run: `npm run typecheck`
Expected: clean for both tsconfig.node and tsconfig.web.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Acceptance check against #51 (read-only reasoning pass)**

Confirm each criterion maps to shipped behavior + a test:
- Display set to `off` → no window, left alone (Task 1 tests).
- Setting survives restart → persisted in `displays:roles`; re-init keeps it (Task 1 resync test).
- Release + re-take mid-service without quitting (Task 2 tests; Task 4 UI; Task 5 hotkey).
- Never-seen display still comes up audience (Task 1 planner test).
- Single-projector regression: pre-existing tests in roles/displays/settings suites all still pass.

- [ ] **Step 5: Commit any stragglers (formatting only), no-op otherwise**

```bash
git status --short
```

Expected: clean tree; nothing to commit.
