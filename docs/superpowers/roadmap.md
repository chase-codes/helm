# Helm — Roadmap / Backlog

**The backlog now lives in [GitHub issues](https://github.com/chase-codes/helm/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement).**

File new feature ideas there with the `enhancement` label and an `area:*` label.
Issue bodies record **intent**, not final design — each item remains a candidate
for its own brainstorm → spec → plan cycle.

**Started:** 2026-07-05 · **Migrated to issues:** 2026-08-07

The open items formerly logged here:

| Issue | Title |
|---|---|
| [#2](https://github.com/chase-codes/helm/issues/2) | Assignable hotkey system + hotkey recorder (incl. songs hotkeys, go-live/take-down bindings) |
| [#3](https://github.com/chase-codes/helm/issues/3) | Reusable scripture-search component (extract from `SermonMode`) |
| [#4](https://github.com/chase-codes/helm/issues/4) | Songs: right-click → Edit, with fast in-place quick edit |
| [#5](https://github.com/chase-codes/helm/issues/5) | Move song import entry point into Settings → Songs (except on an empty library) |
| [#6](https://github.com/chase-codes/helm/issues/6) | Verify EasyWorship import against a real library (Windows) |
| [#7](https://github.com/chase-codes/helm/issues/7) | Pre-service: dedicated scripture-search item |
| [#8](https://github.com/chase-codes/helm/issues/8) | Selectable schedule items with delete — remaining tracks (message, slides) |
| [#9](https://github.com/chase-codes/helm/issues/9) | Scroll the scheduled reading to the top of the preview on select |
| [#10](https://github.com/chase-codes/helm/issues/10) | Background choices for scripture (and similar) audience output |
| [#11](https://github.com/chase-codes/helm/issues/11) | Named operator theme presets: Charcoal, Parchment, Helm (navy) |

The pre-service single-click verb swap ("decided, smaller than it looked") is
tracked as bug [#25](https://github.com/chase-codes/helm/issues/25) (BUG-018).

---

## Shipped log

Roadmap items that shipped before the migration, kept for their design pointers.

### Cross-cutting enablers

- **Right-click context menus.** ✅ — `ContextMenu.tsx` + `useContextMenu.tsx`,
  consumed by `App`, `SermonMode`, `SongsMode`, `SlidesTrack`. Anything that wants a
  context menu is now wiring, not net-new.
- **Selectable list rows + `Delete`-key handling.** ✅ — `useListSelection.ts`
  plus `useTimedUndo.ts` / `UndoToast.tsx` for the "Removed — Undo" affordance. See
  `docs/superpowers/specs/2026-07-06-interaction-primitives-design.md`.

### Songs

- **Count label: "N stanzas".** ✅ (`69a6fce`) — accurate for any block
  (verse/chorus/bridge/tag) = `song.sections.length`, matching the Section Rail row
  count. See `docs/superpowers/specs/2026-07-06-songs-quick-wins-design.md`.
- **Secondary lyric matches under a title search.** ✅ (`10f1509`) — a subordinate
  "Also in lyrics" group (top 3, deduped) shown only when title results are thin
  (fewer than 3).
- **Song library import (EasyWorship 8).** ✅ shipped 2026-07-31, pending
  verification against a real library ([#6](https://github.com/chase-codes/helm/issues/6)).
  An **Import songs** wizard in Songs mode: pick the source program, pick the folder,
  review every song found (new / already in Helm / unreadable, each with a reason),
  import, then a summary that *names* what didn't come through. Songs land via
  `songsRepo.add()`, so they are sectioned, indexed and searchable exactly like
  hand-entered ones. Built behind an `ImportSource` seam (`src/main/importSources/`)
  so CSV or another program is a new adapter plus a registry entry.
  Two facts worth keeping: EasyWorship 6.1+ stores its library as **plain SQLite**
  (`Songs.db`/`SongWords.db`, lyrics as RTF), so `better-sqlite3` reads it with no
  new dependency; and it declares a custom collation (`UTF8_U_CI`) no Node SQLite
  driver can register, so the adapter's SQL must carry **no `WHERE` and no
  `ORDER BY`** against a text column — a committed fixture declares that collation
  so a test fails if anyone reintroduces one.
  Spec: `docs/superpowers/specs/2026-07-30-song-library-import-design.md`; plan:
  `docs/superpowers/plans/2026-07-30-song-library-import.md`.
- **Min/max audience-view font size based on verse length.** ✅ (`de0d393`) —
  content length now determines the fit; the band (`bandCandidates` in
  `SlideCanvas.tsx`) supplies the min and max, tuned for projector legibility.
  Also closed BUG-007 (see `bugs.md`).

### Pre-service

- **Pre-live selection marker.** ✅ (`c59565d`) — a selected-but-not-live card
  carries `● ARMED` (accent ring, no fill), visually distinct from `● ON SCREEN`
  (filled, live). Landed alongside the BUG-008 fix, which also added **Show this
  card** as the deliberate single-card takeover. See `bugs.md` BUG-008.

### Sermon / Scripture

- **Selectable schedule items with delete (scripture track).** ✅ 2026-07-07 —
  select a schedule row (click cues + selects), `Delete`/`Backspace` or
  right-click → Delete removes it with an immediate "Removed — Undo" affordance.
  Message/slides tracks remain ([#8](https://github.com/chase-codes/helm/issues/8)).
  See `docs/superpowers/specs/2026-07-06-interaction-primitives-design.md`.
- **Direct preview → live/cue for scripture, without scheduling first.** ✅
  2026-07-29 — one cursor, moved identically by a rail tap, an arrow, or a
  schedule-row click; it reaches the projector when output is live and is
  preview-only when it isn't. `+ Add`/Enter file a schedule row and never reach the
  screen; `Go live`/Shift+Enter reach the screen and never write a row. Added a
  third presentation verb, `showLive`. Spec:
  `docs/superpowers/specs/2026-07-29-scripture-direct-live-design.md`; plan:
  `docs/superpowers/plans/2026-07-29-scripture-direct-live.md`.
  Three hazards the final review caught, worth remembering when touching this area:
  `showLive` needs its *kind*-level guard or scripture navigation overwrites a live
  song; the builder must refuse a half-typed reference rather than substituting the
  cursor and forcing output live; and the `Go live`/`Take down` button must act on
  its own label rather than re-deriving the toggle. Follow-ups logged as
  [#17](https://github.com/chase-codes/helm/issues/17),
  [#18](https://github.com/chase-codes/helm/issues/18),
  [#19](https://github.com/chase-codes/helm/issues/19)
  (BUG-010/011/012). Not covered by tests: an end-to-end cross-mode assertion that
  scripture cannot seize the screen from Songs.
- **Book-name typeahead in the ref builder.** ✅ (`c9d46a3`) — dim ghost text
  inline: a tail (`gen`→`esis`) when the query prefixes the name, an arrow
  (`jhn → John`) when the alias doesn't. The invariant — *a ghost is visible iff
  space (or Tab) commits it* — is structural: the commit rule lives in an exported
  `bookCompletion` (`refBuilder.ts`) that both the keystroke handler and the
  renderer call, pinned by a table-driven property test. The overlay is gated on
  focus (`SchedulePanel`) so a blurred field can't advertise a commit that space
  would turn into a go-live toggle. Prefix matching prefers a curated
  `RANKED_BOOKS` list (`books.ts`); exact aliases are untouched and pinned by a
  test that every bundled-KJV book name resolves exactly. Rejected, with reasons in
  the spec: chapter/verse-stage hints, Tab-cycling, usage-based ranking.
  Spec: `docs/superpowers/specs/2026-08-05-scripture-book-typeahead-design.md`.
