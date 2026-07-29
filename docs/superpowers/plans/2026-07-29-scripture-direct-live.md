# Direct preview → live for scripture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator move the scripture cursor by tap, arrow, or schedule-row click and have it reach the projector immediately when output is live — with the schedule and the screen as two independent paths, neither gating the other.

**Architecture:** A third presentation verb, `showLive`, sits beside `applyCue` and `goLive` in `src/shared/presentation/core.ts`: it updates the screen when output is live, across any flow, and never toggles to black. Scripture navigation routes through it; Songs, Message, and Slides keep using `applyCue` and its `sameFlow` guard. Two pure functions extracted to `src/shared/scripture/selection.ts` carry the tap and Add-target decisions so they can be tested without mounting `SermonMode` (598 lines, no test file of its own).

**Tech Stack:** TypeScript, React 19, Electron (main/preload/renderer split), Vitest (no `globals: true`), @testing-library/react with jsdom via per-file `// @vitest-environment jsdom`, playwright-core for real-app drivers.

**Spec:** `docs/superpowers/specs/2026-07-29-scripture-direct-live-design.md`

## Global Constraints

- Commit messages: concise conventional-commit subject, no `Co-Authored-By` or `Claude-Session` trailers (`CLAUDE.md`).
- `applyCue` must not change. Songs relies on `sameFlow` so cueing a different song does not jump the screen.
- No path reachable by navigation (tap, arrow, schedule-row click) may black the projector.
- Nothing that reaches the projector may write a schedule row; nothing that writes a schedule row may reach the projector.
- Test command: `npx vitest run <path>`. Full suite: `npm test`. Types: `npm run typecheck`.
- Baseline before starting: 412/412 tests passing, typecheck clean.
- Renderer sources use semicolons (`src/renderer/**`); `src/shared/scripture/**` does not. Match the file you are in.

---

### Task 1: `showLive` presentation verb

**Files:**
- Modify: `src/shared/presentation/core.ts` (add after `goLive`, `:20-23`)
- Test: `src/shared/presentation/core.test.ts`

**Interfaces:**
- Consumes: `PresentationState`, `Slide` from `../types`; existing `goLive`, `initialPresentation`, `setOutput` for test setup.
- Produces: `showLive(st: PresentationState, key: string, slide: Slide): PresentationState` — used by Task 2's stateStore method.

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/presentation/core.test.ts`:

```ts
test('showLive while live hot-updates the screen, even across flows', () => {
  let st = goLive(initialPresentation(), 'scr:Genesis:1:1', slide('Gen 1:1'));
  st = showLive(st, 'scr:Romans:8:1', slide('Rom 8:1'));
  expect(st.output).toBe('live');
  expect(st.liveKey).toBe('scr:Romans:8:1');
  expect(st.liveSnap?.label).toBe('Rom 8:1');
});
test('showLive while black leaves the screen down', () => {
  const st = showLive(initialPresentation(), 'scr:Genesis:1:1', slide('Gen 1:1'));
  expect(st.output).toBe('black');
  expect(st.liveKey).toBeNull();
  expect(st.liveSnap).toBeNull();
});
test('showLive while on the logo leaves the logo up', () => {
  const st = showLive(setOutput(initialPresentation(), 'logo'), 'scr:Genesis:1:1', slide('Gen 1:1'));
  expect(st.output).toBe('logo');
  expect(st.liveSnap).toBeNull();
});
test('showLive on the already-live key does NOT take the screen down', () => {
  let st = goLive(initialPresentation(), 'scr:Genesis:1:1', slide('Gen 1:1'));
  st = showLive(st, 'scr:Genesis:1:1', slide('Gen 1:1'));
  expect(st.output).toBe('live');
  expect(st.liveKey).toBe('scr:Genesis:1:1');
});
test('applyCue still refuses a cross-flow cue (Songs depends on this)', () => {
  let st = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  st = applyCue(st, 'song:b:0', slide('OTHER'));
  expect(st.liveKey).toBe('song:a:0');
});
```

Add `showLive` to the import on line 2:

```ts
import { applyCue, goLive, initialPresentation, keyForSong, outputPayload, sameFlow, setOutput, showLive } from './core';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/presentation/core.test.ts`
Expected: FAIL — `showLive is not a function` (or a TS resolution error on the import).

- [ ] **Step 3: Implement `showLive`**

In `src/shared/presentation/core.ts`, insert immediately after `goLive` (which ends at `:23`):

```ts
/** Navigation's route to the screen: updates what's live when output is already live,
 * across ANY flow, and never toggles. Distinct from both neighbours on purpose —
 * `applyCue` refuses a cross-flow update (Songs needs that: cueing another song must not
 * jump the screen), and `goLive` blacks the output when fired on the key already live
 * (right for a Go live / Take down button, wrong for a tap or an arrow). */
export function showLive(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output !== 'live') return st;
  return { ...st, liveKey: key, liveSnap: slide };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/presentation/core.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/shared/presentation/core.ts src/shared/presentation/core.test.ts
