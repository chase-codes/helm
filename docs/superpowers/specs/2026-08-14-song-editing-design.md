# Song editing — design

**Issue:** #4 (P0) — Songs: right-click → Edit, with fast in-place quick edit
**Date:** 2026-08-14

## Goal

Give the operator two editing paths for songs:

- **Section quick-edit** (the mid-service path): right-click a section card in the
  section rail → edit just those lines in place, without leaving the view or
  disturbing the projector. Fast enough to fix a typo while the band is playing.
- **Whole-song edit** (the post-service path): right-click a song row in the search
  rail → a modal editor for title, author, key, and full lyrics.

Both paths save through a new `songs:update` IPC channel that rewrites the song row
**and** its FTS index in one transaction, so search immediately reflects the edit.

## Non-goals

- No generalized slide/presentation editor (#57 owns that). The in-place section
  editor built here is deliberately song-specific: a textarea over one section's
  lines, not a slide authoring surface.
- No delete, duplicate, or reorder of sections; no new-section creation from the
  quick-edit path.
- No change to the search scorer, tokenizer, or FTS schema (#53/#14/#12 own those);
  the update writes the same columns the insert already writes.

## 1. Data layer — `songs:update`

New type in `src/shared/types.ts`:

```ts
export interface UpdateSongInput {
  title: string;
  author?: string;
  key?: string;
  sections: SongSection[];
}
```

`SongsRepo.update(id, input): Song`:

- Throws if `input.sections` is empty or the id doesn't exist.
- In **one transaction** (`db.transaction`):
  - `UPDATE songs SET title, author, sections_json, music_key WHERE id = ?`
  - `UPDATE song_fts SET title, author, lyrics WHERE rowid = (SELECT rowid FROM songs WHERE id = ?)`
    with lyrics rebuilt via the existing `lyricsOf` — the FTS row must never lag the
    songs row, or search keeps matching deleted text.
- `source` and `created_at` are untouched.
- Returns the updated `Song`.

Sections-based, not text-based, on purpose: the section quick-edit patches one
section into the array and sends the whole array — it must not round-trip the entire
song through `splitToSlides`, where a stray blank line would silently split a section
in two. The modal path runs `splitToSlides` in the renderer (QuickAdd already does,
for its preview) so the preview and the saved sections are the same computation.

Wiring: `songsUpdate: 'songs:update'` in the channel map, handler in
`src/main/ipc.ts`, method in `src/preload/index.ts` + `index.d.ts`.

## 2. Section quick-edit

Entry: `SectionRail` cards get `onContextMenu` → the existing `useContextMenu`
primitive with a single **Edit** item. Right-clicking a card does **not** cue it —
editing must not move the leader or the projector.

State lives in `SongsMode` (owner of the song data); `SectionRail` receives
`editingIndex: number | null` plus callbacks (open handled via a
`onSectionContextMenu(i, e)` prop so the menu itself stays in `SongsMode` with the
row menu).

Editor: the card's lines are replaced in place by a textarea prefilled with
`lines.join('\n')`, styled to match the card's line rendering (same font size and
line height, so the card doesn't jump), auto-focused with the cursor at the end.

Keys and pointer:

- **Enter** saves. **Shift+Enter** inserts a newline.
- **Escape** cancels and is consumed — it must not fall through to the global
  escape chain (disarm → blur → take down). A typo fix must never black the screen.
- Clicking outside the editor cancels. There is no half-saved state.

Save: split the textarea value on newlines, trim each, drop blanks; keep the
section's existing label; patch that one section into `activeSong.sections`; call
`songs:update` with the song's current title/author/key. Section count cannot change
on this path by construction. Saving an unchanged or all-blank value just cancels
(a section must keep at least one line).

## 3. Whole-song edit

`QuickAdd` grows an edit mode via a new optional prop `editSong?: Song`:

- Header reads **Edit song**; the search-online tab is hidden (paste tab only).
- Title/author/key prefilled from the song; the lyrics textarea prefilled by the
  round-trip: each section emitted as its `label` on the first line followed by its
  lines, stanzas separated by one blank line. Every stored label either came from
  `splitToSlides`' label regex or is a `Verse N` default, so the round-trip is
  stable.
- The save button reads **Save changes** and calls
  `songs:update(editSong.id, { title, author, key, sections: splitToSlides(text) })`
  instead of `songs:add`. `source` is not sent (the repo preserves it).
- The slide preview panel works unchanged.

`SongsMode.onEditSong` (the current stub, `console.info` and all) is replaced by
opening this modal with the song looked up from `library`. The Escape handler's
modal checks and `isModalOpen()` cover the edit modal the same way they cover
QuickAdd today (it *is* QuickAdd, so this is nearly free — the edit open state is
a separate `editSongId` so add and edit prefill logic don't tangle).

## 4. After save — one path for both editors

A single `onSongSaved(song: Song)` in `SongsMode`:

1. **Library:** replace the song in `library` by id.
2. **Search:** if a query is active, re-run `songs.search(q, field)` (same reason as
   `onImportCompleted` — `results` otherwise stays stale until the next keystroke);
   in Title mode also re-run the lyric-hint pass.
3. **Re-cue:** if the saved song is the active song, send
   `presentation.cue(keyForSong(id, clampedSection), slideFor(song, section))` with
   the fresh section. `applyCue`'s same-flow rule silently swaps the live snapshot
   when that key's flow is live — the corrected text lands on the projector with no
   flicker and no output-mode change. Never `goLive` (on an already-live key that
   means take-down). If the song isn't live, this simply refreshes the cue/leader.

Edge: if a modal edit shrinks the section count below the live section index, the
existing clamp + lock-reconciliation effects converge the selection on the last
section, and the same silent-swap path updates the projector. No special handling.

Note the cue effect in `SongsMode` is keyed on `[activeSong?.id, clampedSection]`
only — it will not fire on content changes, which is why `onSongSaved` re-cues
explicitly.

## 5. Errors

- Repo throws (unknown id, empty sections) → the renderer keeps the editor open
  with the operator's text intact:
  - Modal: the existing "Couldn't save — try again" inline treatment.
  - Quick-edit: an equivalent small inline error inside the card; the textarea and
    its content stay.

## 6. Testing

- **Repo** (`songsRepo` tests): update rewrites both tables; searching the new
  lyrics finds the song, searching removed text does not; title/author/key updates
  land; `source`/`createdAt` preserved; unknown id and empty sections throw;
  a failed statement leaves both tables unchanged (transaction).
- **SongsMode/SectionRail** component tests: context menu on a section card shows
  Edit; Edit swaps the card to a textarea without cueing; Enter saves → `update`
  called with the patched section and a re-cue is sent (`cue`, never `goLive`);
  Shift+Enter inserts a newline instead of saving; Escape cancels, keeps the old
  lines, and does not reach the take-down chain; blank-only save cancels.
- **QuickAdd edit mode**: prefill round-trips labels and lines; save calls `update`
  (not `add`) with re-split sections; search tab absent; cancel leaves the song
  untouched.
- Acceptance sweep from the issue: the `onEditSong` stub and its `console.info`
  are gone; both entry points work; FTS reflects edits immediately.
