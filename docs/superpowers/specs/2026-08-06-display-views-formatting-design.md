# Display views: line integrity, leader parity, song key — design

Date: 2026-08-06
Status: approved (pending spec review)

## Problem

The operator view renders song lyrics correctly: one DOM line per authored song line
(`SongsMode.tsx` hero, `SectionRail.tsx`). The two output views do not respect that
structure:

- **Audience** (`SlideCanvas`, variant `audience`) and **leader** (`LeaderView`) let lyric
  lines soft-wrap. The auto-fit algorithm (`useFitText` + `fitText.ts`) picks the largest
  font where the *wrapped* text fits, so a line like "Blessed assurance, Jesus is mine!"
  splits in two depending on screen size.
- The **leader** view's hero column is squeezed by a fixed-width rail (30%, 260–420px),
  left-aligned, and styled unlike the operator. Its rail shows only a one-line snippet per
  section. There is no way to rebalance hero vs. rail on what is generally a smaller
  screen.
- The **leader** view tracks only `liveKey` — it doesn't move until Go live, even though
  the operator already fires `presentation.cue()` on every song/section selection.
- The **audience** view hides the section label entirely, and songs have no musical key
  field anywhere in the data model.

## Goals

1. Song line structure is authoritative on every view: a lyric line never wraps.
2. Audience text sizing is pure auto-fit (largest size where the longest line fits the
   width and the verse fits the height). No manual control.
3. Leader view matches the operator's theme and principles: full verse hero + a section
   rail showing every section with all its lines, minus search/navigation controls.
4. Leader hero/rail split is resizable by dragging on the leader window itself **and**
   remotely from the operator's display popover; the setting persists per display. Text on
   both sides scales with the split (hero via auto-fit, rail via width-scaled font).
5. Leader follows the operator's cued selection immediately, not waiting for go-live, with
   a LIVE/CUED indicator.
6. Songs gain an optional musical key; audience shows `Verse 1 · Key G`-style label.

## Non-goals

- Transposition, chords, or any use of the key beyond display.
- Changing operator-view rendering or its sizing mechanics.
- Manual font-size controls for the audience view.
- Changes to stage/livestream chrome beyond what the shared line-integrity fix implies.

## Design

### 1. Line integrity (all output views)

Each lyric line `<div>` in `SlideCanvas` (lyrics kind) and the `LeaderView` hero gets
`white-space: nowrap`. `useFitText` already tests `scrollWidth <= clientWidth`, so the
fitter now shrinks the font until the longest authored line fits on one row and the verse
fits vertically. Existing fit bands stay (`bandCandidates(10.5, 3.5)` lyrics/leader).

Edge case: at the band minimum an extremely long line can still clip horizontally — same
behavior the operator has today when a line exceeds panel width. Accepted.

### 2. Song key + slide payload

- `Song` gains optional `key?: string` (free text, e.g. "G", "Bb", "F#m"). Editable in
  QuickAdd and the song editor; persisted with the song.
- The lyrics slide payload gains `sectionLabel` and `songKey` fields, carried alongside
  the existing pre-baked `label` (which stage/livestream keep using). `slideFor()` in
  SongsMode populates them.
- **Audience label:** `SlideCanvas` variant `audience` (currently label-less) renders a
  subtle bottom label: section label, plus ` · Key G` when the song has a key. Styling
  consistent with existing slide chrome (mono, dim, small). Stage and livestream chrome
  unchanged apart from having the new fields available.

### 3. Leader view restyled to operator theme

`LeaderView` is rebuilt visually on the operator's design tokens (dark background, mono
uppercase labels, accent color for the active section) while remaining its own component —
no imports of operator search/navigation internals.

- **Hero:** full verse, one no-wrap line per authored line, auto-fit within the hero
  panel. Title row: song title · section label · key (when set), plus the existing
  LOGO/BLACK chip and the new LIVE/CUED chip (§5).
- **Rail:** every section, showing its label and **all** its lines (like the operator's
  `SectionRail`, replacing the one-line snippet). Active (cued) section highlighted with
  the accent treatment. Rail font scales with rail width using the operator's formula
  shape (`clamp`-style linear scale on width).
- Non-song content falls back to `SlidesView` exactly as today.

### 4. Resizable leader split

- A `PanelDivider`-style drag handle between hero and rail on the leader window, using the
  operator's drag mechanics (`usePanelWidth` pattern: mousemove delta, clamped, commit on
  mouseup).
- The split value (rail width in px, clamped to sane bounds) persists per display through
  the existing display-settings path (`displays.ts` settings keys, alongside
  `displays:roles` / `displays:views`), **not** localStorage — so the operator can read
  and write the same value.
- The operator's display popover (`OutputViewPopover`) gains a split slider shown when
  that display's view is `leader`. Either writer pushes the new
  value to the leader window over the existing displays channel; the leader re-fits text
  automatically (ResizeObserver already re-runs the fitter on geometry change).

### 5. Leader follows cue

- `PresentationState` gains `cuedKey: string | null` and `cuedSnap: Slide | null`.
  `stateStore`'s cue handler always records them (independent of the existing `applyCue`
  live-screen logic, which is unchanged) and broadcasts.
- `LeaderView` renders the **cued** song/section when present, falling back to live.
  A chip shows `LIVE` when the displayed section is what's live, `CUED` otherwise.
- Audience/stage/livestream continue to render only `liveSnap`. No behavior change.

### 6. State/IPC summary

- New: `cuedKey`/`cuedSnap` in `PresentationState` (broadcast on existing
  `presentation:state` channel — leader already subscribes via `usePresentationState`).
- New: per-display leader-split setting + IPC to set it from either window, following the
  existing `displays:setView`/`displays:setRole` pattern.
- Extended: lyrics `Slide` payload with `sectionLabel`/`songKey`; `Song` with `key`.

## Error handling

- Missing/deleted cued song on leader: same fallback chain as today (SlidesView).
- Song with no key: key UI simply absent everywhere.
- Split setting absent or out of bounds: clamp to default (current 30%-equivalent).

## Testing

- Unit: cue reducer records `cuedKey`/`cuedSnap`; `outputPayload` untouched behavior;
  split clamping; `slideFor` carries `sectionLabel`/`songKey`; song persistence round-trips
  `key`.
- Visual verification via the project's `scratch/verify-*.mjs` driver pattern:
  - Long-line song renders un-wrapped on audience and leader at several window sizes.
  - Audience shows `Verse 1 · Key G` when key set; no key line when unset.
  - Dragging the leader divider rescales hero and rail text; setting survives restart and
    matches operator-side control.
  - Selecting a new song/section in operator updates leader immediately (CUED chip),
    audience unchanged until Go live (chip flips to LIVE).
