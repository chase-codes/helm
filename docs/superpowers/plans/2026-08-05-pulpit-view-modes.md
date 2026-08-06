# Pulpit View Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every output display a switchable view mode — `slides` (today's render), `leader` (distraction-free song view), `mirror` (live capture of the operator's screen) — switched from a header popover and managed in a new Settings → Displays pane.

**Architecture:** A per-fingerprint `OutputViewMode` persisted under settings key `displays:views`, parallel to `displays:roles`. `stateStore` tracks a view per output window and includes it in `OutputPayload`; `OutputApp` branches on it behind an error boundary whose fallback is the plain slides render. Mirror mode streams the operator's screen via `getDisplayMedia` + a main-process `setDisplayMediaRequestHandler`. Leader mode fetches the live song over the existing `songs:get` IPC and renders hero + section rail with `useFitText`.

**Tech Stack:** Electron (IPC, `desktopCapturer`, `setDisplayMediaRequestHandler`), React 19 + TypeScript, vitest + @testing-library/react (jsdom), SQLite settings repo.

**Spec:** `docs/superpowers/specs/2026-08-05-sermon-resize-and-pulpit-views-design.md` §2–§7

## Global Constraints

- Settings key, verbatim: `displays:views` → `Record<fingerprint, OutputViewMode>`. Missing entry ⇒ `'slides'`; existing setups must behave exactly as today until a screen is opted in.
- View switching is a live re-tag (no window respawn), following the `setOutputVariant` pattern.
- Nothing added to the output render path may blank a screen: the view branch is wrapped in an error boundary falling back to the slides render (BUG-009 discipline — there is no other error boundary in the app).
- Platforms: macOS + Windows. Mirror capture needs the Screen Recording permission on macOS only; the failure message must name it there. Windows checkpoint (manual): confirm no yellow "screen is being shared" border on real hardware.
- Test env: vitest has no `globals: true` — component tests need `afterEach(cleanup)` and the `// @vitest-environment jsdom` pragma.
- Commit messages: concise conventional-commit subjects, no Co-Authored-By/session trailers (house rules).

---

### Task 1: Types + pure view-resolution logic

**Files:**
- Modify: `src/shared/types.ts` (`OutputVariant` block `:133-146`, `CH` `:156-157`, `HelmApi.displays` `:252-257`)
- Modify: `src/shared/displays/roles.ts`
- Modify: `src/shared/presentation/core.ts` (`outputPayload` `:51-56`)
- Test: `src/shared/displays/roles.test.ts`, `src/shared/presentation/core.test.ts` (add cases)

**Interfaces:**
- Produces (all later tasks use these exact names):

```ts
// types.ts
export type OutputViewMode = 'slides' | 'leader' | 'mirror';
export interface OutputPayload { slide: Slide; variant: OutputVariant; view: OutputViewMode }
export interface DisplayInfo { /* existing fields */; view: OutputViewMode | null }  // null for operator
// CH additions:
//   displaysSetView: 'displays:setView'
// HelmApi.displays addition:
//   setView(fingerprint: string, view: OutputViewMode): void;

// roles.ts
export const OUTPUT_VIEWS: OutputViewMode[] = ['slides', 'leader', 'mirror'];
export const DEFAULT_VIEW: OutputViewMode = 'slides';
export function resolveView(saved: Record<string, OutputViewMode>, fingerprint: string): OutputViewMode;

// core.ts — signature change (variant keeps its default):
export function outputPayload(st: PresentationState, variant?: OutputVariant, view?: OutputViewMode, logoTitle?: string): OutputPayload;
```

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/displays/roles.test.ts`:

```ts
import { resolveView, DEFAULT_VIEW } from './roles';

describe('resolveView', () => {
  it('returns the saved view for a known fingerprint', () => {
    expect(resolveView({ 'label:BenQ GW2480': 'leader' }, 'label:BenQ GW2480')).toBe('leader');
  });
  it('defaults an unknown fingerprint to slides', () => {
    expect(resolveView({}, 'label:BenQ GW2480')).toBe(DEFAULT_VIEW);
    expect(DEFAULT_VIEW).toBe('slides');
  });
});
```

Add to `src/shared/presentation/core.test.ts`:

```ts
it('outputPayload carries the view and defaults it to slides', () => {
  const st = { output: 'live', liveKey: 'song:a:0', liveSnap: { kind: 'lyrics', lines: ['x'] } } as PresentationState;
  expect(outputPayload(st).view).toBe('slides');
  expect(outputPayload(st, 'stage', 'leader').view).toBe('leader');
  expect(outputPayload(st, 'stage', 'leader').variant).toBe('stage');
});
```

(Adapt the `liveSnap` literal to the file's existing slide fixtures.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/shared/displays/roles.test.ts src/shared/presentation/core.test.ts`
Expected: FAIL — `resolveView` not exported; `view` undefined.

- [ ] **Step 3: Implement**

`types.ts`: add `export type OutputViewMode = 'slides' | 'leader' | 'mirror';` beside `OutputVariant` (`:133`); add `view: OutputViewMode` to `OutputPayload` (`:135`); add `view: OutputViewMode | null` to `DisplayInfo` with the comment `// resolved view for outputs; null for the operator display`; add `displaysSetView: 'displays:setView',` next to `displaysSetRole` in `CH` (`:157`); add `setView(fingerprint: string, view: OutputViewMode): void;` to `HelmApi.displays` (`:252-257`).

`roles.ts` (below `DEFAULT_ROLE`):

```ts
export const OUTPUT_VIEWS: OutputViewMode[] = ['slides', 'leader', 'mirror'];
export const DEFAULT_VIEW: OutputViewMode = 'slides';

/** Saved view for a fingerprint, defaulting to the plain slides render. */
export function resolveView(saved: Record<string, OutputViewMode>, fingerprint: string): OutputViewMode {
  return saved[fingerprint] ?? DEFAULT_VIEW;
}
```

(Import `OutputViewMode` in the existing type import from `../types`.)

`core.ts`:

```ts
export function outputPayload(st: PresentationState, variant: OutputVariant = 'audience', view: OutputViewMode = 'slides', logoTitle = 'HELM'): OutputPayload {
  const slide: Slide = st.output === 'black' ? { kind: 'black' }
    : st.output === 'logo' ? { kind: 'logo', title: logoTitle }
    : st.liveSnap ?? { kind: 'blank' };
  return { slide, variant, view };
}
```

