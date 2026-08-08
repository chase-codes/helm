# Appearance Settings Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move theme controls into a new Appearance section in the Settings modal, drop the header themes popover, and remove the disabled Songs/Backup nav placeholders.

**Architecture:** A new `AppearanceSettings` section component renders family cards + a dark/light segmented control inside the existing `SettingsModal` left-nav layout. State stays where it is: `useAppearance` (App-level, persisted under the `appearance` settings key) gains an absolute `setMode` setter; App wires the four theme props to SettingsModal instead of Header. `ThemePopover` is deleted.

**Tech Stack:** Electron + React 19 + TypeScript, inline `CSSProperties` styling via `ThemeCtx`, Vitest + @testing-library/react (jsdom), tests colocated as `*.test.tsx`.

**Spec:** `docs/superpowers/specs/2026-08-07-appearance-settings-design.md`

## Global Constraints

- Theme changes apply instantly on click — no Save button anywhere.
- Header keeps the sun/moon toggle and settings gear; the themes popover button is removed.
- LeaderView stays pinned to Classic dark (`DARK` export in `src/shared/theme.ts`) — do not touch it.
- Settings nav order: Appearance, Bibles, Displays, Shortcuts, Message. No disabled entries.
- All commands run from repo root `/Users/lem/repos/helm/.claude/worktrees/theme-families-icons`.
- Commits: short conventional subject, no `Co-Authored-By`/`Claude-Session` trailers (house rule).
- Verification suite: `npm test`, `npm run typecheck`, `npm run lint`.

---

### Task 1: `useAppearance` gains an absolute `setMode`

The segmented control needs to set a specific mode ("Light"), not flip whatever is current. `toggleMode` stays for the header sun/moon.

**Files:**
- Modify: `src/renderer/operator/useAppearance.ts:25-53`
- Test: `src/renderer/operator/useAppearance.test.tsx`

**Interfaces:**
- Consumes: existing `useAppearance()` hook and its `update` helper.
- Produces: `setMode: (m: ThemeMode) => void` on the hook's return object — Task 4 (App) passes it to SettingsModal as `setThemeMode`.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('useAppearance', ...)` block in `src/renderer/operator/useAppearance.test.tsx`:

```tsx
  it('setMode sets an absolute mode and persists', async () => {
    const { result } = renderHook(() => useAppearance())
    await waitFor(() => expect(settingsGet).toHaveBeenCalled())
    act(() => result.current.setMode('light'))
    expect(result.current.mode).toBe('light')
    expect(result.current.family).toBe('classic')
    expect(settingsSet).toHaveBeenCalledWith('appearance', { family: 'classic', mode: 'light' })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/operator/useAppearance.test.tsx`
Expected: FAIL — `result.current.setMode is not a function`

- [ ] **Step 3: Implement**

In `src/renderer/operator/useAppearance.ts`, add `setMode` to the return type and return object:

```ts
export function useAppearance(): {
  family: ThemeFamily;
  mode: ThemeMode;
  theme: Theme;
  toggleMode: () => void;
  setMode: (m: ThemeMode) => void;
  setFamily: (f: ThemeFamily) => void;
} {
```

and in the returned object (alongside `toggleMode`/`setFamily`):

```ts
    setMode: (mode) => update({ ...appearance, mode }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/operator/useAppearance.test.tsx`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/useAppearance.ts src/renderer/operator/useAppearance.test.tsx
