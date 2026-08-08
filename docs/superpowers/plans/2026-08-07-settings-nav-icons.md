# Settings Nav Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every item in the Settings modal's left nav shows an icon (today only Appearance and Displays do).

**Architecture:** Add one new `ShortcutsIcon` to the shared brand-icon set (plus its `assets/icons/*.svg` source-of-truth twin), then make the nav data-driven: each `SECTIONS` entry carries its icon component, and the render loop draws `<s.Icon size={15} />` before the label instead of per-id inline conditionals.

**Tech Stack:** React + TypeScript (Electron renderer), vitest + @testing-library/react (jsdom).

## Global Constraints

- Icons are stroke-based, 20-unit viewBox, `currentColor`, via the shared `Icon` wrapper in `src/renderer/shared/icons.tsx`.
- Per the docblock in `icons.tsx`, every inlined icon has a matching SVG in `assets/icons/` — the source of truth. New icons must add both.
- Commit messages: concise conventional-commit subject, no Co-Authored-By/Claude-Session trailers.
- Spec: `docs/superpowers/specs/2026-08-07-settings-nav-icons-design.md`.

---

### Task 1: Icons on all five Settings nav items

**Files:**
- Create: `assets/icons/shortcuts.svg`
- Modify: `src/renderer/shared/icons.tsx` (add `ShortcutsIcon`, keep alphabetical-ish placement near `SettingsIcon`)
- Modify: `src/renderer/operator/SettingsModal.tsx:41-47` (SECTIONS array), `:15` (imports), `:450-460` (nav render loop)
- Test: `src/renderer/operator/SettingsModal.test.tsx` (new)

**Interfaces:**
- Consumes: existing `ThemesIcon`, `SermonIcon`, `DisplayIcon`, `MessageIcon` and the private `Icon` wrapper from `src/renderer/shared/icons.tsx`; `themeFor` from `src/shared/theme`; `SettingsModalProps` as defined in `SettingsModal.tsx:25-39`.
- Produces: `export function ShortcutsIcon(p: IconProps): JSX.Element` in `src/renderer/shared/icons.tsx`. No other public surface changes.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/operator/SettingsModal.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from './SettingsModal'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

// SettingsModal talks to window.helm on mount (bibles manifest + message list,
// plus both progress subscriptions) — stub just that surface.
beforeEach(() => {
  ;(window as unknown as { helm: unknown }).helm = {
    bibles: {
      manifest: vi.fn().mockResolvedValue([]),
      onProgress: vi.fn().mockReturnValue(() => {}),
      install: vi.fn(),
      uninstall: vi.fn()
    },
    message: {
      list: vi.fn().mockResolvedValue([]),
      onInstallProgress: vi.fn().mockReturnValue(() => {}),
      installCorpus: vi.fn()
    }
  }
})

function renderModal(): void {
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <SettingsModal
        open
        onClose={() => {}}
        onBiblesChanged={() => {}}
        hotkeyOverrides={{}}
        onHotkeyOverridesChange={() => {}}
        family="classic"
        setFamily={() => {}}
        themeMode="dark"
        setThemeMode={() => {}}
      />
    </ThemeCtx.Provider>
  )
}

describe('SettingsModal nav', () => {
  it('renders an icon in every nav item', () => {
    renderModal()
    for (const label of ['Appearance', 'Bibles', 'Displays', 'Shortcuts', 'Message']) {
      const btn = screen.getByRole('button', { name: label })
      expect(btn.querySelector('svg'), `${label} nav item should contain an icon`).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/operator/SettingsModal.test.tsx`
Expected: FAIL — "Bibles nav item should contain an icon" (Appearance and Displays pass; Bibles, Shortcuts, Message have no `<svg>`).

- [ ] **Step 3: Add ShortcutsIcon (component + SVG source of truth)**

In `src/renderer/shared/icons.tsx`, after `SettingsIcon` (line ~130), add:

```tsx
export function ShortcutsIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="2.5" y="5" width="15" height="10" rx="2" />
      <path d="M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M6.5 12h7" />
    </Icon>
  )
}
```

Create `assets/icons/shortcuts.svg` (same markup, standalone — mirrors `display.svg`'s format):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="15" height="10" rx="2"></rect><path d="M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M6.5 12h7"></path></svg>
```

- [ ] **Step 4: Make the nav icons data-driven**

In `src/renderer/operator/SettingsModal.tsx`:

Change the icons import (line 15) to:

```tsx
import {
  DisplayIcon,
  ImportIcon,
  MessageIcon,
  SermonIcon,
  ShortcutsIcon,
  ThemesIcon
} from '../shared/icons'
```

Replace the `SECTIONS` array (lines 41–47) with:

```tsx
const SECTIONS = [
  { id: 'appearance', label: 'Appearance', Icon: ThemesIcon },
  { id: 'bibles', label: 'Bibles', Icon: SermonIcon },
  { id: 'displays', label: 'Displays', Icon: DisplayIcon },
  { id: 'shortcuts', label: 'Shortcuts', Icon: ShortcutsIcon },
  { id: 'message', label: 'Message', Icon: MessageIcon }
] as const
```

(`type SettingsSection = (typeof SECTIONS)[number]['id']` on the next line stays as is.)

Replace the nav render loop (the `{SECTIONS.map(...)}` block, lines ~450–460) with:

```tsx
{SECTIONS.map((s) => (
  <button
    key={s.id}
    style={{ ...navItemStyle(section === s.id), gap: '8px' }}
    onClick={() => setSection(s.id)}
  >
    <s.Icon size={15} />
    {s.label}
  </button>
))}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/renderer/operator/SettingsModal.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green, no new failures.

- [ ] **Step 7: Commit**

```bash
git add assets/icons/shortcuts.svg src/renderer/shared/icons.tsx src/renderer/operator/SettingsModal.tsx src/renderer/operator/SettingsModal.test.tsx
git commit -m "feat(settings): icons on all Settings nav items"
```
