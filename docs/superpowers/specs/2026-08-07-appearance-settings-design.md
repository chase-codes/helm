# Appearance settings section — design

**Date:** 2026-08-07
**Status:** Approved
**Builds on:** `2026-08-07-theme-families-and-brand-icons-design.md` (theme families, persistence, header popover)

## Goal

Theme controls should live in Settings, not scattered across the header. The header keeps
exactly one quick toggle (sun/moon for light/dark); the theme-family choice moves into a
new Appearance section in the Settings modal. The Settings nav is also cleaned up: disabled
placeholder sections are removed until their features ship.

## Decisions (made during brainstorming)

1. **Header**: keep the sun/moon light/dark toggle (one-click mid-service utility), remove
   the themes popover button. Header right side drops from 3 icon buttons to 2
   (sun/moon, settings gear).
2. **Placeholders**: the disabled Songs and Backup nav entries are removed from the
   Settings nav entirely. They return when the features are real. The `enabled` flag
   machinery on `SECTIONS` goes away with them.
3. **Organization**: a dedicated **Appearance** section, first in the Settings nav —
   not a broader "General" grab-bag.

## Components

### AppearanceSettings (new — `src/renderer/operator/AppearanceSettings.tsx`)

Rendered in the Settings modal content pane when the Appearance section is selected.

- **Theme group**: one card per family from `FAMILIES` (`src/shared/theme.ts`), each
  showing two color swatches (the family's `appBg` and `accent` for the *current* mode),
  the family label ("Classic", "Helm"), and the mode-specific preset name
  (e.g. "Helm Navy"). Clicking a card applies the family instantly — no Save button,
  matching how the removed popover behaved. The active card gets an accent ring and a
  check mark.
- **Mode group**: a Dark/Light segmented control bound to the same `themeMode` state the
  header sun/moon toggles. One setting, two access points — changing either updates both.

Props: `family`, `onFamilyChange`, `themeMode`, `onModeChange`.

### SettingsModal (`src/renderer/operator/SettingsModal.tsx`)

- Nav becomes: **Appearance, Bibles, Displays, Shortcuts, Message** (in that order).
  Appearance is the default section on open (first in list).
- Songs and Backup entries removed; `enabled` flag and its disabled-button styling
  removed since every remaining section is enabled.
- New props `family`, `setFamily`, `themeMode`, `setThemeMode` passed through from App
  to AppearanceSettings.

### Header (`src/renderer/operator/Header.tsx`)

- Remove the themes icon button, `themesOpen` state, `themesContainerRef`, the
  `ThemePopover` render, and the `family`/`setFamily` props.
- Sun/moon toggle and settings gear remain unchanged.

### App (`src/renderer/operator/App.tsx`)

- Already owns family+mode state persisted via the settings store. Add a
  `setThemeMode(mode)` setter for the segmented control (absolute value); keep
  `toggleTheme` for the header sun/moon. Wire the four theme props to SettingsModal;
  Header keeps only `themeMode`/`toggleTheme`.

### Deletions

- `src/renderer/operator/ThemePopover.tsx`
- `src/renderer/operator/ThemePopover.test.tsx`

## Data flow

Unchanged from the theme-families design: App holds `{family, mode}`, persists through
the settings store IPC, and provides the resolved theme via `ThemeCtx`. This change only
relocates the *controls*. LeaderView stays pinned to Classic dark (`DARK` export).

## Error handling

No new error paths. Persistence and IPC are pre-existing and untouched.

## Testing

- New `AppearanceSettings.test.tsx`: renders both family cards, marks the active one,
  click calls `onFamilyChange` with the right family, mode control calls `onModeChange`.
- Update `SettingsModal` expectations wherever tests assume the old section list or
  default section (e.g. DisplaysSettings/ShortcutsSettings tests that open the modal).
- Update any Header test referencing the themes button; delete ThemePopover tests.
- Full suite must pass.