- [ ] **Step 4: Run to verify they pass, and typecheck to find every affected call site**

Run: `npx vitest run src/shared && npm run typecheck`
Expected: shared tests PASS. Typecheck will FAIL in `stateStore.ts`/`OutputApp.tsx` if `OutputPayload.view` is required — that's Tasks 2/4's work; to keep this task green, it's acceptable for typecheck to fail ONLY on those named files. If anything else fails, fix it here.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/displays/roles.ts src/shared/presentation/core.ts src/shared/displays/roles.test.ts src/shared/presentation/core.test.ts
git commit -m "feat(displays): OutputViewMode type + view-aware outputPayload"
```

---

### Task 2: stateStore tracks a view per output window

**Files:**
- Modify: `src/main/stateStore.ts` (whole file is 32 lines — rework the map)

**Interfaces:**
- Consumes: `OutputViewMode`, `outputPayload(st, variant, view)` from Task 1.
- Produces:

```ts
presentation.registerOutput(w: BrowserWindow, variant: OutputVariant, view?: OutputViewMode): void;  // view defaults 'slides'
presentation.setOutputVariant(w: BrowserWindow, variant: OutputVariant): void;                       // unchanged behavior
presentation.setOutputView(w: BrowserWindow, view: OutputViewMode): void;                            // NEW — live re-tag
```

- [ ] **Step 1: Implement** (no unit test — this module is BrowserWindow-bound; its logic lives in the pure `outputPayload` already tested. The IPC-level behavior is covered by the driver script in Task 9.)

Rework `stateStore.ts`:

```ts
const outputWindows = new Map<BrowserWindow, { variant: OutputVariant; view: OutputViewMode }>();

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.presState, state);
  for (const [w, t] of outputWindows) if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, outputPayload(state, t.variant, t.view));
}
```

- `registerOutput(w, variant, view = 'slides')`: store `{ variant, view }`; the `did-finish-load` replay reads the map entry (`const t = outputWindows.get(w) ?? { variant: 'audience', view: 'slides' }`) and sends `outputPayload(state, t.variant, t.view)`.
- `setOutputVariant(w, variant)`: patch `variant` in the entry, keep `view`, resend that window's payload.
- `setOutputView(w, view)`: symmetric — patch `view`, keep `variant`, resend. No-op if the window isn't registered.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:node`
Expected: `stateStore.ts` clean (renderer-side `OutputApp` may still fail `typecheck:web` until Task 4).

- [ ] **Step 3: Commit**

```bash
git add src/main/stateStore.ts
git commit -m "feat(displays): stateStore carries a per-output view mode"
```

---

### Task 3: displays engine + IPC + preload

**Files:**
- Modify: `src/main/displays.ts` (Tracked `:17`, `createOutputWindow` `:30`, `savedRoles` area `:62-64`, `sync` `:71-118`, `setDisplayRole` area `:126-141`, `openTestOutput` `:159-163`)
- Modify: `src/main/ipc.ts` (`:53-55` area; imports)
- Modify: `src/preload/index.ts` (`displays` block `:25-30`)
- Test: covered by the pure `resolveView` tests (Task 1) + driver script (Task 9); `displays.ts` is Electron-bound and has no existing unit tests to extend.

**Interfaces:**
- Consumes: `resolveView`, `DEFAULT_VIEW`, `OutputViewMode` (Task 1); `presentation.registerOutput/setOutputView` (Task 2).
- Produces:

```ts
// displays.ts
export function setDisplayView(fingerprint: string, view: OutputViewMode): void;
export function operatorDisplayId(): number;    // was module-private; Task 6's capture handler needs it
export function createOutputWindow(bounds: Electron.Rectangle, frameless?: boolean, variant?: OutputVariant, view?: OutputViewMode): BrowserWindow;
// helm API
window.helm.displays.setView(fingerprint, view);
// Test-output seam: setDisplayView('test', view) re-tags every open test output window.
```

- [ ] **Step 1: Implement `displays.ts`**

```ts
const VIEWS_KEY = 'displays:views';
interface Tracked { win: BrowserWindow; fingerprint: string; role: OutputRole; view: OutputViewMode }

function savedViews(): Record<string, OutputViewMode> {
  return settings?.get<Record<string, OutputViewMode>>(VIEWS_KEY, {}) ?? {};
}
```

- `createOutputWindow(bounds, frameless = true, variant = 'audience', view = 'slides')`: pass `view` through to `presentation.registerOutput(win, variant, view)`.
- Export `operatorDisplayId` (add `export` to `:56`).
- `sync()`: compute `const views = savedViews();` once; per attachment `const view = resolveView(views, a.fingerprint);`. Existing window: alongside the role re-tag, `if (existing.view !== view) { existing.view = view; presentation.setOutputView(existing.win, view); }`. New window: `createOutputWindow(a.bounds, true, ROLE_VARIANT[a.role], view)` and store `view` in the Tracked entry. In the `lastDisplays` build, add `view: isOperator ? null : (tracked?.view ?? DEFAULT_VIEW),`.
- New export, mirroring `setDisplayRole`:

```ts
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
```

- [ ] **Step 2: Wire IPC + preload**

`ipc.ts` (import `setDisplayView` next to `setDisplayRole`):

```ts
ipcMain.on(CH.displaysSetView, (_e, fp: string, view: OutputViewMode) => setDisplayView(fp, view));
```

`preload/index.ts`, in `displays`:

