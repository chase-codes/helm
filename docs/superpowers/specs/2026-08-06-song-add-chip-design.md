# Song add chip below the search bar — design

**Date:** 2026-08-06
**Status:** Approved

## Problem

The songs rail's "+ Add a song" and "↓ Import a song library" buttons are the last
children of the scrolling song list (`SongSearchRail.tsx`). With a large library you
must scroll past every song to reach them. The scripture panel already solves this
shape of problem: `SchedulePanel.tsx` renders a tinted "+ Add …" chip directly below
the entry bar. Songs should get the same treatment, except the chip adds a song to
the **library** (via QuickAdd) rather than to a schedule.

## Design

### SongSearchRail (`src/renderer/operator/SongSearchRail.tsx`)

A new fixed block between the field tabs and the scroll region, inside the
non-scrolling header padding so it never scrolls away:

1. **Add chip** — always visible, full width. Mirrors the scripture
   `schedAddStyle` treatment (34px, `marginTop: 8px`, 12.5px/600) but tinted with
   the songs accent: `background: ${T.accent}22`, `color: T.accent` (gold), not
   `T.scripture`. Label adapts to the search query:
   - Query typed: `+ Add "<query>" as a new song`
   - Empty: `+ Add a song`

   Clicking calls the existing `onAddSong` callback.
2. **Import row** — a slim, visually quieter secondary button directly under the
   chip: `↓ Import a song library`, calling the existing `onImportSongs`. It is a
   rare setup action and should not compete with the chip.

The two buttons currently at the bottom of the scroll region are **removed** —
nothing is duplicated at the bottom.

The rail stays purely presentational: theme + data + callbacks, no `window.helm`
calls. No new props are required beyond what it already receives (it already has
the query value for the input).

### SongsMode (`src/renderer/operator/SongsMode.tsx`)

- When the chip opens QuickAdd, capture the current query (trimmed) **at open
  time** and pass it to QuickAdd as the initial title. Later changes to the search
  box must not mutate the modal's title.
- Update the no-results copy: it currently reads `…paste it as a new song below.`
  which becomes wrong once the affordance sits above the list. Reword to point at
  the chip above (e.g. `…or add it as a new song above.`).

### QuickAdd (`src/renderer/operator/QuickAdd.tsx`)

- New optional prop `initialTitle?: string`.
- When provided and non-empty, the title field starts prefilled with it and
  initial focus lands in the **lyrics textarea** (flow: search → miss → click →
  paste lyrics → save, no retyping).
- When absent or empty, behavior is unchanged: blank title, focus on the title
  field.
- QuickAdd relies on being unmounted while closed for fresh state; `SongsMode`
  only mounts it when open, so an initial-value prop is safe.

### Data flow / persistence

Unchanged. Saving still goes `QuickAdd` → `window.helm.songs.add` → IPC →
`songsRepo.add` (insert + FTS index), and `onQuickAddSaved` still appends to the
library state and selects the new song.

## Testing

- `SongSearchRail.test.tsx`:
  - Chip renders with no query, labeled `+ Add a song`.
  - Chip label includes the query when one is typed.
  - Clicking the chip fires `onAddSong`.
  - Import row renders in the header block and fires `onImportSongs`.
  - The old bottom-of-list buttons are gone (no add/import affordances inside
    the scroll region).
- QuickAdd tests:
  - `initialTitle` prefills the title field.
  - With `initialTitle`, focus starts in the lyrics textarea; without it, focus
    starts on the title field.

## Out of scope

- Any change to the song import wizard itself.
- Inline (non-modal) song creation.
- Changes to scripture `SchedulePanel`.
