# Stacked Bible versions — design

**Date:** 2026-08-07
**Status:** Approved
**Issue:** [#37](https://github.com/chase-codes/helm/issues/37)

## Problem

When two Bible versions are shown at once, every view lays them out as side-by-side
columns, each capped at roughly half the available width. Two translations sharing the
width are cramped and hard to read — on the projector the text is too small for the
congregation, and in the operator hero card the multi-version case drops to a smaller
font. Decision: versions stack vertically (primary on top, secondary below),
everywhere. Side-by-side goes away entirely; this is not a per-context option.

## Design

1. **`SlideCanvas.tsx` (all output variants + previews)** — the scripture columns
   container becomes a vertical stack:
   - `colsStyle`: `flexDirection: 'column'`, `alignItems: 'center'`; gap stays a
     vertical rhythm (`4cqmin`).
   - `columnStyle`: every version block gets the full single-version treatment —
     `maxWidth: '86%'`, `textAlign: 'center'` — regardless of count. The `single`
     branch disappears.
   - The scripture auto-fit band already sizes text to the container, so two stacked
     full-width blocks shrink to fit vertically while rendering far larger than two
     47%-wide columns did. Both versions continue to share one fitted size.

2. **`SermonCenter.tsx` (operator hero card)** — the verse columns row becomes a
   vertical stack:
   - The wrapping flex row gains `flexDirection: 'column'`.
   - `verseColMax` (50% cap when multiple) is removed — every block is full width.
   - The multi-version font special-case (`21.0px`) is removed — stacked versions use
     the same `clamp(26px, 2.7vw, 38px)` size as a single version.
   - The hero card already scrolls (`overflowY: 'auto'`), so tall stacks degrade
     gracefully.

Version labels stay attached to their passage in both places (label + text stay
inside one block per version).

## Testing

- `SlideCanvas.test.tsx`: with two versions, the columns container stacks vertically
  and each version block is full-width/centered; the existing "both parallel versions
  render at one size" test keeps passing.
- Operator side is covered by existing SermonMode tests continuing to pass; visual
  check in the running app for both the projector output and the hero card.
