# Sermon Panel Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Songs pane's drag-divider machinery into a shared hook + component, then make the Sermon page's three tracks resizable with one persisted width pair.

**Architecture:** `SongsMode.tsx` owns the only drag-resize implementation today (`startColDrag`, `loadWidth`, localStorage keys `helmSongListW`/`helmSectionPanelW`). We extract a `usePanelWidth` hook (state + drag + persistence) and a `PanelDivider` component (the visual divider), refactor SongsMode onto them unchanged, then wire the Sermon page: width state lives in `SermonMode` under keys `helmSermonLeftW`/`helmSermonRightW` and flows into all three tracks (Scripture renders its rails directly; Message and Slides receive the controls as props).

**Tech Stack:** React 19 + TypeScript, inline `CSSProperties` styles, ThemeCtx theming, vitest + @testing-library/react (jsdom), localStorage persistence.

**Spec:** `docs/superpowers/specs/2026-08-05-sermon-resize-and-pulpit-views-design.md` §1

## Global Constraints

- Persistence keys, verbatim: songs keep `helmSongListW` / `helmSectionPanelW`; sermon page uses `helmSermonLeftW` / `helmSermonRightW` — one pair shared by all three tracks.
- Sermon bounds: left 200–420 default 270; right 240–520 default 330.
- Songs bounds unchanged: list 200–360 default 250; sections 260–620 default 380.
- SongsMode refactor is behavior-preserving — its existing tests must pass unmodified.
- Test env note (from `SongsMode.test.tsx`): vitest has no `globals: true`, so every component test file needs `afterEach(cleanup)` and the `// @vitest-environment jsdom` pragma.
- Runs on macOS and Windows; nothing here is platform-specific.
- Commit messages: concise conventional-commit subjects, no Co-Authored-By/session trailers (house rules).

---

### Task 1: `usePanelWidth` hook

**Files:**
- Create: `src/renderer/operator/usePanelWidth.ts`
- Test: `src/renderer/operator/usePanelWidth.test.tsx`

**Interfaces:**
- Consumes: nothing new — `localStorage`, React.
- Produces (later tasks rely on these exact names):

```ts
import type { MouseEvent as ReactMouseEvent } from 'react';

export interface PanelWidthOpts {
  def: number;
  min: number;
  max: number;
  /** Which edge the panel is anchored to. A 'right'-anchored panel grows as the
   *  divider moves LEFT (drag delta is inverted, `startW - dx`). */
  anchor: 'left' | 'right';
}
export interface PanelWidthControl {
  width: number;                                // clamped, ready to render
  dragging: boolean;
  startDrag: (e: ReactMouseEvent) => void;      // attach to the divider's onMouseDown
}
export function usePanelWidth(storageKey: string, opts: PanelWidthOpts): PanelWidthControl;
```

- [ ] **Step 1: Write the failing test**

`src/renderer/operator/usePanelWidth.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePanelWidth, type PanelWidthOpts } from './usePanelWidth';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const OPTS: PanelWidthOpts = { def: 270, min: 200, max: 420, anchor: 'left' };

function Harness({ opts = OPTS, storageKey = 'testW' }: { opts?: PanelWidthOpts; storageKey?: string }) {
  const p = usePanelWidth(storageKey, opts);
  return (
    <div>
      <div data-testid="width">{p.width}</div>
      <div data-testid="dragging">{String(p.dragging)}</div>
      <div data-testid="divider" onMouseDown={p.startDrag} />
    </div>
  );
}

describe('usePanelWidth', () => {
  it('starts at the default when nothing is persisted', () => {
    const r = render(<Harness />);
    expect(r.getByTestId('width').textContent).toBe('270');
  });

  it('loads a persisted width, clamped to bounds', () => {
    localStorage.setItem('testW', '9999');
    const r = render(<Harness />);
    expect(r.getByTestId('width').textContent).toBe('420');
  });

  it('falls back to the default on an unparsable persisted value', () => {
    localStorage.setItem('testW', 'garbage');
    const r = render(<Harness />);
    expect(r.getByTestId('width').textContent).toBe('270');
  });

  it('drags a left-anchored panel wider with +dx, clamped, and persists on mouseup', () => {
    const r = render(<Harness />);
    fireEvent.mouseDown(r.getByTestId('divider'), { clientX: 100 });
    expect(r.getByTestId('dragging').textContent).toBe('true');
    expect(document.body.style.cursor).toBe('col-resize');
    fireEvent.mouseMove(window, { clientX: 150 });                 // +50
    expect(r.getByTestId('width').textContent).toBe('320');
    fireEvent.mouseMove(window, { clientX: 1000 });                // way past max
    expect(r.getByTestId('width').textContent).toBe('420');
    fireEvent.mouseUp(window);
    expect(r.getByTestId('dragging').textContent).toBe('false');
    expect(document.body.style.cursor).toBe('');
    expect(localStorage.getItem('testW')).toBe('420');
  });

  it('drags a right-anchored panel wider with -dx', () => {
    const r = render(
      <Harness opts={{ def: 330, min: 240, max: 520, anchor: 'right' }} />
    );
    fireEvent.mouseDown(r.getByTestId('divider'), { clientX: 400 });
    fireEvent.mouseMove(window, { clientX: 350 });                 // divider left → wider
    expect(r.getByTestId('width').textContent).toBe('380');
    fireEvent.mouseUp(window);
    expect(localStorage.getItem('testW')).toBe('380');
  });

  it('an unmount mid-drag cleans up without persisting', () => {
    const r = render(<Harness />);
    fireEvent.mouseDown(r.getByTestId('divider'), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 150 });
    r.unmount();
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    expect(localStorage.getItem('testW')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/operator/usePanelWidth.test.tsx`
Expected: FAIL — cannot resolve `./usePanelWidth`.

