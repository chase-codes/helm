# Shared interaction primitives — context menu + selectable rows/Delete

**Date:** 2026-07-06
**Status:** Design approved, ready for implementation plan
**Roadmap:** `docs/superpowers/roadmap.md` → "Cross-cutting enablers" (first two bullets)

## Goal

Build the two shared interaction primitives called out as cross-cutting enablers, and
prove each by wiring **one** real consumer. The downstream features that will ride on
them (Songs quick-edit, schedule delete everywhere) are separate follow-ups — this work
delivers reusable primitives, not those features.

1. **Context-menu primitive** — a reusable right-click menu (cursor-positioned, keyboard-
   navigable, theme-aware, dismiss on Escape/outside-click/scroll). No `onContextMenu`
   handling exists in the renderer today; this is net-new.
2. **Selectable list rows + `Delete`** — a shared "select a row, act on it (keyboard or
   context menu)" pattern, reused wherever a schedule/list appears.

## Product decisions (locked)

- **Delete UX:** immediate removal (no blocking dialog) + a brief transient "Removed —
  Undo" affordance (~5s). Keeps the keyboard-first flow, protects against slips.
- **Selection model:** in the schedule list, a left-click does what it does today (cue/
  jump to that reading) **and** marks the row selected. `Delete` then removes the last-
  selected row; right-click selects + opens the menu. The selection ring is visually
  distinct from the live/current dot.

## Non-goals / scope boundaries (deliberately out)

- Full keyboard row-navigation of the schedule (Up/Down cursor through rows) — collides
  with arrows currently bound to verse-stepping; its own follow-up.
- Real Songs quick-edit — the context-menu "Edit" handler is an intentional stub.
- Delete on the non-scripture sermon tracks (message/slides) — the pattern is reused-
  ready, but those tracks render no schedule list today.
- Position-preserving undo — see "Known caveats".

---

## Primitive A — context menu

### Files (new)
- `src/renderer/operator/ContextMenu.tsx` — the presentational menu + its behavior.
- `src/renderer/operator/useContextMenu.tsx` — hook that owns open/position/items state
  and returns the element to render (so a consumer wires it in ~3 lines).

### Public API
```ts
export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;    // red styling (e.g. Delete)
  disabled?: boolean;
}

// hook
const { open, close, menu } = useContextMenu();
//   open(e: React.MouseEvent, items: ContextMenuItem[]): void  — preventDefault + capture
//                                                                 clientX/clientY + trigger
//   close(): void
//   menu: ReactNode  — drop into JSX once; renders null while closed
```

Consumer shape:
```tsx
const { open, menu } = useContextMenu();
return (
  <>
    <button onContextMenu={(e) => open(e, [{ label: 'Edit', onSelect: () => editSong(id) }])}>…</button>
    {menu}
  </>
);
```

### Behavior
- **Positioning:** `position: fixed` at the cursor's `clientX/clientY`; after mount,
  measure the menu and clamp/flip so it never overflows the viewport.
- **Rendering/style:** mirrors the existing `VersionPicker` float — `T.panel3` background,
  drop-shadow + inset hairline, rounded rows with a hover/active highlight. `danger` items
  render in the live/red accent. Consumes `ThemeCtx` directly via `useContext` (no theme
  prop) since it is invoked from many call sites.
- **Dismiss:** outside-click (a full-viewport scrim), Escape, scroll, window resize/blur.
- **Keyboard & a11y:** `role="menu"`, items `role="menuitem"` with `aria-disabled`.
  ArrowDown/Up roving highlight, Home/End, Enter/Space activate, Escape/Tab close. Focus
  moves into the menu on open and is restored to the trigger element on close.
- **Cooperation with the existing keyboard architecture:** while open, the menu listens on
  the **capture phase** and `stopPropagation`s the keys it handles, so App.tsx's global
  `document` keydown delegate does **not** also step cues / go live / close settings. On
  close the menu removes its listeners and App's delegate is untouched — nothing permanent
  is added to `ModeKeyHandler`. This is the "fit, don't fight" requirement: a menu is a
  transient, cross-cutting overlay, so it owns the keyboard only while visible rather than
  routing Escape through each mode's `onEscape` (which would couple every mode to the menu).
- **Cooperation with `blurOnPointerClick`:** right-click fires `onContextMenu`, not
  `click`, so opening never trips the blur handler. The scrim is a `div` (not a `button`),
  so outside-click dismissal is ignored by `blurOnPointerClick` too.

### Consumer proof #1 — Songs "Edit"
- `SongSearchRail` gains an `onRowContextMenu?: (id: string, e: React.MouseEvent) => void`
  prop; each song-list row wires `onContextMenu`.
