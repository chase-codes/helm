# Theme families (Classic / Helm) + brand icon adoption — design

Date: 2026-08-07
Status: approved (pending spec review)
Issue: #11

## Problem

The operator console has a bare two-state theme toggle (`DARK`/`LIGHT` in
`src/shared/theme.ts`) whose choice is not persisted — `useState('dark')` in
`App.tsx:54` resets every launch. A `Tone` system (Warm/Cool/Earthen) exists in
`theme.ts` but is exposed nowhere, and its merge order silently overrides the light
palette's own scripture/sermon colors with dark-tuned ones.

Separately, the Helm brand kit shipped 13 stroke icons (`assets/icons/`, 20×20,
1.6 stroke, `currentColor`) that the app never adopted — the UI still uses unicode
glyphs (⚙, ⌕, ●, ■, ☀/☾).

## Goals

1. Named theme presets organized as **families** — each family is a dark/light pair;
   the existing ☀/☾ button flips mode *within* the family.
2. Theme choice (family + mode) persists across launches.
3. The brand icon set is used throughout the operator chrome.
4. The dormant Tone system is removed.

## Non-goals

- Theming the audience/leader output windows (LeaderView keeps importing `DARK`).
- A Settings-pane appearance section (the header popover is the picker).
- Replacing typographic status badges (● ARMED, ● ON SCREEN, ✕ TAKE DOWN chip,
  ● PRIMARY / ◧ COMPARE) — those are deliberate parts of mono-font labels.
- Uploading `assets/github-banner.png` as the repo social preview (manual GitHub
  Settings step; no API exists — reminder for Chase, not code).

## Design

### 1. Theme model (`src/shared/theme.ts`)

```ts
export type ThemeFamily = 'classic' | 'helm';
export type ThemeMode = 'dark' | 'light';   // moves here from App.tsx

export const FAMILIES: Record<ThemeFamily, {
  label: string;                 // 'Classic', 'Helm'
  presetName: { dark: string; light: string };  // 'Charcoal'/'Parchment', 'Helm Navy'/'Helm Parchment'
  dark: Palette; light: Palette;
}>;

export function themeFor(family: ThemeFamily, mode: ThemeMode): Theme;
```

`Tone`, `TONES`, and the `tone` parameter are deleted. Each palette carries every
token, including `message` (previously injected only by the Warm tone merge).

**Classic dark (Charcoal)** — today's `DARK` plus `message: '#a88bc4'`. Rendered
output is pixel-identical to today.

**Classic light (Parchment)** — today's `LIGHT`, restoring its own
`scripture: '#3f6bb5'` / `sermon: '#4f7d5f'` (currently dead — the Warm-tone merge
overrides them with dark-tuned values, a latent bug this removal fixes), plus a
light-tuned `message: '#7d54ad'`. This is a small, intended visual change in light
mode: scripture/sermon accents get their designed parchment-legible depth.

**Helm dark (Helm Navy)** — brand navy/gold (starting values, tuned visually during
implementation):

| token | value | | token | value |
|---|---|---|---|---|
| appBg | `#0B1322` | | accent | `#E0A341` |
| panel | `#101B30` | | accentInk | `#1a1206` |
| panel2 | `#16243E` | | live | `#cf6a5e` |
| panel3 | `#1C2D4C` | | scripture | `#7fa5ee` |
| text | `#EFE9DC` | | sermon | `#79a586` |
| dim | `#a89f8c` | | message | `#a88bc4` |
| faint | `#6f6c60` | | quote | `#b98cf0` |
| hairline | `rgba(239,233,220,.07)` | | inputBg | `#101B30` |
| border | `rgba(239,233,220,.11)` | | | |

**Helm light (Helm Parchment)** — the brand's ink-on-parchment pairing:

| token | value | | token | value |
|---|---|---|---|---|
| appBg | `#EFE9DC` | | accent | `#a9762a` |
| panel | `#f5f0e5` | | accentInk | `#fff8ec` |
| panel2 | `#faf7ef` | | live | `#bf4f44` |
| panel3 | `#ffffff` | | scripture | `#3f6bb5` |
| text | `#16243E` | | sermon | `#4f7d5f` |
| dim | `#5a6478` | | message | `#7d54ad` |
| faint | `#8a91a3` | | quote | `#8a5cc0` |
| hairline | `rgba(22,36,62,.10)` | | inputBg | `#ffffff` |
| border | `rgba(22,36,62,.15)` | | | |