```ts
setView: (fp, view) => ipcRenderer.send(CH.displaysSetView, fp, view),
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck:node && npx vitest run src/main src/shared`
Expected: clean / PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/displays.ts src/main/ipc.ts src/preload/index.ts
git commit -m "feat(displays): per-display view mode — persistence, live re-tag, IPC"
```

---

### Task 4: OutputApp branches on view behind an error boundary

**Files:**
- Create: `src/renderer/output/SlidesView.tsx`, `src/renderer/output/OutputErrorBoundary.tsx`
- Create (stubs, replaced in Tasks 5–6): `src/renderer/output/LeaderView.tsx`, `src/renderer/output/MirrorView.tsx`
- Modify: `src/renderer/output/OutputApp.tsx` (25 lines — rework)
- Test: `src/renderer/output/OutputApp.test.tsx` (new)

**Interfaces:**
- Consumes: `OutputPayload.view` (Task 1).
- Produces:

```tsx
export function SlidesView({ payload }: { payload: OutputPayload }): JSX.Element;   // today's ternary, extracted
export class OutputErrorBoundary extends React.Component<{ fallback: React.ReactNode; resetKey: string; children: React.ReactNode }>;
// LeaderView/MirrorView are stubbed here and implemented in Tasks 5/6:
export function LeaderView({ payload }: { payload: OutputPayload }): JSX.Element;   // Task 5 (stub: returns <SlidesView/>)
export function MirrorView(): JSX.Element;                                          // Task 6 (stub: black div)
```

- [ ] **Step 1: Write the failing test**

`src/renderer/output/OutputApp.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, cleanup, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutputApp } from './OutputApp';
import type { OutputPayload } from '../../shared/types';

afterEach(cleanup);

function installHelmStub(): (p: OutputPayload) => void {
  let push: (p: OutputPayload) => void = () => {};
  (window as unknown as { helm: unknown }).helm = {
    output: { onSlide: (cb: (p: OutputPayload) => void) => { push = cb; return () => {}; } },
    presentation: { get: () => Promise.resolve({ output: 'black', liveKey: null, liveSnap: null }), onState: () => () => {} },
    songs: { get: () => Promise.resolve(null) },
  };
  return (p) => act(() => push(p));
}

const LYRICS: OutputPayload['slide'] = { kind: 'lyrics', accent: '#e0a341', label: 'Test · Verse 1', lines: ['Amazing grace'] };

describe('OutputApp view branching', () => {
  it('renders the slides view by default', () => {
    const push = installHelmStub();
    const r = render(<OutputApp />);
    push({ slide: LYRICS, variant: 'audience', view: 'slides' });
    expect(r.getByText('Amazing grace')).toBeTruthy();
  });

  it('renders MirrorView for view=mirror', () => {
    const push = installHelmStub();
    const r = render(<OutputApp />);
    push({ slide: LYRICS, variant: 'stage', view: 'mirror' });
    expect(r.getByTestId('mirror-view')).toBeTruthy();
    expect(r.queryByText('Amazing grace')).toBeNull();
  });

  it('renders LeaderView for view=leader', () => {
    const push = installHelmStub();
    const r = render(<OutputApp />);
    push({ slide: LYRICS, variant: 'stage', view: 'leader' });
    expect(r.getByTestId('leader-view')).toBeTruthy();
  });

  it('falls back to the slides render when a view crashes', () => {
    const push = installHelmStub();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});   // React logs boundary catches
    const r = render(<OutputApp _forceCrashViewForTest />);
    push({ slide: LYRICS, variant: 'stage', view: 'leader' });
    expect(r.getByText('Amazing grace')).toBeTruthy();                     // fallback = slides
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/output/OutputApp.test.tsx`
Expected: FAIL (no view branching, no testids).

- [ ] **Step 3: Implement**

`SlidesView.tsx` — move the existing ternary out of `OutputApp.tsx` verbatim:

```tsx
import type { JSX } from 'react';
import type { OutputPayload } from '../../shared/types';
import { SlideCanvas } from '../shared/SlideCanvas';
import { ReadingCanvas } from '../shared/ReadingCanvas';
import { VideoCanvas } from '../shared/VideoCanvas';

export function SlidesView({ payload }: { payload: OutputPayload }): JSX.Element {
  return payload.slide.kind === 'reading' ? (
    <ReadingCanvas slide={payload.slide} fill />
  ) : payload.slide.kind === 'video' ? (
    <VideoCanvas slide={payload.slide} fill />
  ) : (
    <SlideCanvas slide={payload.slide} variant={payload.variant} fill />
  );
}
```

`OutputErrorBoundary.tsx`:

```tsx
import React from 'react';

interface Props { fallback: React.ReactNode; resetKey: string; children: React.ReactNode }
interface State { failed: boolean }

/** The only error boundary in the app (BUG-009): a crash in a view must degrade the
 *  output to the plain slides render, never blank a screen the congregation is watching.
 *  Re-arms when resetKey (the payload's view) changes, so switching away and back retries. */
export class OutputErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  componentDidCatch(error: unknown): void { console.error('[helm] output view crashed, falling back to slides:', error); }
  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render(): React.ReactNode { return this.state.failed ? this.props.fallback : this.props.children; }
}
```

`OutputApp.tsx`:

```tsx
import { useEffect, useState, type JSX } from 'react';
import type { OutputPayload } from '../../shared/types';
import { SlidesView } from './SlidesView';
import { LeaderView } from './LeaderView';
import { MirrorView } from './MirrorView';
import { OutputErrorBoundary } from './OutputErrorBoundary';

export function OutputApp({ _forceCrashViewForTest = false }: { _forceCrashViewForTest?: boolean }): JSX.Element {
  const [payload, setPayload] = useState<OutputPayload>({ slide: { kind: 'black' }, variant: 'audience', view: 'slides' });
  useEffect(() => window.helm.output.onSlide(setPayload), []);
  useEffect(() => {
    document.body.style.cursor = 'none';
    document.body.style.background = '#000';
  }, []);
  const view =
    payload.view === 'mirror' ? <MirrorView />
    : payload.view === 'leader' ? (_forceCrashViewForTest ? <CrashForTest /> : <LeaderView payload={payload} />)
    : <SlidesView payload={payload} />;
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <OutputErrorBoundary resetKey={payload.view} fallback={<SlidesView payload={payload} />}>
        {view}
      </OutputErrorBoundary>
    </div>
  );
}