git commit -m "feat(presentation): add showLive — cross-flow, non-toggling screen update"
```

---

### Task 2: Wire `presentation.show` through IPC

**Files:**
- Modify: `src/shared/types.ts:81-82` (channel constants) and `:170-175` (the `presentation` API block)
- Modify: `src/main/stateStore.ts:12-17` (the `presentation` object)
- Modify: `src/main/ipc.ts:46-49` (handler registration)
- Modify: `src/preload/index.ts:17-20` (renderer bridge)

**Interfaces:**
- Consumes: `showLive` from Task 1.
- Produces: `window.helm.presentation.show(key: string, slide: Slide): void` — used by Tasks 4 and 6.

There is no test here. This layer is thin pass-through with no logic, matching how `cue` / `goLive` / `setOutput` are already plumbed; `npm run typecheck` is the gate, and Task 8 exercises the wire end to end.

- [ ] **Step 1: Add the channel constant**

In `src/shared/types.ts`, line 82 currently reads:

```ts
  presGoLive: 'presentation:goLive', presSetOutput: 'presentation:setOutput',
```

Change it to:

```ts
  presGoLive: 'presentation:goLive', presShow: 'presentation:show',
  presSetOutput: 'presentation:setOutput',
```

- [ ] **Step 2: Add the method to the API type**

In the same file, the `presentation` block at `:170-175`. After the `goLive` line, add:

```ts
    show(key: string, slide: Slide): void;
```

- [ ] **Step 3: Add the stateStore method**

In `src/main/stateStore.ts`, extend the import on line 3:

```ts
import { applyCue, goLive, initialPresentation, outputPayload, setOutput, showLive } from '../shared/presentation/core';
```

Then, after the `goLive` line in the `presentation` object (`:15`), add:

```ts
  show: (key: string, slide: Slide) => { state = showLive(state, key, slide); broadcast(); },
```

- [ ] **Step 4: Register the IPC handler**

In `src/main/ipc.ts`, after line 48, add:

```ts
  ipcMain.on(CH.presShow, (_e, key: string, slide: Slide) => presentation.show(key, slide));
```

- [ ] **Step 5: Add the preload bridge**

In `src/preload/index.ts`, after line 19, add:

```ts
    show: (key, slide) => ipcRenderer.send(CH.presShow, key, slide),
```

- [ ] **Step 6: Verify types across both projects**

Run: `npm run typecheck`
Expected: clean exit, no errors. (This runs `tsconfig.node.json` then `tsconfig.web.json`, so it checks main, preload, and renderer.)

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/stateStore.ts src/main/ipc.ts src/preload/index.ts
git commit -m "feat(presentation): plumb showLive through IPC as presentation.show"
```

---

### Task 3: `railSelect` and `addTarget`

**Files:**
- Create: `src/shared/scripture/selection.ts`
- Test: `src/shared/scripture/selection.test.ts`

**Interfaces:**
- Consumes: `RefBuilderState`, `initialBuilder`, `setEnd` from `./refBuilder`; `ParsedRef`, `toParsedRef` — note `toParsedRef` lives in `./refBuilder`, while `ParsedRef` is a type exported from `./refs`. `BookExtent` from `../types`.
- Produces:
  - `interface Cursor { book: string; ch: number; v: number }`
  - `interface RailSelection { cursor: Cursor; builder: RefBuilderState }`
  - `railSelect(builder: RefBuilderState, cursor: Cursor, preview: { book: string; ch: number }, v: number, shift: boolean, extent: BookExtent): RailSelection`
  - `addTarget(builder: RefBuilderState, cursor: Cursor): ParsedRef`

  Both are used by Tasks 5 and 6. `addTarget` returns a non-nullable `ParsedRef` — there is always a cursor, so there is always something to add.

Background the implementer needs: `RefBuilderState` is a staged structure (`stage`, `bookQuery`, `book`, `chapter`, `startVerse`, `endVerse`) — see `src/shared/scripture/refBuilder.ts:5-12`. `setEnd(s, v, extent)` (`:145`) returns `s` unchanged unless `chapter` and `startVerse` are both set, and orders `startVerse`/`endVerse` by min/max, so a backwards shift-tap works for free. `EMPTY_EXTENT` is `{ chapters: 0, verseCounts: [] }`, which makes `clampVerse` return `0` and therefore makes `setEnd` a no-op — that is the correct fallback for a book whose extents have not loaded yet.

- [ ] **Step 1: Write the failing tests**

Create `src/shared/scripture/selection.test.ts`:

```ts
import { expect, test } from 'vitest'
import { railSelect, addTarget, type Cursor } from './selection'
import { initialBuilder, type RefBuilderState } from './refBuilder'
import type { BookExtent } from '../types'

const GENESIS: BookExtent = { chapters: 50, verseCounts: Array(50).fill(31) }
const cursor: Cursor = { book: 'Genesis', ch: 1, v: 5 }
const here = { book: 'Genesis', ch: 1 }

const built = (over: Partial<RefBuilderState>): RefBuilderState => ({
  ...initialBuilder(),
  stage: 'verse',
  book: 'Genesis',
  chapter: 1,
  ...over
})

test('plain tap moves the cursor to the tapped verse', () => {
  const r = railSelect(initialBuilder(), cursor, here, 9, false, GENESIS)
  expect(r.cursor).toEqual({ book: 'Genesis', ch: 1, v: 9 })
})

test('plain tap clears a pending builder range', () => {
  const pending = built({ startVerse: 2, endVerse: 4, stage: 'endVerse' })
  const r = railSelect(pending, cursor, here, 9, false, GENESIS)
  expect(r.builder).toEqual(initialBuilder())
})

test('plain tap in a previewed chapter moves the cursor across chapters', () => {
  const typed = built({ book: 'Romans', chapter: 8, startVerse: null })
  const r = railSelect(typed, cursor, { book: 'Romans', ch: 8 }, 28, false, GENESIS)
  expect(r.cursor).toEqual({ book: 'Romans', ch: 8, v: 28 })
  expect(r.builder).toEqual(initialBuilder())
})

test('shift-tap anchors the range at the cursor, not at the builder start', () => {
  const stale = built({ startVerse: 20, endVerse: null })
  const r = railSelect(stale, cursor, here, 9, true, GENESIS)
  expect(r.builder.book).toBe('Genesis')
  expect(r.builder.chapter).toBe(1)
  expect(r.builder.startVerse).toBe(5)
  expect(r.builder.endVerse).toBe(9)
})

test('shift-tap does not move the cursor', () => {
  const r = railSelect(initialBuilder(), cursor, here, 9, true, GENESIS)
  expect(r.cursor).toEqual(cursor)
})

test('shift-tap backwards still yields an ordered range', () => {
  const r = railSelect(initialBuilder(), cursor, here, 2, true, GENESIS)
  expect(r.builder.startVerse).toBe(2)
  expect(r.builder.endVerse).toBe(5)
})

test('shift-tap in a chapter the cursor is not in starts a fresh anchor there', () => {
  const typed = built({ book: 'Romans', chapter: 8, startVerse: null })
  const r = railSelect(typed, cursor, { book: 'Romans', ch: 8 }, 28, true, GENESIS)
  expect(r.cursor).toEqual(cursor)
  expect(r.builder.book).toBe('Romans')
  expect(r.builder.chapter).toBe(8)
  expect(r.builder.startVerse).toBe(28)
  expect(r.builder.endVerse).toBeNull()
})

test('addTarget falls back to the cursor when the builder is empty', () => {
  expect(addTarget(initialBuilder(), cursor)).toEqual({ book: 'Genesis', ch: 1, from: 5, to: 5 })
})

test('addTarget prefers a typed reference over the cursor', () => {
  const typed = built({ book: 'Romans', chapter: 8, startVerse: 28 })
  expect(addTarget(typed, cursor)).toEqual({ book: 'Romans', ch: 8, from: 28, to: 28 })
})

test('addTarget returns a shift-tapped range', () => {
  const range = built({ startVerse: 5, endVerse: 9, stage: 'endVerse' })
  expect(addTarget(range, cursor)).toEqual({ book: 'Genesis', ch: 1, from: 5, to: 9 })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/scripture/selection.test.ts`
Expected: FAIL — cannot resolve `./selection`.

- [ ] **Step 3: Implement the module**

Create `src/shared/scripture/selection.ts` (no semicolons — match the rest of `src/shared/scripture/`):

```ts
import type { BookExtent } from '../types'
import type { ParsedRef } from './refs'
import { initialBuilder, setEnd, toParsedRef, type RefBuilderState } from './refBuilder'

/** Where the operator is: the verse the hero shows, the arrows step, and — when output is
 * live — the projector displays. One cursor, moved identically by a rail tap, an arrow key,
 * and a schedule-row click. */
export interface Cursor {
  book: string
  ch: number
  v: number
}

export interface RailSelection {
  cursor: Cursor
  builder: RefBuilderState
}

/** What a click on a verse card means.
 *
 * Plain tap moves the cursor to the tapped verse and clears the builder — the operator
 * reached for the rail, so any pending range (or half-typed ref) is stale. Shift-tap leaves
 * the cursor alone and writes a range into the builder instead, anchored at the cursor, so
 * tap-then-shift-tap reads as "from here to there".
 *
 * `preview` is the book/chapter the rail is currently showing, which diverges from the
 * cursor only while a typed reference is resolving in the builder. A shift-tap there has no
 * sensible anchor (the cursor is in a different chapter), so it starts a fresh one on the
 * tapped verse rather than inventing a cross-chapter range. */
export function railSelect(
  builder: RefBuilderState,
  cursor: Cursor,
  preview: { book: string; ch: number },
  v: number,
  shift: boolean,
  extent: BookExtent
): RailSelection {
  if (!shift) {
    return { cursor: { book: preview.book, ch: preview.ch, v }, builder: initialBuilder() }
  }
  const anchored = preview.book === cursor.book && preview.ch === cursor.ch
  const base: RefBuilderState = {
    ...initialBuilder(),
    stage: 'verse',
    book: preview.book,
    chapter: preview.ch,
    startVerse: anchored ? cursor.v : v
  }
  return { cursor, builder: anchored ? setEnd(base, v, extent) : base }
}

/** What `+ Add` and Enter would file: the typed reference when the entry holds one, else
 * the cursor's single verse. Never null — there is always a cursor, so the affordance is
 * always offered, which is what a mouse-only operator needs. */
export function addTarget(builder: RefBuilderState, cursor: Cursor): ParsedRef {
  return toParsedRef(builder) ?? { book: cursor.book, ch: cursor.ch, from: cursor.v, to: cursor.v }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/scripture/selection.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/scripture/selection.ts src/shared/scripture/selection.test.ts
git commit -m "feat(scripture): extract railSelect and addTarget selection helpers"
```

---

### Task 4: Route scripture navigation through `show`, with the stale-chapter guard

**Files:**
- Modify: `src/renderer/operator/SermonMode.tsx:227-236`

**Interfaces:**
- Consumes: `window.helm.presentation.show` from Task 2.
- Produces: nothing new. Behaviour change only — moving the cursor now reaches the projector across chapters.