`floatShadow` stays computed from `border` in `themeFor`, as today.

### 2. Persistence (App.tsx)

- State becomes `{ family: ThemeFamily; mode: ThemeMode }`, default
  `{ family: 'classic', mode: 'dark' }`.
- On mount, one `window.helm.settings.get('appearance', default)` (existing IPC →
  SQLite `settings` table) hydrates the state; unknown/malformed values fall back to
  the default per-field.
- Every change calls `window.helm.settings.set('appearance', next)` (fire-and-forget,
  matching the channel's `send` semantics).
- First paint may briefly render the default before hydration resolves — accepted
  (matches how other boot-time fetches behave).
- `ThemeMode` moves to `shared/theme.ts`; `App.tsx` re-exports it so the seven
  existing `import type { ThemeMode } from './App'` sites keep working (they can be
  migrated opportunistically).

### 3. Header controls (Header.tsx)

- **☀/☾ button stays** in place and flips `mode` within the current family. Its glyph
  becomes matching sun/moon stroke icons (see §4).
- **New themes button** (kit's `themes.svg`, half-filled circle) sits next to it, same
  34×34 chip styling. Click opens a popover anchored to it — same
  outside-click/Escape pattern as `OutputViewPopover` — listing the two families:
  - Row per family: label + two small color swatches (family's dark `appBg` /
    `accent`) + a check on the active family.
  - Clicking a row sets the family (mode unchanged) and closes the popover.

### 4. Icons (src/renderer/shared/icons.tsx)

Following the `HelmMark.tsx` precedent: one inline-SVG React component per icon,
paths copied verbatim from `assets/icons/*.svg`, `size` prop (default 20 → viewBox
20), stroke `currentColor` so theme color inherits. No build plugin, no runtime asset
loading. `assets/icons/` remains the brand source of truth; a comment in `icons.tsx`
points back to it.

Two icons are drawn new, matching the set's grammar (20×20 viewBox, 1.6 stroke,
round caps): `sun.svg`, `moon.svg` — added to `assets/icons/` first, then mirrored
into `icons.tsx`.

Swap-ins (operator only):

| Site | Today | Becomes |
|---|---|---|
| Header settings button | `⚙` | `<SettingsIcon />` |
| Header theme-mode button | `☀`/`☾` | `<SunIcon />`/`<MoonIcon />` |
| Header themes button | — (new) | `<ThemesIcon />` |
| Header mode tabs | text only | icon + label (`pre-service`, `songs`, `sermon`, ~15px) |
| Song search field | `⌕` | `<SearchIcon />` |
| Go-live buttons (SermonCenter, SongsMode, SlidesTrack) | `● Go live` | `<GoLiveIcon /> Go live` |
| Take-down buttons (same sites) | `■ Take down` | `<ScreenBlackIcon /> Take down` |
| Import buttons (SongImport, MessageImport, Settings sections) | text/glyph | `<ImportIcon />` + label |
| Displays settings section | text | `<DisplayIcon />` + label |

Buttons that mix icon + text use inline-flex with a small gap so baseline alignment
stays clean at the existing font sizes. The ✕ clear button in search fields and all
status badges stay typographic (see Non-goals).

### 5. Testing

- `theme.ts`: `themeFor` returns the right palette per (family, mode); every family
  ships all tokens (no undefined); Classic dark equals the pre-change rendered values.
- `App`/persistence: mocked `window.helm.settings` — boot hydrates saved
  `{family, mode}`; toggling mode and picking a family each write `appearance`.
- `Header`: themes popover opens, lists both families, selecting one applies it and
  closes; ☀/☾ keeps family, flips mode.
- Existing tests asserting glyph text ("● Go live", "■ Take down", "⚙") are updated
  to match the new markup (accessible names/titles preserved).

## Sequencing

1. Icon module + glyph swaps (no behavior change).
2. Theme model rework + Tone removal.
3. Persistence + header popover.

Each lands green (`npm test`, lint, typecheck) before the next.