function CrashForTest(): JSX.Element { throw new Error('forced crash for boundary test'); }
```

Stub the two views so this task stands alone (real implementations replace them in Tasks 5–6):

`LeaderView.tsx` (stub): `export function LeaderView({ payload }: { payload: OutputPayload }): JSX.Element { return <div data-testid="leader-view" style={{ position: 'fixed', inset: 0 }}><SlidesView payload={payload} /></div>; }`

`MirrorView.tsx` (stub): `export function MirrorView(): JSX.Element { return <div data-testid="mirror-view" style={{ position: 'fixed', inset: 0, background: '#000' }} />; }`

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/output/OutputApp.test.tsx && npm run typecheck:web`
Expected: PASS / clean (this closes the `OutputPayload.view` typecheck debt from Task 1).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/output
git commit -m "feat(output): view-mode branching behind a slides-fallback error boundary"
```

---

### Task 5: LeaderView

**Files:**
- Modify: `src/shared/presentation/core.ts` (add `parseSongKey` beside `keyForSong` `:6`)
- Modify: `src/renderer/output/LeaderView.tsx` (replace stub)
- Test: `src/shared/presentation/core.test.ts` (parse cases), `src/renderer/output/LeaderView.test.tsx` (new)

**Interfaces:**
- Consumes: `SlidesView` (Task 4), `usePresentationState` (`src/renderer/operator/useHelm.ts:4` — generic despite the directory), `useFitText`/`fitSizeValue` (`src/renderer/shared/useFitText.ts`), `bandCandidates` (`src/shared/slides/fitText.ts`), `window.helm.songs.get`.
- Produces:

```ts
// core.ts — inverse of keyForSong. Splits on the LAST colon so a song id containing ':' can't break it.
export function parseSongKey(key: string | null): { songId: string; section: number } | null;
```

- [ ] **Step 1: Write the failing tests**

`core.test.ts` additions:

```ts
describe('parseSongKey', () => {
  it('round-trips keyForSong', () => {
    expect(parseSongKey(keyForSong('abc', 3))).toEqual({ songId: 'abc', section: 3 });
  });
  it('rejects null, non-song keys, and malformed sections', () => {
    expect(parseSongKey(null)).toBeNull();
    expect(parseSongKey('scr:kjv:John:3:16')).toBeNull();
    expect(parseSongKey('song:abc:notanumber')).toBeNull();
  });
});
```

`LeaderView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LeaderView } from './LeaderView';
import type { OutputPayload, PresentationState, Song } from '../../shared/types';

afterEach(cleanup);

const SONG: Song = {
  id: 's1', title: 'Amazing Grace', author: 'John Newton', source: 'manual', createdAt: 0,
  sections: [
    { label: 'Verse 1', lines: ['Amazing grace how sweet the sound'] },
    { label: 'Verse 2', lines: ['Twas grace that taught my heart to fear'] },
  ],
};

function installHelmStub(state: PresentationState): void {
  (window as unknown as { helm: unknown }).helm = {
    presentation: { get: () => Promise.resolve(state), onState: () => () => {} },
    songs: { get: (id: string) => Promise.resolve(id === 's1' ? SONG : null) },
  };
}
const payload = (state: PresentationState): OutputPayload =>
  ({ slide: state.liveSnap ?? { kind: 'black' }, variant: 'stage', view: 'leader' });

describe('LeaderView', () => {
  it('renders hero lines, title, and the section rail with the live section highlighted', async () => {
    const st: PresentationState = { output: 'live', liveKey: 'song:s1:1', liveSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Verse 2', lines: SONG.sections[1].lines } };
    installHelmStub(st);
    const r = render(<LeaderView payload={payload(st)} />);
    await waitFor(() => expect(r.getByText('Twas grace that taught my heart to fear')).toBeTruthy());
    expect(r.getByText('Amazing Grace')).toBeTruthy();
    expect(r.getByTestId('leader-section-1').dataset.live).toBe('true');
    expect(r.getByTestId('leader-section-0').dataset.live).toBe('false');
  });

  it('keeps the song up and shows a status chip while the projector is on logo', async () => {
    const st: PresentationState = { output: 'logo', liveKey: 'song:s1:0', liveSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines } };
    installHelmStub(st);
    const r = render(<LeaderView payload={payload(st)} />);
    await waitFor(() => expect(r.getByText('Amazing grace how sweet the sound')).toBeTruthy());
    expect(r.getByText('LOGO')).toBeTruthy();
  });

  it('falls back to the slides render for non-song content', async () => {
    const st: PresentationState = { output: 'live', liveKey: 'scr:kjv:John:3', liveSnap: { kind: 'scripture', accent: '#7fb069', ref: 'John 3:16', version: 'KJV', text: 'For God so loved the world' } };
    installHelmStub(st);
    const r = render(<LeaderView payload={payload(st)} />);
    await waitFor(() => expect(r.getByText('For God so loved the world')).toBeTruthy());
    expect(r.queryByTestId('leader-rail')).toBeNull();
  });

  it('falls back to the slides render when the song has been deleted', async () => {
    const st: PresentationState = { output: 'live', liveKey: 'song:GONE:0', liveSnap: { kind: 'lyrics', accent: '#e0a341', label: 'x', lines: ['orphan line'] } };
    installHelmStub(st);
    const r = render(<LeaderView payload={payload(st)} />);
    await waitFor(() => expect(r.getByText('orphan line')).toBeTruthy());
    expect(r.queryByTestId('leader-rail')).toBeNull();
  });
});
```

(Adjust slide-literal fields to the real `Slide` type — check `types.ts` — the shapes above follow SongsMode/SermonMode cue builders.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/shared/presentation/core.test.ts src/renderer/output/LeaderView.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`core.ts`:

```ts
/** Inverse of keyForSong. Splits on the LAST colon so a song id containing ':' can't break it. */
export function parseSongKey(key: string | null): { songId: string; section: number } | null {
  if (!key || !key.startsWith('song:')) return null;
  const i = key.lastIndexOf(':');
  if (i <= 'song:'.length - 1) return null;
  const songId = key.slice('song:'.length, i);
  const section = Number(key.slice(i + 1));
  if (songId === '' || !Number.isInteger(section) || section < 0) return null;
  return { songId, section };
}
```

`LeaderView.tsx` — full replacement of the stub:

```tsx
import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import type { OutputPayload, Song } from '../../shared/types';
import { parseSongKey } from '../../shared/presentation/core';
import { bandCandidates } from '../../shared/slides/fitText';
import { useFitText, fitSizeValue } from '../shared/useFitText';
import { usePresentationState } from '../operator/useHelm';
import { SlidesView } from './SlidesView';

// Hoisted for stable identity in useFitText's deps (same reasoning as SlideCanvas's bands).
const LEADER_BAND = bandCandidates(10.5, 3.5);