- [ ] **Step 3: Write the implementation**

`src/renderer/operator/usePanelWidth.ts` — this is `SongsMode.tsx:287-326`'s `startColDrag` and `:33-42`'s `loadWidth`, generalized:

```ts
import { useRef, useState, useEffect, type MouseEvent as ReactMouseEvent } from 'react';

export interface PanelWidthOpts {
  def: number;
  min: number;
  max: number;
  /** Which edge the panel is anchored to. A 'right'-anchored panel grows as the
   *  divider moves LEFT (drag delta is inverted, `startW - dx`). */
  anchor: 'left' | 'right';
}
export interface PanelWidthControl {
  width: number;
  dragging: boolean;
  startDrag: (e: ReactMouseEvent) => void;
}

/** Loads a persisted panel width; falls back to `def` when missing/invalid (parses to NaN). */
function loadWidth(key: string, def: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return def;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : def;
  } catch {
    return def;
  }
}

/**
 * Drag-to-resize width state for one side panel, persisted to localStorage on release.
 * Extracted from SongsMode's startColDrag: mousemove/mouseup on window, body cursor +
 * userSelect suppressed while dragging, persisted only on a real mouseup — an
 * unmount-aborted drag skips persisting (the width state it was mutating is being torn
 * down anyway).
 */
export function usePanelWidth(storageKey: string, opts: PanelWidthOpts): PanelWidthControl {
  const { def, min, max, anchor } = opts;
  const clamp = (v: number): number => Math.max(min, Math.min(max, v));
  const [width, setWidth] = useState(() => loadWidth(storageKey, def));
  const [dragging, setDragging] = useState(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Abort an in-flight drag if this hook unmounts mid-drag.
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const startDrag = (e: ReactMouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let latest = startW;
    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX;
      latest = clamp(anchor === 'left' ? startW + dx : startW - dx);
      setWidth(latest);
    };
    const cleanup = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragCleanupRef.current = null;
    };
    const onUp = (): void => {
      cleanup();
      setDragging(false);
      try {
        localStorage.setItem(storageKey, String(latest));
      } catch {
        // localStorage unavailable (e.g. private mode) — width just won't persist.
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    dragCleanupRef.current = cleanup;
    setDragging(true);
  };

  // Defensive clamp at render time (mirrors SongsMode), in case a persisted value is
  // outside the current bounds (e.g. edited by hand in devtools).
  return { width: clamp(width), dragging, startDrag };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/operator/usePanelWidth.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/usePanelWidth.ts src/renderer/operator/usePanelWidth.test.tsx
git commit -m "feat(operator): extract usePanelWidth drag-resize hook"
```

---

### Task 2: `PanelDivider` component + SongsMode refactor

