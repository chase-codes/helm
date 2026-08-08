# Settings nav icons — design

**Date:** 2026-08-07
**Status:** Approved

## Problem

The Settings modal's left nav has five sections, but only Appearance and Displays render an icon next to their label. The inconsistency looks awkward. Decision: all five items get icons.

## Design

1. **New `ShortcutsIcon`** in `src/renderer/shared/icons.tsx` — a keyboard glyph (rounded rect with key marks), matching the existing icon style: 20-unit viewBox, stroke-based, takes `IconProps`.

2. **Data-driven icons in `SettingsModal.tsx`** — replace the inline per-id conditionals in the nav render loop with an `icon` component field on each `SECTIONS` entry, rendered as `<s.Icon size={15} />` before the label:

   | Section    | Icon            |
   |------------|-----------------|
   | Appearance | `ThemesIcon` (existing, unchanged) |
   | Bibles     | `SermonIcon` (existing open-book glyph; a book is the right symbol for Bibles — reuse accepted) |
   | Displays   | `DisplayIcon` (existing, unchanged) |
   | Shortcuts  | `ShortcutsIcon` (new) |
   | Message    | `MessageIcon` (existing) |

No other behavior or layout changes; the nav item's existing `gap: '8px'` handles spacing.

## Testing

Existing tests must keep passing. Visual check of the nav in the running app (all five icons render, active/inactive colors inherit via `currentColor`).
