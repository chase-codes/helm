# Guided Scripture Reference Builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare scripture text field with a guided reference builder — a pure keyboard state machine plus click-to-select in the live verse preview — that composes readings like `James 1:1-10` with live feedback, then schedules/projects them.

**Architecture:** A new pure, unit-tested module `src/shared/scripture/refBuilder.ts` holds all builder logic as a state machine (`RefBuilderState`) with no I/O. `SermonMode` owns one `RefBuilderState`, feeds keystrokes through `applyKey`, renders the input via `renderBuilder`, drives the right-hand `ChapterRail` as a live preview (arbitrary book/chapter + a highlighted pending range), and commits via `toParsedRef` on Enter/Shift+Enter. A new `biblesRepo.bookExtent` query (surfaced over IPC, version-agnostic to the caller) supplies per-book chapter/verse counts for live clamping.

**Tech Stack:** TypeScript (strict), React (renderer), Electron IPC (contextIsolation on), better-sqlite3, Vitest + @testing-library/react.

## Global Constraints

- TS strict; **no `any` in `src/shared`**.
- IPC channel names come **only** from `CH` in `src/shared/types.ts`; never hard-code a channel string.
- `contextIsolation` stays on; renderer reaches main only through `window.helm` (the `HelmApi` surface).
- Commit messages have **NO `Co-Authored-By` trailers**.
- **better-sqlite3 dual ABI:** `npm test` needs the **Node** ABI. The main tree is currently on the Electron ABI. Run `npm rebuild better-sqlite3` before running tests, and **end on the Node ABI** so tests stay green. `npx electron-rebuild` is only for `npm run dev`.
- Character-exact fidelity when porting any styles from `docs/design/Lectern.pretty.html` (this feature adds no new ported styles; it reuses `ChapterRail`/`SchedulePanel` idioms already in the tree).
- Test files live beside their source (`foo.ts` → `foo.test.ts`; renderer `.tsx` render tests start with `// @vitest-environment jsdom`).
- Run `npm test` (Node ABI), `npm run typecheck`, and `npm run lint` green before any commit that touches source.

## File Structure

**New:**
- `src/shared/scripture/refBuilder.ts` — the pure state machine: types (`BuilderStage`, `RefBuilderState`), `initialBuilder`, `clampChapter`, `clampVerse`, `renderBuilder`, `toParsedRef`, `fromParsedRef`, `applyKey`, `setStart`, `setEnd`. Depends only on `matchBook`/`matchBookExact`/`parseRef`/`formatRef` from `refs.ts` and the `BookExtent` type. No I/O.
- `src/shared/scripture/refBuilder.test.ts` — unit tests for the above.

**Modified:**
- `src/shared/scripture/refs.ts` — add `matchBookExact` (exact-alias match, no prefix fallback).
- `src/shared/scripture/refs.test.ts` — tests for `matchBookExact`.
- `src/main/biblesRepo.ts` — add `bookExtent(book, versionId)` (no schema change; queries `verses`).
- `src/main/biblesRepo.test.ts` — tests for `bookExtent`.
- `src/shared/types.ts` — add `BookExtent`; add `CH.biblesBookExtent`; add `HelmApi.bibles.bookExtent`.
- `src/main/ipc.ts` — handle `CH.biblesBookExtent` (resolve version to first installed).
- `src/preload/index.ts` — wire `bibles.bookExtent`.
- `src/renderer/operator/ChapterRail.tsx` — preview props (`previewBook`/`previewChapter`), `selectedRange`, `onSelectVerse`.
- `src/renderer/operator/ChapterRail.test.tsx` — **new** render test for highlight + click.
- `src/renderer/operator/SchedulePanel.tsx` — input shows a controlled `value` string + paste handler; `canAdd`/`addLabel`/`onAdd`.
- `src/renderer/operator/SermonMode.tsx` — own `RefBuilderState`, extent cache, keydown → `applyKey`, Enter/Shift+Enter commit, drive rail preview + selection, click-select.

---

## Design decisions locked here (read before Task 4)

These resolve ambiguities in the spec; every task must honor them.