**Files:**
- Create: `src/renderer/operator/PanelDivider.tsx`
- Modify: `src/renderer/operator/SongsMode.tsx` (remove `loadWidth` `:33-42`, constants stay; remove `startColDrag` `:287-326`, `DragTarget` type `:30`, `dragging` state `:73`, `dragCleanupRef` and its unmount effect, `dividerStyle`/`gripStyle` `:415-437`; replace the two divider `<div>`s at `:462-464` and `:494-500`)
- Test: existing `src/renderer/operator/SongsMode.test.tsx` (unmodified — regression gate)

**Interfaces:**
- Consumes: `PanelWidthControl` from Task 1 (`startDrag`, `dragging`, `width`).
- Produces:

```tsx
export interface PanelDividerProps {
  active: boolean;                              // pass control.dragging
  onMouseDown: (e: ReactMouseEvent) => void;    // pass control.startDrag
  hit?: number;                                 // hit-area width px, default 10
  title?: string;                               // tooltip, default 'Drag to resize'
  background?: string;                          // default 'transparent'
}
export function PanelDivider(props: PanelDividerProps): JSX.Element;
```

- [ ] **Step 1: Write `PanelDivider`**

`src/renderer/operator/PanelDivider.tsx` — the divider element from `SongsMode.tsx:415-437, 462-464`, made reusable:

```tsx
import { useContext, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import { ThemeCtx } from './ThemeCtx';

export interface PanelDividerProps {
  active: boolean;
  onMouseDown: (e: ReactMouseEvent) => void;
  hit?: number;
  title?: string;
  background?: string;
}

/** Drag handle between an operator side rail and the center pane. Pure presentation:
 *  width state and drag mechanics live in usePanelWidth. */
export function PanelDivider({ active, onMouseDown, hit = 10, title = 'Drag to resize', background = 'transparent' }: PanelDividerProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const wrapStyle: CSSProperties = {
    width: `${hit}px`,
    flexShrink: 0,
    cursor: 'col-resize',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '6px',
    background,
  };
  const gripStyle: CSSProperties = {
    width: '3px',
    height: '44px',
    borderRadius: '2px',
    background: active ? T.accent : T.border,
  };
  return (
    <div style={wrapStyle} title={title} onMouseDown={onMouseDown}>
      <div style={gripStyle} />
    </div>
  );
}
```

Match the removed `dividerStyle` exactly when you delete it from SongsMode — if the original has properties not listed here (check before deleting), carry them over.

- [ ] **Step 2: Refactor SongsMode onto the hook + divider**

In `SongsMode.tsx`:

```tsx
import { usePanelWidth } from './usePanelWidth';
import { PanelDivider } from './PanelDivider';
// ...
const listPanel = usePanelWidth('helmSongListW', { def: LIST_W_DEFAULT, min: LIST_W_MIN, max: LIST_W_MAX, anchor: 'left' });
const sectionPanel = usePanelWidth('helmSectionPanelW', { def: SECTION_W_DEFAULT, min: SECTION_W_MIN, max: SECTION_W_MAX, anchor: 'right' });
```

- `width={listWClamped}` → `width={listPanel.width}`; `width={sectionWClamped}` → `width={sectionPanel.width}`.
- First divider (`:462-464`) → `<PanelDivider active={listPanel.dragging} onMouseDown={listPanel.startDrag} background={T.appBg} />`.
- Second divider (`:494-500`) → `<PanelDivider active={sectionPanel.dragging} onMouseDown={sectionPanel.startDrag} hit={12} title="Drag to resize — lyric text scales with the panel" />`.
- Delete: `loadWidth`, `DragTarget`, `listW`/`sectionW`/`dragging` state, `startColDrag`, `dragCleanupRef` + its unmount-cleanup effect, `dividerStyle`, `gripStyle`, the render-time clamp lines (`:429-430`). Keep the `LIST_W_*`/`SECTION_W_*` constants.