- `SongsMode` owns `useContextMenu()` and supplies a single `Edit` item.
- The `Edit` handler is an **intentional stub**: it selects the song and logs intent, with
  a comment pointing at the Quick-edit follow-up. The menu — not quick-edit — is the
  deliverable.

---

## Primitive B — selectable rows + Delete

### Files (new)
- `src/renderer/operator/useListSelection.ts` — `{ selectedId, select, clear, isSelected }`.
  Deliberately small; the reusable asset is the *pattern* (selection state + Delete
  dispatch + right-click Delete), not the line count.

### Delete-key dispatch — fits the existing delegate
- Extend `ModeKeyHandler` (App.tsx) with optional `onDelete?: () => void`.
- App's global keydown handles `Delete` **and** `Backspace` (Mac's primary key reports as
  `Backspace`), placed **after** the existing `typing` guard so editing an input is never
  hijacked. It only acts/`preventDefault`s when the active mode provides `onDelete`.
- Triple-guarded before anything is removed: not typing + mode provides `onDelete` + a row
  is actually selected (checked inside the mode's `onDelete`).
- **Rejected alternative:** a second `document` keydown listener inside `useListSelection`.
  It races App's single delegate and re-introduces the multi-handler problem the App
  architecture was built to avoid.

### Consumer proof #2 — schedule delete (`SchedulePanel` / `SermonMode`)
- `ScheduleRow` gains an `isSelected` flag (distinct selection ring vs. the live dot) and
  the row wires both `onClick` (cue/jump — unchanged) **and** `onContextMenu`.
- A left-click on a schedule row calls the existing jump **and** `select(id)`.
- `SermonMode` owns `selectedScheduleId` (via `useListSelection`) and a `removeReading(id)`:
  captures the reading for undo, calls `window.helm.schedule.remove(id)`, updates the
  schedule, clears the selection if it was the removed row, and raises the undo toast.
- `ModeKeyHandler.onDelete` → if a schedule row is selected (scripture track),
  `removeReading(selectedId)`.
- Right-click → `select(id)` + `open(e, [{ label: 'Delete', danger: true, onSelect: …}])`.
- **Undo toast:** a small transient affordance in `SchedulePanel`, driven by an
  `undo?: { label: string; onUndo: () => void }` prop; `SermonMode` owns the ~5s timeout.
  Undo re-adds via `window.helm.schedule.add(reading)`.

---

## Net-new IPC — schedule remove (required to prove B)

`window.helm.schedule` exposes only `list`/`add` today. Following the existing
`media.remove(id)` / `preservice.removeCard(id)` idiom, add end-to-end:

- `scheduleRepo.remove(id: string): ScriptureReading[]` — delete the `service_items` row
  by id, return the updated `list()`.
- `CH.scheduleRemove = 'schedule:remove'` in `src/shared/types.ts`.
- `ipcMain.handle(CH.scheduleRemove, (_e, id) => scheduleRepo.remove(id))` in `ipc.ts`.
- preload: `remove: (id) => ipcRenderer.invoke(CH.scheduleRemove, id)`.
- `HelmApi.schedule.remove(id: string): Promise<ScriptureReading[]>` type.

---

## Known caveats

1. **Undo ordering** — `scheduleRepo.add` appends at the end, so an undone reading returns
   at the *bottom* of the schedule, not its original slot. Accepted for the enabler;
   position-preserving undo is a follow-up.
2. **Backspace-as-Delete** — included intentionally (Mac keyboards' main delete key reports
   as `Backspace`), triple-guarded as above.

---

## Testing (TDD, existing `*.test.tsx` style)

- `ContextMenu.test.tsx` — opens at the cursor position; renders items with `menu`/
  `menuitem` roles; Escape and outside-click dismiss; Enter/click fire `onSelect`;
  ArrowDown/Up move the active item; a `disabled` item is not activatable; `danger`
  styling applied.
- `SchedulePanel.test.tsx` — a selected row renders the selection styling; click fires the
  select/cue callback; right-click fires `onRowContextMenu`; the undo toast renders and its
  button fires `onUndo`.
- `scheduleRepo` — `remove` deletes by id and returns the updated list (add + remove).
- App-level — pressing `Delete` (and `Backspace`), while not typing, dispatches the active
  mode's `onDelete`; does nothing when the mode provides none.
- `SongSearchRail` — right-clicking a row fires `onRowContextMenu` with the row id.

## Constraints honored

- CLAUDE.md: concise conventional-commit subjects; no Co-Authored-By / Claude-Session
  trailers.
- Keyboard-first, live mid-service: nothing mouse-only for the delete *action* (Delete key
  + right-click both work); Escape always backs out; the menu never traps focus past close.
- Renderer idioms: inline-style + `ThemeCtx`, existing rail/panel components, `*.test.tsx`.
- Accessibility: ARIA menu roles, keyboard operable.
