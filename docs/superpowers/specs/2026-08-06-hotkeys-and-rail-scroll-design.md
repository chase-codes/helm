# Operator hotkeys & ChapterRail scroll fix — design

**Date:** 2026-08-06
**Status:** Approved (brainstormed with operator; this doc is the validated design)

## Goals

1. A coherent, rebindable hotkey system for the operator surface: song section
   jumps (chorus/bridge/tag/verse), scheduled-reading jumps, page switching,
   quick scripture lookup, and field focusing/clearing — with good defaults and
   a full Shortcuts editor in Settings.
2. Fix: clicking a scheduled scripture (or jumping to one) must scroll the
   ChapterRail so the reading's start verse sits at the top of the rail; verse
   arrow-stepping must keep the cued verse in view.

Non-goals: chord sequences (OpenLP-style `c2` typing), command palette,
per-user profiles. Explicitly ruled out during brainstorming.

## Architecture: central keymap registry (Approach A)

New pure module `src/shared/hotkeys/` (no React; unit-testable like
`keyDispatch.ts`):

- **`actions.ts`** — the single action registry. Each action:
  `{ id, label, scope: 'global' | 'songs' | 'scripture', defaults: string[],
  fixed?: true }`. `defaults` is a list because some actions ship with synonyms
  (Enter + Space). `fixed` rows are listed in Settings but not rebindable.
- **`match.ts`** —
  - `eventToBinding(e: KeyboardEvent): string | null` normalizes a keydown to a
    binding string (`'Mod+L'`, `'Home'`, `'C'`, `'/'`, `'Mod+Backspace'`).
    `Mod` = Cmd on macOS, Ctrl elsewhere, so one stored default fits both.
  - `resolveAction(e, scope, overrides): ActionId | null` — active page scope
    first, then global; overrides beat defaults.
- **Typing guard:** single-key bindings (no modifier) never fire while an
  input/textarea is focused (existing rule, kept). Modifier bindings fire even
  while typing — that is what lets `Mod+L` escape the search box.
- **Overrides** persist in the existing settings store under one key:
  `hotkeys: Record<ActionId, string[]>`. Absent key = pure defaults. App loads
  overrides at startup, holds the resolved keymap in state, and passes it to
  the dispatcher — Settings edits apply immediately, no restart.

The Settings pane, the dispatcher, and any future docs all render/resolve from
the same registry, so they cannot drift.

## Default bindings

| Scope | Action | Default | Notes |
|---|---|---|---|
| Global | Go to Pre-service / Songs / Sermon | `Mod+1` / `Mod+2` / `Mod+3` | works while typing |
| Global | Scripture lookup | `Mod+L` | jump to Sermon → Scripture track, ref entry focused |
| Global | Focus search / entry | `/` | Songs: search box · Sermon: ref entry |
| Global | Clear field | `Mod+Backspace`, `Mod+Delete` | wipes the focused search box / ref entry entirely |
| Global | Go live / take down | `Enter`, `Space` | existing behavior, now rebindable |
| Global | Next / Previous | `→ ↓` / `← ↑` | existing, rebindable |
| Global | Delete selected | `Delete`, `Backspace` | existing, rebindable |
| Global | Close / clear | `Escape` | **fixed** — never rebindable |
| Songs | Jump to chorus | `Home`, `C` | repeat press cycles Chorus 1 → 2 → … |
| Songs | Jump to bridge | `B` | |
| Songs | Jump to tag/ending | `T` | |
| Songs | Jump to Verse 1–9 | `1`–`9` | **fixed** block; matches section *label* "Verse N" |
| Scripture | Jump to reading 1–9 | `1`–`9` | **fixed** block; Nth row of the schedule panel |

Rebinding replaces an action's whole binding list with the single captured key;
reset restores defaults including synonyms.

## Dispatch routing

`keyDispatch.ts` stops matching raw `e.key` and asks `resolveAction()` for an
action id.

- **App-level actions** (`page.*`, `scripture.lookup`) are handled in App,
  which owns `setMode`.
