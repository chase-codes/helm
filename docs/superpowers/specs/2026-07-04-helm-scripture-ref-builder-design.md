# Helm — Guided Scripture Reference Builder (design)

**Date:** 2026-07-04
**Status:** Approved — ready for planning
**Extends:** `2026-07-03-helm-design.md` (§5 search). Improves the slice-3 scripture entry (`SermonMode`/`SchedulePanel`/`ChapterRail`).

## 1. Purpose & scope

The current scripture entry is a bare text field: you type a full reference (`james 1:1-10`) and press Enter; Space completes a *partial* book name (`jame`→`James`). It gives no feedback while typing a book, no live verse preview, and no way to build/select a range interactively. This feature replaces it with a **guided reference builder** — a keyboard state machine plus click-to-select in the verse preview — that lets an operator compose a reading (`James 1:1-10`) quickly, see the verses as they build it, and add a set of readings to the schedule.

In scope: the guided typed builder, live verse preview with range highlight (in the existing right-hand chapter rail), click-to-select-range in that rail, and Enter/Shift+Enter schedule/project actions. Out of scope: changing the one-verse-per-slide projection model, cross-chapter ranges, and multi-version validation (validate against the primary installed bible).

## 2. Interaction model — the typed builder

A small state machine drives the add-reading input. It holds structured tokens and renders them as a display string (e.g. `James 1:1-10`).

```ts
type BuilderStage = 'book' | 'chapter' | 'verse' | 'endVerse';
interface RefBuilderState {
  stage: BuilderStage;
  bookQuery: string;        // raw letters while stage === 'book'
  book: string | null;      // resolved canonical book (e.g. "James")
  chapter: number | null;
  startVerse: number | null;
  endVerse: number | null;  // null until a range is started
}
```

**Stages advance on Space** (which is otherwise swallowed — `preventDefault`):

- **book:** letters accumulate in `bookQuery`. On Space, `matchBook(bookQuery)` (existing prefix/alias match): if it resolves, set `book`, clear `bookQuery`, advance → `chapter`, and fetch that book's `BookExtent` (§7). If it does not resolve, Space is ignored (stay in book). *(This preserves today's working `jame`→`James` completion.)*
- **chapter:** digits accumulate; the number is **clamped live to `1…extent.chapters`** — a keystroke that would exceed the max clamps to the max (never an invalid chapter). On Space, if `chapter` is set, advance → `verse` (display gains `:`).
- **verse:** digits clamp to `1…extent.verseCounts[chapter-1]`. On Space, advance → `endVerse` (display gains `-`), initializing `endVerse = startVerse`.
- **endVerse:** digits clamp to `startVerse…extent.verseCounts[chapter-1]`.

**Other keys:**
- **Backspace:** deletes within the current token; when the current token is empty, steps back one stage (endVerse→verse→chapter→book), restoring that token for editing.
- **`:` and `-`:** typed directly, they advance chapter→verse and verse→endVerse respectively (same as Space at those stages), so a fast typist or a paste of `james 1:1-10` composes the same state. A pasted/opaque string is parsed with the existing `parseRef` and loaded via `fromParsedRef`.
- **Enter / Shift+Enter:** §5.
- **Escape:** clears the builder (empty input); a second Escape bubbles (closes Settings), matching today.

**Rendering** (`renderBuilder`): `book`→`"James"`; `+chapter`→`"James 1"`; entering verse→`"James 1:"`, `+startVerse`→`"James 1:1"`; entering endVerse→`"James 1:1-"`, `+endVerse`→`"James 1:1-10"`. While in `book` with only `bookQuery`, render `bookQuery` verbatim (`"Jame"`).

## 3. Live preview — the right chapter rail

The right-hand `ChapterRail` becomes the builder's live preview:

- Whenever the builder has a resolved `book` + `chapter`, the rail **loads that chapter's verses** (via `getChapter`) as a *preview* — independent of the live/cued scripture state. Before a chapter is chosen, the rail shows the current cued chapter (today's behavior).
- The **pending range** `[startVerse…endVerse]` (or just `startVerse`, or none) is **highlighted** distinctly from the CUED/LIVE badges. Verses above and below scroll normally; the rail auto-scrolls to keep the selection in view.
- The preview never mutates presentation state — it is purely visual until Enter/Shift+Enter.

## 4. Click-to-select in the rail

Clicking verses builds the same structured range as typing (the two are interchangeable, both writing `RefBuilderState`). The rule is unambiguous by click position/modifier:

- **Click a verse when there is no open selection** (fresh, or just after a completed range) → set `startVerse = v`, `endVerse = null` (single-verse selection); input updates to `Book ch:v`.
- **Click a *different* verse while a start is set and `endVerse` is null** → set `endVerse = v` (range, normalized to `from=min,to=max`); input updates to `Book ch:from-to`. (This is the "click start, then click end" gesture.)
- **Shift-click any verse** → always set `endVerse = v` from the current `startVerse` (normalized), regardless of state.
- **Click the already-selected single verse** → no change (stays single).
- Clicking requires a preview book+chapter to be active (from typing or from the current cued chapter). Clicking in the *cued* chapter with no active builder starts a fresh selection in that chapter.

## 5. Enter / Shift+Enter — schedule & project

On a builder state that yields a valid `ParsedRef` (`toParsedRef` non-null):

