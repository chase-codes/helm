# Helm — Roadmap / Backlog

Captured feature ideas not yet scheduled. Each item is a candidate for its own
brainstorm → spec → plan cycle; details here record **intent**, not final design.

**Started:** 2026-07-05

---

## Cross-cutting enablers

Several items below share these foundations — worth building once as reusable primitives.

- ~~**Right-click context menus.**~~ ✅ **Shipped** — `ContextMenu.tsx` + `useContextMenu.tsx`,
  consumed by `App`, `SermonMode`, `SongsMode`, `SlidesTrack`. Anything below that wanted a
  context menu is now wiring, not net-new.
- ~~**Selectable list rows + `Delete`-key handling.**~~ ✅ **Shipped** — `useListSelection.ts`
  plus `useTimedUndo.ts` / `UndoToast.tsx` for the "Removed — Undo" affordance. See
  `docs/superpowers/specs/2026-07-06-interaction-primitives-design.md`.
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
- ~~**Count label: "X verses" instead of "X sections."**~~ ✅ **Shipped** (`69a6fce`) — landed
  as **"N stanzas"** (accurate for any block: verse/chorus/bridge/tag) = `song.sections.length`,
  matching the Section Rail row count. See `docs/superpowers/specs/2026-07-06-songs-quick-wins-design.md`.
- ~~**Secondary lyric matches under a title search.**~~ ✅ **Shipped** (`10f1509`) — a subordinate
  "Also in lyrics" group (top 3, deduped) shown only when title results are thin (fewer than 3).
- **Move the import entry point into Settings → Songs, except on an empty library.**
  (Operator, 2026-08-04.) Import is a once-or-twice-in-a-lifetime migration, but it currently
  sits permanently in the song search rail — prime real estate next to the control the operator
  uses every single service. It belongs in Settings, where `SECTIONS` already carries a
  **`songs`** entry stubbed `enabled: false` (`SettingsModal.tsx:16-22`) waiting for content.
  The exception is a **fresh install with an empty library**: hiding the only way to fill it
  behind a settings pane is precisely the "reason not to migrate" the feature exists to remove,
  so an empty library should still surface the import prominently — as the empty state of the
  song list itself, which is where a new user is already looking and is more discoverable than
  today's button. Once the library has songs, that prompt disappears and Settings is the home.
  Small and self-contained: the wizard, IPC and orchestrator are untouched; this moves the
  entry point and adds an empty-state branch. Note `SongsMode` currently owns the wizard's
  `importOpen`/`importInFlight` state and its Escape gate, so mounting it from Settings needs
  that guard to travel with it or be reproduced.
- **Song library import.** A way to bring in an existing song library rather than entering
  songs one at a time. Multiple source formats eventually, but the immediate need is
  **importing from EasyWorship 8's format**. (Found during Windows rehearsal testing,
  2026-07-09.)
  - **Update (2026-07-31): shipped, pending verification against a real library.** An
    **Import songs** wizard in Songs mode: pick the source program, pick the folder, review
    every song found (new / already in Helm / unreadable, each with a reason), import, then a
    summary that *names* what didn't come through. Songs land via `songsRepo.add()`, so they
    are sectioned, indexed and searchable exactly like hand-entered ones.
    Built behind an `ImportSource` seam (`src/main/importSources/`) so CSV or another program
    is a new adapter plus a registry entry — no changes to the RTF stripper, tidy rules,
    dedupe, orchestrator or wizard. Exactly one adapter ships.
    Two facts worth keeping, both established before any code was written: EasyWorship 6.1+
    stores its library as **plain SQLite** (`Songs.db`/`SongWords.db`, lyrics as RTF) — not
    Firebird, not Paradox — so `better-sqlite3` reads it with no new dependency; and it
    declares a custom collation (`UTF8_U_CI`) that no Node SQLite driver can register, so the
    adapter's SQL must carry **no `WHERE` and no `ORDER BY`** against a text column. A
    committed fixture declares that collation specifically so a test fails if anyone
    reintroduces one.
    Spec: `docs/superpowers/specs/2026-07-30-song-library-import-design.md`; plan:
    `docs/superpowers/plans/2026-07-30-song-library-import.md`.
    **Still owed:** the schema is corroborated by two independent open-source tools but no
    real EasyWorship library has ever been opened. First task on the Windows machine is
    `PRAGMA table_info(song)`/`(word)` plus one real `words` blob — see the handoff note
    `docs/superpowers/notes/2026-07-31-song-import-windows-handoff.md`.
- **Assignable navigation/action hotkeys** (part of the hotkey system above). Concrete asks:
  - **Home** → jump back to the chorus quickly.
  - **Ctrl+X then a number** → jump to that verse.
  - Bindings for **go live** and **take down**.
  - All of the above **operator-assignable** via the hotkey recorder.
- ~~**Min/max audience-view font size based on verse length.**~~ ✅ **Shipped** (`de0d393`) —
  content length now determines the fit (a shorter verse/stanza renders larger, a longer one
  shrinks to stay readable); the band (`bandCandidates` in `SlideCanvas.tsx`) supplies the
  min and max, tuned for projector legibility rather than a fixed size. Also closed
  **BUG-007** (`docs/superpowers/bugs.md`). (Found during Windows rehearsal testing,
  2026-07-08.)

---

## Pre-service

- ~~**Pre-live selection marker.**~~ ✅ **Shipped** (`c59565d`) — a selected-but-not-live card
  now carries `● ARMED` (accent ring, no fill), visually distinct from `● ON SCREEN` (filled,
  live). Landed alongside the BUG-008 fix, which also added **Show this card** as the
  deliberate single-card takeover. See `bugs.md` BUG-008.
