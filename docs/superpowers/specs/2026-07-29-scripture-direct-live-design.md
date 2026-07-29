# Helm — Direct preview → live for scripture

**Date:** 2026-07-29
**Closes:** the roadmap item *"Direct preview → live/cue for scripture, without scheduling
first"* (`docs/superpowers/roadmap.md`, Sermon/Scripture section), found during Windows
rehearsal testing 2026-07-08.

---

## Why

A service is dynamic. The preacher reads past the planned verses, doubles back, or lands
somewhere nobody scheduled. Today the operator cannot follow, because **the schedule is the
gate to the screen**.

The gap is narrower than the roadmap wording suggests, and it is verified in code, not
assumed. All line numbers are `src/renderer/operator/SermonMode.tsx` unless noted.

1. **There is already a no-schedule path to live** — `goLive()` (`:247`) pushes the cued
   verse without touching the schedule, wired to SermonCenter's button (`:576`) and a key
   handler (`:503`).
2. **But the only ways to change *which* passage is cued** are clicking an existing schedule
   row (`jumpTo`, `:269`, called at `:445`) or committing the builder — and
   `commitBuilder` (`:363`) calls `window.helm.schedule.add(p)` **unconditionally**, before
   it even reads `goLiveToo`.
3. **Tapping a verse card doesn't cue.** It writes a range into the ref builder
   (`onRailSelectVerse`, `:418`), by deliberate design — `ChapterRail.tsx:21-26`.

So: *going live* without scheduling is possible; *changing what goes live* is not. Reaching
an unplanned verse means authoring a schedule row for it mid-service.

A second, smaller thing this fixes: the screen already follows the cursor, but only inside
the chapter you are live in. `applyCue` (`src/shared/presentation/core.ts:16-19`) requires
`sameFlow`, which for scripture compares book **and** chapter (`:13`). Arrowing within
Genesis 1 updates the projector; jumping to Romans 8 silently does not.

## What we're building

**One cursor, whose meaning depends on whether output is live.**

`scrBook` / `scrCh` / `scrV` is the single "where am I" state. Three gestures move it, and
they are the same action: plain tap on a verse card, arrow keys, clicking a schedule row.

| Gesture | Output is live | Output is black / logo |
| --- | --- | --- |
| Tap a verse card | On screen now | Selects + previews |
| Arrow key | On screen now | Selects + previews |
| Click a schedule row | On screen now | Selects + previews |

This is the PowerPoint slide panel: when you are presenting, clicking a slide presents it.
When you are not, clicking a slide selects it. Live means live across **any** book or
chapter, not just the one already on screen.

**Nothing gates on the schedule.** `plannedSet` (`:457-462`) tints cards and drives the
on-deck `VERSE` / `KEEP READING` tag. It never fences navigation — reading before or past a
planned range is unrestricted, as it is today.

**Two paths to the schedule, and neither is a gate to the screen:**

| Action | Writes a schedule row | Reaches the projector |
| --- | --- | --- |
| `+ Add` button, or Enter in the entry field | Yes | No |
| `● Go live` button, or Shift+Enter | No | Yes |
| Tap / arrow / schedule-row click | No | Only when already live |

Today Shift+Enter does both (`commitBuilder(e.shiftKey)`, `:388`). It stops writing rows.
The schedule records only what the operator deliberately adds.

**Range selection stays in the rail.** Shift-tap anchors at the cursor and writes the range
into the entry field, where it is visible and editable: tap verse 5, shift-tap verse 9,
entry reads `Genesis 1:5-9`, Enter files it. A subsequent plain tap clears the builder — the
cursor moved, so the pending range is stale. This does mean tapping the rail discards a
half-typed reference; that is the intended trade, since reaching for the rail is a
deliberate act.

**The `+ Add` affordance is always available for the current selection.** `canAdd` /
`addLabel` (`:411-413`) read the typed builder when the entry field holds a parsed ref, and
fall back to the cursor when it is empty — so a mouse-only operator always sees
`+ Add Genesis 1:5` for wherever they are, without knowing any keyboard shortcut. GUI parity
for the other path already exists: SermonCenter's button labels itself
`● Go live` / `■ Take down` (`SermonCenter.tsx:266-267`).

