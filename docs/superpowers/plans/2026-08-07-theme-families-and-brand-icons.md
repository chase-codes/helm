# Theme Families + Brand Icon Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named, persisted theme families (Classic = Charcoal/Parchment, Helm = navy/gold pair) picked from a header popover, plus adoption of the brand icon set across the operator chrome.

**Architecture:** `src/shared/theme.ts` becomes a two-family palette table (`FAMILIES`) with `themeFor(family, mode)`; the dormant Tone system is deleted. A `useAppearance` hook in the operator renderer hydrates `{family, mode}` from the existing `window.helm.settings` IPC (SQLite) and persists every change. Icons are inline-SVG React components in `src/renderer/shared/icons.tsx` (the `HelmMark.tsx` pattern), copied verbatim from `assets/icons/*.svg`.

**Tech Stack:** Electron + React 19 + TypeScript, vitest + @testing-library/react (jsdom), inline `CSSProperties` styling (no CSS framework).

**Spec:** `docs/superpowers/specs/2026-08-07-theme-families-and-brand-icons-design.md`

## Global Constraints

- Commit messages: concise conventional-commit subjects, NO `Co-Authored-By`/`Claude-Session` trailers (CLAUDE.md).
- Verification commands: `npm test`, `npm run lint`, `npm run typecheck`. All three must pass before each commit.
- Icons: 20×20 viewBox, stroke `currentColor`, strokeWidth 1.6, round caps/joins — matching `assets/icons/*.svg` exactly.
- Status badges stay typographic: ● ARMED, ● ON SCREEN, ✕ TAKE DOWN chip, ● PRIMARY / ◧ COMPARE, the search-field ✕ clear button, and the `⇄ Switch to …` arrow are NOT replaced.
- Output windows are out of scope: `LeaderView.tsx` keeps importing `DARK`.
- All file paths below are relative to the repo root `/Users/lem/repos/helm`.

---

### Task 1: Sun/moon assets + icon component module

**Files:**
- Create: `assets/icons/sun.svg`, `assets/icons/moon.svg`
- Create: `src/renderer/shared/icons.tsx`
- Test: `src/renderer/shared/icons.test.tsx`

**Interfaces:**
- Produces: `IconProps = { size?: number }` and 15 named exports, each `(props: IconProps) => JSX.Element`: `DisplayIcon, GoLiveIcon, ImportIcon, LogoIcon, MessageIcon, PreServiceIcon, ScheduleIcon, ScreenBlackIcon, SearchIcon, SermonIcon, SettingsIcon, SongsIcon, ThemesIcon, SunIcon, MoonIcon`. Default size 20; SVG inherits `currentColor`.

- [ ] **Step 1: Add the two new brand-style SVGs to `assets/icons/`**

`assets/icons/sun.svg` (one line + trailing newline, matching the set):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="4"></circle><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M15.8 4.2l-1.7 1.7M5.9 14.1l-1.7 1.7"></path></svg>
```

`assets/icons/moon.svg` — crescent plus a small sparkle so it doesn't read as `screen-black.svg`'s plain crescent:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15.2 12.1A6.4 6.4 0 1 1 7.4 4.3a5 5 0 0 0 7.8 7.8z"></path><path d="M15 2.6v2.8M13.6 4h2.8"></path></svg>
```

- [ ] **Step 2: Write the failing test**

`src/renderer/shared/icons.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as icons from './icons'

afterEach(cleanup)

const ICON_NAMES = [
  'DisplayIcon', 'GoLiveIcon', 'ImportIcon', 'LogoIcon', 'MessageIcon',
  'PreServiceIcon', 'ScheduleIcon', 'ScreenBlackIcon', 'SearchIcon',
  'SermonIcon', 'SettingsIcon', 'SongsIcon', 'ThemesIcon', 'SunIcon', 'MoonIcon'
] as const

describe('icons', () => {
  it.each(ICON_NAMES)('%s renders a 20-viewBox currentColor svg', (name) => {
    const Icon = icons[name]
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg!.getAttribute('viewBox')).toBe('0 0 20 20')
    expect(svg!.getAttribute('stroke')).toBe('currentColor')
    expect(svg!.getAttribute('width')).toBe('20')
  })

  it('honors the size prop', () => {
    const { container } = render(<icons.SearchIcon size={15} />)
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('15')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/renderer/shared/icons.test.tsx`
Expected: FAIL — cannot resolve `./icons`.

- [ ] **Step 4: Write `src/renderer/shared/icons.tsx`**

Path data is copied verbatim from `assets/icons/*.svg` (the brand source of truth):