Why the guard is not optional: `chapter` is fetched async and keyed by `[scrBook, scrCh]`, so `liveChapter` (`:225`) is null for a render or two after a cross-book or cross-chapter jump. Today that costs nothing, because a cross-chapter key fails `sameFlow` and `applyCue` no-ops. `showLive` has no such check, so without the guard this effect would push the `INSTALL_HINT` slide — the "no bible installed" text — onto the projector during the fetch. `liveChapter` is already in the dependency array, so the effect re-runs with real verse text the moment the fetch resolves. Identical reasoning to `goLive`'s guard at `:247-257`.

Do not add a test in this task — the guard gets a proper CI test in Task 8, once the rail and builder wiring it shares a harness with are also in place. `showLive`'s own semantics are already covered by Task 1.

- [ ] **Step 1: Replace the cue effect**

`src/renderer/operator/SermonMode.tsx:227-236` currently reads:

```tsx
  // Cue on every book/chapter/verse/version/chapter-data change (mirrors SongsMode).
  useEffect(() => {
    const key = keyForScripture(scrBook, scrCh, scrV);
    const cols = verseCols(liveChapter?.verses[scrV] ?? {}, versions, abbrOf);
    const slide = buildScriptureSlide(
      formatRef({ book: scrBook, ch: scrCh, from: scrV, to: scrV }),
      cols.length ? cols : [{ version: '', text: INSTALL_HINT }]
    );
    window.helm.presentation.cue(key, slide);
  }, [scrBook, scrCh, scrV, versions, liveChapter, abbrOf]);
```

Replace it with:

```tsx
  // The cursor's route to the screen: `show` on every book/chapter/verse/version/
  // chapter-data change. Unlike the `cue` this replaced, it follows across chapters and
  // books — moving the cursor while live moves the projector, wherever you move it.
  //
  // Bail while `liveChapter` is null. It is null for a render or two after a cross-book/
  // chapter jump (see its comment above), and `show` — having no sameFlow guard to make
  // that an accidental no-op the way `cue` did — would otherwise push the INSTALL_HINT
  // slide onto the projector mid-service. `liveChapter` is a dep, so this re-runs with the
  // real text the moment the fetch resolves; the screen holds the previous verse for that
  // tick rather than flashing a false "no bible installed". Same guard, same reason, as
  // `goLive` below.
  useEffect(() => {
    if (!liveChapter) return;
    const key = keyForScripture(scrBook, scrCh, scrV);
    const cols = verseCols(liveChapter.verses[scrV] ?? {}, versions, abbrOf);
    const slide = buildScriptureSlide(
      formatRef({ book: scrBook, ch: scrCh, from: scrV, to: scrV }),
      cols.length ? cols : [{ version: '', text: INSTALL_HINT }]
    );
    window.helm.presentation.show(key, slide);
  }, [scrBook, scrCh, scrV, versions, liveChapter, abbrOf]);
```

Note `liveChapter?.verses` becomes `liveChapter.verses` — the guard makes the optional chain dead.

- [ ] **Step 2: Verify types and the full suite still pass**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; 412 tests + the 15 added in Tasks 1 and 3, all passing.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/operator/SermonMode.tsx
git commit -m "feat(scripture): follow the cursor to the projector across chapters"
```

---

### Task 5: Rail tap moves the cursor; `+ Add` always offers the selection

**Files:**
- Modify: `src/renderer/operator/SermonMode.tsx:411-413` (`canAdd` / `addLabel`), `:415-432` (`onRailSelectVerse`), `:554-555` (the `SchedulePanel` props)

**Interfaces:**
- Consumes: `railSelect`, `addTarget`, `Cursor` from Task 3.
- Produces: `addRef: ParsedRef` — the value Task 6's two commit functions file and show.

- [ ] **Step 1: Add the import**

In `src/renderer/operator/SermonMode.tsx`, after the `refBuilder` import block (ends `:16`), add:

```tsx
import { railSelect, addTarget, type Cursor } from '../../shared/scripture/selection';
```

`setStart` is no longer used once Step 3 lands — drop it from the `refBuilder` import on `:12` at that point. `setEnd` also becomes unused here (it moved into `railSelect`); drop it from `:13` too.

- [ ] **Step 2: Replace `canAdd` / `addLabel`**

Lines `:411-413` currently read:

```tsx
  const parsed = toParsedRef(builder);
  const canAdd = parsed !== null;
  const addLabel = parsed ? `+ Add ${formatRef(parsed)}` : '';
```

Replace with:

```tsx
  // The cursor, as the pure selection helpers want it.
  const cursor: Cursor = { book: scrBook, ch: scrCh, v: scrV };
  // What `+ Add` and Enter would file: the typed ref when the entry holds one, else the
  // cursor's verse. Always something, so the button is always offered — a mouse-only
  // operator never has to know the keyboard flow to schedule what they're looking at.
  const addRef = addTarget(builder, cursor);
  const addLabel = `+ Add ${formatRef(addRef)}`;
```

`toParsedRef` may now be unused in this file — check with `grep -n "toParsedRef" src/renderer/operator/SermonMode.tsx` after Task 6 and drop it from the `:10` import if so.

- [ ] **Step 3: Replace `onRailSelectVerse`**

Lines `:415-432` (the comment plus the function) become:

```tsx
  // A click on a verse card. Plain tap moves the cursor — which reaches the projector via
  // the show effect above when output is live, and is a quiet preview when it isn't.
  // Shift-tap leaves the cursor and writes a range into the builder instead. The decision
  // itself lives in `railSelect` so it can be tested without mounting this component.
  const onRailSelectVerse = (v: number, shift: boolean): void => {
    const next = railSelect(
      builder,
      cursor,
      { book: previewBook, ch: previewCh },
      v,
      shift,
      bookExtents[previewBook] ?? EMPTY_EXTENT
    );
    setBuilder(next.builder);
    jumpTo(next.cursor.book, next.cursor.ch, next.cursor.v);
  };