- [ ] **Step 3: Run the SongsMode regression + new hook tests**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx src/renderer/operator/usePanelWidth.test.tsx`
Expected: PASS with no changes to `SongsMode.test.tsx`. If a SongsMode test fails, the refactor changed behavior — fix the refactor, not the test.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:web`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/PanelDivider.tsx src/renderer/operator/SongsMode.tsx
git commit -m "refactor(songs): move drag dividers onto usePanelWidth + PanelDivider"
```

---

### Task 3: Sermon page — Scripture track resizable

**Files:**
- Modify: `src/renderer/operator/SermonMode.tsx` (constants `:42-43`, scripture-track render `:632-684`)
- Test: `src/renderer/operator/SermonMode.test.tsx` (add one case)

**Interfaces:**
- Consumes: `usePanelWidth`, `PanelDivider` (Tasks 1–2).
- Produces: `leftPanel`/`rightPanel` (`PanelWidthControl`) in `SermonMode` scope — Task 4 threads these same objects into `MessageMode` and `SlidesTrack` props.

- [ ] **Step 1: Add a failing test**

In `SermonMode.test.tsx`, following the file's existing render-helper pattern (reuse its `window.helm` stub setup):

```tsx
it('scripture track rails resize from the dividers and persist the sermon-wide keys', () => {
  localStorage.clear();
  const r = renderSermon();               // the file's existing helper; scripture track is the default
  const dividers = r.getAllByTitle('Drag to resize');
  expect(dividers).toHaveLength(2);
  fireEvent.mouseDown(dividers[0], { clientX: 100 });
  fireEvent.mouseMove(window, { clientX: 160 });
  fireEvent.mouseUp(window);
  expect(localStorage.getItem('helmSermonLeftW')).toBe('330');   // 270 + 60
  fireEvent.mouseDown(dividers[1], { clientX: 500 });
  fireEvent.mouseMove(window, { clientX: 440 });
  fireEvent.mouseUp(window);
  expect(localStorage.getItem('helmSermonRightW')).toBe('390');  // 330 + 60 (right-anchored)
});
```

Adapt the helper name to what the file actually uses; add `localStorage.clear()` to its `beforeEach` if absent.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx`
Expected: the new case FAILS (no dividers found).

- [ ] **Step 3: Wire the scripture track**

In `SermonMode.tsx`:

```tsx
import { usePanelWidth } from './usePanelWidth';
import { PanelDivider } from './PanelDivider';

const SERMON_LEFT = { def: 270, min: 200, max: 420, anchor: 'left' } as const;
const SERMON_RIGHT = { def: 330, min: 240, max: 520, anchor: 'right' } as const;
```

Inside the component (top level — the pair is shared by all tracks, so it must not live inside a track branch):

```tsx
const leftPanel = usePanelWidth('helmSermonLeftW', SERMON_LEFT);
const rightPanel = usePanelWidth('helmSermonRightW', SERMON_RIGHT);
```