- **Everything else** routes to the active mode via the existing
  `ModeKeyHandler` ref, extended with one method:
  `onAction?: (id: ActionId) => void`. The existing dedicated methods
  (`onEscape`, `onArrow`, `onGoLive`, `onDelete`, `isModalOpen`) keep their
  shape — arrows/enter/escape/delete resolve to actions internally but arrive
  through the same delegates as today.
- Escape stays checked first, before action resolution, with all its current
  modal-close/clear semantics.

## Songs page behavior

- **Label-matched jumps:** chorus = first section matching `/chorus/i`
  (repeat press cycles through all chorus sections, wrapping), bridge =
  `/bridge/i`, tag = `/tag|ending/i`, digits = section labeled `Verse N`.
  No matching section → the key does nothing.
- **Live-follow rule:** a jump always moves the selection in the section rail.
  The projector changes only if that song is already live (output is live and
  `liveKey` is a section key of the active song) — then the target section goes
  live in the same keypress. On logo/black, or when a different song is live,
  the jump is a quiet cue.
- The section rail scrolls the jumped-to card into view.

## Scripture page behavior

- `1`–`9` = jump to the Nth scheduled reading, identical to clicking its row:
  cursor to `book ch:from`, row selected, rail scrolls the verse to the top
  (see below).

## Global behavior

- `Mod+1/2/3` switches page.
- `Mod+L` (scripture lookup): App switches mode to Sermon and bumps a
  `lookupNonce` prop; SermonMode reacts by forcing `track = 'scripture'` and
  focusing the ref entry (same App-mediated pattern as `biblesRevision`).
  Flow: `Mod+L` → type `John 3:16` → `Shift+Enter` → live.
- `/` focuses the active page's search/entry field (input refs threaded to
  SongSearchRail / SchedulePanel).
- `Mod+Backspace` / `Mod+Delete` clears the focused field: song search →
  empty query, ref entry → builder reset to `initialBuilder()`.

## Settings: Shortcuts pane

New pane in `SettingsModal` alongside Displays, rendered from the registry,
grouped Global / Songs / Scripture. Each row: action label + binding chips.

- **Rebind:** click a chip → capture mode ("Press a key…"); next keydown
  becomes the binding; Escape cancels capture.
- **Conflicts:** a captured key already held by a colliding action (same
  scope, or global↔mode overlap) is refused with an inline message naming the
  holder. No silent double-bindings; unbind the other side first to swap.
- **Custom markers:** overridden rows get a dot + per-row reset;
  "Reset all to defaults" at the bottom. Fixed rows render grayed with a note.
- **Persistence:** writes to settings `hotkeys` key; App re-resolves the
  keymap immediately.

## ChapterRail scroll fix

`SermonMode` gains scroll-request state `{ v, align: 'start' | 'nearest',
nonce }`, passed to `ChapterRail`:

- **`align: 'start'`** (verse to top of rail): schedule-row click, reading
  `1`–`9` hotkey, lookup/builder jumps.
- **`align: 'nearest'`** (keep in view): arrow verse-steps — fixes the cued
  verse walking off-screen without yanking the rail while reading.
- The rail consumes the request in an effect keyed on `nonce` **and**
  `verseCount`: a cross-book/chapter jump renders its rows only after the
  chapter fetch resolves a tick later, and the `verseCount` dep re-applies the
  scroll once the target row exists. (A transient scroll against the outgoing
  chapter's rows is acceptable — the re-apply lands on the real target.)
- Clicking a verse card directly never scrolls (it is already under the
  mouse). The existing shift-range `selectedRange` scroll effect stays as is.

## Testing

- **Unit (pure):** `eventToBinding` normalization (Mod on both platforms,
  typing guard, modifier pass-through); `resolveAction` precedence (mode scope
  beats global, overrides beat defaults); section-label matchers + chorus
  cycling; reading-N resolution; extended `keyDispatch` routing with a mocked
  handler (style of `keyDispatch.test.ts`).
- **Component:** SongsMode hotkey jump + live-follow with mocked `window.helm`
  (style of `SongsMode.test.tsx`); ChapterRail scroll-request effect via jsdom
  `scrollIntoView` spy; Shortcuts pane rebind/conflict/reset (style of
  `DisplaysSettings.test.tsx`).