```tsx
import type { JSX, ReactNode } from 'react'

export interface IconProps {
  size?: number
}

/**
 * Brand stroke icons, inlined from assets/icons/*.svg (the source of truth —
 * keep the two in sync). Same pattern as HelmMark: currentColor so the
 * surrounding text color themes them.
 */
function Icon({ size = 20, children }: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function DisplayIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="2.5" y="3.5" width="15" height="10.5" rx="1.5" />
      <path d="M10 14v3M6.5 17h7" />
    </Icon>
  )
}

export function GoLiveIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M8.2 6.8v6.4L13.6 10z" />
    </Icon>
  )
}

export function ImportIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M10 3v8.5M6.5 8 10 11.5 13.5 8M4 16.5h12" />
    </Icon>
  )
}

export function LogoIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="10" cy="10" r="5.6" />
      <circle cx="10" cy="10" r="1.6" />
      <path d="M10 1.5v2.9M10 15.6v2.9M1.5 10h2.9M15.6 10h2.9M4 4l2 2M14 14l2 2M16 4l-2 2M6 14l-2 2" />
    </Icon>
  )
}

export function MessageIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="2.5" y="5" width="15" height="10" rx="1.5" />
      <circle cx="7" cy="10" r="1.7" />
      <circle cx="13" cy="10" r="1.7" />
      <path d="M8.7 10h2.6" />
    </Icon>
  )
}

export function PreServiceIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M4 10a6 6 0 0 1 6-6h3.5" />
      <path d="M11.8 1.8 14 4l-2.2 2.2" />
      <path d="M16 10a6 6 0 0 1-6 6H6.5" />
      <path d="M8.7 13.8 6.5 16l2.2 2.2" />
    </Icon>
  )
}

export function ScheduleIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h8" />
    </Icon>
  )
}

export function ScreenBlackIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M16.5 12.3A7.2 7.2 0 1 1 7.7 3.5a5.6 5.6 0 0 0 8.8 8.8z" />
    </Icon>
  )
}

export function SearchIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13 13l4.5 4.5" />
    </Icon>
  )
}

export function SermonIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M10 5.2C8.5 4 6.5 3.4 4 3.4V15c2.5 0 4.5.6 6 1.8 1.5-1.2 3.5-1.8 6-1.8V3.4c-2.5 0-4.5.6-6 1.8v11.6" />
    </Icon>
  )
}

export function SettingsIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M5 3v7.7M5 14.3V17M10 3v1.2M10 7.8V17M15 3v8.7M15 15.3V17" />
      <circle cx="5" cy="12.5" r="1.8" />
      <circle cx="10" cy="6" r="1.8" />
      <circle cx="15" cy="13.5" r="1.8" />
    </Icon>
  )
}

export function SongsIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M7.5 15.5V5l7-1.5V13" />
      <circle cx="5.5" cy="15.5" r="2" />
      <circle cx="12.5" cy="13" r="2" />
    </Icon>
  )
}

export function ThemesIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function SunIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="10" cy="10" r="4" />
      <path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M15.8 4.2l-1.7 1.7M5.9 14.1l-1.7 1.7" />
    </Icon>
  )
}

export function MoonIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M15.2 12.1A6.4 6.4 0 1 1 7.4 4.3a5 5 0 0 0 7.8 7.8z" />
      <path d="M15 2.6v2.8M13.6 4h2.8" />
    </Icon>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/renderer/shared/icons.test.tsx`
Expected: PASS (16 tests).

- [ ] **Step 6: Full verification + commit**

```bash
npm test && npm run lint && npm run typecheck
git add assets/icons/sun.svg assets/icons/moon.svg src/renderer/shared/icons.tsx src/renderer/shared/icons.test.tsx
git commit -m "feat(icons): inline brand icon components; add sun/moon to the set"
```

---

### Task 2: Header — settings gear, sun/moon, mode-tab icons

**Files:**
- Modify: `src/renderer/operator/Header.tsx`

**Interfaces:**
- Consumes: `SettingsIcon, SunIcon, MoonIcon, PreServiceIcon, SongsIcon, SermonIcon` from Task 1.
- Produces: no API change — `HeaderProps` is untouched in this task.

There is no Header.test today and this is a pure markup swap; existing app-level rendering is covered by the full suite. No new test file — the suite must stay green.

- [ ] **Step 1: Swap the glyphs in `Header.tsx`**

Add to the imports (`Header.tsx:1-7` region):

```tsx
import { MoonIcon, PreServiceIcon, SermonIcon, SettingsIcon, SongsIcon, SunIcon } from '../shared/icons'
```

Replace the `MODE_TABS` constant (`Header.tsx:17-21`) — note the type import for `IconProps`:

```tsx
import type { IconProps } from '../shared/icons'

const MODE_TABS: Array<{ id: Mode; label: string; Icon: (p: IconProps) => JSX.Element }> = [
  { id: 'pre', label: 'Pre-service', Icon: PreServiceIcon },
  { id: 'songs', label: 'Songs', Icon: SongsIcon },
  { id: 'sermon', label: 'Sermon', Icon: SermonIcon }
]
```

Update `modeTabStyle` (`Header.tsx:68-75`) to lay out icon + label:

```tsx
  const modeTabStyle = (active: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    padding: '7px 16px',
    borderRadius: '8px',
    fontSize: '13.5px',
    fontWeight: active ? 700 : 600,
    color: active ? T.accentInk : T.dim,
    background: active ? T.accent : 'transparent'
  })
```

Update the tab render (`Header.tsx:136-140`):

