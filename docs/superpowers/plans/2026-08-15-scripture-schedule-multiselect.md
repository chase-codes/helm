# Scripture Schedule Clear-All + Shift-Click Multi-Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bulk removal for the scripture schedule — a Clear-all control and shift-click contiguous multi-select with delete acting on the whole selection — recoverable via the existing undo toast (issue #61).

**Architecture:** One new IPC channel `schedule:removeMany` backed by a single-transaction repo method covers both features. `useListSelection` widens in place to an ordered multi-select with conventional pivot shift-click semantics (anchor stays put). `SermonMode` swaps its single-id delete path for a batch path; `useTimedUndo` holds the batch.

**Tech Stack:** Electron (better-sqlite3 in main, React 19 renderer), Vitest + @testing-library/react (jsdom), TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-15-scripture-schedule-multiselect-design.md`

## Global Constraints

- Commit messages: concise conventional-commit subjects; NO `Co-Authored-By` or `Claude-Session` trailers (CLAUDE.md).
- Shift-click uses **pivot** semantics: the anchor (last plain-clicked row) stays put; each shift-click re-ranges from it. Never grow-the-range.
- Bulk removal is ONE IPC call and ONE DB transaction — never a loop of `remove` calls.
- No confirmation dialogs; destructive bulk deletes are recoverable via the undo toast.
- Single-select behavior and single-item delete are unchanged from today.
- Out of scope: #22's rail fix, #8's other tracks, position-preserving undo restore, Ctrl/Cmd-click discontiguous selection.
- Verification commands: `npx vitest run <file>` per task, `npm run typecheck` and `npm run lint` before finishing.

---

### Task 1: `ScheduleRepo.removeMany`

**Files:**
- Modify: `src/main/scheduleRepo.ts`
- Test: `src/main/scheduleRepo.test.ts`

**Interfaces:**
- Consumes: existing `createScheduleRepo(db)`, prepared `deleteItem` statement, `list()`.
- Produces: `removeMany(ids: string[]): ScriptureReading[]` on the `ScheduleRepo` interface — removes every given id in one transaction, tolerates unknown ids, returns the re-listed schedule. Task 2 exposes it over IPC.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/scheduleRepo.test.ts`:

```ts
test('removeMany deletes all given ids in one call and returns the updated list', () => {
  repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  repo.add({ book: 'John', ch: 3, from: 16, to: 16 })
  const three = repo.add({ book: 'Psalm', ch: 23, from: 1, to: 6 })
  const doomed = three.filter((r) => r.book !== 'John').map((r) => r.id)
  const after = repo.removeMany(doomed)
  expect(after).toHaveLength(1)
  expect(after[0].book).toBe('John')
})

test('removeMany with every id clears the schedule', () => {
  repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  const all = repo.add({ book: 'John', ch: 3, from: 16, to: 16 })
  expect(repo.removeMany(all.map((r) => r.id))).toHaveLength(0)
})

test('removeMany tolerates unknown ids and an empty list', () => {
  const one = repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  expect(repo.removeMany(['does-not-exist'])).toHaveLength(1)
  expect(repo.removeMany([])).toHaveLength(1)
  expect(repo.removeMany([one[0].id, 'does-not-exist'])).toHaveLength(0)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/scheduleRepo.test.ts`
Expected: 3 new tests FAIL — `repo.removeMany is not a function`. The 7 existing tests still pass.

- [ ] **Step 3: Implement `removeMany`**

In `src/main/scheduleRepo.ts`:

Add to the interface (after `remove`):

```ts
export interface ScheduleRepo {
  list(): ScriptureReading[]
  add(r: Omit<ScriptureReading, 'id'>): ScriptureReading[]
  remove(id: string): ScriptureReading[]
  removeMany(ids: string[]): ScriptureReading[]
}
```

Below the `deleteItem` prepared statement, add the transaction:

```ts
const deleteItems = db.transaction((ids: string[]) => {
  for (const id of ids) deleteItem.run(id)
})
```

Add to the returned object (after `remove`):