### Not in scope

- **Arrows still stop at chapter boundaries** (`stepVerse`, `:243-245`). Crossing chapters
  by arrow is a separate feature the on-deck panel already gestures at (`:482-483`).
- **Recording ad-hoc verses in the schedule.** Considered and rejected: the schedule is a
  plan, not a log. Nothing shown via a direct path is written down.
- **Background choices for scripture audience output** — the other rehearsal item. An
  independent subsystem (audience styling plus a settings flow), sharing no code with this
  and blocking nothing. Its own spec → plan cycle.

## Design

### `showLive` — a third presentation verb

`src/shared/presentation/core.ts` has two verbs today and needs a third:

| Verb | Behaviour |
| --- | --- |
| `applyCue` (`:16`) | Updates the screen only if live **and** `sameFlow` — a cue that stays off-screen across flows |
| `goLive` (`:20`) | Forces output live; **toggles to black** when fired on the key already live |
| `showLive` (new) | Updates the screen if live, any flow, no toggle. Otherwise a no-op |

```ts
export function showLive(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output !== 'live') return st;
  return { ...st, liveKey: key, liveSnap: slide };
}
```

`applyCue` is **not** modified. Songs depends on `sameFlow`: cueing a section of a
*different* song must not jump the screen, which is the entire point of a cue. Scripture
taps and arrows route through `showLive`; Songs is untouched.

The no-toggle property is load-bearing. `goLive` blacks the output when fired on the
already-live key (`core.ts:21`), which is correct for a `Go live` / `Take down` button and
wrong for navigation — tapping the verse already on screen would blank the projector. The
toggle stays on the explicit button and its key handler, where a deliberate blank belongs.

**Shift+Enter is not the toggle either.** It names a specific reference, so blanking on it
is never what was asked for: typing a ref that happens to be on screen and pressing
Shift+Enter must leave it on screen. `goLiveFromBuilder` therefore checks first — if output
is live and the target key already matches `liveKey`, it resets the builder and does
nothing else. Only `Go live` / `Take down`, which is explicitly labelled as a toggle, blanks.

Plumbing follows the existing pattern exactly: a `presShow` channel beside `presCue` /
`presGoLive` (`src/main/ipc.ts:47-48`), a `send` in `src/preload/index.ts:18-19`, a method on
`presentation` in `src/shared/types.ts:170-175`, and a `stateStore` method.

### The stale-chapter guard

`chapter` is fetched async and keyed by `[scrBook, scrCh]`. For a render or two after a
cross-book or cross-chapter jump it still holds the previous chapter's data, which is why
`liveChapter` (`:225`) gates on a match and why `goLive` bails on a null one (`:247-257`).

Today the cue effect (`:228-236`) has no such guard and does not need one: a cross-chapter
jump fails `sameFlow`, so `applyCue` is a no-op during the fetch. **Dropping `sameFlow`
removes that accidental protection.** Without a guard, a cross-chapter tap while live would
push the `INSTALL_HINT` slide — "no bible installed" — onto the projector for a tick.

So the effect skips entirely while `liveChapter` is null. `liveChapter` is already in the
dependency array (`:236`), so the effect re-runs and the real verse lands the moment the
chapter resolves. The cost is that a cross-chapter tap while live holds the *previous* verse
on screen for one fetch tick instead of flashing wrong content — the right trade for a
projector in front of a congregation.

### Changes to `SermonMode.tsx`

1. **Cue effect** (`:228-236`) — calls `showLive` instead of `cue`; skips while
   `liveChapter` is null.
2. **`onRailSelectVerse`** (`:418-432`) — plain tap becomes `jumpTo` plus a builder clear;
   shift-tap anchors `setEnd` at the cursor rather than at the builder's own start.