Scripture-track JSX (`:632-684`): replace `width={SCHEDULE_PANEL_W}` with `width={leftPanel.width}` and `width={RIGHT_PANEL_W}` with `width={rightPanel.width}`; insert `<PanelDivider active={leftPanel.dragging} onMouseDown={leftPanel.startDrag} />` between `<SchedulePanel …/>` and `<SermonCenter …/>`, and `<PanelDivider active={rightPanel.dragging} onMouseDown={rightPanel.startDrag} />` between `<SermonCenter …/>` and `<ChapterRail …/>`. Delete the now-unused `SCHEDULE_PANEL_W`/`RIGHT_PANEL_W` constants (`:42-43`) once nothing references them (Task 4 removes the other users; leave them until then if Message/Slides still import their own — they don't, they have their own module constants).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/SermonMode.tsx src/renderer/operator/SermonMode.test.tsx
git commit -m "feat(sermon): resizable schedule panel and chapter rail"
```

---

### Task 4: Message + Slides tracks share the pair

**Files:**
- Modify: `src/renderer/operator/MessageMode.tsx` (constants `:49-50`, `railStyle` `:342`, `ParagraphRail` width `:411`, props interface)
- Modify: `src/renderer/operator/SlidesTrack.tsx` (constants `:34-35`, `railStyle` `:310`, `comingPanelStyle` `:373`, props interface)
- Modify: `src/renderer/operator/SermonMode.tsx` (pass the controls at `:625` and `:630`)
- Test: `src/renderer/operator/SlidesTrack.test.tsx` (update props; add divider case). MessageMode has no test file today — its coverage comes through `SermonMode.test.tsx`; add a message-track divider case there.

**Interfaces:**
- Consumes: `PanelWidthControl` objects `leftPanel`/`rightPanel` created in Task 3.
- Produces: both components gain the same two required props:

```ts
import type { PanelWidthControl } from './usePanelWidth';
// added to MessageModeProps and SlidesTrackProps:
leftPanel: PanelWidthControl;
rightPanel: PanelWidthControl;
```

- [ ] **Step 1: Add failing tests**

`SlidesTrack.test.tsx` — extend the existing render helper to pass stub controls, and add:

```tsx
const stubPanel = (width: number) => ({ width, dragging: false, startDrag: vi.fn() });
// helper now passes: leftPanel={stubPanel(270)} rightPanel={stubPanel(330)}

it('renders both resize dividers wired to the panel controls', () => {
  const left = stubPanel(270);
  const right = stubPanel(330);
  const r = renderTrack({ leftPanel: left, rightPanel: right });   // adapt to the file's helper
  const dividers = r.getAllByTitle('Drag to resize');
  expect(dividers).toHaveLength(2);
  fireEvent.mouseDown(dividers[0], { clientX: 10 });
  expect(left.startDrag).toHaveBeenCalled();
  fireEvent.mouseDown(dividers[1], { clientX: 10 });
  expect(right.startDrag).toHaveBeenCalled();
});
```

`SermonMode.test.tsx` — a message-track case mirroring Task 3's, if the file already has a way to switch to the message track; if switching tracks in the test requires substantial new scaffolding, cover MessageMode's dividers by asserting they exist after clicking the Message tab (the TrackTabs button labeled `Message`), and skip the drag simulation (the hook and divider are already unit-tested).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/operator/SlidesTrack.test.tsx src/renderer/operator/SermonMode.test.tsx`
Expected: new cases FAIL (missing props / no dividers).

- [ ] **Step 3: Thread the props**

- `MessageMode.tsx`: add `leftPanel`/`rightPanel` to its props interface. Replace `width: \`${RAIL_W}px\`` in `railStyle` (`:342`) with `width: \`${leftPanel.width}px\``, and `width={RIGHT_PANEL_W}` (`:411`) with `width={rightPanel.width}`. Insert `<PanelDivider active={leftPanel.dragging} onMouseDown={leftPanel.startDrag} />` between the left rail and the center pane, and the right-panel divider between center and `ParagraphRail`. Delete the `RAIL_W`/`RIGHT_PANEL_W` constants.
- `SlidesTrack.tsx`: same treatment — `railStyle` (`:310`), `comingPanelStyle` (`:373`), two dividers, delete constants.
- `SermonMode.tsx`: pass `leftPanel={leftPanel} rightPanel={rightPanel}` to `<MessageMode …/>` (`:625`) and `<SlidesTrack …/>` (`:630`). Now delete `SCHEDULE_PANEL_W`/`RIGHT_PANEL_W` from SermonMode if Task 3 left them.

Layout note: in all three tracks the row container is `display:flex` with `gap:'1px'` on a hairline background; the divider sits as a flex child between panels exactly as in SongsMode — no wrapper changes needed.

- [ ] **Step 4: Run the full operator test directory**

Run: `npx vitest run src/renderer/operator`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite + commit**

Run: `npm run typecheck:web && npm test`
Expected: clean/PASS.

```bash
git add src/renderer/operator/MessageMode.tsx src/renderer/operator/SlidesTrack.tsx src/renderer/operator/SermonMode.tsx src/renderer/operator/SlidesTrack.test.tsx src/renderer/operator/SermonMode.test.tsx
git commit -m "feat(sermon): message and slides tracks share the resizable rail pair"
```

---

### Task 5: Real-app verification

**Files:**
- Create: `scratch/verify-sermon-resize.mjs` (playwright `_electron` driver — copy the boilerplate from `scratch/verify-typeahead.mjs`: launch, find the operator window by `w.url().includes('operator')`)

**Interfaces:** none — verification only.

- [ ] **Step 1: Write the driver script**

The script: launch the app; click the Sermon tab; screenshot; `mouse.down/move/up` across the left divider (drag +80px); switch to the Message track, screenshot (left rail must show the widened width); switch to Slides, screenshot; relaunch the app and screenshot the Sermon tab again (width must have persisted). Save shots under `scratch/sermon-resize-shots/`. Follow the existing driver's selector conventions.

- [ ] **Step 2: Run it and eyeball the screenshots**

Run: `node scratch/verify-sermon-resize.mjs`
Expected: all three tracks show the same widened left rail; the width survives relaunch; Songs pane widths are untouched.

- [ ] **Step 3: Commit (script only)**

```bash
git add scratch/verify-sermon-resize.mjs
git commit -m "test(sermon): driver script verifying shared rail resize"
```