```ts
    removeMany(ids) {
      deleteItems(ids)
      return list()
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/scheduleRepo.test.ts`
Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/scheduleRepo.ts src/main/scheduleRepo.test.ts
git commit -m "feat(scripture): ScheduleRepo.removeMany in one transaction"
```

---

### Task 2: IPC plumbing for `schedule.removeMany`

**Files:**
- Modify: `src/shared/types.ts` (channel map ~line 188, `HelmApi.schedule` ~line 298)
- Modify: `src/main/ipc.ts` (~line 90)
- Modify: `src/preload/index.ts` (~line 46)

**Interfaces:**
- Consumes: `ScheduleRepo.removeMany(ids: string[]): ScriptureReading[]` from Task 1.
- Produces: `window.helm.schedule.removeMany(ids: string[]): Promise<ScriptureReading[]>` — the renderer surface Tasks 4–5 call. Channel name: `'schedule:removeMany'`.

There is no test harness for the plumbing layer (list/add/remove have none either); verification is typecheck + the full suite staying green. `src/preload/index.d.ts` only re-exports `HelmApi`, so it needs no edit.

- [ ] **Step 1: Add the channel constant**

In `src/shared/types.ts`, extend the schedule line of the `CH` map:

```ts
  scheduleList: 'schedule:list', scheduleAdd: 'schedule:add', scheduleRemove: 'schedule:remove',
  scheduleRemoveMany: 'schedule:removeMany',
```

- [ ] **Step 2: Add the API surface**

In `src/shared/types.ts`, extend `HelmApi.schedule`:

```ts
  schedule: {
    list(): Promise<ScriptureReading[]>;
    add(r: Omit<ScriptureReading, 'id'>): Promise<ScriptureReading[]>;
    remove(id: string): Promise<ScriptureReading[]>;
    removeMany(ids: string[]): Promise<ScriptureReading[]>;
  };
```

- [ ] **Step 3: Add the main-process handler**

In `src/main/ipc.ts`, after the `scheduleRemove` handler (~line 90):

```ts
  ipcMain.handle(CH.scheduleRemoveMany, (_e, ids: string[]) => scheduleRepo.removeMany(ids));
```

- [ ] **Step 4: Add the preload passthrough**

In `src/preload/index.ts`, inside the `schedule` block:

```ts
  schedule: {
    list: () => ipcRenderer.invoke(CH.scheduleList),
    add: (r) => ipcRenderer.invoke(CH.scheduleAdd, r),
    remove: (id) => ipcRenderer.invoke(CH.scheduleRemove, id),
    removeMany: (ids) => ipcRenderer.invoke(CH.scheduleRemoveMany, ids),
  },
```

- [ ] **Step 5: Verify typecheck and suite**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean. Vitest: `SermonMode.test.tsx` may now fail typecheck-in-test ONLY if the stub object is type-asserted — it is installed via `(window as unknown as { helm: unknown }).helm = {...}` so it will NOT fail here; the stub gains `removeMany` in Task 4. All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/ipc.ts src/preload/index.ts
git commit -m "feat(scripture): schedule.removeMany IPC channel"
```

---

### Task 3: Multi-select `useListSelection`

**Files:**
- Modify: `src/renderer/operator/useListSelection.ts` (full rewrite, small file)
- Test: `src/renderer/operator/useListSelection.test.tsx` (rewrite the Host, keep + extend cases)

**Interfaces:**
- Consumes: nothing new.
- Produces (Tasks 4–5 rely on these exact names):

```ts
useListSelection(orderedIds: string[]): ListSelection

interface ListSelection {
  selectedIds: string[];              // in orderedIds order, pruned of vanished ids
  selectedId: string | null;          // exactly-one convenience, else null
  select: (id: string) => void;       // plain click: [id], anchor = id
  selectTo: (id: string) => void;     // shift-click: contiguous anchor..id run; anchor stays put
  clear: () => void;
  isSelected: (id: string) => boolean;
}
```