3. **`commitBuilder`** (`:363-383`) splits into `addToSchedule` (row, no screen) and
   `goLiveFromBuilder` (jumps the cursor to `p.from` and shows it, no row). Enter → add,
   Shift+Enter → live, `+ Add` button → add. Both reset the builder and set the track to
   `scripture`, as `commitBuilder` does today. `goLiveFromBuilder` keeps today's
   chapter-cache handling (`:371-381`): reuse `chapter` when it already matches, else fetch
   fresh so the live slide never shows stale text. The comment at `:360` currently claims
   "Enter … jumps + goes live", which the code has never done — `:388` passes `e.shiftKey`.
   It goes with the split.
4. **`canAdd` / `addLabel`** (`:411-413`) — fall back to the cursor when the entry is empty.

### Two extractions

`SermonMode.tsx` is 598 lines and there is no `SermonMode.test.tsx`; coverage lives on the
pure pieces (`core.test.ts`, `ChapterRail.test.tsx`, `SchedulePanel.test.tsx`). Both new
decisions come out as pure functions so they can be tested directly rather than through the
container:

- **`railSelect(builder, cursor, v, shift)` → `{ cursor, builder }`** — the whole tap
  decision. What does it do: maps a rail click to the next cursor and builder state. How you
  use it: call it from `onRailSelectVerse` and apply both halves. What it depends on: the
  ref-builder helpers (`setStart` / `setEnd`) and book extents, nothing React.
- **`addTarget(builder, cursor)` → `ParsedRef | null`** — the typed-ref-else-cursor
  fallback, driving `canAdd` and `addLabel`. Pure, no dependencies beyond `toParsedRef`.

### Unchanged

**`ChapterRail.tsx` needs no API change.** It already reports `onSelectVerse(v, shift)` and
leaves the decision to its caller (`:177`) — the seam is in the right place already. Its doc
comment (`:21-26`) and the `HINT` string (`:19`) describe the old builder-only behaviour and
are updated. Its two highlight tiers stay: `selected` for a pending shift-tap range,
`isCued` for the cursor.

**`SchedulePanel.tsx` and `SermonCenter.tsx` need no changes.** Both already take
`canAdd` / `addLabel` / `onAdd` (`SchedulePanel.tsx:26-27,121-124`) and `onGoLive`
(`SermonCenter.tsx:25,266`) as props; only what `SermonMode` passes down changes.

## Testing

**`core.test.ts`** — `showLive`: no-op when output is `black` and when `logo`; updates
`liveKey`/`liveSnap` when live; updates across a *different* flow (the `sameFlow` case
`applyCue` refuses); does **not** toggle to black when fired on the already-live key. Plus a
regression assertion that `applyCue` still refuses a cross-flow cue, so Songs stays safe.

**`railSelect` tests** — plain tap moves the cursor and clears a pending range; shift-tap
anchors at the cursor, not at the builder's start; shift-tap after a plain tap yields the
expected range; a plain tap into a previewed chapter moves the cursor across chapters.

**`addTarget` tests** — typed ref wins; empty entry falls back to the cursor's single verse;
a shift-tapped range produces the range.

**`ChapterRail.test.tsx`** — unchanged in behaviour, but confirms `onSelectVerse` still
reports the shift flag.

**Blank-hazard tests** — the two paths that must never black the output: `showLive` on the
already-live key, and `goLiveFromBuilder` targeting the already-live key.

**Real-app verification**, following the pattern of `scratch/verify-bug008.mjs` and
`verify-autofit.mjs` (untracked, run from the repo root so `playwright-core` resolves): go
live on a verse, tap a different verse in the same chapter, confirm the projector follows;
tap a verse in a different book, confirm the projector follows and never shows the install
hint; take the output down, tap around, confirm the projector stays black; tap the verse
already live, confirm it does not blank.

## Known caveats

- A plain tap discards a half-typed reference in the entry field. Deliberate — see above.
- A cross-chapter tap while live is one fetch tick behind. Deliberate — see the guard.
- Arrows still stop at chapter boundaries, so following a reader past the end of a chapter
  still needs a rail tap or a typed ref.