```

`jumpTo` is called unconditionally — on a shift-tap it re-sets the same three values, which React bails out of without re-rendering.

`onRailSelectVerse` must be declared after `cursor` (Step 2, around `:411`) and after `previewBook` / `previewCh` (`:313-314`), which it already is.

- [ ] **Step 4: Update the `SchedulePanel` props**

Lines `:554-555` currently read:

```tsx
            canAdd={canAdd}
            addLabel={addLabel}
```

Replace with:

```tsx
            canAdd
            addLabel={addLabel}
```

(`canAdd` is now always true — the shorthand passes `true`. The button only renders inside the scripture track, `SchedulePanel.tsx:108,121`.)

- [ ] **Step 5: Verify types and the full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean — in particular, no "declared but never read" errors for `setStart`, `setEnd`, or `toParsedRef`. All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/SermonMode.tsx
git commit -m "feat(scripture): rail tap moves the cursor, shift-tap builds the range"
```

---

### Task 6: Split `commitBuilder` into schedule and screen

**Files:**
- Modify: `src/renderer/operator/SermonMode.tsx:359-383` (`commitBuilder`), `:385-390` (`onEntryKeyDown`), `:556` (`onAdd`)

**Interfaces:**
- Consumes: `addRef` and `cursor` from Task 5; `goLiveWithChapter` (`:302`), `jumpTo` (`:269`), `keyForScripture`, and the `output` / `liveKey` values from `usePresentationState()` (`:53`), all already in scope.
- Produces: `addToSchedule(): void` and `goLiveFromBuilder(): void`.

Today `commitBuilder` (`:363`) calls `window.helm.schedule.add(p)` unconditionally, before it even reads `goLiveToo` — so every route through it leaves a schedule row behind. That is the behaviour this whole feature exists to remove. Note also that the comment at `:359-362` claims "Enter … jumps + goes live"; the code has never done that, because `:388` passes `e.shiftKey`. The comment goes with the split.

- [ ] **Step 1: Replace `commitBuilder` with two functions**

Lines `:359-383` (the comment block plus `commitBuilder`) become:

```tsx
  // Two independent commits. The schedule is a plan; it is not a gate to the projector, and
  // nothing that reaches the projector writes a row. Enter and `+ Add` file; Shift+Enter and
  // the Go live button show. Both read `addRef`, so an empty entry commits the cursor's
  // verse — Shift+Enter on an empty field is the keyboard twin of the Go live button.
  const addToSchedule = (): void => {
    window.helm.schedule.add(addRef).then(setSchedule).catch(console.error);
    setBuilder(initialBuilder());
    setTrack('scripture');
  };

  const goLiveFromBuilder = (): void => {
    const p = addRef;
    setBuilder(initialBuilder());
    setTrack('scripture');
    // `goLive` blacks the output when fired on the key already live (see
    // shared/presentation/core.ts) — correct for the Go live / Take down button, wrong here.
    // Shift+Enter names a reference, so blanking is never what was asked for; if it's
    // already up, we're done.
    const key = keyForScripture(p.book, p.ch, p.from);
    if (output === 'live' && liveKey === key) return;
    jumpTo(p.book, p.ch, p.from);
    // Reuse the cached chapter when it already matches, else fetch fresh so the live slide
    // never shows stale text from the previous book.
    if (chapter && chapter.book === p.book && chapter.chapter === p.ch) {
      goLiveWithChapter(p, chapter);
    } else {
      window.helm.bibles
        .getChapter(p.book, p.ch)
        .then((c) => {
          setChapter(c);
          goLiveWithChapter(p, c);
        })
        .catch(console.error);
    }
  };
```

These must be declared after `addRef` (Task 5, around `:411`). `commitBuilder` currently sits at `:363`, above it — move the two new functions below the `addRef` declaration rather than leaving them where `commitBuilder` was, or `addRef` will be referenced before initialization.

- [ ] **Step 2: Update the Enter handler**

In `onEntryKeyDown`, lines `:386-390` currently read:

```tsx
    if (e.key === 'Enter') {
      e.preventDefault();
      commitBuilder(e.shiftKey);
      return;
    }
```

Replace with:

```tsx
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) goLiveFromBuilder();
      else addToSchedule();
      return;
    }
```

`onEntryKeyDown` is passed as a prop at `:553` and is only called from the input's `onKeyDown`, so it may reference functions declared later in the component body — but keep it below them anyway to match the file's existing top-to-bottom ordering.

- [ ] **Step 3: Update the Add button**

Line `:556` currently reads:

```tsx
            onAdd={() => commitBuilder(false)}
```

Replace with:

```tsx
            onAdd={addToSchedule}
```