Signature change note: the hook gains a required `orderedIds` parameter. Its only real consumer is `SermonMode.tsx:84` (`App.tsx`/`pickNeighbor.ts` mention it in comments only). This task updates SermonMode's call site minimally (`useListSelection(schedule.map((r) => r.id))` + `sel.selectedIds.length` guard in `onDelete`) so the app still compiles; the full behavioral rewiring is Task 4.

- [ ] **Step 1: Rewrite the test file with failing multi-select cases**

Replace `src/renderer/operator/useListSelection.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useState, type JSX } from 'react'
import { useListSelection } from './useListSelection'

afterEach(cleanup)

// Tiny host component so we exercise the hook through real React state transitions.
// Rows can be removed to simulate deletion happening elsewhere in the list.
function Host({ initialIds = ['a', 'b', 'c', 'd'] }: { initialIds?: string[] } = {}): JSX.Element {
  const [ids, setIds] = useState(initialIds)
  const sel = useListSelection(ids)
  return (
    <div>
      <span data-testid="selected">{sel.selectedId ?? 'none'}</span>
      <span data-testid="selected-ids">{sel.selectedIds.join(',') || 'none'}</span>
      <span data-testid="a-selected">{String(sel.isSelected('a'))}</span>
      {ids.map((id) => (
        <span key={id}>
          <button onClick={() => sel.select(id)}>{`select-${id}`}</button>
          <button onClick={() => sel.selectTo(id)}>{`shift-${id}`}</button>
          <button onClick={() => setIds((cur) => cur.filter((x) => x !== id))}>{`remove-${id}`}</button>
        </span>
      ))}
      <button onClick={() => sel.clear()}>clear</button>
    </div>
  )
}

const ids = (): string => screen.getByTestId('selected-ids').textContent ?? ''

describe('useListSelection', () => {
  it('selects, re-selects, and clears (single-select behavior unchanged)', () => {
    render(<Host />)
    expect(screen.getByTestId('selected').textContent).toBe('none')
    expect(screen.getByTestId('a-selected').textContent).toBe('false')

    fireEvent.click(screen.getByText('select-a'))
    expect(screen.getByTestId('selected').textContent).toBe('a')
    expect(screen.getByTestId('a-selected').textContent).toBe('true')

    fireEvent.click(screen.getByText('select-b'))
    expect(screen.getByTestId('selected').textContent).toBe('b')
    expect(screen.getByTestId('a-selected').textContent).toBe('false')

    fireEvent.click(screen.getByText('clear'))
    expect(screen.getByTestId('selected').textContent).toBe('none')
    expect(ids()).toBe('none')
  })

  it('selectTo with no anchor acts like select', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('shift-c'))
    expect(ids()).toBe('c')
    expect(screen.getByTestId('selected').textContent).toBe('c')
  })

  it('select then selectTo yields the contiguous run, in list order', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('select-a'))
    fireEvent.click(screen.getByText('shift-c'))
    expect(ids()).toBe('a,b,c')
    // multi-selection has no single selectedId
    expect(screen.getByTestId('selected').textContent).toBe('none')
  })

  it('a backwards shift-click still yields an ordered run', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('select-c'))
    fireEvent.click(screen.getByText('shift-a'))
    expect(ids()).toBe('a,b,c')
  })

  it('a second shift-click pivots from the anchor, it does not grow', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('select-b'))
    fireEvent.click(screen.getByText('shift-d'))
    expect(ids()).toBe('b,c,d')
    fireEvent.click(screen.getByText('shift-a'))
    expect(ids()).toBe('a,b') // anchored at b — NOT a,b,c,d
  })

  it('ids that vanish from the list drop out of the selection', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('select-a'))
    fireEvent.click(screen.getByText('shift-c'))
    fireEvent.click(screen.getByText('remove-b'))
    expect(ids()).toBe('a,c')
  })

  it('a vanished anchor makes the next selectTo act like select', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('select-a'))
    fireEvent.click(screen.getByText('remove-a'))
    expect(ids()).toBe('none')
    fireEvent.click(screen.getByText('shift-c'))
    expect(ids()).toBe('c')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/operator/useListSelection.test.tsx`