```tsx
        {MODE_TABS.map((t) => (
          <button key={t.id} style={modeTabStyle(mode === t.id)} onClick={() => setMode(t.id)}>
            <t.Icon size={15} />
            {t.label}
          </button>
        ))}
```

Replace the theme button content (`Header.tsx:174-176`):

```tsx
      <button style={themeBtnStyle} onClick={toggleTheme} title="Light/dark">
        {themeMode === 'dark' ? <SunIcon size={17} /> : <MoonIcon size={17} />}
      </button>
```

Replace the settings button content (`Header.tsx:177-179`):

```tsx
      <button style={themeBtnStyle} onClick={onOpenSettings} title="Settings">
        <SettingsIcon size={17} />
      </button>
```

- [ ] **Step 2: Verify visually and run the suite**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass (no test asserts ⚙/☀/☾ — confirm with `grep -rn "⚙\|☀\|☾" src --include="*.test.tsx"` returning nothing).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/operator/Header.tsx
git commit -m "feat(operator): brand icons in header — settings, sun/moon, mode tabs"
```

---

### Task 3: Search, import, and settings-nav icons

**Files:**
- Modify: `src/renderer/operator/SongSearchRail.tsx:160,188`
- Modify: `src/renderer/operator/SettingsModal.tsx` (SECTIONS nav ~441-450, message import button ~496)
- Modify: `src/renderer/operator/SongImport.tsx:272-274` (the "Import N songs" confirm button)

**Interfaces:**
- Consumes: `SearchIcon, ImportIcon, DisplayIcon` from Task 1.

MessageImport's confirm button ("Save to library", `MessageImport.tsx:250-252`) intentionally stays text-only — it's a save action, not an import; its modal is already opened from an ImportIcon'd button.

- [ ] **Step 1: SongSearchRail — search glass and import row**

Add import:

```tsx
import { ImportIcon, SearchIcon } from '../shared/icons'
```

Replace line 160's `<span style={{ fontSize: '15px', opacity: 0.5 }}>⌕</span>` with:

```tsx
          <span style={{ display: 'inline-flex', opacity: 0.5 }}>
            <SearchIcon size={15} />
          </span>
```

Replace the import row (line 186-189, currently `↓ Import a song library`):

```tsx
        <button style={{ ...importRowStyle, display: 'inline-flex', alignItems: 'center', gap: '7px' }} onClick={onImportSongs}>
          <ImportIcon size={14} /> Import a song library
        </button>
```

(Leave the ✕ clear button at line 169-172 untouched.)

- [ ] **Step 2: Check SongSearchRail tests still pass**

Run: `npx vitest run src/renderer/operator/SongSearchRail.test.tsx`
If a test queries `↓ Import a song library` or `⌕`, change the query text to `Import a song library` / remove the glyph expectation. Expected: PASS.

- [ ] **Step 3: SettingsModal — Displays nav icon + import button icon**

Add import:

```tsx
import { DisplayIcon, ImportIcon } from '../shared/icons'
```

In the `SECTIONS` nav render (~line 441-450), give the Displays row its icon. The row currently renders `{s.label}` inside a `<button>`; change the button body to:

```tsx
                <button
                  key={s.id}
                  disabled={!s.enabled}
                  style={{ ...navItemStyle(section === s.id, s.enabled), display: 'flex', alignItems: 'center', gap: '8px' }}
                  onClick={() => s.enabled && setSection(s.id)}
                >
                  {s.id === 'displays' && <DisplayIcon size={15} />}
                  {s.label}
                </button>
```

(Adapt to the existing button's exact attributes — keep every existing prop/handler, only add the flex layout and icon. Read the current block before editing.)

On the message-section button at ~line 496 (`Import from file…` opener — the one with `onClick={() => setMessageImportOpen(true)}`), prepend the icon the same way:

```tsx
                    <button
                      style={{ ...ghostBtnStyle(false), display: 'inline-flex', alignItems: 'center', gap: '7px' }}
                      onClick={() => setMessageImportOpen(true)}
                    >
                      <ImportIcon size={14} /> {/* keep the button's existing label text */}
                    </button>
```

- [ ] **Step 4: SongImport — confirm button icon**

Add import:

```tsx
import { ImportIcon } from '../shared/icons';
```

Replace the confirm button at `SongImport.tsx:272-274`:

```tsx
            <button
              style={{ ...primaryStyle, display: 'inline-flex', alignItems: 'center', gap: '7px' }}
              onClick={() => runImport(step.token, newCount)}
            >
              <ImportIcon size={14} /> Import {plural(newCount, 'song', 'songs')}
            </button>
```

If `SongImport.test.tsx` queries `Import N songs` by text it still matches (icon adds no text).

- [ ] **Step 5: Run the suite**

Run: `npm test && npm run lint && npm run typecheck`
Expected: PASS. `DisplaysSettings.test.tsx` and `SettingsModal`-related tests query by label text, which is preserved.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/SongSearchRail.tsx src/renderer/operator/SettingsModal.tsx src/renderer/operator/SongImport.tsx
git commit -m "feat(operator): search/import/display icons in rail and settings"
```

---