- [ ] **Step 4: Verify types and the full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean, no reference-before-initialization errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/SermonMode.tsx
git commit -m "feat(scripture): split commit into schedule and screen paths"
```

---

### Task 7: Correct `ChapterRail`'s documented contract and hint

**Files:**
- Modify: `src/renderer/operator/ChapterRail.tsx:19` (the `HINT` constant) and `:21-26` (the component doc comment)
- Test: `src/renderer/operator/ChapterRail.test.tsx` (no change needed — verify only)

**Interfaces:**
- Consumes: nothing. `ChapterRail`'s props are unchanged: it already reports `onSelectVerse(v, shift)` (`:177`) and leaves the decision to its caller, which is why Tasks 5 and 6 needed no changes here.
- Produces: nothing.

Both strings describe the old builder-only behaviour and are now wrong — the doc comment explicitly says tapping writes a range "rather than jumping the live/cued verse directly," which is exactly what tapping now does.

- [ ] **Step 1: Update the hint text**

Line `:19` currently reads:

```tsx
const HINT = 'Planned verses are highlighted. Tap any verse — and keep reading right past the plan.'
```

Replace with:

```tsx
const HINT = 'Tap a verse to go there — on screen when you\'re live. Shift-tap to build a range.'
```

- [ ] **Step 2: Update the doc comment**

Lines `:21-26` currently read:

```tsx
/** Right rail for the Scripture track: one card per verse in the current chapter,
 * tinted by planned/cued/live tier. Tapping a card (or shift-tapping to extend) writes a
 * range select into the caller's `RefBuilderState` via `onSelectVerse`, rather than jumping
 * the live/cued verse directly — the builder is the single source of truth for what's
 * selected, and the caller decides when/whether that turns into a live preview. Mirrors
 * SectionRail's tap-to-navigate shape. */
```

Replace with:

```tsx
/** Right rail for the Scripture track: one card per verse in the current chapter,
 * tinted by planned/cued/live tier. Tapping reports `(verse, shiftKey)` and leaves the
 * meaning to the caller — SermonMode reads a plain tap as "move the cursor here" (which
 * reaches the projector when output is live) and a shift-tap as "extend a range into the
 * ref builder", via `railSelect` in shared/scripture/selection.ts. The rail itself stays
 * presentational: `cuedV` marks the cursor, `selectedRange` marks a pending range, and it
 * decides neither. Mirrors SectionRail's tap-to-navigate shape. */
```

- [ ] **Step 3: Confirm the existing tests still pass**

Run: `npx vitest run src/renderer/operator/ChapterRail.test.tsx`
Expected: PASS, 2 tests. Both assert structure and the shift flag, neither asserts the hint copy.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/operator/ChapterRail.tsx
git commit -m "docs(scripture): correct ChapterRail's tap contract and hint"
```

---

### Task 8: `SermonMode` integration tests

**Files:**
- Create: `src/renderer/operator/SermonMode.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-7. Asserts against `window.helm` call sites, not internals.
- Produces: nothing.

This is the first test of `SermonMode`, and it exists because the four behaviours below are the ones that fail *in front of a congregation* if a later edit breaks them. A gitignored driver is not CI. The pattern is established — `PreServiceMode.test.tsx:39-73` mounts a whole mode component against a stubbed `window.helm` inside a `ThemeCtx.Provider`; follow its shape, including the `afterEach(cleanup)` comment about this project's vitest config not setting `globals: true`.

The stub must cover every `window.helm` surface `SermonMode` touches on mount, or effects reject and the render is useless: `settings.get` / `settings.set` (`:110`, `:170`), `schedule.list` / `schedule.add` / `schedule.remove` (`:118`, `:295`), `bibles.manifest` / `bibles.getChapter` / `bibles.bookExtent` / `bibles.onProgress` (`:124`, `:178`, `:196-208`, `:140`), and `presentation.get` / `presentation.onState` / `presentation.show` / `presentation.goLive` / `presentation.setOutput`.

`getChapter` is deliberately deferred so the guard is testable: `SermonMode` calls it twice on mount — once for the live chapter (`:178`) and once for the preview chapter (`:331`) — and both share the one pending promise, so a single `resolve` releases both.

Note the layering the first test depends on: the renderer's effect calls `window.helm.presentation.show` unconditionally once `liveChapter` resolves; the "only when output is live" decision lives in `showLive` in the main process (Task 1, already tested there). So this file asserts *whether the IPC is called*, which is exactly what the guard controls.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/operator/SermonMode.test.tsx`:

```tsx
// @vitest-environment jsdom
import { useRef } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SermonMode } from './SermonMode'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { ChapterData, PresentationState } from '../../shared/types'

// This project's vitest config does not set `globals: true`, so
// @testing-library/react's auto afterEach(cleanup) never registers; without
// this, DOM from one test leaks into the next.
afterEach(cleanup)

const GENESIS_1: ChapterData = {
  book: 'Genesis',
  chapter: 1,
  verseCount: 5,
  verses: {
    1: { kjv: 'In the beginning' },
    2: { kjv: 'And the earth was without form' },
    3: { kjv: 'And God said, Let there be light' },
    4: { kjv: 'And God saw the light' },
    5: { kjv: 'And God called the light Day' }
  }
}

const NOTHING_LIVE: PresentationState = { output: 'black', liveKey: null, liveSnap: null }
const GEN_1_1_LIVE: PresentationState = {
  output: 'live',
  liveKey: 'scr:Genesis:1:1',
  liveSnap: { kind: 'scripture', ref: 'Genesis 1:1', columns: [] }
}

function installHelmStub(pres: PresentationState = NOTHING_LIVE): {
  show: ReturnType<typeof vi.fn>
  goLive: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  resolveChapter: () => void
} {
  const show = vi.fn()
  const goLive = vi.fn()
  const add = vi.fn(() => Promise.resolve([]))
  let release: () => void = () => {}
  // One pending promise shared by both getChapter call sites (live + preview), so the
  // chapter stays unresolved until the test releases it.
  const pending = new Promise<ChapterData>((res) => {
    release = () => res(GENESIS_1)
  })
  ;(window as unknown as { helm: unknown }).helm = {
    settings: { get: () => Promise.resolve(['kjv']), set: vi.fn() },
    schedule: { list: () => Promise.resolve([]), add, remove: vi.fn(() => Promise.resolve([])) },
    bibles: {
      manifest: () => Promise.resolve([{ id: 'kjv', abbr: 'KJV', name: 'King James', installed: true }]),
      getChapter: () => pending,
      bookExtent: () => Promise.resolve({ chapters: 50, verseCounts: Array(50).fill(31) }),
      onProgress: () => () => {}
    },
    presentation: {
      get: () => Promise.resolve(pres),
      onState: () => () => {},
      show,
      goLive,
      setOutput: vi.fn(),
      cue: vi.fn()
    }
  }
  return { show, goLive, add, resolveChapter: release }
}

function Harness(): JSX.Element {
  const keyHandlerRef = useRef(null)
  return (
    <ThemeCtx.Provider value={themeFor('dark')}>
      <SermonMode
        themeMode="dark"
        keyHandlerRef={keyHandlerRef}
        active
        onOpenSettings={() => {}}
        biblesRevision={0}
      />
    </ThemeCtx.Provider>
  )
}

const entry = (): HTMLElement => screen.getByPlaceholderText('Add reading — John 3:16')
const verseCard = (n: number): HTMLElement =>
  screen.getByText(`Verse ${n}`).closest('button') as HTMLElement

describe('SermonMode — direct preview to live', () => {
  it('does not touch the projector while the chapter fetch is unresolved', async () => {
    const { show, resolveChapter } = installHelmStub()
    render(<Harness />)
    // Let every mount effect run and settle with the chapter still pending.
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy().valueOf()).catch(() => {})
    expect(show).not.toHaveBeenCalled()

    resolveChapter()
    await waitFor(() => expect(show).toHaveBeenCalled())
    expect(show.mock.calls[0][0]).toBe('scr:Genesis:1:1')
  })

  it('a rail tap shows the tapped verse and writes no schedule row', async () => {
    const { show, add, resolveChapter } = installHelmStub()
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(show).toHaveBeenCalled())
    show.mockClear()

    fireEvent.click(verseCard(3))
    await waitFor(() => expect(show).toHaveBeenCalled())
    expect(show.mock.calls[0][0]).toBe('scr:Genesis:1:3')
    expect(add).not.toHaveBeenCalled()
  })

  it('Shift+Enter on the reference already live does not blank the projector', async () => {
    const { goLive, resolveChapter } = installHelmStub(GEN_1_1_LIVE)
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    // Empty entry -> addRef is the cursor, Genesis 1:1, which is what's already live.
    fireEvent.keyDown(entry(), { key: 'Enter', shiftKey: true })
    await waitFor(() => expect(goLive).not.toHaveBeenCalled())
  })

  it('Enter files a schedule row and never reaches the projector', async () => {
    const { goLive, show, add, resolveChapter } = installHelmStub()
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    show.mockClear()

    fireEvent.keyDown(entry(), { key: 'Enter' })
    await waitFor(() => expect(add).toHaveBeenCalled())
    expect(add.mock.calls[0][0]).toEqual({ book: 'Genesis', ch: 1, from: 1, to: 1 })
    expect(goLive).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and fix the harness, not the app**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx`

Expect the first run to need harness adjustments — this is the first mount of this component under test. Legitimate fixes: a missing `window.helm` method the stub does not provide (add it), a `JSX.Element` import needed from `react`, a `waitFor` that needs a different settle condition, or the `GEN_1_1_LIVE` `liveSnap` shape needing to match the real `Slide` union for `scripture` (check `src/shared/scripture/slides.ts:17` and `src/shared/types.ts` and correct it).

The first test's `waitFor(...).catch(...)` line is a deliberate settle-and-ignore; if it reads awkwardly, replace it with an explicit settle (`await act(async () => {})`) — but the assertion that follows it, `expect(show).not.toHaveBeenCalled()`, must stay exactly as written. It is the guard.

**Not** legitimate: changing `SermonMode` to make a test pass. If a test fails on real behaviour, stop and report it — that is a genuine defect from Tasks 4-6, not a harness problem.

- [ ] **Step 3: Run the full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/operator/SermonMode.test.tsx
git commit -m "test(scripture): cover the guard, rail tap, and the two no-blank paths"
```

---

### Task 9: Real-app verification driver

**Files:**
- Create: `scratch/verify-direct-live.mjs` (untracked — `scratch/` is gitignored; nothing to commit)

**Interfaces:**
- Consumes: the whole stack — `window.helm.presentation.show` (Task 2) through the rail wiring (Tasks 5-6).
- Produces: a PASS/FAIL report.

This exercises what Task 8's jsdom tests cannot: the renderer → preload → main → stateStore → output-window path, with a real `showLive` deciding against real output state. Task 8 proves the renderer calls the right IPC; this proves the IPC does the right thing to the projector. Run it from the repo root so `playwright-core` resolves.

- [ ] **Step 1: Read the existing driver for the launch pattern**

Read `scratch/verify-bug008.mjs:1-30`. It launches Electron via `playwright-core`'s `_electron`, sleeps 6s for boot, and picks the operator window by URL. Reuse that preamble verbatim.

- [ ] **Step 2: Write the driver**

Create `scratch/verify-direct-live.mjs`:

```js
// Direct preview -> live for scripture: real-app verification. Exercises the full IPC path
// (renderer -> preload -> main -> stateStore -> output window), plus the async chapter
// fetch that the show effect's liveChapter guard exists for.
import { _electron as electron } from 'playwright-core';
import * as path from 'node:path';

