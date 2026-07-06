# Helm — Roadmap / Backlog

Captured feature ideas not yet scheduled. Each item is a candidate for its own
brainstorm → spec → plan cycle; details here record **intent**, not final design.

**Started:** 2026-07-05

---

## Cross-cutting enablers

Several items below share these foundations — worth building once as reusable primitives.

- **Right-click context menus.** No `onContextMenu` handling exists in the renderer yet.
  This is net-new and underpins: songs edit / quick-edit, and schedule-item actions
  (delete). Build a small shared context-menu primitive rather than one-off menus.
- **Selectable list rows + `Delete`-key handling.** A shared "select a row, act on it
  (keyboard or context menu)" pattern used by the schedule lists (scripture, sermon,
  and the other sermon-view tracks). One implementation, reused wherever a list of
  scheduled/queued items appears.
- **Assignable hotkey system + hotkey recorder.** A bindings layer where navigation and
  actions map to operator-assignable keys, plus a recorder UI to capture a keystroke and
  assign it. Enables the songs hotkeys below and likely go-live / take-down bindings
  app-wide. Substantial subsystem — spec on its own.
- **Reusable scripture-search component.** Extract the sermon view's scripture-search /
  reference experience (currently entangled in `SermonMode` — ref builder, chapter rail,
  version picker) into a standalone embeddable unit. Enables the dedicated pre-service
  scripture item below. (Related: the shipped lightweight pre-service verse look-up —
  `docs/superpowers/specs/2026-07-05-helm-preservice-verse-lookup-design.md` — was the
  minimal "reference + Look up"; this is the richer full-search experience.)

---

## Songs

- **Right-click → Edit.** Context-menu "Edit" on a song row to open it for editing.
- **Quick edit (right-click → Edit) — in-place, non-disruptive.** A super-fast path to fix
  typos without disrupting the service for the song leader. Stays in the current view and
  edits **directly in the preview**. **Enter saves**; **Shift+Enter inserts a real newline.**
- **Count label: "X verses" instead of "X sections."** Replace the current
  `song.sections.length` "sections" label (`SongsMode.tsx:39,43`) with a verse count =
  the number of actual verse sections **plus one chorus, counted a single time even though
  it repeats.** (Counting rule depends on section-label semantics — Verse/Chorus/Bridge.)
- **Secondary lyric matches under a title search.** Even when "search by title" is selected,
  show a small secondary subsection of likely **lyric** matches — roughly the **top 3** —
  clearly subordinate and **never taking precedence over the title results**. Not a full
  lyric search; just a "you might also mean…" hint.
- **Assignable navigation/action hotkeys** (part of the hotkey system above). Concrete asks:
  - **Home** → jump back to the chorus quickly.
  - **Ctrl+X then a number** → jump to that verse.
  - Bindings for **go live** and **take down**.
  - All of the above **operator-assignable** via the hotkey recorder.

---

## Pre-service

- **Pre-live selection marker.** When the operator selects a card **before anything is live**,
  highlight it as a marker indicating **it will go live if engaged** — an "armed / will-cue"
  state visually distinct from the current "● ON SCREEN" (actually live) highlight.
- **Dedicated scripture-search item.** A first-class pre-service item that matches the full
  sermon scripture-search experience (browse/search, not just type-a-reference). Depends on
  the *reusable scripture-search component* enabler above (break the capability out of
  `SermonMode` first).

---

## Sermon / Scripture (and other schedule lists)

- **Selectable schedule items with delete.** Be able to select items in the schedule and
  remove them — via **right-click → delete from schedule**, and for scriptures in the
  schedule via the **`Delete` key**. Apply the same select-and-delete pattern **wherever a
  schedule/list appears** in the sermon view (scripture, sermon, and the other tracks).
  Builds on the *selectable list rows + Delete-key* and *context-menu* enablers.