### Task 4: Go live / Take down buttons

**Files:**
- Modify: `src/renderer/operator/SermonCenter.tsx:266-268`
- Modify: `src/renderer/operator/SongsMode.tsx:618-625`
- Modify (tests asserting the glyphs): `src/renderer/operator/SermonMode.test.tsx:365-369`, `src/renderer/operator/SlidesTrack.test.tsx:124,227`, plus any others the grep in Step 3 finds.

**Interfaces:**
- Consumes: `GoLiveIcon, ScreenBlackIcon` from Task 1.
- Produces: button accessible text becomes exactly `Go live` / `Take down` (no glyph prefix) — tests query these.

- [ ] **Step 1: SermonCenter button**

Add import:

```tsx
import { GoLiveIcon, ScreenBlackIcon } from '../shared/icons';
```

Replace the button body at `SermonCenter.tsx:266-268`:

```tsx
        <button
          style={{ ...goLiveStyle, display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          onClick={onGoLive}
        >
          {cuedIsLive ? <ScreenBlackIcon size={14} /> : <GoLiveIcon size={14} />}
          {cuedIsLive ? 'Take down' : 'Go live'}
        </button>
```

- [ ] **Step 2: SongsMode buttons**

Add the same import. Replace `SongsMode.tsx:618-625`:

```tsx
          {armed && (
            <button
              style={{ ...goLiveStyle, background: T.live, display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              onClick={takeDown}
            >
              <ScreenBlackIcon size={14} /> Take down
            </button>
          )}
          <button
            style={{ ...goLiveStyle, display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            onClick={armed ? commitSwitch : goLive}
          >
            {!armed && (cuedIsLive ? <ScreenBlackIcon size={14} /> : <GoLiveIcon size={14} />)}
            {armed ? `⇄ Switch to ${armed.title}` : cuedIsLive ? 'Take down' : 'Go live'}
          </button>
```

(The `⇄ Switch` label keeps its typographic arrow per the spec.)

- [ ] **Step 3: Update every test that asserts the old glyph labels**

Find them all:

```bash
grep -rn "● Go live\|■ Take down" src --include="*.test.tsx"
```

Known sites: `SermonMode.test.tsx:365,367,369` and `SlidesTrack.test.tsx:124,227`. In each, change the query string `'● Go live'` → `'Go live'` and `'■ Take down'` → `'Take down'` (and any comment text mentioning the glyph form can stay). Example for `SlidesTrack.test.tsx:124`:

```tsx
    const goLiveBtn = (await screen.findByText('Go live')).closest('button') as HTMLButtonElement
```

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run lint && npm run typecheck`
Expected: PASS. If a test fails on text matching, check whether it used exact-match `getByText` against a label this task changed, and align it with the new plain-text labels.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/SermonCenter.tsx src/renderer/operator/SongsMode.tsx src/renderer/operator/SermonMode.test.tsx src/renderer/operator/SlidesTrack.test.tsx
git commit -m "feat(operator): go-live/take-down buttons use brand icons"
```

---

### Task 5: Theme families in shared/theme.ts (Tone system removed)

**Files:**
- Rewrite: `src/shared/theme.ts`
- Modify: `src/renderer/operator/ThemeCtx.ts:4`, `src/renderer/operator/App.tsx:2,15,54-56`
- Modify (mechanical sweep): every `themeFor('dark')`/`themeFor('light')` call in the 14 test files listed in Step 4
- Test: `src/shared/theme.test.ts` (new)

**Interfaces:**
- Produces:
  - `type ThemeFamily = 'classic' | 'helm'`
  - `type ThemeMode = 'dark' | 'light'` (moves here; `App.tsx` re-exports it)
  - `FAMILIES: Record<ThemeFamily, { label: string; presetName: Record<ThemeMode, string>; dark: Palette; light: Palette }>`
  - `themeFor(family: ThemeFamily, mode: ThemeMode): Theme`
  - `DARK` stays exported (Classic dark palette) for `LeaderView.tsx:8`.
  - `Tone`, `TONES`, and the old `LIGHT` export are deleted.

- [ ] **Step 1: Write the failing test**