const APP_DIR = '/Users/lem/repos/helm';
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_DIR],
  cwd: APP_DIR,
  timeout: 30_000,
});
await sleep(6_000);
const page = app.windows().find((w) => w.url().includes('operator')) ?? (await app.firstWindow());
const pres = () => page.evaluate(() => window.helm.presentation.get());

// The rail card for a verse: its label is "Verse N" (ChapterRail.tsx:188).
const verseCard = (n) => page.getByText(`Verse ${n}`, { exact: true }).locator('../..');
const schedCount = async () => (await page.evaluate(() => window.helm.schedule.list())).length;

// --- Land on the Sermon tab, scripture track. ---
await page.getByText('Sermon', { exact: true }).first().click();
await sleep(800);

// The schedule is persisted in SQLite and survives restarts, so every schedule assertion
// below is a delta against whatever this machine already had.
const schedBaseline = await schedCount();

// --- 1. Tapping while NOT live must not put anything on the projector. ---
await page.evaluate(() => window.helm.presentation.setOutput('black'));
await sleep(300);
await verseCard(3).click();
await sleep(500);
let st = await pres();
check('tap while black leaves the screen down', st.output === 'black', `output=${st.output}`);

// --- 2. Go live, then tap another verse in the same chapter: screen must follow. ---
await page.locator('button', { hasText: /^● Go live$/ }).click();
await sleep(500);
st = await pres();
check('Go live puts the cursor verse up', st.output === 'live', `liveKey=${st.liveKey}`);
const liveBefore = st.liveKey;

await verseCard(7).click();
await sleep(600);
st = await pres();
check('tap while live follows in-chapter', st.liveKey !== liveBefore && st.liveKey.endsWith(':7'), `liveKey=${st.liveKey}`);

// --- 3. Tapping the verse already live must NOT blank the projector. ---
await verseCard(7).click();
await sleep(500);
st = await pres();
check('tapping the live verse does not blank', st.output === 'live', `output=${st.output}`);

// --- 4. Cross-chapter jump while live: screen follows, and never shows the install hint. ---
const entry = page.getByPlaceholder('Add reading — John 3:16');
await entry.click();
await entry.pressSequentially('rom 8:1', { delay: 60 });
await sleep(400);
await verseCard(28).click();
await sleep(1_200);
st = await pres();
check('cross-chapter tap follows the screen', st.liveKey === 'scr:Romans:8:28', `liveKey=${st.liveKey}`);
const text = JSON.stringify(st.liveSnap ?? {});
check('cross-chapter tap never shows the install hint', !text.includes('Install a bible'), text.slice(0, 80));

// --- 5. Shift+Enter naming the reference already on screen must NOT blank it. ---
await entry.click();
await entry.pressSequentially('rom 8:28', { delay: 60 });
await sleep(400);
await page.keyboard.press('Shift+Enter');
await sleep(700);
st = await pres();
check('Shift+Enter on the already-live ref does not blank', st.output === 'live', `output=${st.output}`);
check('Shift+Enter leaves the same verse up', st.liveKey === 'scr:Romans:8:28', `liveKey=${st.liveKey}`);

// --- 6. The schedule must be untouched by everything above. ---
check('no direct path wrote a schedule row', (await schedCount()) === schedBaseline, `baseline ${schedBaseline}`);

// --- 7. Shift-tap builds a range; Enter files it and does NOT go live. ---
await verseCard(2).click();
await sleep(400);
const liveAtRangeStart = (await pres()).liveKey;
await verseCard(5).click({ modifiers: ['Shift'] });
await sleep(400);
check('shift-tap offers the range on the Add button', (await page.getByText(/\+ Add .*2-5/).count()) === 1);
await entry.click();
await page.keyboard.press('Enter');
await sleep(600);
check('Enter files the range', (await schedCount()) === schedBaseline + 1);
check('Enter did not move the screen', (await pres()).liveKey === liveAtRangeStart, `liveKey=${(await pres()).liveKey}`);

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
await app.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
```

- [ ] **Step 3: Run it**

Run from the repo root: `node scratch/verify-direct-live.mjs`
Expected: `12/12 passed`, exit 0.

If a locator misses, fix the locator — not the app — unless a check genuinely fails. The `Verse N` card selector walks up two parents from the label `div` to the `button` (`ChapterRail.tsx:173-188`); confirm that depth before assuming a behaviour bug. Verse 28 must exist in Romans 8, and step 4 assumes a bible is installed; if none is, install one through Settings first or step 4's hint check is vacuous.

- [ ] **Step 4: Record the outcome**

There is nothing to commit — `scratch/` is gitignored (`3730374`). Report the pass count and any check that failed, with its detail string.

---

## Post-implementation

- [ ] Run the full gate: `npm run typecheck && npm test`. Expected: clean, 412 + 19 new tests (5 from Task 1, 10 from Task 3, 4 from Task 8).
- [ ] Update `docs/superpowers/roadmap.md`: the *Direct preview → live/cue for scripture* item's 2026-07-29 update line says "spec written" — change it to record that it shipped, matching the style of the *Selectable schedule items* update at `:82-87`.
- [ ] Commit the roadmap change: `git commit -m "docs(roadmap): mark direct preview → live for scripture shipped"`.