1. **`endVerse` sentinel is `null` until an end value is typed/clicked.** Entering the `endVerse` stage does **not** set `endVerse = startVerse` in state (the spec's "initializing" wording); instead `toParsedRef` defaults `to = endVerse ?? startVerse`. This is what makes multi-digit end entry (`-10`) work and lets `renderBuilder` show `James 1:1-` (trailing `-`, no number) before a digit is typed.
2. **Digit accumulation:** a numeric stage's value grows as `value*10 + digit`, then clamps. Entering a numeric stage leaves its value `null`, so the first digit starts fresh.
3. **`endVerse` typed digits clamp to `[1, verseMax]`** (NOT floored at `startVerse`), so typing `5`→`3` is allowed mid-edit; **`toParsedRef` normalizes** `from = min`, `to = max`. Click gestures (`setEnd`) **do** normalize in state immediately (a click is a discrete gesture where showing `3-5` is clearly right).
4. **Enter with no start verse** (at `chapter` stage, chapter set) commits `from = to = 1` (spec §9). Enter before a chapter is set → `toParsedRef` returns `null` → no-op.
5. **Numbered-book advancement** on Space requires an **exact** alias match (`matchBookExact`) when the query contains a digit, to avoid `"1"` prefix-resolving to `"1 Samuel"`. Non-numbered queries keep today's prefix completion (`jame`→`James`).
6. **`applyKey` swallows every single-character key** (`preventDefault: true`) so the input value is fully controlled by state; only paste flows through `onChange`. `applyKey` does **not** handle `Enter`/`Escape` — `SermonMode` handles those before delegating.

`EMPTY_EXTENT` = `{ chapters: 0, verseCounts: [] }` is exported from `refBuilder.ts` for callers.

---

## Task 1: `matchBookExact` in refs.ts

**Files:**
- Modify: `src/shared/scripture/refs.ts`
- Test: `src/shared/scripture/refs.test.ts`

**Interfaces:**
- Produces: `matchBookExact(token: string): string | null` — returns the canonical book name only when `norm(token)` is an **exact alias** of a book; no prefix fallback. `matchBook` is unchanged.

- [ ] **Step 1: Write the failing test** — append to `src/shared/scripture/refs.test.ts`:

```ts
import { matchBook, matchBookExact, parseRef, formatRef } from './refs'

test('matchBookExact matches exact aliases only, no prefix', () => {
  expect(matchBookExact('jn')).toBe('John')
  expect(matchBookExact('1john')).toBe('1 John')
  expect(matchBookExact('1 john')).toBe('1 John')
  expect(matchBookExact('2 cor')).toBe('2 Corinthians')
  // prefix-only inputs that matchBook would resolve must NOT resolve here
  expect(matchBookExact('1')).toBeNull()
  expect(matchBookExact('gene')).toBeNull()
  expect(matchBookExact('zzz')).toBeNull()
})
```

(Update the existing top-of-file import line to include `matchBookExact`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm rebuild better-sqlite3 && npx vitest run src/shared/scripture/refs.test.ts`
Expected: FAIL — `matchBookExact is not a function`.

- [ ] **Step 3: Write minimal implementation** — in `src/shared/scripture/refs.ts`, add after `matchBook`:

```ts
export function matchBookExact(token: string): string | null {
  const t = norm(token)
  if (!t) return null
  for (const b of BOOKS) if (b.aliases.includes(t)) return b.name
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/scripture/refs.test.ts`
Expected: PASS (all refs tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/scripture/refs.ts src/shared/scripture/refs.test.ts
git commit -m "feat(refs): add matchBookExact (exact-alias match, no prefix)"
```

---

## Task 2: refBuilder types, `initialBuilder`, clamps, `renderBuilder`

**Files:**
- Create: `src/shared/scripture/refBuilder.ts`
- Create: `src/shared/scripture/refBuilder.test.ts`

**Interfaces:**
- Consumes: `BookExtent` from `../types` (added in Task 6 — for now declare a local import; Task 6 lands the type. To keep this task self-contained and compiling, **define `BookExtent` in `types.ts` as the very first step of this task** — see Step 0.)
- Produces:
  - `type BuilderStage = 'book' | 'chapter' | 'verse' | 'endVerse'`
  - `interface RefBuilderState { stage: BuilderStage; bookQuery: string; book: string | null; chapter: number | null; startVerse: number | null; endVerse: number | null }`
  - `const EMPTY_EXTENT: BookExtent`
  - `initialBuilder(): RefBuilderState`
  - `clampChapter(n: number, extent: BookExtent): number` — clamp to `[1, extent.chapters]`; returns `0` when `extent.chapters < 1` (caller treats `< 1` as "no valid chapter").
  - `clampVerse(n: number, chapter: number, extent: BookExtent): number` — clamp to `[1, extent.verseCounts[chapter-1] ?? 0]`; returns `0` when the max is `< 1`.
  - `renderBuilder(state: RefBuilderState): string`

- [ ] **Step 0: Add `BookExtent` to types** — in `src/shared/types.ts`, after the `ChapterData` interface (line ~61) add:

```ts
export interface BookExtent { chapters: number; verseCounts: number[] } // verseCounts[chapterIndex0] = verses in chapter (index+1)
```

- [ ] **Step 1: Write the failing test** — create `src/shared/scripture/refBuilder.test.ts`:

```ts
import { expect, test } from 'vitest'
import type { BookExtent } from '../types'
import {
  EMPTY_EXTENT,
  initialBuilder,
  clampChapter,
  clampVerse,
  renderBuilder,
  type RefBuilderState
} from './refBuilder'

const james: BookExtent = { chapters: 5, verseCounts: [27, 26, 18, 17, 20] }

test('initialBuilder starts empty at the book stage', () => {
  expect(initialBuilder()).toEqual({
    stage: 'book', bookQuery: '', book: null, chapter: null, startVerse: null, endVerse: null
  })
})

test('clampChapter clamps to [1, chapters]; 0 when no chapters', () => {
  expect(clampChapter(3, james)).toBe(3)
  expect(clampChapter(9, james)).toBe(5)
  expect(clampChapter(0, james)).toBe(1)
  expect(clampChapter(3, EMPTY_EXTENT)).toBe(0)
})

test('clampVerse clamps to [1, verseCount(chapter)]; 0 when unknown', () => {
  expect(clampVerse(10, 1, james)).toBe(10)
  expect(clampVerse(99, 1, james)).toBe(27)
  expect(clampVerse(5, 2, james)).toBe(5)
  expect(clampVerse(0, 1, james)).toBe(1)
  expect(clampVerse(5, 9, james)).toBe(0) // chapter out of range
})

test('renderBuilder renders each stage', () => {
  const at = (s: Partial<RefBuilderState>): string => renderBuilder({ ...initialBuilder(), ...s })
  expect(at({ stage: 'book', bookQuery: 'Jame' })).toBe('Jame')
  expect(at({ stage: 'book', bookQuery: '' })).toBe('')
  expect(at({ stage: 'chapter', book: 'James', chapter: null })).toBe('James')
  expect(at({ stage: 'chapter', book: 'James', chapter: 1 })).toBe('James 1')
  expect(at({ stage: 'verse', book: 'James', chapter: 1, startVerse: null })).toBe('James 1:')
  expect(at({ stage: 'verse', book: 'James', chapter: 1, startVerse: 1 })).toBe('James 1:1')
  expect(at({ stage: 'endVerse', book: 'James', chapter: 1, startVerse: 1, endVerse: null })).toBe('James 1:1-')
  expect(at({ stage: 'endVerse', book: 'James', chapter: 1, startVerse: 1, endVerse: 10 })).toBe('James 1:1-10')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm rebuild better-sqlite3 && npx vitest run src/shared/scripture/refBuilder.test.ts`
Expected: FAIL — cannot find module `./refBuilder`.

- [ ] **Step 3: Write minimal implementation** — create `src/shared/scripture/refBuilder.ts`:

```ts
import type { BookExtent } from '../types'
import { matchBook, matchBookExact, parseRef, type ParsedRef } from './refs'

export type BuilderStage = 'book' | 'chapter' | 'verse' | 'endVerse'
export interface RefBuilderState {
  stage: BuilderStage
  bookQuery: string
  book: string | null
  chapter: number | null
  startVerse: number | null
  endVerse: number | null
}

export const EMPTY_EXTENT: BookExtent = { chapters: 0, verseCounts: [] }

export function initialBuilder(): RefBuilderState {
  return { stage: 'book', bookQuery: '', book: null, chapter: null, startVerse: null, endVerse: null }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

export function clampChapter(n: number, extent: BookExtent): number {
  return clamp(n, 1, extent.chapters)
}
export function clampVerse(n: number, chapter: number, extent: BookExtent): number {
  return clamp(n, 1, extent.verseCounts[chapter - 1] ?? 0)
}

export function renderBuilder(s: RefBuilderState): string {
  if (s.book === null) return s.bookQuery
  let out = s.book
  if (s.chapter === null) return out
  out += ` ${s.chapter}`
  if (s.stage === 'chapter') return out
  out += ':'
  if (s.startVerse !== null) out += s.startVerse
  if (s.stage !== 'endVerse') return out
  out += '-'
  if (s.endVerse !== null) out += s.endVerse
  return out
}
```

Note: `matchBook`/`matchBookExact`/`parseRef`/`ParsedRef` are imported now; they are used by later tasks in this same file. If lint flags them as unused at this checkpoint, add them in Task 3/4 instead — but since those tasks land in the same branch immediately, importing now is fine. To keep this commit lint-clean on its own, **import only what this task uses** and add the rest in Task 3:

```ts
import type { BookExtent } from '../types'
```

(Drop the `refs` import from this commit; Task 3 adds it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/scripture/refBuilder.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/scripture/refBuilder.ts src/shared/scripture/refBuilder.test.ts src/shared/types.ts
git commit -m "feat(refBuilder): types, initialBuilder, clamps, renderBuilder"
```

---

## Task 3: `toParsedRef` / `fromParsedRef`

**Files:**
- Modify: `src/shared/scripture/refBuilder.ts`
- Test: `src/shared/scripture/refBuilder.test.ts`

**Interfaces:**
- Consumes: `RefBuilderState`, `initialBuilder`; `ParsedRef` from `refs.ts`.
- Produces:
  - `toParsedRef(state: RefBuilderState): ParsedRef | null` — `null` unless `book` and `chapter` are set. `from = startVerse ?? 1`; `end = endVerse ?? from`; result normalized `from = min, to = max`.
  - `fromParsedRef(p: ParsedRef): RefBuilderState` — `{ stage: p.to > p.from ? 'endVerse' : 'verse', bookQuery: '', book: p.book, chapter: p.ch, startVerse: p.from, endVerse: p.to > p.from ? p.to : null }`.

- [ ] **Step 1: Write the failing test** — append to `refBuilder.test.ts`:

```ts
import { toParsedRef, fromParsedRef } from './refBuilder'

test('toParsedRef requires book + chapter', () => {
  expect(toParsedRef({ ...initialBuilder(), stage: 'book', bookQuery: 'jam' })).toBeNull()
  expect(toParsedRef({ ...initialBuilder(), stage: 'chapter', book: 'James', chapter: null })).toBeNull()
})

test('toParsedRef: chapter with no verse commits from=to=1', () => {
  expect(toParsedRef({ ...initialBuilder(), stage: 'chapter', book: 'James', chapter: 3 }))
    .toEqual({ book: 'James', ch: 3, from: 1, to: 1 })
})

test('toParsedRef: single verse and range', () => {
  expect(toParsedRef({ ...initialBuilder(), stage: 'verse', book: 'James', chapter: 1, startVerse: 5 }))
    .toEqual({ book: 'James', ch: 1, from: 5, to: 5 })
  expect(toParsedRef({ ...initialBuilder(), stage: 'endVerse', book: 'James', chapter: 1, startVerse: 1, endVerse: 10 }))
    .toEqual({ book: 'James', ch: 1, from: 1, to: 10 })
})

test('toParsedRef normalizes an inverted range', () => {
  expect(toParsedRef({ ...initialBuilder(), stage: 'endVerse', book: 'James', chapter: 1, startVerse: 8, endVerse: 3 }))
    .toEqual({ book: 'James', ch: 1, from: 3, to: 8 })
})

test('fromParsedRef loads single and range refs', () => {
  expect(fromParsedRef({ book: 'John', ch: 3, from: 16, to: 16 }))
    .toEqual({ stage: 'verse', bookQuery: '', book: 'John', chapter: 3, startVerse: 16, endVerse: null })
  expect(fromParsedRef({ book: 'Genesis', ch: 1, from: 1, to: 10 }))
    .toEqual({ stage: 'endVerse', bookQuery: '', book: 'Genesis', chapter: 1, startVerse: 1, endVerse: 10 })
})

test('round-trip toParsedRef(fromParsedRef(p)) === p', () => {
  for (const p of [
    { book: 'John', ch: 3, from: 16, to: 16 },
    { book: 'Genesis', ch: 1, from: 1, to: 10 }
  ]) expect(toParsedRef(fromParsedRef(p))).toEqual(p)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/scripture/refBuilder.test.ts`
Expected: FAIL — `toParsedRef is not a function`.

- [ ] **Step 3: Write minimal implementation** — in `refBuilder.ts`, add the `refs` import at top and the two functions:

```ts
import { matchBook, matchBookExact, parseRef, type ParsedRef } from './refs'
```

```ts
export function toParsedRef(s: RefBuilderState): ParsedRef | null {
  if (s.book === null || s.chapter === null) return null
  const from0 = s.startVerse ?? 1
  const end0 = s.endVerse ?? from0
  return { book: s.book, ch: s.chapter, from: Math.min(from0, end0), to: Math.max(from0, end0) }
}

export function fromParsedRef(p: ParsedRef): RefBuilderState {
  const isRange = p.to > p.from
  return {
    stage: isRange ? 'endVerse' : 'verse',
    bookQuery: '',
    book: p.book,
    chapter: p.ch,
    startVerse: p.from,
    endVerse: isRange ? p.to : null
  }
}
```

(If lint reports `matchBook`/`matchBookExact`/`parseRef` unused, they are consumed in Task 4 — but Task 4 lands next in the same branch. To keep this commit lint-clean, import only `type ParsedRef` here and add the value imports in Task 4.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/scripture/refBuilder.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/scripture/refBuilder.ts src/shared/scripture/refBuilder.test.ts
git commit -m "feat(refBuilder): toParsedRef/fromParsedRef with range normalization"
```

---

## Task 4: `applyKey` — transitions, digit clamping, backspace

**Files:**
- Modify: `src/shared/scripture/refBuilder.ts`
- Test: `src/shared/scripture/refBuilder.test.ts`

**Interfaces:**
- Consumes: `RefBuilderState`, clamps, `matchBook`, `matchBookExact`; `BookExtent`.
- Produces: `applyKey(state: RefBuilderState, key: string, shift: boolean, extent: BookExtent): { state: RefBuilderState; preventDefault: boolean }`.
  - `key` is a `KeyboardEvent.key` value. `applyKey` handles `Backspace` and single-character keys (`key.length === 1`). It never handles `Enter`/`Escape` (returns state unchanged, `preventDefault: false`). `shift` is currently unused by `applyKey` (Enter/Shift+Enter live in `SermonMode`); accept it for signature stability.

Behavior (honor the locked decisions):
- **Any `key.length === 1`** → `preventDefault: true` (swallow), even if it produces no state change.
- **book stage:**
  - letters/digits (`/^[a-z0-9]$/i`) → append to `bookQuery`.
  - `' '` (space): let `q = bookQuery`, `b = matchBook(q)`. Advance (`book = b`, `bookQuery = ''`, `chapter = null`, `stage = 'chapter'`) when `b !== null && (!/\d/.test(q) || matchBookExact(q) !== null)`. Else if `/\d/.test(q)` → append a literal `' '` to `bookQuery` (numbered book still being typed). Else no change.
  - `:` / `-` / other single chars → no state change (still swallowed).
- **chapter stage:**
  - digit `d` → `chapter = clampChapter((chapter ?? 0) * 10 + d, extent) || null` (map `0`→`null`).
  - `' '` or `':'` → if `chapter !== null` advance to `verse` (`startVerse` stays `null`).
  - letters/`-`/others → no change.
- **verse stage:**
  - digit `d` → `startVerse = clampVerse((startVerse ?? 0) * 10 + d, chapter, extent) || null`.
  - `' '` or `'-'` → if `startVerse !== null` advance to `endVerse` (`endVerse` stays `null`).
  - `':'`/letters/others → no change.
- **endVerse stage:**
  - digit `d` → `endVerse = clampVerse((endVerse ?? 0) * 10 + d, chapter, extent) || null`.
  - `' '`/`-`/`:`/letters/others → no change.
- **Backspace** (`preventDefault: true`):
  - book: if `bookQuery !== ''` → drop last char. Else no change.
  - chapter: if `chapter === null` → step back to book (`stage: 'book'`, `book: null`, `bookQuery: <the resolved book name>`, `chapter: null`). Else `chapter = Math.floor(chapter / 10) || null`.
  - verse: if `startVerse === null` → step back to chapter (`stage: 'chapter'`). Else `startVerse = Math.floor(startVerse / 10) || null`.
  - endVerse: if `endVerse === null` → step back to verse (`stage: 'verse'`). Else `endVerse = Math.floor(endVerse / 10) || null`.

- [ ] **Step 1: Write the failing test** — append to `refBuilder.test.ts`:

```ts
import { applyKey, EMPTY_EXTENT } from './refBuilder'

const james: BookExtent2 = { chapters: 5, verseCounts: [27, 26, 18, 17, 20] } // see alias below

// (reuse the `james` const already defined at the top of this file; the line above is
// illustrative — do NOT redeclare it. Remove this comment block when writing.)

// Helper: feed a string of single-char keys through applyKey.
function type(s: RefBuilderState, keys: string, extent: BookExtent): RefBuilderState {
  let st = s
  for (const k of keys) st = applyKey(st, k, false, extent).state
  return st
}

test('space swallowed at every stage', () => {
  expect(applyKey(initialBuilder(), ' ', false, james).preventDefault).toBe(true)
})

test('book: prefix completion advances (jame -> James)', () => {
  const st = applyKey(type(initialBuilder(), 'jame', james), ' ', false, james).state
  expect(st).toMatchObject({ stage: 'chapter', book: 'James', bookQuery: '' })
})

test('book: unresolved space stays in book', () => {
  const st = applyKey(type(initialBuilder(), 'zz', james), ' ', false, james).state
  expect(st.stage).toBe('book')
  expect(st.book).toBeNull()
})

test('book: numbered book via exact alias advances (1john -> 1 John)', () => {
  const st = applyKey(type(initialBuilder(), '1john', james), ' ', false, james).state
  expect(st).toMatchObject({ stage: 'chapter', book: '1 John' })
})

test('book: bare "1" + space does NOT jump to 1 Samuel; inserts a literal space', () => {
  const st = applyKey(type(initialBuilder(), '1', james), ' ', false, james).state
  expect(st.stage).toBe('book')
  expect(st.book).toBeNull()
  expect(st.bookQuery).toBe('1 ')
})

test('chapter digits clamp to max', () => {
  let st = applyKey(type(initialBuilder(), 'jame', james), ' ', false, james).state // -> chapter
  st = type(st, '9', james)
  expect(st.chapter).toBe(5) // clamped from 9 to 5
})

test('full typed range James 1:1-10 with clamping', () => {
  let st = applyKey(type(initialBuilder(), 'james', james), ' ', false, james).state
  st = applyKey(type(st, '1', james), ' ', false, james).state // chapter 1 -> verse
  st = applyKey(type(st, '1', james), ' ', false, james).state // start 1 -> endVerse
  st = type(st, '10', james)
  expect(renderBuilder(st)).toBe('James 1:1-10')
  expect(toParsedRef(st)).toEqual({ book: 'James', ch: 1, from: 1, to: 10 })
})

test('colon and hyphen advance like space', () => {
  let st = applyKey(type(initialBuilder(), 'james', james), ' ', false, james).state
  st = type(st, '1', james)
  st = applyKey(st, ':', false, james).state // -> verse
  expect(st.stage).toBe('verse')
  st = type(st, '2', james)
  st = applyKey(st, '-', false, james).state // -> endVerse
  expect(st.stage).toBe('endVerse')
})

test('verse clamps to chapter verse count', () => {
  let st = applyKey(type(initialBuilder(), 'james', james), ' ', false, james).state
  st = applyKey(type(st, '1', james), ' ', false, james).state // chapter 1 -> verse
  st = type(st, '99', james)
  expect(st.startVerse).toBe(27) // James 1 has 27 verses
})

test('backspace deletes within a numeric token then steps back', () => {
  let st = applyKey(type(initialBuilder(), 'james', james), ' ', false, james).state
  st = type(st, '12', james) // chapter clamps: 1 -> 12 -> clamp 5
  expect(st.chapter).toBe(5)
  st = applyKey(st, 'Backspace', false, james).state // 5 -> null? Math.floor(5/10)=0 -> null
  expect(st.chapter).toBeNull()
  st = applyKey(st, 'Backspace', false, james).state // empty chapter -> step back to book
  expect(st.stage).toBe('book')
  expect(st.book).toBeNull()
  expect(st.bookQuery).toBe('James')
})

test('no extent: cannot advance past chapter clamp', () => {
  const st = type(applyKey(type(initialBuilder(), 'james', EMPTY_EXTENT), ' ', false, EMPTY_EXTENT).state, '3', EMPTY_EXTENT)
  expect(st.chapter).toBeNull() // clampChapter(3, EMPTY) === 0 -> null
})
```

When writing, **remove the `BookExtent2`/redeclare comment scaffolding** — reuse the `james` const declared at the top of the file (Task 2), and add a `import type { BookExtent } from '../types'` if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/scripture/refBuilder.test.ts`
Expected: FAIL — `applyKey is not a function`.

- [ ] **Step 3: Write minimal implementation** — in `refBuilder.ts`, ensure the value imports exist:

```ts
import { matchBook, matchBookExact, parseRef, type ParsedRef } from './refs'
```

(`parseRef` stays imported for `SermonMode`'s paste path re-export convenience? No — `parseRef` is used directly in `SermonMode`, not here. Import only `matchBook, matchBookExact, type ParsedRef`.)

Add:

```ts
type Applied = { state: RefBuilderState; preventDefault: boolean }
const isDigit = (k: string): boolean => k >= '0' && k <= '9'
const isAlnum = (k: string): boolean => /^[a-z0-9]$/i.test(k)

export function applyKey(s: RefBuilderState, key: string, _shift: boolean, extent: BookExtent): Applied {
  if (key === 'Backspace') return { state: backspace(s), preventDefault: true }
  if (key.length !== 1) return { state: s, preventDefault: false }
  return { state: printable(s, key, extent), preventDefault: true }
}

function printable(s: RefBuilderState, key: string, extent: BookExtent): RefBuilderState {
  switch (s.stage) {
    case 'book': {
      if (key === ' ') {
        const q = s.bookQuery
        const b = matchBook(q)
        if (b !== null && (!/\d/.test(q) || matchBookExact(q) !== null)) {
          return { ...s, stage: 'chapter', book: b, bookQuery: '', chapter: null }
        }
        if (/\d/.test(q)) return { ...s, bookQuery: q + ' ' }
        return s
      }
      if (isAlnum(key)) return { ...s, bookQuery: s.bookQuery + key }
      return s
    }
    case 'chapter': {
      if (isDigit(key)) {
        const c = clampChapter((s.chapter ?? 0) * 10 + Number(key), extent)
        return { ...s, chapter: c || null }
      }
      if ((key === ' ' || key === ':') && s.chapter !== null) return { ...s, stage: 'verse' }
      return s
    }
    case 'verse': {
      if (isDigit(key) && s.chapter !== null) {
        const v = clampVerse((s.startVerse ?? 0) * 10 + Number(key), s.chapter, extent)
        return { ...s, startVerse: v || null }
      }
      if ((key === ' ' || key === '-') && s.startVerse !== null) return { ...s, stage: 'endVerse' }
      return s
    }
    case 'endVerse': {
      if (isDigit(key) && s.chapter !== null) {
        const v = clampVerse((s.endVerse ?? 0) * 10 + Number(key), s.chapter, extent)
        return { ...s, endVerse: v || null }
      }
      return s
    }
  }
}

function backspace(s: RefBuilderState): RefBuilderState {
  switch (s.stage) {
    case 'book':
      return s.bookQuery ? { ...s, bookQuery: s.bookQuery.slice(0, -1) } : s
    case 'chapter':
      if (s.chapter === null) return { ...s, stage: 'book', book: null, bookQuery: s.book ?? '', chapter: null }
      return { ...s, chapter: Math.floor(s.chapter / 10) || null }
    case 'verse':
      if (s.startVerse === null) return { ...s, stage: 'chapter' }
      return { ...s, startVerse: Math.floor(s.startVerse / 10) || null }
    case 'endVerse':
      if (s.endVerse === null) return { ...s, stage: 'verse' }
      return { ...s, endVerse: Math.floor(s.endVerse / 10) || null }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/scripture/refBuilder.test.ts && npm run typecheck && npm run lint`
Expected: PASS; typecheck + lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/scripture/refBuilder.ts src/shared/scripture/refBuilder.test.ts
git commit -m "feat(refBuilder): applyKey state machine (transitions, clamping, backspace)"
```

---

## Task 5: `setStart` / `setEnd` (click-select helpers)

**Files:**
- Modify: `src/shared/scripture/refBuilder.ts`
- Test: `src/shared/scripture/refBuilder.test.ts`

**Interfaces:**
- Produces:
  - `setStart(state, v, extent): RefBuilderState` — requires `chapter !== null` (else returns state unchanged). Sets `startVerse = clampVerse(v)`, `endVerse = null`, `stage = 'verse'`.
  - `setEnd(state, v, extent): RefBuilderState` — requires `chapter !== null && startVerse !== null` (else unchanged). Clamps `e = clampVerse(v)`; sets `startVerse = min(startVerse, e)`, `endVerse = max(startVerse, e)`, `stage = 'endVerse'` (normalized immediately).

- [ ] **Step 1: Write the failing test** — append to `refBuilder.test.ts`:

```ts
import { setStart, setEnd } from './refBuilder'

const base: RefBuilderState = { stage: 'verse', bookQuery: '', book: 'James', chapter: 1, startVerse: 3, endVerse: null }

test('setStart sets a fresh single-verse selection', () => {
  expect(setStart(base, 7, james)).toMatchObject({ stage: 'verse', startVerse: 7, endVerse: null })
})

test('setStart clamps to chapter verse count', () => {
  expect(setStart(base, 99, james).startVerse).toBe(27)
})

test('setEnd builds an ascending range', () => {
  expect(setEnd({ ...base, startVerse: 3 }, 9, james)).toMatchObject({ stage: 'endVerse', startVerse: 3, endVerse: 9 })
})

test('setEnd normalizes when the end is below the start', () => {
  expect(setEnd({ ...base, startVerse: 8 }, 3, james)).toMatchObject({ startVerse: 3, endVerse: 8 })
})

test('setStart/setEnd no-op without a chapter/start', () => {
  const noChapter: RefBuilderState = { ...initialBuilder(), book: 'James' }
  expect(setStart(noChapter, 5, james)).toBe(noChapter)
  const noStart: RefBuilderState = { ...base, startVerse: null }
  expect(setEnd(noStart, 5, james)).toBe(noStart)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/scripture/refBuilder.test.ts`
Expected: FAIL — `setStart is not a function`.

- [ ] **Step 3: Write minimal implementation** — in `refBuilder.ts`:

```ts
export function setStart(s: RefBuilderState, v: number, extent: BookExtent): RefBuilderState {
  if (s.chapter === null) return s
  const start = clampVerse(v, s.chapter, extent)
  return { ...s, stage: 'verse', startVerse: start || null, endVerse: null }
}

export function setEnd(s: RefBuilderState, v: number, extent: BookExtent): RefBuilderState {
  if (s.chapter === null || s.startVerse === null) return s
  const e = clampVerse(v, s.chapter, extent)
  if (!e) return s
  return { ...s, stage: 'endVerse', startVerse: Math.min(s.startVerse, e), endVerse: Math.max(s.startVerse, e) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/scripture/refBuilder.test.ts && npm run typecheck && npm run lint`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/scripture/refBuilder.ts src/shared/scripture/refBuilder.test.ts
git commit -m "feat(refBuilder): setStart/setEnd click-select helpers"
```

---

## Task 6: `biblesRepo.bookExtent`

**Files:**
- Modify: `src/main/biblesRepo.ts`
- Test: `src/main/biblesRepo.test.ts`

**Interfaces:**
- Consumes: `BookExtent` from `../shared/types`.
- Produces: `BiblesRepo.bookExtent(book: string, versionId: string): BookExtent` — one query:
  `SELECT chapter, MAX(verse) AS mv FROM verses WHERE version_id=? AND book=? GROUP BY chapter ORDER BY chapter`, mapped to `{ chapters: rows.length, verseCounts: rows.map(r => r.mv) }`. Unknown/empty book → `{ chapters: 0, verseCounts: [] }`.

- [ ] **Step 1: Write the failing test** — append to `src/main/biblesRepo.test.ts`. First extend the `kjv` fixture with a small multi-chapter book so counts are non-trivial; add a `Jude`-like book to the existing `kjv.books` array **or** add a new fixture. To avoid disturbing existing assertions, add a dedicated fixture and install it:

```ts
const multi: NormalizedBible = {
  id: 'kjvx',
  abbr: 'KJVX',
  name: 'KJV Extra',
  language: 'en',
  books: [
    {
      name: 'James',
      chapters: [
        { n: 1, verses: [{ n: 1, text: 'a' }, { n: 2, text: 'b' }, { n: 3, text: 'c' }] },
        { n: 2, verses: [{ n: 1, text: 'd' }, { n: 2, text: 'e' }] }
      ]
    }
  ]
}

test('bookExtent returns chapter count and per-chapter verse counts', () => {
  repo.install(multi)
  const ext = repo.bookExtent('James', 'kjvx')
  expect(ext).toEqual({ chapters: 2, verseCounts: [3, 2] })
})

test('bookExtent returns {0, []} for an unknown book', () => {
  repo.install(multi)
  expect(repo.bookExtent('Nahum', 'kjvx')).toEqual({ chapters: 0, verseCounts: [] })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm rebuild better-sqlite3 && npx vitest run src/main/biblesRepo.test.ts`
Expected: FAIL — `repo.bookExtent is not a function`.

- [ ] **Step 3: Write minimal implementation** — in `src/main/biblesRepo.ts`:

Add to the `BiblesRepo` interface:

```ts
  bookExtent(book: string, versionId: string): BookExtent
```

Import the type:

```ts
import type { BookExtent, ChapterData, InstalledVersion, NormalizedBible } from '../shared/types'
```

Add a prepared statement near the others:

```ts
  const selectExtent = db.prepare(
    'SELECT chapter, MAX(verse) AS mv FROM verses WHERE version_id = ? AND book = ? GROUP BY chapter ORDER BY chapter'
  )
```

Add the method to the returned object:

```ts
    bookExtent(book, versionId) {
      const rows = selectExtent.all(versionId, book) as { chapter: number; mv: number }[]
      return { chapters: rows.length, verseCounts: rows.map((r) => r.mv) }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/biblesRepo.test.ts && npm run typecheck`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/biblesRepo.ts src/main/biblesRepo.test.ts
git commit -m "feat(biblesRepo): bookExtent query for per-book chapter/verse counts"
```

---

## Task 7: IPC + preload wiring for `bookExtent`

**Files:**
- Modify: `src/shared/types.ts` (CH + HelmApi)
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Produces: `CH.biblesBookExtent = 'bibles:bookExtent'`; `HelmApi.bibles.bookExtent(book: string): Promise<BookExtent>` (version-agnostic to the caller — the main handler resolves the version). Consumed by `SermonMode` in Task 10.

- [ ] **Step 1: Add the channel + API type** — in `src/shared/types.ts`:

In the `CH` object, beside `biblesGetChapter`:

```ts
  biblesGetChapter: 'bibles:getChapter',
  biblesBookExtent: 'bibles:bookExtent',
```

In `HelmApi.bibles`, beside `getChapter`:

```ts
    getChapter(book: string, chapter: number): Promise<ChapterData>;
    bookExtent(book: string): Promise<BookExtent>;
```

- [ ] **Step 2: Wire the main handler** — in `src/main/ipc.ts`, after the `biblesGetChapter` handler:

```ts
  ipcMain.handle(CH.biblesBookExtent, (_e, book: string) => {
    // Version-agnostic to the caller: chapter/verse counts are canonically stable across
    // the KJV-family translations for clamping, so resolve to the first installed version
    // (or return {0, []} when none is installed — the builder then can't advance past book).
    const versionId = biblesRepo.installed()[0]?.id
    return versionId ? biblesRepo.bookExtent(book, versionId) : { chapters: 0, verseCounts: [] }
  })
```

- [ ] **Step 3: Wire preload** — in `src/preload/index.ts`, in `bibles`:

```ts
    getChapter: (book, chapter) => ipcRenderer.invoke(CH.biblesGetChapter, book, chapter),
    bookExtent: (book) => ipcRenderer.invoke(CH.biblesBookExtent, book),
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck && npm run lint`
Expected: clean (no unit test — this is IPC glue; the type surface must compile end-to-end).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/ipc.ts src/preload/index.ts
git commit -m "feat(ipc): bibles.bookExtent channel (version-resolved in main)"
```

---

## Task 8: `ChapterRail` preview + selection props

**Files:**
- Modify: `src/renderer/operator/ChapterRail.tsx`
- Test (create): `src/renderer/operator/ChapterRail.test.tsx`

**Interfaces:**
- Produces (new props on `ChapterRailProps`):
  - `selectedRange: { from: number; to: number } | null` — pending builder range to highlight, distinct from CUED/LIVE.
  - `onSelectVerse: (v: number, shift: boolean) => void` — click handler; `SermonMode` maps it to `setStart`/`setEnd`.
  - The rail already receives `book`/`ch`/`verseCount`/`previewOf` from `SermonMode`; in Task 10 `SermonMode` passes the **preview** book/chapter/verseCount/text through these existing props, so `ChapterRail` needs no `previewBook`/`previewChapter` of its own — it just renders whatever `book`/`ch`/`verseCount`/`previewOf` it is given and adds range highlighting + shift-aware clicks. Keep the existing `onSelect(v)` for the CUED jump semantics **or** fold it into `onSelectVerse`. **Decision:** replace `onSelect` with `onSelectVerse(v, shift)`; `SermonMode` decides whether a click cues or builds.

- [ ] **Step 1: Write the failing render test** — create `src/renderer/operator/ChapterRail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChapterRail } from './ChapterRail'
import { themeFor } from '../../shared/theme'

const baseProps = {
  theme: themeFor('dark'),
  dark: true,
  width: 330,
  book: 'James',
  ch: 1,
  verseCount: 5,
  plannedSet: new Set<number>(),
  cuedV: 1,
  isVerseLive: () => false,
  previewOf: (v: number) => `verse ${v} text`,
  selectedRange: { from: 2, to: 4 } as { from: number; to: number } | null,
  onSelectVerse: vi.fn()
}

describe('ChapterRail', () => {
  it('marks verses inside selectedRange as selected', () => {
    render(<ChapterRail {...baseProps} />)
    const selected = document.querySelectorAll('[data-selected="true"]')
    expect(selected.length).toBe(3) // verses 2,3,4
  })

  it('fires onSelectVerse with the shift flag', () => {
    const onSelectVerse = vi.fn()
    render(<ChapterRail {...baseProps} onSelectVerse={onSelectVerse} />)
    const v3 = screen.getByText('verse 3 text').closest('button') as HTMLButtonElement
    fireEvent.click(v3, { shiftKey: true })
    expect(onSelectVerse).toHaveBeenCalledWith(3, true)
  })
})
```

(`themeFor(mode, tone)` in `src/shared/theme.ts` returns a `Theme`; `themeFor('dark')` is the dark theme. The test's point is the two `data-selected`/shift assertions.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm rebuild better-sqlite3 && npx vitest run src/renderer/operator/ChapterRail.test.tsx`
Expected: FAIL — props `selectedRange`/`onSelectVerse` don't exist; no `data-selected`.

- [ ] **Step 3: Implement** — edit `src/renderer/operator/ChapterRail.tsx`:

Update `ChapterRailProps`: remove `onSelect`, add:

```ts
  selectedRange: { from: number; to: number } | null;
  onSelectVerse: (v: number, shift: boolean) => void;
```

In the component signature, replace `onSelect` with `selectedRange, onSelectVerse`.

Add a selected-state style and mark each row. Compute per verse:

```tsx
const selected = selectedRange !== null && v >= selectedRange.from && v <= selectedRange.to
```

Give the selected verse a distinct highlight (reuse `T.scripture` but stronger than `planned`, distinct from cued/live). Add to `rowStyle` a `selected` branch (highest visual priority below live), e.g. a solid inset ring:

```tsx
const rowStyle = (isLive: boolean, isCued: boolean, planned: boolean, selected: boolean): CSSProperties => ({
  display: 'block', width: '100%', textAlign: 'left', padding: '11px 13px', borderRadius: '11px', cursor: 'pointer',
  background: selected
    ? (dark ? 'rgba(111,156,240,.18)' : 'rgba(63,107,181,.14)')
    : isLive ? (dark ? 'rgba(111,156,240,.14)' : 'rgba(63,107,181,.11)')
    : isCued ? (dark ? 'rgba(111,156,240,.09)' : 'rgba(63,107,181,.07)')
    : planned ? (dark ? 'rgba(111,156,240,.05)' : 'rgba(63,107,181,.045)')
    : T.panel2,
  boxShadow: selected
    ? `inset 0 0 0 2px ${T.scripture}`
    : isLive ? `inset 0 0 0 2px ${T.scripture}`
    : isCued ? `inset 0 0 0 1.5px ${T.scripture}66`
    : planned ? `inset 0 0 0 1px ${T.scripture}44`
    : `inset 0 0 0 1px ${T.hairline}`
})
```

Render the button with the flag, a `data-selected` attribute, and the shift-aware click:

```tsx
<button
  key={v}
  data-selected={selected}
  style={rowStyle(isLive, isCued, planned, selected)}
  onClick={(e) => onSelectVerse(v, e.shiftKey)}
>
```

Auto-scroll the selection into view: add a `ref` on the first selected verse's button and an effect. Minimal approach — attach a `ref` callback on the row where `v === selectedRange?.from` that calls `el.scrollIntoView({ block: 'nearest' })`:

```tsx
ref={selected && v === selectedRange?.from ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
```

(This runs on each render where that verse is the selection start — acceptable for a preview rail; if lint objects to inline ref callbacks, extract a small `useCallback`/`useEffect` keyed on `selectedRange?.from`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/operator/ChapterRail.test.tsx && npm run typecheck`
Expected: PASS; typecheck clean (SermonMode still references the old `onSelect` — Task 10 fixes that; **typecheck of the whole tree will fail until Task 10**. To keep this task's gate green, either land Task 8 + Task 10 together, or temporarily keep `onSelect` as an optional deprecated prop. **Decision:** run only the file's vitest + the web typecheck scoped mentally; the branch-wide `npm run typecheck` is expected to fail between Task 8 and Task 10 because `SermonMode` is the sole consumer. Note this in the commit and fix in Task 10.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/ChapterRail.tsx src/renderer/operator/ChapterRail.test.tsx
git commit -m "feat(ChapterRail): selectedRange highlight + shift-aware onSelectVerse

SermonMode (sole consumer) is updated in the next task; tree typecheck is
red between these two commits by design."
```

---

## Task 9: `SchedulePanel` — controlled builder input

**Files:**
- Modify: `src/renderer/operator/SchedulePanel.tsx`

**Interfaces:**
- Produces (revised `SchedulePanelProps`): replace `entryQ`/`setEntryQ`/`hasParse` with:
  - `value: string` — the `renderBuilder(state)` string (fully controlled).
  - `onEntryChange: (v: string) => void` — fires on paste/IME (non-keystroke edits); `SermonMode` tries `parseRef` → `fromParsedRef`.
  - keep `onEntryKeyDown`, `onAdd`, `rows`; rename `hasParse`→`canAdd`, keep `addLabel`.

- [ ] **Step 1: Update the interface** — in `SchedulePanel.tsx`:

```ts
export interface SchedulePanelProps {
  theme: Theme;
  width: number;
  track: SermonTrack;
  setTrack: (t: SermonTrack) => void;
  value: string;
  onEntryChange: (v: string) => void;
  onEntryKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  canAdd: boolean;
  addLabel: string;
  onAdd: () => void;
  rows: ScheduleRow[];
}
```

- [ ] **Step 2: Update the destructure + input** — replace the destructured `entryQ, setEntryQ, ..., hasParse` with `value, onEntryChange, onEntryKeyDown, canAdd, addLabel, onAdd`. Update the `<input>`:

```tsx
<input
  style={{ flex: 1, fontSize: '13.5px', fontFamily: "'JetBrains Mono',monospace" }}
  value={value}
  onChange={(e) => onEntryChange(e.target.value)}
  onKeyDown={onEntryKeyDown}
  placeholder="Add reading — John 3:16"
/>
```

And the add button guard:

```tsx
{canAdd && (
  <button style={schedAddStyle} onClick={onAdd}>
    {addLabel}
  </button>
)}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: fails only in `SermonMode` (the caller), fixed in Task 10. The `SchedulePanel` file itself compiles.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/operator/SchedulePanel.tsx
git commit -m "feat(SchedulePanel): controlled builder input value + paste + canAdd

Caller (SermonMode) updated in the next task."
```

---

## Task 10: `SermonMode` integration

**Files:**
- Modify: `src/renderer/operator/SermonMode.tsx`

**Interfaces:**
- Consumes: everything from `refBuilder.ts`, `refs.ts` (`parseRef`, `formatRef`), `SchedulePanel` (revised props), `ChapterRail` (revised props), `window.helm.bibles.bookExtent`.

This is the glue task; it is validated by typecheck/lint and manual verification (`npm run dev`), not a new unit test.

- [ ] **Step 1: Replace imports + state.** At the top of `SermonMode.tsx`:

Add:

```ts
import { formatRef, parseRef, type ParsedRef } from '../../shared/scripture/refs';
import {
  initialBuilder, applyKey, renderBuilder, toParsedRef, fromParsedRef, setStart, setEnd,
  EMPTY_EXTENT, type RefBuilderState
} from '../../shared/scripture/refBuilder';
import type { BibleManifestEntry, BookExtent, ChapterData, ScriptureReading } from '../../shared/types';
```

(Remove `matchBook` from the `refs` import and remove `norm` import if no longer used elsewhere in the file — verify with a search; the old Space-completion used both.)

Replace the `entryQ` state:

```ts
const [builder, setBuilder] = useState<RefBuilderState>(initialBuilder());
const extentCache = useRef<Record<string, BookExtent>>({});
const [extentTick, setExtentTick] = useState(0); // bumps to re-render after an async extent fetch
```

- [ ] **Step 2: Extent fetch effect.** After the chapter-cache effect, add:

```ts
// Fetch (once, cached) the BookExtent for the builder's resolved book so digit clamping
// has real chapter/verse maxima. Version-agnostic — main resolves the installed version.
useEffect(() => {
  const b = builder.book;
  if (!b || extentCache.current[b]) return;
  let live = true;
  void window.helm.bibles
    .bookExtent(b)
    .then((ext) => {
      if (!live) return;
      extentCache.current[b] = ext;
      setExtentTick((t) => t + 1);
    })
    .catch(console.error);
  return () => {
    live = false;
  };
}, [builder.book]);

const curExtent = builder.book ? extentCache.current[builder.book] ?? EMPTY_EXTENT : EMPTY_EXTENT;
void extentTick; // referenced so the fetch-completion re-render is not optimized away
```

- [ ] **Step 3: Preview book/chapter + selected range derived from the builder.** Add:

```ts
// The rail previews the builder's book+chapter when resolved, else the cued chapter.
const previewBook = builder.book ?? scrBook;
const previewCh = builder.chapter ?? scrCh;
const selectedRange =
  builder.startVerse !== null
    ? { from: Math.min(builder.startVerse, builder.endVerse ?? builder.startVerse), to: Math.max(builder.startVerse, builder.endVerse ?? builder.startVerse) }
    : null;
```

Fetch the preview chapter data. The existing chapter-cache effect keys on `[scrBook, scrCh, versions]` and stores into `chapter`. Add a **separate** preview chapter state so the live/cued chapter is not disturbed:

```ts
const [previewChapter, setPreviewChapter] = useState<ChapterData | null>(null);

useEffect(() => {
  let live = true;
  void window.helm.bibles
    .getChapter(previewBook, previewCh)
    .then((c) => {
      if (live) setPreviewChapter(c);
    })
    .catch(console.error);
  return () => {
    live = false;
  };
}, [previewBook, previewCh, versions]);

const railChapter =
  previewChapter && previewChapter.book === previewBook && previewChapter.chapter === previewCh ? previewChapter : null;
const railVerseCount = railChapter?.verseCount || 1;
const railPreviewOf = useCallback(
  (v: number): string => railChapter?.verses[v]?.[versions[0]] ?? '',
  [railChapter, versions]
);
```

- [ ] **Step 4: Keydown handler.** Replace `onEntryKeyDown`/`addReading`/`parsed`/`hasParse`/`addLabel` with:

```ts
const commitBuilder = (goLiveToo: boolean): void => {
  const p = toParsedRef(builder);
  if (!p) return;
  window.helm.schedule.add(p).then(setSchedule).catch(console.error);
  setBuilder(initialBuilder());
  setTrack('scripture');
  if (goLiveToo) {
    jumpTo(p.book, p.ch, p.from);
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
  }
};

const onEntryKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitBuilder(e.shiftKey);
    return;
  }
  if (e.key === 'Escape') {
    // Clear the builder first; a second Escape (already empty) falls through to the
    // document-level modal-close handler (Settings) via normal bubbling — matches today.
    if (renderBuilder(builder) !== '') {
      e.preventDefault();
      setBuilder(initialBuilder());
    }
    return;
  }
  const r = applyKey(builder, e.key, e.shiftKey, curExtent);
  if (r.preventDefault) e.preventDefault();
  if (r.state !== builder) setBuilder(r.state);
};

// Paste / IME: if the whole field parses as a ref, load it structurally.
const onEntryChange = (v: string): void => {
  const p = parseRef(v);
  if (p) setBuilder(fromParsedRef(p));
};

const parsed = toParsedRef(builder);
const canAdd = parsed !== null;
const addLabel = parsed ? `+ Add ${formatRef(parsed)}` : '';
```

- [ ] **Step 5: Click-to-select handler for the rail.** Add:

```ts
// Click-select in the rail writes the same RefBuilderState as typing. If the builder has
// no resolved book yet, seed it from the previewed (cued) chapter so a click there starts
// a fresh selection in that chapter.
const onRailSelectVerse = (v: number, shift: boolean): void => {
  setBuilder((b) => {
    const seeded: RefBuilderState =
      b.book === null || b.chapter === null
        ? { ...initialBuilder(), stage: 'verse', book: previewBook, chapter: previewCh, startVerse: null, endVerse: null }
        : b;
    const ext = extentCache.current[seeded.book ?? ''] ?? EMPTY_EXTENT;
    if (shift) return setEnd(seeded, v, ext);
    // No open selection (fresh or just-completed range) -> start; a start set with no end
    // and a *different* verse -> end; same verse -> stay single.
    if (seeded.startVerse === null || seeded.endVerse !== null) return setStart(seeded, v, ext);
    if (v === seeded.startVerse) return seeded;
    return setEnd(seeded, v, ext);
  });
};
```

Also make sure the previewed book's extent is fetched even when the builder was seeded by a click (the Step 2 effect keys on `builder.book`, which the seed sets, so it fetches on the next render — good).

- [ ] **Step 6: Update JSX props.** In the `SchedulePanel` element, replace `entryQ/setEntryQ/hasParse/onAdd` wiring:

```tsx
<SchedulePanel
  theme={T}
  width={SCHEDULE_PANEL_W}
  track={track}
  setTrack={setTrack}
  value={renderBuilder(builder)}
  onEntryChange={onEntryChange}
  onEntryKeyDown={onEntryKeyDown}
  canAdd={canAdd}
  addLabel={addLabel}
  onAdd={() => commitBuilder(false)}
  rows={scheduleRows}
/>
```

In the `ChapterRail` element, feed the **preview** book/chapter and the selection:

```tsx
<ChapterRail
  theme={T}
  dark={dark}
  width={RIGHT_PANEL_W}
  book={previewBook}
  ch={previewCh}
  verseCount={railVerseCount}
  plannedSet={plannedSet}
  cuedV={scrV}
  isVerseLive={isVerseLive}
  previewOf={railPreviewOf}
  selectedRange={selectedRange}
  onSelectVerse={onRailSelectVerse}
/>
```

Note `plannedSet`/`isVerseLive` are computed against `scrBook`/`scrCh`; when the preview shows a *different* chapter than the cued one, planned/live tinting there is harmless (planned set is empty for the other chapter, live is false). Leave as-is (spec keeps CUED/LIVE badges for the cued chapter; a divergent preview simply shows fewer badges).

- [ ] **Step 7: Typecheck, lint, full test (Node ABI).**

Run: `npm rebuild better-sqlite3 && npm test && npm run typecheck && npm run lint`
Expected: all green (136 prior tests + the new refBuilder/refs/biblesRepo/ChapterRail tests). Fix any fallout (e.g., a lingering `onSelect`/`entryQ` reference, an unused `norm`/`matchBook` import).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/operator/SermonMode.tsx
git commit -m "feat(SermonMode): drive scripture entry through the guided ref builder

Keydown -> applyKey, Enter/Shift+Enter commit, rail live preview with a
highlighted pending range, and click-to-select. Restores the tree to a
green typecheck after the ChapterRail/SchedulePanel prop changes."
```

---

## Task 11: Manual verification + finish

**Files:** none (verification + merge).

- [ ] **Step 1: Rebuild for the app and run it.**

Run: `npx electron-rebuild` then `npm run dev`.

Verify against the spec:
- Type `jame` + Space → input shows `James`, rail previews James 1.
- Type `1` + Space → `James 1:`; type `1` + Space → `James 1:1-`; type `10` → `James 1:1-10`, rail highlights verses 1–10.
- Chapter/verse over-typing clamps (e.g. `James` `9` → chapter 5; `James 1:` `99` → verse 27).
- Backspace steps back through endVerse→verse→chapter→book, restoring `James` for editing.
- Click a verse → single selection; click another → range; Shift-click → range from start.
- Enter → appends to SCRIPTURE SCHEDULE, no projection, builder resets. Shift+Enter → appends **and** goes live on the first verse.
- Paste `james 1:1-10` into the field → loads `James 1:1-10`.
- Enter at `James 1` (chapter only) → schedules `James 1:1`.
- With no bible installed, the builder cannot advance past book and the rail shows the install hint; no crash.

- [ ] **Step 2: End on the Node ABI so tests stay green.**

Run: `npm rebuild better-sqlite3 && npm test`
Expected: all green.

- [ ] **Step 3: Whole-branch review + merge.** Use `superpowers:requesting-code-review` for a final whole-branch review, address findings, then `superpowers:finishing-a-development-branch` to merge to master (no `Co-Authored-By` trailers).

---

## Self-Review

**Spec coverage:**
- §2 typed builder (stages, Space/`:`/`-`, Backspace, render) → Tasks 2–4. ✓
- §3 live preview in the rail (preview book/chapter, highlight, auto-scroll) → Tasks 8, 10. ✓
- §4 click-to-select (fresh/start-then-end/shift/same-verse/seed-from-cued) → Tasks 5, 8, 10. ✓
- §5 Enter/Shift+Enter schedule & project → Task 10 (`commitBuilder`). ✓
- §6 projection model unchanged → Task 10 reuses `goLiveWithChapter`/`jumpTo`; no verse-stepping change. ✓
- §7 `BookExtent` + `bookExtent` repo query + IPC (version-resolved) → Tasks 2 (type), 6, 7. ✓
- §8 architecture/files → all tasks map to the listed files. ✓
- §9 edge cases: chapter-only Enter→v1 (Task 3 test), inverted range normalize (Tasks 3, 5), 1-chapter books (clamp, covered by clampChapter), switching books re-fetches (Task 10 effect keyed on `builder.book`; chapter/verse reset happens because a new book is reached only via a fresh `applyKey` book resolution that sets `chapter:null`), no bible installed (Task 4 EMPTY_EXTENT test + Task 7 `{0,[]}`). ✓
- §10 testing (unit/integration/render) → Tasks 2–6, 8. ✓
- §11 out of scope → nothing added beyond scope. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. One deliberate cross-task note: the tree typecheck is red between Tasks 8–10 (single-consumer prop change) — called out explicitly, not a hidden gap.

**Type consistency:** `RefBuilderState`/`BuilderStage`/`BookExtent` names consistent across tasks; `applyKey` returns `{ state, preventDefault }` everywhere; `onSelectVerse(v, shift)`, `selectedRange {from,to}`, `bookExtent(book)` signatures match between producer and consumer tasks; `toParsedRef`/`fromParsedRef` round-trip verified in Task 3.

**Known deviations from the spec wording (intentional, documented above):** `endVerse` uses a `null` sentinel rather than initializing to `startVerse` (§2) — behavior-equivalent via `to = endVerse ?? startVerse`; `matchBookExact` added to `refs.ts` (spec listed only `matchBook`) to make numbered-book Space advancement correct.