`src/shared/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DARK, FAMILIES, themeFor } from './theme'

describe('themeFor', () => {
  it('classic dark keeps today\'s charcoal values', () => {
    const t = themeFor('classic', 'dark')
    expect(t.appBg).toBe('#0f1115')
    expect(t.accent).toBe('#e0a341')
    expect(t.scripture).toBe('#6f9cf0')
    expect(t.message).toBe('#a88bc4')
  })

  it('classic light uses its own parchment-tuned content colors', () => {
    const t = themeFor('classic', 'light')
    expect(t.appBg).toBe('#ece5d6')
    // Previously dead — the Warm tone merge overrode these with dark-tuned values.
    expect(t.scripture).toBe('#3f6bb5')
    expect(t.sermon).toBe('#4f7d5f')
    expect(t.message).toBe('#7d54ad')
  })

  it('helm dark is the brand navy/gold pairing', () => {
    const t = themeFor('helm', 'dark')
    expect(t.appBg).toBe('#0B1322')
    expect(t.text).toBe('#EFE9DC')
    expect(t.accent).toBe('#E0A341')
  })

  it('helm light is ink-on-parchment', () => {
    const t = themeFor('helm', 'light')
    expect(t.appBg).toBe('#EFE9DC')
    expect(t.text).toBe('#16243E')
  })

  it('every family/mode palette carries every token', () => {
    for (const family of ['classic', 'helm'] as const) {
      for (const mode of ['dark', 'light'] as const) {
        const t = themeFor(family, mode)
        for (const [k, v] of Object.entries(t)) {
          expect(v, `${family}/${mode}.${k}`).toBeTruthy()
        }
        expect(t.floatShadow).toContain(t.border)
      }
    }
  })

  it('exports DARK as the classic dark palette for LeaderView', () => {
    expect(DARK).toBe(FAMILIES.classic.dark)
  })

  it('names the presets', () => {
    expect(FAMILIES.classic.presetName).toEqual({ dark: 'Charcoal', light: 'Parchment' })
    expect(FAMILIES.helm.presetName).toEqual({ dark: 'Helm Navy', light: 'Helm Parchment' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/theme.test.ts`
Expected: FAIL — `FAMILIES` not exported; `themeFor('classic', 'dark')` signature mismatch.

- [ ] **Step 3: Rewrite `src/shared/theme.ts`**

```ts
export interface Theme {
  appBg: string; panel: string; panel2: string; panel3: string;
  text: string; dim: string; faint: string; hairline: string; border: string;
  inputBg: string; accent: string; accentInk: string; live: string;
  scripture: string; sermon: string; message: string; quote: string;
  floatShadow: string;
}
export type ThemeFamily = 'classic' | 'helm';
export type ThemeMode = 'dark' | 'light';
type Palette = Omit<Theme, 'floatShadow'>;

const CLASSIC_DARK: Palette = { appBg: '#0f1115', panel: '#15171c', panel2: '#1c1f25', panel3: '#23262e', text: '#e8e6e1', dim: '#9a9488', faint: '#736f66', hairline: 'rgba(255,255,255,.06)', border: 'rgba(255,255,255,.08)', inputBg: '#1c1f25', accent: '#e0a341', accentInk: '#1a1206', live: '#cf6a5e', scripture: '#6f9cf0', sermon: '#6f9c7a', message: '#a88bc4', quote: '#b98cf0' };
const CLASSIC_LIGHT: Palette = { appBg: '#ece5d6', panel: '#f7f3ea', panel2: '#fdfbf6', panel3: '#ffffff', text: '#2c2823', dim: '#7a7263', faint: '#a59c8a', hairline: 'rgba(0,0,0,.08)', border: 'rgba(0,0,0,.12)', inputBg: '#ffffff', accent: '#b87a2c', accentInk: '#ffffff', live: '#bf4f44', scripture: '#3f6bb5', sermon: '#4f7d5f', message: '#7d54ad', quote: '#8a5cc0' };
const HELM_DARK: Palette = { appBg: '#0B1322', panel: '#101B30', panel2: '#16243E', panel3: '#1C2D4C', text: '#EFE9DC', dim: '#a89f8c', faint: '#6f6c60', hairline: 'rgba(239,233,220,.07)', border: 'rgba(239,233,220,.11)', inputBg: '#101B30', accent: '#E0A341', accentInk: '#1a1206', live: '#cf6a5e', scripture: '#7fa5ee', sermon: '#79a586', message: '#a88bc4', quote: '#b98cf0' };
const HELM_LIGHT: Palette = { appBg: '#EFE9DC', panel: '#f5f0e5', panel2: '#faf7ef', panel3: '#ffffff', text: '#16243E', dim: '#5a6478', faint: '#8a91a3', hairline: 'rgba(22,36,62,.10)', border: 'rgba(22,36,62,.15)', inputBg: '#ffffff', accent: '#a9762a', accentInk: '#fff8ec', live: '#bf4f44', scripture: '#3f6bb5', sermon: '#4f7d5f', message: '#7d54ad', quote: '#8a5cc0' };

export const FAMILIES: Record<ThemeFamily, { label: string; presetName: Record<ThemeMode, string>; dark: Palette; light: Palette }> = {
  classic: { label: 'Classic', presetName: { dark: 'Charcoal', light: 'Parchment' }, dark: CLASSIC_DARK, light: CLASSIC_LIGHT },
  helm: { label: 'Helm', presetName: { dark: 'Helm Navy', light: 'Helm Parchment' }, dark: HELM_DARK, light: HELM_LIGHT },
};

/** Classic dark palette — LeaderView renders operator-dark regardless of the operator's pick. */
export const DARK = CLASSIC_DARK;

export function themeFor(family: ThemeFamily, mode: ThemeMode): Theme {
  const p = FAMILIES[family][mode];
  return { ...p, floatShadow: `0 18px 50px rgba(0,0,0,.45), inset 0 0 0 1px ${p.border}` };
}
```

- [ ] **Step 4: Update the call sites**

`src/renderer/operator/ThemeCtx.ts:4`:

```ts
export const ThemeCtx = createContext<Theme>(themeFor('classic', 'dark'));
```

`src/renderer/operator/App.tsx` — line 2 imports and line 15 type:

```ts
import { themeFor, type ThemeMode } from '../../shared/theme';
```

```ts
export type { ThemeMode } from '../../shared/theme';
```

(Delete the local `export type ThemeMode = 'dark' | 'light';` — the seven `import type { ThemeMode } from './App'` sites keep working through the re-export.)

Line 55: `const theme = themeFor('classic', themeMode);` (family becomes state in Task 6).

Mechanical sweep over the test files (14 files — ChapterRail, ContextMenu, DisplaysSettings, OutputViewPopover, PreCardEditor, PreServiceMode, QuickAdd, SchedulePanel, SermonMode, ShortcutsSettings, SlidesTrack, SongImport, SongSearchRail, SongsMode `.test.tsx`):

```bash
grep -rl "themeFor('dark')\|themeFor('light')" src | xargs sed -i '' \
  -e "s/themeFor('dark')/themeFor('classic', 'dark')/g" \
  -e "s/themeFor('light')/themeFor('classic', 'light')/g"
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run lint && npm run typecheck`
Expected: PASS, including the new `theme.test.ts`. Note: light-mode scripture/sermon/message values change (spec'd fix of the tone-merge bug) — if any snapshot/color assertion breaks, verify it was asserting the OLD merged values and update it to the palette values above.

- [ ] **Step 6: Commit**

```bash
git add src/shared/theme.ts src/shared/theme.test.ts src/renderer/operator/ThemeCtx.ts src/renderer/operator/App.tsx src/renderer/operator/*.test.tsx
git commit -m "feat(theme): two named families (Classic/Helm) replace mode+tone; fix light-mode tone override"
```

---

### Task 6: useAppearance hook — persisted {family, mode}

**Files:**
- Create: `src/renderer/operator/useAppearance.ts`
- Test: `src/renderer/operator/useAppearance.test.tsx`
- Modify: `src/renderer/operator/App.tsx:53-56` (state), `App.tsx:142` (Header props pass-through — Header itself changes in Task 7)

**Interfaces:**
- Consumes: `ThemeFamily, ThemeMode, themeFor` from Task 5; `window.helm.settings.get/set` (`src/shared/types.ts:299-302`).
- Produces:

```ts
export interface Appearance { family: ThemeFamily; mode: ThemeMode }
export function sanitizeAppearance(v: unknown): Appearance
export function useAppearance(): {
  family: ThemeFamily; mode: ThemeMode; theme: Theme;
  toggleMode: () => void; setFamily: (f: ThemeFamily) => void;
}
```

Settings key: `'appearance'`, value `{ family, mode }`.

- [ ] **Step 1: Write the failing test**

`src/renderer/operator/useAppearance.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { themeFor } from '../../shared/theme'
import { sanitizeAppearance, useAppearance } from './useAppearance'

const settingsGet = vi.fn()
const settingsSet = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  settingsGet.mockResolvedValue({ family: 'classic', mode: 'dark' })
  ;(window as unknown as { helm: unknown }).helm = {
    settings: { get: settingsGet, set: settingsSet }
  }
})

describe('sanitizeAppearance', () => {
  it('passes valid values through', () => {
    expect(sanitizeAppearance({ family: 'helm', mode: 'light' })).toEqual({ family: 'helm', mode: 'light' })
  })
  it('falls back per-field on garbage', () => {
    expect(sanitizeAppearance({ family: 'neon', mode: 42 })).toEqual({ family: 'classic', mode: 'dark' })
    expect(sanitizeAppearance(null)).toEqual({ family: 'classic', mode: 'dark' })
    expect(sanitizeAppearance('nope')).toEqual({ family: 'classic', mode: 'dark' })
  })
})

describe('useAppearance', () => {
  it('hydrates the saved appearance on mount', async () => {
    settingsGet.mockResolvedValue({ family: 'helm', mode: 'light' })
    const { result } = renderHook(() => useAppearance())
    await waitFor(() => expect(result.current.family).toBe('helm'))
    expect(result.current.mode).toBe('light')
    expect(result.current.theme).toEqual(themeFor('helm', 'light'))
    expect(settingsGet).toHaveBeenCalledWith('appearance', { family: 'classic', mode: 'dark' })
  })

  it('toggleMode flips within the family and persists', async () => {
    const { result } = renderHook(() => useAppearance())
    await waitFor(() => expect(settingsGet).toHaveBeenCalled())
    act(() => result.current.toggleMode())
    expect(result.current.mode).toBe('light')
    expect(result.current.family).toBe('classic')
    expect(settingsSet).toHaveBeenCalledWith('appearance', { family: 'classic', mode: 'light' })
  })

  it('setFamily keeps the mode and persists', async () => {
    const { result } = renderHook(() => useAppearance())
    await waitFor(() => expect(settingsGet).toHaveBeenCalled())
    act(() => result.current.setFamily('helm'))
    expect(result.current.family).toBe('helm')
    expect(result.current.mode).toBe('dark')
    expect(settingsSet).toHaveBeenCalledWith('appearance', { family: 'helm', mode: 'dark' })
  })
})
```

(If `vi.stubGlobal` fights with the direct `window.helm` assignment, drop the stubGlobal line — assigning `(window as ...).helm` in `beforeEach` is the pattern; check how sibling tests like `UpdatePill.test.tsx` mock `window.helm` and match it.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/operator/useAppearance.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/renderer/operator/useAppearance.ts`**

```ts
import { useEffect, useState } from 'react';
import { themeFor, type Theme, type ThemeFamily, type ThemeMode } from '../../shared/theme';

export interface Appearance {
  family: ThemeFamily;
  mode: ThemeMode;
}

const DEFAULT_APPEARANCE: Appearance = { family: 'classic', mode: 'dark' };

/** Per-field fallback so a stale/garbled settings row can never wedge the UI. */
export function sanitizeAppearance(v: unknown): Appearance {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    family: o.family === 'helm' ? 'helm' : 'classic',
    mode: o.mode === 'light' ? 'light' : 'dark'
  };
}

/**
 * Operator appearance = theme family + dark/light mode, persisted under the
 * 'appearance' settings key. First paint renders the default until the async
 * hydrate resolves (same tradeoff as the hotkeys load in App).
 */
export function useAppearance(): {
  family: ThemeFamily;
  mode: ThemeMode;
  theme: Theme;
  toggleMode: () => void;
  setFamily: (f: ThemeFamily) => void;
} {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    void window.helm.settings
      .get<unknown>('appearance', DEFAULT_APPEARANCE)
      .then((v) => setAppearance(sanitizeAppearance(v)))
      .catch(console.error);
  }, []);

  const update = (next: Appearance): void => {
    setAppearance(next);
    window.helm.settings.set('appearance', next);
  };

  return {
    family: appearance.family,
    mode: appearance.mode,
    theme: themeFor(appearance.family, appearance.mode),
    toggleMode: () => update({ ...appearance, mode: appearance.mode === 'dark' ? 'light' : 'dark' }),
    setFamily: (family) => update({ ...appearance, family })
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/operator/useAppearance.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire App.tsx to the hook**

Replace `App.tsx:54-56`:

```tsx
  const { family, mode: themeMode, theme, toggleMode: toggleTheme, setFamily } = useAppearance();
```

Add the import, delete the old `const [themeMode, setThemeMode] = ...`, `const theme = themeFor(themeMode)`, and `const toggleTheme = ...` lines, and remove the now-unused `themeFor` import from App. The `Header` call at line 142 keeps `themeMode={themeMode} toggleTheme={toggleTheme}` and additionally passes `family={family} setFamily={setFamily}` — Header accepts them in Task 7, so ONLY pass the new props once Task 7's Header signature exists; if executing tasks strictly in order, add the props in Task 7 instead and pass nothing new here.

- [ ] **Step 6: Run everything**

Run: `npm test && npm run lint && npm run typecheck`
Expected: PASS. Modes' `themeMode` props (`PreServiceMode`, `SongsMode`, `SermonMode`) are fed by the hook's `mode` under the same `themeMode` name — no downstream change.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/operator/useAppearance.ts src/renderer/operator/useAppearance.test.tsx src/renderer/operator/App.tsx
git commit -m "feat(theme): persist appearance (family+mode) via settings store"
```

---

### Task 7: ThemePopover + header themes button

**Files:**
- Create: `src/renderer/operator/ThemePopover.tsx`
- Test: `src/renderer/operator/ThemePopover.test.tsx`
- Modify: `src/renderer/operator/Header.tsx` (props + themes button), `src/renderer/operator/App.tsx:142` (pass `family`/`setFamily`)

**Interfaces:**
- Consumes: `FAMILIES, ThemeFamily` from Task 5; `ThemesIcon` from Task 1; `useAppearance` outputs via App props.
- Produces: `ThemePopover({ family, onSelect, onClose, containRef })`; `HeaderProps` gains `family: ThemeFamily` and `setFamily: (f: ThemeFamily) => void`.

- [ ] **Step 1: Write the failing test**

`src/renderer/operator/ThemePopover.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { ThemePopover } from './ThemePopover'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

function renderPopover(family: 'classic' | 'helm' = 'classic'): {
  onSelect: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
} {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const containRef = createRef<HTMLDivElement>()
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <div ref={containRef}>
        <ThemePopover family={family} onSelect={onSelect} onClose={onClose} containRef={containRef} />
      </div>
    </ThemeCtx.Provider>
  )
  return { onSelect, onClose }
}