- ~~**Decide what a single click on a card should do.**~~ **Decided, and smaller than it looked**
  — switching what is already on screen is free; starting to project is not. The rule turns out
  to be an existing primitive: `shared/presentation/core.ts` already offers `showLive`
  ("no-op unless output is live, then switch freely") next to `goLive` ("start projecting"),
  and Songs/Sermon/Message already bind `goLive` to explicit controls while navigating via
  `show`. Pre-service is the only mode routing a *tap* through `goLive`. So this is a verb
  swap in `preserviceEngine`, not a new design. See `bugs.md` BUG-018.
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
  - **Update (2026-07-07):** the two enablers + the **scripture** consumer shipped —
    select a schedule row (click cues + selects), `Delete`/`Backspace` or right-click →
    Delete removes it with an immediate "Removed — Undo" affordance. Message/slides tracks
    still pending (they render no schedule list yet; the `useListSelection` /
    `useTimedUndo` / `UndoToast` / context-menu pieces are reuse-ready). See
    `docs/superpowers/specs/2026-07-06-interaction-primitives-design.md`.

- **Scroll the scheduled reading to the top of the preview on select.** When a scheduled
  verse (or verse range) is clicked in the schedule rail, scroll the chapter/verse preview
  so the reading's **first verse sits at the top** of the visible area — don't just
  highlight it in place. Today clicking a schedule row jumps the cue (`jumpTo` → `scrV` in
  `SermonMode`) but the verse preview (`ChapterRail`) doesn't bring the target into view,
  so a reading deep in a long chapter leaves the operator scrolling to find it mid-service.
  Bringing the first verse to the top makes the passage immediately ready for both the
  operator and the on-screen speaker. Likely a `scrollIntoView` on the cued/selected first
  verse card in `ChapterRail`, triggered on schedule-row select. Consider the same courtesy
  wherever a list drives a scrollable preview.

- **Direct preview → live/cue for scripture, without scheduling first.** Today, cuing a
  scripture reading requires adding it to the schedule and then clicking to it — there's no
  way to select a passage in the preview pane and immediately cue/go-live with it directly.
  Want a fast path: select a scripture in the preview, and if the sermon view is already
  live, switch straight to it (skip the add-to-schedule detour). (Found during Windows
  rehearsal testing, 2026-07-08.)
  - **Update (2026-07-29): shipped.** One cursor, moved identically by a rail tap, an arrow,
    or a schedule-row click; it reaches the projector when output is live (any book, any
    chapter) and is preview-only when it isn't. `+ Add`/Enter file a schedule row and never
    reach the screen; `Go live`/Shift+Enter reach the screen and never write a row. Added a
    third presentation verb, `showLive` — like `applyCue` but following across books and
    chapters, like `goLive` but never toggling to black. Spec:
    `docs/superpowers/specs/2026-07-29-scripture-direct-live-design.md`; plan:
    `docs/superpowers/plans/2026-07-29-scripture-direct-live.md`.
    Three hazards the final review caught and fixed, worth remembering when touching this
    area: `showLive` needs its *kind*-level guard or scripture navigation overwrites a live
    song; the builder must refuse a half-typed reference rather than substituting the cursor
    and forcing output live; and the `Go live`/`Take down` button must act on its own label
    rather than re-deriving the toggle, now that cursor moves commit immediately.
    Follow-ups logged: BUG-010, BUG-011, BUG-012. Not covered by tests: an end-to-end
    cross-mode assertion that scripture cannot seize the screen from Songs — the reducer is
    unit-tested and the two known reproductions are blocked by construction.

- ~~**Book-name typeahead in the ref builder.**~~ ✅ **Shipped** (`c9d46a3`) — the entry now
  shows the book space would commit as dim ghost text inline, in two forms: an inline tail
  (`gen`→`esis`) when the query prefixes the name, and an arrow (`jhn → John`) when the
  matching alias doesn't. The invariant — *a ghost is visible iff space (or Tab) commits it*
  — is structural, not conventional: the commit rule moved out of `printable` into an
  exported `bookCompletion` (`refBuilder.ts`) that both the keystroke handler and the
  renderer call, pinned by a table-driven property test. The ghost is an overlay span, never
  part of the input's `value`.
  Measuring the design turned up a second defect and pulled it into scope: `matchBook`'s
  prefix branch returned the first match in canonical order, so **the example in this entry
  was wrong** — `BOOKS` is in canonical order, so `jo` gave *Joshua*, not John, and `ma` gave
  *Malachi*. A preview would have advertised that on every keystroke, so the branch now
  prefers a curated `RANKED_BOOKS` list (`books.ts`) with canonical order as the tie-break;
  the exact-alias branch is untouched, pinned by a test that every bundled-KJV book name —
  including the variants `Psalms` and `Song of Songs` — resolves exactly, out of the
  ranking's reach (`bibleSource` maps downloaded book names through `matchBook`).
  Rejected, with reasons in the spec: chapter/verse-stage hints (a range display, not a
  completion, and it sits on the extent-fetch path where **BUG-010** already drops digits
  typed at speed), Tab-cycling through alternatives (one more letter disambiguates), and
  usage-based ranking (same keystrokes would resolve differently week to week, and cold-start
  empty on a fresh install). `ti` and `co` stay "wrong" — Timothy and Corinthians are
  numbered, so no ranking reaches them bare; the ghost at least makes that visible now.
  Spec: `docs/superpowers/specs/2026-08-05-scripture-book-typeahead-design.md`.

- **Background choices for scripture (and similar) audience output.** A settings flow
  letting operators choose the background shown behind scripture text on the audience
  view, rather than a fixed look. (Found during Windows rehearsal testing, 2026-07-09.)