- **Enter** → append the reading to the SCRIPTURE SCHEDULE below the last item (existing `scheduleRepo.add`, which dedups on `book/ch/from/to`), then reset the builder for the next entry. **No projection.**
- **Shift+Enter** → the same append **and** go live: jump `scrBook/scrCh/scrV` to the range's first verse and project it (existing `goLiveWithChapter` path).
- Existing schedule rows remain clickable to jump/cue; existing verse-stepping (arrows) is unchanged.

Invalid/incomplete builder on Enter (e.g. book only): no-op (as today when `parseRef` fails).

## 6. Projection model (unchanged)

A scheduled range is **stepped one verse per slide** — the on-screen hero shows a single verse; arrows advance through `from…to`. Shift+Enter goes live on `from`. This is the existing slice-3 model; the builder only composes the range and adds it to the schedule. (Whole-range-on-one-slide is explicitly not part of this feature.)

## 7. Data & validation — `BookExtent`

Client-side clamping needs, per book (in the primary installed version): the chapter count and the verse count of each chapter.

```ts
interface BookExtent { chapters: number; verseCounts: number[] } // verseCounts[chapterIndex0] = verses in chapter (index+1)
```

- New `biblesRepo.bookExtent(book: string, versionId: string): BookExtent` — one query:
  `SELECT chapter, MAX(verse) AS mv FROM verses WHERE version_id=? AND book=? GROUP BY chapter ORDER BY chapter`, mapped to `{ chapters: rows.length, verseCounts: rows.map(r => r.mv) }`. Returns `{ chapters: 0, verseCounts: [] }` for an unknown/empty book.
- New IPC `CH.biblesBookExtent` + `HelmApi.bibles.bookExtent(book): Promise<BookExtent>` — **version-agnostic to the caller**: the main-process handler resolves `versionId` to the first installed version (chapter/verse counts are canonically stable across the KJV-family translations for clamping purposes; if none installed, returns `{0,[]}`). Fetched once when a book is chosen; cached in `SermonMode` keyed by book for the session.

## 8. Architecture & files

**New (pure, unit-tested — the core):**
- `src/shared/scripture/refBuilder.ts` — `initialBuilder`, `applyKey(state, key, shift, extent) → { state, preventDefault }`, `renderBuilder(state) → string`, `toParsedRef(state) → ParsedRef | null`, `fromParsedRef(ParsedRef) → RefBuilderState`, `setStart`/`setEnd(state, v, extent)`, `clampChapter`/`clampVerse`. Depends only on `matchBook`/`parseRef`/`formatRef` from `refs.ts` and the `BookExtent` type. No I/O.

**Modified:**
- `src/main/biblesRepo.ts` + `src/main/db.ts` (no schema change; uses `verses`) — `bookExtent`.
- `src/shared/types.ts` — `BookExtent`, `RefBuilderState`, `BuilderStage`, `CH.biblesBookExtent`, `HelmApi.bibles.bookExtent`.
- `src/preload/index.ts`, `src/main/ipc.ts` — wire `bookExtent`.
- `src/renderer/operator/SermonMode.tsx` — own `RefBuilderState`; replace `onEntryKeyDown`/`entryQ`/`hasParse`/`addReading` with the builder (input value = `renderBuilder`, keydown = `applyKey`); drive the rail's preview book/chapter + selected range from the builder; Enter/Shift+Enter schedule/project; fetch+cache `BookExtent`.
- `src/renderer/operator/ChapterRail.tsx` — new props `previewBook`/`previewChapter` (load an arbitrary chapter for preview), `selectedRange: {from,to} | null` (highlight), `onSelectVerse(v, shift)` (click-select). Keep CUED/LIVE badge behavior for the cued chapter.
- `src/renderer/operator/SchedulePanel.tsx` — the input displays `renderBuilder(state)` and forwards keydown; a small stage hint is optional (YAGNI — omit unless trivial).

## 9. Edge cases

- `James 1` + Enter → whole-chapter reading is out of scope; require at least a start verse. If the operator presses Enter at `chapter` stage, treat as `verse 1` (`from=to=1`)? **Decision:** Enter with no verse commits `from=to=1` (chapter's first verse) — simplest sensible default; the operator can build a range explicitly.
- Range where `endVerse < startVerse` (via click or edit): normalize to `from=min, to=max`.
- Book with 1 chapter (Obadiah, Jude…): chapter stage still required (clamped to `1`).
- Switching books mid-build re-fetches extent and resets chapter/verse.
- No bible installed: `bookExtent` returns `{0,[]}`; the builder cannot advance past book (clamp to nothing) and the preview shows the existing install hint — degrade calmly, no crash.

## 10. Testing

- **Unit (vitest, Node ABI):** `refBuilder` — stage transitions on Space/`:`/`-`, digit clamping (chapter>max→max, verse>chapterMax→max, endVerse≥start), Backspace stepping, `renderBuilder` strings at every stage, `toParsedRef`/`fromParsedRef` round-trip, `setStart`/`setEnd` ordering/normalization, the Enter-at-chapter→verse-1 default.
- **Integration:** `biblesRepo.bookExtent` against an in-memory DB seeded with a small multi-chapter book (verify chapters + per-chapter verse counts; unknown book → `{0,[]}`).
- **Render (@testing-library):** `ChapterRail` highlights a `selectedRange`, and `onSelectVerse` fires with the shift flag.
- `npm test` on the Node ABI stays green.

## 11. Out of scope

- Whole-range-on-one-slide projection (stays one-verse-per-slide).
- Cross-chapter ranges (`James 1:20–2:3`).
- Validation against multiple versions simultaneously (uses the primary installed version).
- A separate book-suggestion dropdown (Space-completion + live preview cover discovery).