describe('ThemePopover', () => {
  it('lists both families with the active one marked', () => {
    renderPopover('helm')
    expect(screen.getByText('Classic')).toBeTruthy()
    expect(screen.getByText('Helm')).toBeTruthy()
    const helmRow = screen.getByText('Helm').closest('button')!
    expect(helmRow.textContent).toContain('✓')
  })

  it('selecting a family reports it and closes', () => {
    const { onSelect, onClose } = renderPopover('classic')
    fireEvent.click(screen.getByText('Helm'))
    expect(onSelect).toHaveBeenCalledWith('helm')
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape closes', () => {
    const { onClose } = renderPopover()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/operator/ThemePopover.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/renderer/operator/ThemePopover.tsx`**

Follows `OutputViewPopover.tsx`'s dismiss pattern (Escape + capture-phase outside mousedown + window blur):

```tsx
import { useContext, useEffect, type CSSProperties, type JSX, type RefObject } from 'react'
import { ThemeCtx } from './ThemeCtx'
import { FAMILIES, type ThemeFamily } from '../../shared/theme'

/** Theme-family picker, anchored under the header's themes button. */
export function ThemePopover({
  family,
  onSelect,
  onClose,
  containRef
}: {
  family: ThemeFamily
  onSelect: (f: ThemeFamily) => void
  onClose: () => void
  containRef: RefObject<HTMLDivElement | null>
}): JSX.Element {
  const T = useContext(ThemeCtx)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!containRef.current?.contains(e.target as Node)) onClose()
    }
    const dismiss = (): void => onClose()
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', dismiss)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', dismiss)
    }
  }, [onClose, containRef])

  const popStyle: CSSProperties = {
    position: 'absolute',
    top: '46px',
    right: 0,
    zIndex: 60,
    minWidth: '220px',
    background: T.panel,
    borderRadius: '12px',
    boxShadow: `0 12px 40px rgba(0,0,0,0.45), inset 0 0 0 1px ${T.hairline}`,
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  }
  const rowStyle = (active: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: active ? 700 : 600,
    color: active ? T.text : T.dim,
    background: active ? T.panel2 : 'transparent',
    textAlign: 'left' as const
  })
  const swatchStyle = (bg: string, ring: string): CSSProperties => ({
    width: '14px',
    height: '14px',
    borderRadius: '4px',
    background: bg,
    boxShadow: `inset 0 0 0 1px ${ring}`,
    flexShrink: 0
  })

  return (
    <div style={popStyle} data-testid="theme-popover">
      {(Object.keys(FAMILIES) as ThemeFamily[]).map((f) => {
        const fam = FAMILIES[f]
        return (
          <button
            key={f}
            style={rowStyle(f === family)}
            onClick={() => {
              onSelect(f)
              onClose()
            }}
          >
            <span style={swatchStyle(fam.dark.appBg, T.border)} />
            <span style={swatchStyle(fam.dark.accent, T.border)} />
            <span style={{ flex: 1 }}>{fam.label}</span>
            {f === family && <span style={{ color: T.accent }}>✓</span>}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/operator/ThemePopover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the Header**

`Header.tsx` — extend props and render. Props (`Header.tsx:9-15`):

```tsx
import type { ThemeFamily } from '../../shared/theme'
import { ThemePopover } from './ThemePopover'
import { ThemesIcon } from '../shared/icons'   // merge into the Task 2 import line

export interface HeaderProps {
  mode: Mode
  setMode: (m: Mode) => void
  themeMode: ThemeMode
  toggleTheme: () => void
  family: ThemeFamily
  setFamily: (f: ThemeFamily) => void
  onOpenSettings: () => void
}
```

Component state + refs (next to the existing `viewsOpen` state, `Header.tsx:34-35`):

```tsx
  const [themesOpen, setThemesOpen] = useState(false)
  const themesContainerRef = useRef<HTMLDivElement | null>(null)
```

Render — insert between the ☀/☾ button and the settings button (`Header.tsx:174-179` region), reusing `themeBtnStyle`:

```tsx
      <div ref={themesContainerRef} style={{ position: 'relative' }}>
        <button style={themeBtnStyle} onClick={() => setThemesOpen((o) => !o)} title="Theme">
          <ThemesIcon size={17} />
        </button>
        {themesOpen && (
          <ThemePopover
            family={family}
            onSelect={setFamily}
            onClose={() => setThemesOpen(false)}
            containRef={themesContainerRef}
          />
        )}
      </div>
```

`App.tsx:142` — pass the new props:

```tsx
        <Header mode={mode} setMode={setMode} themeMode={themeMode} toggleTheme={toggleTheme} family={family} setFamily={setFamily} onOpenSettings={() => setSettingsOpen(true)} />
```

- [ ] **Step 6: Run everything**

Run: `npm test && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Manual smoke test**

Run: `npm run dev` — verify: themes button opens the popover; picking Helm swaps to navy/gold; ☀/☾ flips to ink-on-parchment; relaunch the app and both choices stick; Classic still looks exactly like before in dark mode.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/operator/ThemePopover.tsx src/renderer/operator/ThemePopover.test.tsx src/renderer/operator/Header.tsx src/renderer/operator/App.tsx
git commit -m "feat(theme): header theme-family popover (Classic/Helm)"
```

---

## After all tasks

- Close the loop on issue #11: `gh issue close 11 --repo chase-codes/helm --comment "..."` referencing the merge.
- Manual follow-up for Chase (not code): upload `assets/github-banner.png` as the repo's social preview in GitHub Settings.