Expected: FAIL — the hook takes no argument, `selectTo`/`selectedIds` don't exist.

- [ ] **Step 3: Rewrite the hook**

Replace `src/renderer/operator/useListSelection.ts` with:

```ts
import { useCallback, useMemo, useState } from 'react';

export interface ListSelection {
  /** Selected row ids, in list order, pruned of ids no longer in the list. */
  selectedIds: string[];
  /** The single selected id when exactly one row is selected, else null. */
  selectedId: string | null;
  /** Plain click: selection becomes [id], and id becomes the range anchor. */
  select: (id: string) => void;
  /** Shift-click: the contiguous run between the anchor and id. The anchor stays
   * put (conventional pivot — a second shift-click re-ranges, never grows; the
   * behavior #22 pins as expected). With no live anchor, acts like select. */
  selectTo: (id: string) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

/**
 * Shared selection state for a list, now multi-capable. The reusable pattern is: this
 * hook for selection + `ModeKeyHandler.onDelete` for the keyboard action + the
 * context-menu primitive for right-click — reused wherever a schedule/list appears.
 *
 * `orderedIds` is the list's current order; `selectedIds` is derived against it, so
 * rows deleted elsewhere fall out of the selection with no effect bookkeeping.
 */
export function useListSelection(orderedIds: string[]): ListSelection {
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const selectedIds = useMemo(() => {
    const set = new Set(picked);
    return orderedIds.filter((id) => set.has(id));
  }, [orderedIds, picked]);

  const select = useCallback((id: string): void => {
    setPicked([id]);
    setAnchorId(id);
  }, []);

  const selectTo = useCallback(
    (id: string): void => {
      const anchor = anchorId !== null && orderedIds.includes(anchorId) ? anchorId : null;
      if (anchor === null || !orderedIds.includes(id)) {
        setPicked([id]);
        setAnchorId(id);
        return;
      }
      const i = orderedIds.indexOf(anchor);
      const j = orderedIds.indexOf(id);
      const [lo, hi] = i <= j ? [i, j] : [j, i];
      setPicked(orderedIds.slice(lo, hi + 1));
    },
    [anchorId, orderedIds]
  );

  const clear = useCallback((): void => {
    setPicked([]);
    setAnchorId(null);
  }, []);

  const isSelected = useCallback((id: string): boolean => selectedIds.includes(id), [selectedIds]);

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  return { selectedIds, selectedId, select, selectTo, clear, isSelected };
}
```

- [ ] **Step 4: Minimally update SermonMode's call site so the app compiles**

In `src/renderer/operator/SermonMode.tsx`:

Line 84 (`schedule` state is declared above it, line 80):

```ts
  const sel = useListSelection(schedule.map((r) => r.id));
```

Line 707–709 — `sel.selectedId` still exists and single-delete still works, leave `onDelete` as-is for this task (Task 4 rewires it to the batch).

- [ ] **Step 5: Run the hook tests and the full suite**

Run: `npx vitest run src/renderer/operator/useListSelection.test.tsx && npx vitest run && npm run typecheck`
Expected: all PASS. SermonMode's existing tests exercise single-select paths only, which behave identically.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/useListSelection.ts src/renderer/operator/useListSelection.test.tsx src/renderer/operator/SermonMode.tsx
git commit -m "feat(scripture): multi-select useListSelection with pivot shift semantics"
```

---

### Task 4: SermonMode bulk delete — shift-click, keyboard, context menu, batch undo

**Files:**
- Modify: `src/renderer/operator/SermonMode.tsx` (removeReading→removeReadings ~line 400, undo ~85/425/789, rows ~612, onDelete ~707)
- Modify: `src/renderer/operator/SchedulePanel.tsx` (`ScheduleRow.onClick` gains the mouse event, ~line 19)
- Test: `src/renderer/operator/SermonMode.test.tsx`

**Interfaces:**
- Consumes: `window.helm.schedule.removeMany(ids)` (Task 2); `sel.selectedIds` / `sel.selectTo(id)` (Task 3).
- Produces: `removeReadings(ids: string[]): void` inside SermonMode (Task 5's Clear-all calls it); `ScheduleRow.onClick: (e: ReactMouseEvent) => void`.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/operator/SermonMode.test.tsx`:

(a) Extend the stub in `installHelmStub`: add a `removeMany` mock next to `remove` and return it. In the return-type annotation add `removeMany: ReturnType<typeof vi.fn>`; in the body:

```ts
  const removeMany = vi.fn(() => Promise.resolve([]))
```

change the schedule stub line to:

```ts
    schedule: { list: () => Promise.resolve(schedule), add, remove: vi.fn(() => Promise.resolve([])), removeMany },
```

and add `removeMany,` to the returned object.

(b) Add a describe block (module scope, e.g. after the onAction wiring block; uses the existing `Harness`, `NOTHING_LIVE`, `ModeKeyHandlerRef` imports):

```tsx
describe('SermonMode — schedule multi-select and bulk delete', () => {
  const THREE: ScriptureReading[] = [
    { id: 'r1', book: 'Genesis', ch: 1, from: 1, to: 1 },
    { id: 'r2', book: 'Genesis', ch: 1, from: 2, to: 2 },
    { id: 'r3', book: 'Genesis', ch: 1, from: 3, to: 3 }
  ]
  const rowButton = (title: string): HTMLElement =>
    screen.getByText(title).closest('button') as HTMLElement

  it('shift-click selects the contiguous run without moving the rail cursor', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, THREE)
    render(<Harness />)
    resolveChapter()
    await screen.findByText('Genesis 1:1')

    fireEvent.click(rowButton('Genesis 1:1'))
    fireEvent.click(rowButton('Genesis 1:3'), { shiftKey: true })

    for (const t of ['Genesis 1:1', 'Genesis 1:2', 'Genesis 1:3']) {
      expect(rowButton(t).getAttribute('data-selected')).toBe('true')
    }
  })

  it('Delete removes the whole selection via one removeMany call and arms a batch undo', async () => {
    const { resolveChapter, removeMany } = installHelmStub(NOTHING_LIVE, THREE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await screen.findByText('Genesis 1:1')

    fireEvent.click(rowButton('Genesis 1:1'))
    fireEvent.click(rowButton('Genesis 1:2'), { shiftKey: true })
    act(() => keyHandlerRef.current?.onDelete?.())

    await waitFor(() => expect(removeMany).toHaveBeenCalledTimes(1))
    expect(removeMany).toHaveBeenCalledWith(['r1', 'r2'])
    await screen.findByText(/2 readings/)
  })

  it('undo after a bulk delete re-adds every reading in order', async () => {
    const { resolveChapter, add } = installHelmStub(NOTHING_LIVE, THREE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await screen.findByText('Genesis 1:1')

    fireEvent.click(rowButton('Genesis 1:1'))
    fireEvent.click(rowButton('Genesis 1:2'), { shiftKey: true })
    act(() => keyHandlerRef.current?.onDelete?.())
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(add).toHaveBeenCalledTimes(2))
    expect(add.mock.calls[0][0]).toMatchObject({ book: 'Genesis', ch: 1, from: 1, to: 1 })
    expect(add.mock.calls[1][0]).toMatchObject({ book: 'Genesis', ch: 1, from: 2, to: 2 })
  })

  it('single-item delete still works and keeps its formatRef toast label', async () => {
    const { resolveChapter, removeMany } = installHelmStub(NOTHING_LIVE, THREE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await screen.findByText('Genesis 1:2')

    fireEvent.click(rowButton('Genesis 1:2'))
    act(() => keyHandlerRef.current?.onDelete?.())

    await waitFor(() => expect(removeMany).toHaveBeenCalledWith(['r2']))
    // Toast label is the ref, not "1 readings". Anchor on the toast's own "Removed"
    // text — the row title also reads "Genesis 1:2", so matching the ref alone could
    // pass against the not-yet-unmounted row.
    await waitFor(() => expect(screen.getByText(/Removed/).textContent).toMatch(/Genesis 1:2/))
    expect(screen.queryByText(/1 readings/)).toBeNull()
  })
})
```

