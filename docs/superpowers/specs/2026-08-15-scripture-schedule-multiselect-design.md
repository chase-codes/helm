# Scripture schedule: clear-all + shift-click multi-select — design

**Issue:** #61 (enhancement, P0, area:scripture)
**Date:** 2026-08-15

## Goal

Clearing a scripture schedule today is a row-by-row grind: selection is single-only,
delete acts on one id, and the IPC surface has no bulk operation. Add:

1. A **Clear schedule** control that removes every reading in one action.
2. **Shift-click multi-select** — a contiguous run of scheduled readings — with
   delete (keyboard, context menu) acting on the whole selection.

Both are recoverable via the existing undo-toast pattern, not a confirmation dialog.

## Decisions

- **Undo toast, not a dialog.** `useTimedUndo`/`UndoToast` extend naturally to a
  batch; nothing blocking to dismiss mid-prep. Caveat (accepted, pre-existing):
  undo re-adds via `schedule.add`, which appends at the end, so a range deleted
  from the middle is restored at the end of the list. Position-preserving restore
  stays a follow-up, as it already is for single-item undo.
- **Pivot shift-click semantics, here only.** Conventional shift-click: the anchor
  (last plain-clicked row) stays put and each shift-click re-ranges from it —
  matching the *expected* behavior stated in #22. The verse rail's current
  grow-the-range behavior (#22) is fixed separately; both panels converge on the
  same convention.
- **One bulk channel.** `schedule.removeMany(ids)` covers both features; clear-all
  is `removeMany(everyId)`. No separate `clear` channel.
- **Extend `useListSelection` in place.** Only `SermonMode` consumes it (other
  mentions are comments), so widening it doesn't silently change other call
  sites, and #8 (other tracks) inherits multi-select for free.

## Main process

`ScheduleRepo` gains:

```ts
removeMany(ids: string[]): ScriptureReading[]
```

Implemented as one `db.transaction` looping the existing prepared `DELETE`
statement, then returning `list()`. Missing/unknown ids are tolerated (no-op per
id), matching `remove`'s tolerance today.

IPC plumbing, mirroring the existing three schedule channels:

- `CH.scheduleRemoveMany = 'schedule:removeMany'` in `src/shared/types.ts`
- `schedule.removeMany(ids: string[]): Promise<ScriptureReading[]>` on the
  `HelmApi` surface in `src/shared/types.ts`
- Handler in `src/main/ipc.ts`; passthrough in `src/preload/index.ts` (+ `index.d.ts`)

## Selection hook

`useListSelection` becomes multi-aware and takes the list order:

```ts
useListSelection(orderedIds: string[]): ListSelection

interface ListSelection {
  selectedIds: string[];          // in list order
  selectedId: string | null;      // derived: selectedIds.length === 1 ? selectedIds[0] : null
  select(id: string): void;       // plain click: selection = [id], anchor = id
  selectTo(id: string): void;     // shift-click: contiguous run anchor..id; anchor stays put
  clear(): void;
  isSelected(id: string): boolean;
}
```

Semantics:

- `select(id)` — today's behavior: single selection, and sets the anchor.
- `selectTo(id)` — selection becomes the contiguous run between the anchor and
  `id` in `orderedIds`; the anchor does **not** move (pivot). With no anchor yet,
  behaves like `select(id)`.
- Ids that disappear from `orderedIds` (deleted elsewhere) are dropped from the
  selection; if the anchor disappears, it clears.
- `selectedId` is kept as a derived convenience so single-select call sites read
  naturally; `isSelected`/`clear` keep their meaning.

## SermonMode wiring

- **Row click** gains the event's `shiftKey`. Plain click = `jumpToReading` as
  today (select + jump + pin rail). Shift-click = `selectTo(id)` only — no rail
  jump; the gesture marks a range, it doesn't navigate.
- **`removeReadings(ids: string[])`** replaces `removeReading(id)` internally:
  look up the readings, call `schedule.removeMany`, and on IPC success set the
  schedule, clear the selection if it intersected the removed ids, and arm undo
  with the batch (same success-gated pattern as today). Single-item paths call
  `removeReadings([id])`.
- **Undo** becomes `useTimedUndo<ScriptureReading[]>`. `undoRemove` re-adds each
  reading in original order via sequential `schedule.add` calls; the last
  response sets the schedule. Toast label: one reading → `formatRef(r)` as
  today; a batch → `"N readings"`.
- **Keyboard** `item.delete` (Delete/Backspace) acts on `sel.selectedIds`.
- **Context menu**: right-click on a row inside the current multi-selection
  offers **Delete N readings** acting on the whole selection; right-click on a
  row outside it re-selects that row first and offers single Delete (today's
  behavior).

## Clear schedule control

A small text button in the `SCRIPTURE SCHEDULE` header row of `SchedulePanel`,
rendered only when the schedule is non-empty. Clicking it calls
`removeReadings(allIds)` — one IPC call, one transaction, recoverable via the
same undo toast.

## Testing

- **Repo**: `removeMany` removes all given ids in one call; unknown ids
  tolerated; returns the re-listed schedule.
- **Hook**: plain select; shift with no anchor acts like select; shift after
  select yields the contiguous run; a second shift-click pivots from the same
  anchor (does not grow); backwards ranges; anchor/selection cleanup when ids
  vanish from `orderedIds`.
- **UI (SermonMode/SchedulePanel)**: shift-click renders the range as selected;
  Delete removes the whole selection via one `removeMany` call; undo restores
  the batch; Clear schedule removes everything and undo restores it; the button
  is absent when the schedule is empty.
- Existing single-select behavior is unchanged; existing hook tests update only
  for the new `orderedIds` parameter, not for behavior.

## Out of scope

- #22's rail fix (`railSelect` anchor tracking).
- #8's other tracks (message, slides) — they inherit the widened hook later.
- Position-preserving undo restore (existing caveat).
- Ctrl/Cmd-click discontiguous selection.