export function LeaderView({ payload }: { payload: OutputPayload }): JSX.Element {
  const st = usePresentationState();
  const parsed = parseSongKey(st.liveKey);
  const [song, setSong] = useState<Song | null>(null);
  useEffect(() => {
    let live = true;
    if (!parsed) { setSong(null); return; }
    void window.helm.songs.get(parsed.songId).then((s) => { if (live) setSong(s); });
    return () => { live = false; };
  }, [parsed?.songId]);

  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const section = parsed && song ? song.sections[parsed.section] : undefined;
  useFitText(rootRef, heroRef, section ? LEADER_BAND : null, [st.liveKey, song?.id]);

  // Not a song (or the song was deleted): show exactly what the slides view would.
  if (!parsed || !song || !section) return <SlidesView payload={payload} />;

  const dim = 'rgba(255,255,255,0.55)';
  const chip = st.output === 'logo' ? 'LOGO' : st.output === 'black' ? 'BLACK' : null;
  const rootStyle: CSSProperties = {
    position: 'fixed', inset: 0, background: '#000', color: '#fff', display: 'flex',
    fontFamily: "'Hanken Grotesk',sans-serif",
  };
  const heroWrapStyle: CSSProperties = {
    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '3cqmin 4cqmin',
    containerType: 'size',
  };
  const titleRowStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0,
    fontFamily: "'JetBrains Mono',monospace", letterSpacing: '0.12em', textTransform: 'uppercase',
    fontSize: 'max(12px, 2.2cqmin)', color: dim,
  };
  const chipStyle: CSSProperties = {
    padding: '2px 10px', borderRadius: '6px', background: 'rgba(224,163,65,0.2)',
    color: '#e0a341', fontWeight: 700,
  };
  const lineStyle: CSSProperties = {
    fontWeight: 700, lineHeight: 1.22, letterSpacing: '-0.012em',
    fontSize: `max(14px, ${fitSizeValue('7.4cqmin')})`,
  };
  const railStyle: CSSProperties = {
    width: '30%', maxWidth: '420px', minWidth: '260px', flexShrink: 0, overflowY: 'auto',
    borderLeft: '1px solid rgba(255,255,255,0.14)', padding: '2.5cqmin 2cqmin',
    display: 'flex', flexDirection: 'column', gap: '1.2cqmin', containerType: 'size',
  };
  const sectionCardStyle = (live: boolean): CSSProperties => ({
    padding: '1.6cqmin 1.8cqmin', borderRadius: '10px',
    background: live ? 'rgba(224,163,65,0.16)' : 'rgba(255,255,255,0.05)',
    boxShadow: live ? 'inset 0 0 0 2px #e0a341' : 'inset 0 0 0 1px rgba(255,255,255,0.10)',
  });
  const sectionLabelStyle = (live: boolean): CSSProperties => ({
    fontFamily: "'JetBrains Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.1em',
    fontSize: 'max(11px, 2.4cqmin)', fontWeight: 700, color: live ? '#e0a341' : dim,
  });
  const sectionSnippetStyle: CSSProperties = {
    fontSize: 'max(12px, 2.6cqmin)', color: 'rgba(255,255,255,0.8)', marginTop: '0.6cqmin',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  };

  return (
    <div style={rootStyle} data-testid="leader-view">
      <div ref={rootRef} style={heroWrapStyle}>
        <div style={titleRowStyle}>
          <span>{song.title}</span>
          <span>· {section.label}</span>
          {chip && <span style={chipStyle}>{chip}</span>}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
          <div ref={heroRef} style={{ display: 'flex', flexDirection: 'column', gap: '0.8em', width: '100%' }}>
            {section.lines.map((ln, i) => (
              <div key={i} style={lineStyle}>{ln}</div>
            ))}
          </div>
        </div>
      </div>
      <div style={railStyle} data-testid="leader-rail">
        {song.sections.map((s, i) => {
          const live = parsed.section === i;
          return (
            <div key={i} style={sectionCardStyle(live)} data-testid={`leader-section-${i}`} data-live={String(live)}>
              <div style={sectionLabelStyle(live)}>{s.label}</div>
              <div style={sectionSnippetStyle}>{s.lines[0] ?? ''}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Implementation notes:
- `usePresentationState` comes from `../operator/useHelm` — the file is generic (only touches `window.helm`); importing across the operator/output directories is already the pattern for `renderer/shared`. If the import feels wrong at implementation time, move `usePresentationState` to `src/renderer/shared/useHelm.ts` and re-export from the old path — do NOT duplicate it.
- The hero fit measures `heroRef` inside `rootRef` (the hero column, `containerType: 'size'`), so `cqmin` in the fitted value resolves against the hero column — the same mechanism as `SlideCanvas.tsx:359-366`.
- Colors are hardcoded dark (`#000` bg) — output windows have no ThemeCtx, matching `SlideCanvas`'s approach.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/shared/presentation/core.test.ts src/renderer/output/LeaderView.test.tsx src/renderer/output/OutputApp.test.tsx && npm run typecheck:web`
Expected: PASS (OutputApp's leader-view test now exercises the real component) / clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/presentation/core.ts src/shared/presentation/core.test.ts src/renderer/output/LeaderView.tsx src/renderer/output/LeaderView.test.tsx
git commit -m "feat(output): LeaderView — distraction-free song view for the pulpit"
```

---

### Task 6: MirrorView + main-process capture handler

**Files:**
- Modify: `src/renderer/output/MirrorView.tsx` (replace stub)
- Modify: `src/main/index.ts` (in `app.whenReady`, after `initDisplays` `:203`)
- Test: `src/renderer/output/MirrorView.test.tsx` (new)

**Interfaces:**
- Consumes: `operatorDisplayId()` (exported in Task 3).
- Produces: `MirrorView(): JSX.Element` (already imported by OutputApp in Task 4).

- [ ] **Step 1: Write the failing test**

`MirrorView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MirrorView } from './MirrorView';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubGetDisplayMedia(impl: () => Promise<MediaStream>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getDisplayMedia: fn } as unknown as MediaDevices, userAgent: navigator.userAgent });
  return fn;
}

describe('MirrorView', () => {
  it('shows an in-place failure message when capture is refused, never a silent black screen', async () => {
    stubGetDisplayMedia(() => Promise.reject(new Error('Permission denied')));
    const r = render(<MirrorView />);
    await waitFor(() => expect(r.getByTestId('mirror-error').textContent).toMatch(/screen capture/i));
  });

  it('names the macOS Screen Recording permission on mac user agents', async () => {
    stubGetDisplayMedia(() => Promise.reject(new Error('Permission denied')));
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getDisplayMedia: () => Promise.reject(new Error('denied')) } as unknown as MediaDevices, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
    const r = render(<MirrorView />);
    await waitFor(() => expect(r.getByTestId('mirror-error').textContent).toMatch(/Screen Recording/));
  });

  it('attaches the stream to the video element on success', async () => {
    const stop = vi.fn();
    const fakeStream = { getTracks: () => [{ stop, addEventListener: vi.fn(), removeEventListener: vi.fn() }] } as unknown as MediaStream;
    stubGetDisplayMedia(() => Promise.resolve(fakeStream));
    const r = render(<MirrorView />);
    const video = (await waitFor(() => r.getByTestId('mirror-video'))) as HTMLVideoElement;
    await waitFor(() => expect(video.srcObject).toBe(fakeStream));
    r.unmount();
    expect(stop).toHaveBeenCalled();   // tracks stopped on unmount
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/output/MirrorView.test.tsx`
Expected: FAIL (stub has no capture logic).

- [ ] **Step 3: Implement `MirrorView.tsx`**

```tsx
import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';

const RETRY_MS = 3000;

/** Live video mirror of the operator's screen. The main process's
 *  setDisplayMediaRequestHandler picks the operator display as the source, so this
 *  getDisplayMedia call shows no picker and needs no user gesture. */
export function MirrorView(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let stream: MediaStream | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const stop = (): void => {
      if (stream) for (const t of stream.getTracks()) t.stop();
      stream = null;
    };
    const start = (): void => {
      navigator.mediaDevices
        .getDisplayMedia({ video: { frameRate: 30 }, audio: false })
        .then((s) => {
          if (!live) { for (const t of s.getTracks()) t.stop(); return; }
          stream = s;
          setError(null);
          const video = videoRef.current;
          if (video) { video.srcObject = s; void video.play?.(); }
          // If the capture dies (display topology change, permission revoked), retry.
          for (const t of s.getTracks()) t.addEventListener('ended', () => { if (live) { stop(); retryTimer = setTimeout(start, RETRY_MS); } });
        })
        .catch(() => {
          if (!live) return;
          const isMac = navigator.userAgent.includes('Macintosh');
          setError(
            isMac
              ? 'Screen capture unavailable. Helm needs the Screen Recording permission: System Settings → Privacy & Security → Screen Recording, then relaunch Helm.'
              : 'Screen capture unavailable. Check that no other app is blocking screen capture, or switch this display back to Slides view.',
          );
          retryTimer = setTimeout(start, RETRY_MS);
        });
    };
    start();
    return () => { live = false; if (retryTimer) clearTimeout(retryTimer); stop(); };
  }, []);

  const rootStyle: CSSProperties = { position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const videoStyle: CSSProperties = { width: '100%', height: '100%', objectFit: 'contain' };
  const errorStyle: CSSProperties = {
    maxWidth: '70%', textAlign: 'center', color: 'rgba(255,255,255,0.85)',
    fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 'max(16px, 2.5vmin)', lineHeight: 1.5,
  };

  return (
    <div style={rootStyle} data-testid="mirror-view">
      {error ? (
        <div style={errorStyle} data-testid="mirror-error">{error}</div>
      ) : (
        <video ref={videoRef} style={videoStyle} autoPlay muted playsInline data-testid="mirror-video" />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Main-process capture handler**

In `src/main/index.ts`: add `session` and `desktopCapturer` to the electron import (`:1`), add `operatorDisplayId` to the `./displays` import (`:31`), and after `initDisplays(...)` (`:203`):

```ts
// Mirror view: answer any renderer getDisplayMedia call with the operator's screen —
// no picker, no user gesture. Screen (not window) capture so the mirror includes the
// cursor and any modals, matching what OS-level mirroring showed. macOS: fails until
// the user grants Screen Recording permission; MirrorView renders the instruction.
session.defaultSession.setDisplayMediaRequestHandler(
  (_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        const opId = String(operatorDisplayId())
        const match = sources.find((s) => s.display_id === opId) ?? sources[0]
        callback(match ? { video: match } : {})
      })
      .catch(() => callback({}))
  },
  { useSystemPicker: false }
)
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/renderer/output && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/output/MirrorView.tsx src/renderer/output/MirrorView.test.tsx src/main/index.ts
git commit -m "feat(output): MirrorView streams the operator screen into an output window"
```

---

### Task 7: Header popover — mid-service view switching

**Files:**
- Create: `src/renderer/operator/OutputViewPopover.tsx`
- Modify: `src/renderer/operator/Header.tsx` (outputs chip `:136-138`)
- Test: `src/renderer/operator/OutputViewPopover.test.tsx` (new)

**Interfaces:**
- Consumes: `useDisplayStatus` (`useHelm.ts:24`), `DisplayInfo.view` (Task 1), `window.helm.displays.setView` (Task 3), `OUTPUT_VIEWS` (Task 1).
- Produces:

```tsx
export function OutputViewPopover({ onClose }: { onClose: () => void }): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

`OutputViewPopover.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutputViewPopover } from './OutputViewPopover';
import { ThemeCtx } from './ThemeCtx';
import { themeFor } from '../../shared/theme';
import type { DisplayStatus } from '../../shared/types';

afterEach(cleanup);

const STATUS: DisplayStatus = {
  outputs: 2,
  displays: [
    { id: 1, fingerprint: 'label:Built-in', label: 'Built-in Display', width: 1512, height: 982, scaleFactor: 2, role: null, view: null, isOperator: true },
    { id: 2, fingerprint: 'label:Projector', label: 'Projector', width: 1920, height: 1080, scaleFactor: 1, role: 'audience', view: 'slides', isOperator: false },
    { id: 3, fingerprint: 'geo:1024x600@1r0', label: '', width: 1024, height: 600, scaleFactor: 1, role: 'stage', view: 'mirror', isOperator: false },
  ],
};

function installHelmStub(): ReturnType<typeof vi.fn> {
  const setView = vi.fn();
  (window as unknown as { helm: unknown }).helm = {
    displays: { get: () => Promise.resolve(STATUS), onStatus: () => () => {}, setView, setRole: vi.fn(), openTest: vi.fn() },
  };
  return setView;
}
const renderPopover = (onClose = vi.fn()) =>
  render(
    <ThemeCtx.Provider value={themeFor('dark', 'Warm')}>
      <OutputViewPopover onClose={onClose} />
    </ThemeCtx.Provider>,
  );

describe('OutputViewPopover', () => {
  it('lists output displays only, with resolution fallback for unlabeled ones', async () => {
    installHelmStub();
    const r = renderPopover();
    await waitFor(() => expect(r.getByText('Projector')).toBeTruthy());
    expect(r.getByText('1024×600')).toBeTruthy();
    expect(r.queryByText('Built-in Display')).toBeNull();   // operator screen not listed
  });

  it('switches a view and closes', async () => {
    const setView = installHelmStub();
    const onClose = vi.fn();
    const r = renderPopover(onClose);
    await waitFor(() => expect(r.getByText('Projector')).toBeTruthy());
    fireEvent.click(r.getByTestId('view-label:Projector-leader'));
    expect(setView).toHaveBeenCalledWith('label:Projector', 'leader');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    installHelmStub();
    const onClose = vi.fn();
    renderPopover(onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

(Adapt `themeFor` arguments to its real signature — `src/shared/theme.ts:17`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/operator/OutputViewPopover.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`OutputViewPopover.tsx`:

```tsx
import { useContext, useEffect, type CSSProperties, type JSX } from 'react';
import { ThemeCtx } from './ThemeCtx';
import { useDisplayStatus } from './useHelm';
import { OUTPUT_VIEWS } from '../../shared/displays/roles';
import type { OutputViewMode } from '../../shared/types';

const VIEW_LABEL: Record<OutputViewMode, string> = { slides: 'Slides', leader: 'Leader', mirror: 'Mirror' };

/** Quick per-screen view switcher, anchored under the header's outputs chip. */
export function OutputViewPopover({ onClose }: { onClose: () => void }): JSX.Element {
  const T = useContext(ThemeCtx);
  const { displays } = useDisplayStatus();
  const outputs = displays.filter((d) => !d.isOperator);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const popStyle: CSSProperties = {
    position: 'absolute', top: '46px', right: 0, zIndex: 60, minWidth: '300px',
    background: T.panel, borderRadius: '12px', boxShadow: `0 12px 40px rgba(0,0,0,0.45), inset 0 0 0 1px ${T.hairline}`,
    padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px',
  };
  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 8px' };
  const nameStyle: CSSProperties = { flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const roleStyle: CSSProperties = { fontFamily: "'JetBrains Mono',monospace", fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: T.faint };
  const segWrapStyle: CSSProperties = { display: 'flex', gap: '3px', background: T.panel2, padding: '3px', borderRadius: '8px' };
  const segStyle = (active: boolean): CSSProperties => ({
    padding: '4px 9px', borderRadius: '6px', fontSize: '11.5px', fontWeight: active ? 700 : 600,
    color: active ? T.accentInk : T.dim, background: active ? T.accent : 'transparent',
  });

  return (
    <div style={popStyle} data-testid="output-view-popover">
      {outputs.length === 0 && <div style={{ ...nameStyle, color: T.dim, padding: '6px 8px' }}>No output displays connected</div>}
      {outputs.map((d) => {
        const name = d.label || `${d.width}×${d.height}`;
        return (
          <div key={d.fingerprint} style={rowStyle}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={nameStyle}>{name}</div>
              <div style={roleStyle}>{d.role ?? ''}</div>
            </div>
            <div style={segWrapStyle}>
              {OUTPUT_VIEWS.map((v) => (
                <button
                  key={v}
                  style={segStyle(d.view === v)}
                  data-testid={`view-${d.fingerprint}-${v}`}
                  onClick={() => { window.helm.displays.setView(d.fingerprint, v); onClose(); }}
                >
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

`Header.tsx`: add `const [viewsOpen, setViewsOpen] = useState(false);` (import `useState`), wrap the chip in a relatively-positioned container, and make the chip a button:

```tsx
<div style={{ position: 'relative' }}>
  <button style={{ ...outputsChipStyle, cursor: 'pointer', background: 'transparent' }} onClick={() => setViewsOpen((o) => !o)} title="Output views">
    {outputs} OUTPUT{outputs === 1 ? '' : 'S'}{isLive ? ' · LIVE' : ''}
  </button>
  {viewsOpen && <OutputViewPopover onClose={() => setViewsOpen(false)} />}
</div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/operator/OutputViewPopover.test.tsx && npm run typecheck:web`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/OutputViewPopover.tsx src/renderer/operator/OutputViewPopover.test.tsx src/renderer/operator/Header.tsx
git commit -m "feat(operator): header popover for per-screen output views"
```

---

### Task 8: Settings → Displays pane

**Files:**
- Create: `src/renderer/operator/DisplaysSettings.tsx`
- Modify: `src/renderer/operator/SettingsModal.tsx` (`SECTIONS` `:18` → `enabled: true`; render the section in the content switch alongside `bibles`/`message`)
- Test: `src/renderer/operator/DisplaysSettings.test.tsx` (new)

**Interfaces:**
- Consumes: `useDisplayStatus`, `OUTPUT_ROLES`/`OUTPUT_VIEWS` (roles.ts), `window.helm.displays.setRole` (existing, unused by any UI until now) and `.setView` (Task 3).
- Produces: `export function DisplaysSettings(): JSX.Element` — rendered by SettingsModal when `section === 'displays'`.

- [ ] **Step 1: Write the failing test**

`DisplaysSettings.test.tsx` (reuse the `STATUS` fixture and helm stub shape from Task 7's test, importing `DisplaysSettings` instead):

```tsx
it('lists every display, marking the operator screen and offering no pickers for it', async () => {
  installHelmStub();
  const r = renderPane();
  await waitFor(() => expect(r.getByText('Built-in Display')).toBeTruthy());
  expect(r.getByText('Operator screen')).toBeTruthy();
  expect(r.queryByTestId('role-label:Built-in')).toBeNull();
});

it('changes a role and a view over IPC', async () => {
  const { setRole, setView } = installHelmStub();
  const r = renderPane();
  await waitFor(() => expect(r.getByText('Projector')).toBeTruthy());
  fireEvent.change(r.getByTestId('role-label:Projector'), { target: { value: 'stage' } });
  expect(setRole).toHaveBeenCalledWith('label:Projector', 'stage');
  fireEvent.click(r.getByTestId('view-label:Projector-leader'));
  expect(setView).toHaveBeenCalledWith('label:Projector', 'leader');
});

it('shows resolution and scale for each display', async () => {
  installHelmStub();
  const r = renderPane();
  await waitFor(() => expect(r.getByText('1920×1080 @1x')).toBeTruthy());
  expect(r.getByText('1512×982 @2x')).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/operator/DisplaysSettings.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`DisplaysSettings.tsx` — structure mirrors the popover's rows, plus a role `<select>`; reuse SettingsModal's visual vocabulary (`rowStyle`-like rows, mono chips):

```tsx
import { useContext, type CSSProperties, type JSX } from 'react';
import { ThemeCtx } from './ThemeCtx';
import { useDisplayStatus } from './useHelm';
import { OUTPUT_ROLES, OUTPUT_VIEWS } from '../../shared/displays/roles';
import type { OutputRole, OutputViewMode } from '../../shared/types';

const VIEW_LABEL: Record<OutputViewMode, string> = { slides: 'Slides', leader: 'Leader', mirror: 'Mirror' };

export function DisplaysSettings(): JSX.Element {
  const T = useContext(ThemeCtx);
  const { displays } = useDisplayStatus();
  // styles: row (flex, 10px gap, bottom hairline), name (600 weight), spec chip
  // (JetBrains Mono 11px, T.faint), operator tag (accent chip), segmented view control
  // identical to OutputViewPopover's segStyle, role <select> styled like the modal's buttons.
  return (
    <>
      <div /* sectionTitleStyle-alike */>Displays</div>
      <div /* sectionHintStyle-alike */>
        Each screen Helm drives has a role (what feed it gets) and a view (how it shows it).
        Mirror shows this operator screen; Leader shows a clean song view for the pulpit.
      </div>
      {displays.map((d) => {
        const name = d.label || `${d.width}×${d.height}`;
        return (
          <div key={d.fingerprint} /* row */>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div>{name}</div>
              <div /* spec chip */>{`${d.width}×${d.height} @${d.scaleFactor}x`}</div>
            </div>
            {d.isOperator ? (
              <span /* accent chip */>Operator screen</span>
            ) : (
              <>
                <select
                  value={d.role ?? 'audience'}
                  data-testid={`role-${d.fingerprint}`}
                  onChange={(e) => window.helm.displays.setRole(d.fingerprint, e.target.value as OutputRole)}
                >
                  {OUTPUT_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <div /* segmented */>
                  {OUTPUT_VIEWS.map((v) => (
                    <button key={v} data-testid={`view-${d.fingerprint}-${v}`} /* segStyle(d.view === v) */
                      onClick={() => window.helm.displays.setView(d.fingerprint, v)}>
                      {VIEW_LABEL[v]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
```

(The style-comment placeholders above are visual only — fill them with concrete `CSSProperties` copied from SettingsModal's existing `rowStyle`/`sectionTitleStyle`/`sectionHintStyle` and the popover's `segStyle`; every behavioral element — testids, handlers, labels, fallbacks — is specified verbatim.)

`SettingsModal.tsx`: flip `{ id: 'displays', label: 'Displays', enabled: true },` and add to the content switch:

```tsx
{section === 'displays' && <DisplaysSettings />}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/operator/DisplaysSettings.test.tsx && npm run typecheck:web`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/DisplaysSettings.tsx src/renderer/operator/DisplaysSettings.test.tsx src/renderer/operator/SettingsModal.tsx
git commit -m "feat(settings): Displays pane — roles and views per screen"
```

---

### Task 9: Full-suite gate + real-app verification

**Files:**
- Create: `scratch/verify-views.mjs` (playwright `_electron` driver — boilerplate from `scratch/verify-autofit.mjs`: launch, find windows by `w.url().includes('operator')` / `includes('output')`)

**Interfaces:** none — verification only.

- [ ] **Step 1: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: everything PASSES. Fix regressions before proceeding (likely suspects: any test constructing `OutputPayload` without `view`).

- [ ] **Step 2: Write the driver script**

`scratch/verify-views.mjs`, using the Task 3 test-output seam (`setView('test', …)`):

1. Launch; in the operator window `page.evaluate(() => window.helm.displays.openTest())` to open a test output; find the output window.
2. Put a song live (drive the Songs tab UI like `verify-autofit.mjs` does).
3. Screenshot output → `scratch/views-shots/slides.png`.
4. `page.evaluate(() => window.helm.displays.setView('test', 'leader'))`; wait for `[data-testid="leader-view"]`; screenshot → `leader.png`. Assert the section rail lists the song's sections and one has `data-live="true"`.
5. `setView('test', 'mirror')`; wait for `[data-testid="mirror-view"]`; screenshot → `mirror.png`. Either a video element with a live stream OR the `mirror-error` message is a pass (unprivileged/headless machines can't capture); log which occurred.
6. `setView('test', 'slides')`; assert the lyrics are back (switching away and back works).
7. Also assert the operator window's header popover opens: click the outputs chip, wait for `[data-testid="output-view-popover"]`, screenshot → `popover.png`.

- [ ] **Step 3: Run it and eyeball the screenshots**

Run: `node scratch/verify-views.mjs`
Expected: leader view shows hero + highlighted rail; slides view identical before/after; popover lists the test/output screens. If `mirror-error` showed on macOS, grant Screen Recording to the dev build once and re-run to see a real frame.

- [ ] **Step 4: Manual platform checkpoints (record results in the PR/commit body)**

- macOS: first mirror activation triggers the Screen Recording prompt; after grant + relaunch, the mirror shows the operator screen with cursor.
- Windows (real hardware, per spec §6): mirror works with no permission prompt AND no yellow "screen is being shared" border. If a border appears, investigate Electron's WGC capture switches before shipping.

- [ ] **Step 5: Commit**

```bash
git add scratch/verify-views.mjs
git commit -m "test(output): driver script cycling slides/leader/mirror views"
```