git commit -m "feat(theme): useAppearance gains absolute setMode"
```

---

### Task 2: `AppearanceSettings` component

New settings section: one card per theme family (swatches + label + preset name, click to apply, active card ringed and checked) and a Dark/Light segmented control. Follows the DisplaysSettings pattern: section renders its own title/hint, styled inline via `ThemeCtx`.

**Files:**
- Create: `src/renderer/operator/AppearanceSettings.tsx`
- Test: `src/renderer/operator/AppearanceSettings.test.tsx`

**Interfaces:**
- Consumes: `FAMILIES`, `ThemeFamily`, `ThemeMode` from `src/shared/theme.ts` (`FAMILIES[f]` has `label: string`, `presetName: Record<ThemeMode, string>`, `dark`/`light` palettes with `appBg`/`accent`); `ThemeCtx` from `./ThemeCtx`.
- Produces: `AppearanceSettings` component with props `{ family: ThemeFamily; onFamilyChange: (f: ThemeFamily) => void; themeMode: ThemeMode; onModeChange: (m: ThemeMode) => void }` — Task 3 renders it inside SettingsModal.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/operator/AppearanceSettings.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettings } from './AppearanceSettings'
import { ThemeCtx } from './ThemeCtx'
import { themeFor, type ThemeFamily, type ThemeMode } from '../../shared/theme'

afterEach(cleanup)

function renderAppearance(
  family: ThemeFamily = 'classic',
  mode: ThemeMode = 'dark'
): { onFamilyChange: ReturnType<typeof vi.fn>; onModeChange: ReturnType<typeof vi.fn> } {
  const onFamilyChange = vi.fn()
  const onModeChange = vi.fn()
  render(
    <ThemeCtx.Provider value={themeFor(family, mode)}>
      <AppearanceSettings
        family={family}
        onFamilyChange={onFamilyChange}
        themeMode={mode}
        onModeChange={onModeChange}
      />
    </ThemeCtx.Provider>
  )
  return { onFamilyChange, onModeChange }
}

describe('AppearanceSettings', () => {
  it('renders both family cards with the active one marked', () => {
    renderAppearance('helm')
    const helm = screen.getByTestId('family-helm')
    const classic = screen.getByTestId('family-classic')
    expect(helm.textContent).toContain('Helm')
    expect(helm.textContent).toContain('✓')
    expect(classic.textContent).toContain('Classic')
    expect(classic.textContent).not.toContain('✓')
  })

  it('shows the preset name for the current mode', () => {
    renderAppearance('helm', 'dark')
    expect(screen.getByText('Helm Navy')).toBeTruthy()
    expect(screen.getByText('Charcoal')).toBeTruthy()
  })

  it('clicking a family card reports it', () => {
    const { onFamilyChange } = renderAppearance('classic')
    fireEvent.click(screen.getByTestId('family-helm'))
    expect(onFamilyChange).toHaveBeenCalledWith('helm')
  })

  it('mode control reports the absolute mode', () => {
    const { onModeChange } = renderAppearance('classic', 'dark')
    fireEvent.click(screen.getByText('Light'))
    expect(onModeChange).toHaveBeenCalledWith('light')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/operator/AppearanceSettings.test.tsx`
Expected: FAIL — cannot resolve `./AppearanceSettings`

- [ ] **Step 3: Implement the component**

Create `src/renderer/operator/AppearanceSettings.tsx`:

```tsx
import { useContext, type CSSProperties, type JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import { FAMILIES, type ThemeFamily, type ThemeMode } from '../../shared/theme'

export interface AppearanceSettingsProps {
  family: ThemeFamily
  onFamilyChange: (f: ThemeFamily) => void
  themeMode: ThemeMode
  onModeChange: (m: ThemeMode) => void
}

/** Settings › Appearance: theme-family cards + dark/light mode control. */
export function AppearanceSettings({
  family,
  onFamilyChange,
  themeMode,
  onModeChange
}: AppearanceSettingsProps): JSX.Element {
  const T = useContext(ThemeCtx)

  const titleStyle: CSSProperties = { fontSize: '15px', fontWeight: 700, marginBottom: '4px' }
  const hintStyle: CSSProperties = {
    fontSize: '12.5px',
    color: T.dim,
    lineHeight: 1.4,
    marginBottom: '16px'
  }
  const groupLabelStyle: CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: T.dim,
    margin: '18px 0 10px'
  }
  const cardsRowStyle: CSSProperties = { display: 'flex', gap: '12px' }
  const cardStyle = (active: boolean): CSSProperties => ({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '12px 14px',
    borderRadius: '10px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 ${active ? 2 : 1}px ${active ? T.accent : T.border}`,
    textAlign: 'left'
  })
  const swatchRowStyle: CSSProperties = { display: 'flex', gap: '6px' }
  const swatchStyle = (bg: string): CSSProperties => ({
    width: '18px',
    height: '18px',
    borderRadius: '5px',
    background: bg,
    boxShadow: `inset 0 0 0 1px ${T.border}`
  })
  const segWrapStyle: CSSProperties = {
    display: 'inline-flex',
    gap: '4px',
    background: T.panel2,
    padding: '4px',
    borderRadius: '10px'
  }
  const segBtnStyle = (active: boolean): CSSProperties => ({
    padding: '7px 16px',
    borderRadius: '7px',
    fontSize: '13px',
    fontWeight: active ? 700 : 600,
    color: active ? T.accentInk : T.dim,
    background: active ? T.accent : 'transparent'
  })

  return (
    <>
      <div style={titleStyle}>Appearance</div>
      <div style={hintStyle}>
        Pick a theme for the operator screen. Changes apply instantly; the header sun/moon
        button flips the same dark/light setting.
      </div>
      <div style={groupLabelStyle}>Theme</div>
      <div style={cardsRowStyle}>
        {(Object.keys(FAMILIES) as ThemeFamily[]).map((f) => {
          const fam = FAMILIES[f]
          const active = f === family
          return (
            <button
              key={f}
              style={cardStyle(active)}
              onClick={() => onFamilyChange(f)}
              data-testid={`family-${f}`}
            >
              <span style={swatchRowStyle}>
                <span style={swatchStyle(fam[themeMode].appBg)} />
                <span style={swatchStyle(fam[themeMode].accent)} />
              </span>
              <span style={{ fontSize: '13.5px', fontWeight: 700, color: T.text }}>
                {fam.label} {active && <span style={{ color: T.accent }}>✓</span>}
              </span>
              <span style={{ fontSize: '12px', color: T.dim }}>{fam.presetName[themeMode]}</span>
            </button>
          )
        })}
      </div>
      <div style={groupLabelStyle}>Mode</div>
      <div style={segWrapStyle}>
        {(['dark', 'light'] as ThemeMode[]).map((m) => (
          <button key={m} style={segBtnStyle(m === themeMode)} onClick={() => onModeChange(m)}>
            {m === 'dark' ? 'Dark' : 'Light'}
          </button>
        ))}
      </div>
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/operator/AppearanceSettings.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/AppearanceSettings.tsx src/renderer/operator/AppearanceSettings.test.tsx
git commit -m "feat(settings): AppearanceSettings section (family cards + mode control)"
```

---

### Task 3: SettingsModal — Appearance section first, placeholders removed

Add Appearance to the nav (first, default on open), remove the disabled Songs/Backup entries and the whole `enabled` mechanism, and thread the four theme props from App.

**Files:**
- Modify: `src/renderer/operator/SettingsModal.tsx` (SECTIONS `:35-43`, props `:23-33`, nav item style `:214-226`, nav render + content `:441-507`)
- Modify: `src/renderer/operator/App.tsx:54,162-170`

**Interfaces:**
- Consumes: `AppearanceSettings` from Task 2 (props `family`, `onFamilyChange`, `themeMode`, `onModeChange`); `setMode` from Task 1 via `useAppearance()`; `ThemesIcon` from `../shared/icons` (already exists — Header currently imports it).
- Produces: `SettingsModalProps` extended with `family: ThemeFamily; setFamily: (f: ThemeFamily) => void; themeMode: ThemeMode; setThemeMode: (m: ThemeMode) => void` — Task 4 relies on App already passing these.

- [ ] **Step 1: Update SECTIONS and default section**

In `src/renderer/operator/SettingsModal.tsx`, replace the `SECTIONS` constant:

```tsx
const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'bibles', label: 'Bibles' },
  { id: 'displays', label: 'Displays' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'message', label: 'Message' }
] as const
```

and change the initial section state:

```tsx
  const [section, setSection] = useState<SettingsSection>('appearance')
```

- [ ] **Step 2: Remove the `enabled` machinery from nav styling and render**

Change `navItemStyle` to take only `active`:

```tsx
  const navItemStyle = (active: boolean): CSSProperties => ({
    height: '34px',
    padding: '0 12px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: active ? 700 : 600,
    color: active ? T.text : T.dim,
    background: active ? T.panel3 : 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center'
  })