Note: `ScriptureReading` is already imported by the test file (used in `installHelmStub`'s signature); `act`, `waitFor`, `fireEvent`, `screen` likewise.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx`
Expected: the 4 new tests FAIL (shift-click jumps instead of range-selecting; delete calls `remove`, not `removeMany`). Existing tests PASS.

- [ ] **Step 3: Change `ScheduleRow.onClick` to carry the mouse event**

In `src/renderer/operator/SchedulePanel.tsx` line 19:

```ts
  onClick: (e: ReactMouseEvent) => void;
```

(`ReactMouseEvent` is already imported.) The row `<button onClick={r.onClick}>` already passes the event through — no JSX change.

- [ ] **Step 4: Rewire SermonMode**

In `src/renderer/operator/SermonMode.tsx`:

(a) Line 85 — batch undo:

```ts
  const undo = useTimedUndo<ScriptureReading[]>();
```

(b) Replace `removeReading` (~line 400) with the batch version (comment updated to match):

```ts
  // Immediate remove + a self-clearing "Removed — Undo" affordance (no blocking dialog).
  // Toast/selection-clear happen on IPC success so a rejected remove doesn't falsely claim
  // removal. One removeMany call covers single-item delete, a shift-click range, and
  // Clear-all alike — always one IPC round-trip, one transaction. Undo re-adds via
  // schedule.add, which appends at the end (position-preserving restore is a follow-up —
  // see the interaction-primitives design's Known caveats).
  const removeReadings = (ids: string[]): void => {
    const readings = schedule.filter((r) => ids.includes(r.id));
    if (readings.length === 0) return;
    window.helm.schedule
      .removeMany(readings.map((r) => r.id))
      .then((rows) => {
        setSchedule(rows);
        if (ids.some((id) => sel.isSelected(id))) sel.clear();
        undo.arm(readings);
      })
      .catch(console.error);
  };
```

(c) Replace `undoRemove` (~line 425):

```ts
  // Sequential re-adds keep the batch's relative order; the last response is the
  // authoritative list. Cancel first so a re-click can't double-restore.
  const undoRemove = (): void => {
    const batch = undo.pending;
    if (!batch) return;
    undo.cancel();
    (async () => {
      let rows: ScriptureReading[] | null = null;
      for (const { book, ch, from, to } of batch) {
        rows = await window.helm.schedule.add({ book, ch, from, to });
      }
      if (rows) setSchedule(rows);
    })().catch(console.error);
  };
```

(d) `scheduleRows` (~line 612) — shift-click ranges, plain click jumps; context menu acts on the selection when the row is inside a multi-selection:

```ts
      onClick: (e) => {
        if (e.shiftKey) sel.selectTo(r.id);
        else jumpToReading(r);
      },
      onContextMenu: (e) => {
        if (sel.isSelected(r.id) && sel.selectedIds.length > 1) {
          const ids = sel.selectedIds;
          contextMenu.open(e, [
            { label: `Delete ${ids.length} readings`, danger: true, onSelect: () => removeReadings(ids) }
          ]);
        } else {
          sel.select(r.id);
          contextMenu.open(e, [{ label: 'Delete', danger: true, onSelect: () => removeReadings([r.id]) }]);
        }
      }
```

(e) `onDelete` (~line 707):

```ts
      onDelete: () => {
        if (track === 'scripture' && sel.selectedIds.length > 0) removeReadings(sel.selectedIds);
      },
```

(f) Toast label (~line 789):

```ts
            undo={
              undo.pending
                ? {
                    label:
                      undo.pending.length === 1
                        ? formatRef(undo.pending[0])
                        : `${undo.pending.length} readings`,
                    onUndo: undoRemove
                  }
                : undefined
            }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx src/renderer/operator/SchedulePanel.test.tsx && npm run typecheck`
Expected: all PASS (SchedulePanel's `onClick: vi.fn()` rows still satisfy the widened signature).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/SermonMode.tsx src/renderer/operator/SchedulePanel.tsx src/renderer/operator/SermonMode.test.tsx
git commit -m "feat(scripture): shift-click multi-select with bulk delete and batch undo"
```

---

### Task 5: Clear schedule control

**Files:**
- Modify: `src/renderer/operator/SchedulePanel.tsx` (header row, ~line 177; new prop)
- Modify: `src/renderer/operator/SermonMode.tsx` (pass `onClearAll`, ~line 788)
- Test: `src/renderer/operator/SchedulePanel.test.tsx`, `src/renderer/operator/SermonMode.test.tsx`

**Interfaces:**
- Consumes: `removeReadings(ids)` from Task 4.
- Produces: `SchedulePanelProps.onClearAll?: () => void` — rendered as a "Clear all" button in the schedule header only when `rows.length > 0`.

- [ ] **Step 1: Write the failing tests**

Append to the describe block in `src/renderer/operator/SchedulePanel.test.tsx`:

```tsx
  it('shows Clear all only when there are rows, and fires onClearAll', () => {
    const onClearAll = vi.fn()
    render(<SchedulePanel {...baseProps} onClearAll={onClearAll} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })

  it('hides Clear all when the schedule is empty', () => {
    render(<SchedulePanel {...baseProps} rows={[]} onClearAll={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()
  })
```

Append to the multi-select describe block in `src/renderer/operator/SermonMode.test.tsx` (reuses its `THREE` fixture):

```tsx
  it('Clear all removes every reading in one removeMany call, recoverable via undo', async () => {
    const { resolveChapter, removeMany } = installHelmStub(NOTHING_LIVE, THREE)
    render(<Harness />)
    resolveChapter()
    await screen.findByText('Genesis 1:1')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

    await waitFor(() => expect(removeMany).toHaveBeenCalledTimes(1))
    expect(removeMany).toHaveBeenCalledWith(['r1', 'r2', 'r3'])
    await screen.findByText(/3 readings/)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/operator/SchedulePanel.test.tsx src/renderer/operator/SermonMode.test.tsx`
Expected: the 3 new tests FAIL — no "Clear all" button exists.

- [ ] **Step 3: Implement the control**

In `src/renderer/operator/SchedulePanel.tsx`:

(a) Add to `SchedulePanelProps` (after `undo`):

```ts
  /** Clear-schedule control; the button renders only when the schedule is non-empty.
   * Destructive but recoverable — the caller routes it through the same removeMany +
   * undo-toast path as row deletes, so there is no confirmation dialog. */
  onClearAll?: () => void;
```

(b) Replace the `SCRIPTURE SCHEDULE` header div (~line 177) with:

```tsx
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 8px', flexShrink: 0 }}>
            <span style={{ fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600 }}>
              SCRIPTURE SCHEDULE
            </span>
            {onClearAll && rows.length > 0 && (
              <button
                style={{ fontSize: '10px', letterSpacing: '0.05em', fontWeight: 600, color: T.faint, cursor: 'pointer' }}
                onClick={onClearAll}
              >
                Clear all
              </button>
            )}
          </div>
```

(c) Add `onClearAll` to the destructured props in the function signature (after `undo`).

In `src/renderer/operator/SermonMode.tsx`, pass it from the `SchedulePanel` call site (~line 788, after `rows={scheduleRows}`):

```tsx
            onClearAll={() => removeReadings(schedule.map((r) => r.id))}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SchedulePanel.test.tsx src/renderer/operator/SermonMode.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Full verification**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: full suite green, typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/SchedulePanel.tsx src/renderer/operator/SermonMode.tsx src/renderer/operator/SchedulePanel.test.tsx src/renderer/operator/SermonMode.test.tsx
git commit -m "feat(scripture): Clear all control for the scripture schedule"
```