```

and replace the nav button render block with:

```tsx
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  style={{ ...navItemStyle(section === s.id), gap: '8px' }}
                  onClick={() => setSection(s.id)}
                >
                  {s.id === 'appearance' && <ThemesIcon size={15} />}
                  {s.id === 'displays' && <DisplayIcon size={15} />}
                  {s.label}
                </button>
              ))}
```

Add `ThemesIcon` to the existing icons import: `import { DisplayIcon, ImportIcon, ThemesIcon } from '../shared/icons'`.

- [ ] **Step 3: Add the theme props and render the section**

Extend the props interface and destructuring:

```tsx
import type { ThemeFamily, ThemeMode } from '../../shared/theme'

export interface SettingsModalProps {
  // ...existing props unchanged...
  family: ThemeFamily
  setFamily: (f: ThemeFamily) => void
  themeMode: ThemeMode
  setThemeMode: (m: ThemeMode) => void
}
```

(destructure `family, setFamily, themeMode, setThemeMode` in the function signature alongside the existing props), import the component:

```tsx
import { AppearanceSettings } from './AppearanceSettings'
```

and add to the content pane (first, above the `displays` line):

```tsx
              {section === 'appearance' && (
                <AppearanceSettings
                  family={family}
                  onFamilyChange={setFamily}
                  themeMode={themeMode}
                  onModeChange={setThemeMode}
                />
              )}
```

- [ ] **Step 4: Wire the props from App**

In `src/renderer/operator/App.tsx`, add `setMode` to the hook destructuring (line 54):

```tsx
  const { mode: themeMode, theme, toggleMode: toggleTheme, family, setFamily, setMode: setThemeMode } = useAppearance();
```

and extend the `<SettingsModal>` element (lines 162-170):

```tsx
          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onBiblesChanged={() => setBiblesRevision((r) => r + 1)}
            hotkeyOverrides={hotkeyOverrides}
            onHotkeyOverridesChange={saveHotkeyOverrides}
            family={family}
            setFamily={setFamily}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
          />
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; full suite PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/SettingsModal.tsx src/renderer/operator/App.tsx
git commit -m "feat(settings): Appearance section first in nav; drop disabled placeholders"
```

---

### Task 4: Slim the header — remove the themes popover

Remove the themes icon button and popover from Header, drop its `family`/`setFamily` props, delete `ThemePopover`, and run the full verification suite.

**Files:**
- Modify: `src/renderer/operator/Header.tsx:10-21,29-45,191-203`
- Modify: `src/renderer/operator/App.tsx:140`
- Delete: `src/renderer/operator/ThemePopover.tsx`, `src/renderer/operator/ThemePopover.test.tsx`

**Interfaces:**
- Consumes: SettingsModal already receives the theme props (Task 3), so Appearance stays reachable after the popover is gone.
- Produces: `HeaderProps` without `family`/`setFamily` — final shape: `{ mode, setMode, themeMode, toggleTheme, onOpenSettings }`.

- [ ] **Step 1: Remove the popover from Header**

In `src/renderer/operator/Header.tsx`:
- Delete the `ThemePopover` import (line 6) and remove `ThemesIcon` from the icons import (line 10) and the now-unused `import type { ThemeFamily }` (line 11).
- Remove `family: ThemeFamily` and `setFamily: (f: ThemeFamily) => void` from `HeaderProps`, and `family, setFamily` from the destructuring.
- Delete the `themesOpen` state and `themesContainerRef` ref (lines 44-45).
- Delete the themes button block (lines 191-203) — the `<div ref={themesContainerRef} ...>` wrapper and everything inside it. The sun/moon button and settings gear stay.

- [ ] **Step 2: Update App's Header element**

In `src/renderer/operator/App.tsx` line 140, remove the two props:

```tsx
        <Header mode={mode} setMode={setMode} themeMode={themeMode} toggleTheme={toggleTheme} onOpenSettings={() => setSettingsOpen(true)} />
```

- [ ] **Step 3: Delete ThemePopover**

```bash
git rm src/renderer/operator/ThemePopover.tsx src/renderer/operator/ThemePopover.test.tsx
```

- [ ] **Step 4: Full verification**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS/clean — no dangling references to `ThemePopover` or the removed props (typecheck would catch them).

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer/operator
git commit -m "feat(operator): theme controls move to Settings; drop header themes popover"
```
