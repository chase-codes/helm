# Operator Hotkeys & ChapterRail Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rebindable hotkey system (song section jumps, reading jumps, page switching, scripture lookup, field focus/clear) with a Shortcuts settings pane, plus the ChapterRail scroll-to-top fix for scheduled-scripture clicks.

**Architecture:** A pure keymap registry in `src/shared/hotkeys/` (action definitions + event→binding matching) consumed by the existing `keyDispatch.ts` document-keydown dispatcher. Modes receive non-core actions through one new optional `ModeKeyHandler.onAction` method; App handles page-level actions itself. Settings overrides persist under one settings-store key (`hotkeys`) held in App state so edits apply live.

**Tech Stack:** Electron + React 18 + TypeScript, vitest (+ jsdom / @testing-library/react for component tests).

**Spec:** `docs/superpowers/specs/2026-08-06-hotkeys-and-rail-scroll-design.md`

## Global Constraints

- Commit messages: concise conventional-commit subject, NO `Co-Authored-By`/`Claude-Session` trailers (CLAUDE.md house rule).
- `Mod` = Cmd on macOS, Ctrl elsewhere. Binding strings are stored platform-neutral (`'Mod+L'`).
- Single-key bindings (no Mod/Alt) NEVER fire while an `input`/`textarea` is focused; Mod/Alt bindings DO fire while typing.
- Escape is fixed: handled before action resolution, never rebindable.
- Existing dispatch behavior must not regress: arrows fire even while Settings is open; Enter/Space and Delete are suppressed while Settings or a mode modal is open; typing guard unchanged.
- Test commands: `npx vitest run <file>` for one file, `npm test` for all, `npm run typecheck`, `npm run lint`.
- Existing tests must keep passing at every task boundary.

---

### Task 1: Hotkey registry + binding matcher (`src/shared/hotkeys/`)

**Files:**
- Create: `src/shared/hotkeys/actions.ts`
- Create: `src/shared/hotkeys/match.ts`
- Test: `src/shared/hotkeys/match.test.ts`

**Interfaces:**
- Consumes: nothing (pure, leaf module).
- Produces (later tasks import these exact names):
  - `actions.ts`: `type HotkeyScope = 'global' | 'songs' | 'scripture'`; `type AppActionId = 'page.pre' | 'page.songs' | 'page.sermon' | 'scripture.lookup'`; `interface HotkeyAction { id: string; label: string; scope: HotkeyScope; defaults: string[]; fixed?: boolean; digitBlock?: boolean }`; `type HotkeyOverrides = Record<string, string[]>`; `const HOTKEY_ACTIONS: HotkeyAction[]`
  - `match.ts`: `const IS_MAC: boolean`; `interface ResolvedHotkey { id: string; digit?: number }`; `eventToBinding(e: KeyboardEvent, isMac?: boolean): string | null`; `resolveHotkey(e: KeyboardEvent, opts: { scope: 'songs' | 'scripture' | null; typing: boolean; overrides: HotkeyOverrides; isMac?: boolean }): ResolvedHotkey | null`; `bindingConflict(binding: string, actionId: string, overrides: HotkeyOverrides): HotkeyAction | null`; `formatBinding(binding: string, isMac?: boolean): string`

- [ ] **Step 1: Write the failing tests**

`src/shared/hotkeys/match.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bindingConflict, eventToBinding, formatBinding, resolveHotkey } from './match'

// Minimal KeyboardEvent stand-in — match.ts only reads key/metaKey/ctrlKey/altKey/shiftKey.
function ev(key: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}): KeyboardEvent {
  return {
    key,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift
  } as unknown as KeyboardEvent
}

describe('eventToBinding', () => {
  it('normalizes single letters to uppercase', () => {
    expect(eventToBinding(ev('c'), false)).toBe('C')
  })
  it('maps the platform-primary modifier to Mod (meta on mac, ctrl elsewhere)', () => {
    expect(eventToBinding(ev('l', { meta: true }), true)).toBe('Mod+L')
    expect(eventToBinding(ev('l', { ctrl: true }), false)).toBe('Mod+L')
  })
  it('meta on windows/linux is NOT Mod', () => {
    expect(eventToBinding(ev('l', { meta: true }), false)).toBe('L')
  })
  it('normalizes space and keeps named keys as-is', () => {
    expect(eventToBinding(ev(' '), false)).toBe('Space')
    expect(eventToBinding(ev('Home'), false)).toBe('Home')
    expect(eventToBinding(ev('Backspace', { ctrl: true }), false)).toBe('Mod+Backspace')
  })
  it('returns null on bare modifier presses', () => {
    expect(eventToBinding(ev('Shift'), false)).toBeNull()
    expect(eventToBinding(ev('Meta'), false)).toBeNull()
  })
  it('includes Shift only for non-printable keys (printables already carry it in e.key)', () => {
    expect(eventToBinding(ev('C', { shift: true }), false)).toBe('C')
    expect(eventToBinding(ev('Enter', { shift: true }), false)).toBe('Shift+Enter')
  })
})

describe('resolveHotkey', () => {
  const opts = (over: Partial<Parameters<typeof resolveHotkey>[1]> = {}): Parameters<typeof resolveHotkey>[1] => ({
    scope: null,
    typing: false,
    overrides: {},
    isMac: false,
    ...over
  })

  it('resolves defaults: Mod+2 → page.songs, Mod+L → scripture.lookup', () => {
    expect(resolveHotkey(ev('2', { ctrl: true }), opts())).toEqual({ id: 'page.songs' })
    expect(resolveHotkey(ev('l', { ctrl: true }), opts())).toEqual({ id: 'scripture.lookup' })
  })
  it('songs scope: C → song.chorus, Home → song.chorus, B → song.bridge', () => {
    expect(resolveHotkey(ev('c'), opts({ scope: 'songs' }))).toEqual({ id: 'song.chorus' })
    expect(resolveHotkey(ev('Home'), opts({ scope: 'songs' }))).toEqual({ id: 'song.chorus' })
    expect(resolveHotkey(ev('b'), opts({ scope: 'songs' }))).toEqual({ id: 'song.bridge' })
  })
  it('digit blocks report which digit: 3 → song.verse/3 in songs, scripture.reading/3 in scripture', () => {
    expect(resolveHotkey(ev('3'), opts({ scope: 'songs' }))).toEqual({ id: 'song.verse', digit: 3 })
    expect(resolveHotkey(ev('3'), opts({ scope: 'scripture' }))).toEqual({ id: 'scripture.reading', digit: 3 })
  })
  it('unscoped digit resolves nothing', () => {
    expect(resolveHotkey(ev('3'), opts())).toBeNull()
  })
  it('typing suppresses unmodified bindings but not Mod bindings', () => {
    expect(resolveHotkey(ev('c'), opts({ scope: 'songs', typing: true }))).toBeNull()
    expect(resolveHotkey(ev('/'), opts({ typing: true }))).toBeNull()
    expect(resolveHotkey(ev('Backspace', { ctrl: true }), opts({ typing: true }))).toEqual({ id: 'field.clear' })
  })
  it('overrides replace defaults', () => {
    const overrides = { 'song.bridge': ['X'] }
    expect(resolveHotkey(ev('b'), opts({ scope: 'songs', overrides }))).toBeNull()
    expect(resolveHotkey(ev('x'), opts({ scope: 'songs', overrides }))).toEqual({ id: 'song.bridge' })
  })
  it('mode scope beats global on a collision', () => {
    // Override bridge onto '/' which is global focus.search by default.
    const overrides = { 'song.bridge': ['/'] }
    expect(resolveHotkey(ev('/'), opts({ scope: 'songs', overrides }))).toEqual({ id: 'song.bridge' })
    expect(resolveHotkey(ev('/'), opts({ scope: 'scripture', overrides }))).toEqual({ id: 'focus.search' })
  })
})

describe('bindingConflict', () => {
  it('flags a clash inside the same scope', () => {
    expect(bindingConflict('C', 'song.tag', {})?.id).toBe('song.chorus')
  })
  it('flags a global↔mode clash both directions', () => {
    expect(bindingConflict('Home', 'go.live', {})?.id).toBe('song.chorus')
    expect(bindingConflict('Enter', 'song.tag', {})?.id).toBe('go.live')
  })
  it('digit-block keys are protected', () => {
    expect(bindingConflict('4', 'song.chorus', {})?.id).toBe('song.verse')
  })
  it('songs↔scripture do not clash (different pages)', () => {
    // scripture.reading holds '1'–'9', but so does song.verse — checking a songs-scope
    // binding against scripture scope must not match scripture.reading first.
    expect(bindingConflict('T', 'song.bridge', {})).toBeNull()
  })
  it('respects overrides when detecting clashes', () => {
    expect(bindingConflict('X', 'song.tag', { 'song.bridge': ['X'] })?.id).toBe('song.bridge')
    expect(bindingConflict('B', 'song.tag', { 'song.bridge': ['X'] })).toBeNull()
  })
})

describe('formatBinding', () => {
  it('renders Mod per platform', () => {
    expect(formatBinding('Mod+L', true)).toBe('⌘L')
    expect(formatBinding('Mod+L', false)).toBe('Ctrl+L')
  })
  it('renders arrows compactly', () => {
    expect(formatBinding('ArrowRight', false)).toBe('→')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/hotkeys/match.test.ts`
Expected: FAIL — cannot resolve `./match`.

- [ ] **Step 3: Implement the registry**

`src/shared/hotkeys/actions.ts`:

```ts
export type HotkeyScope = 'global' | 'songs' | 'scripture'

/** Actions App handles itself (mode switching / lookup) rather than delegating to a mode. */
export type AppActionId = 'page.pre' | 'page.songs' | 'page.sermon' | 'scripture.lookup'

export interface HotkeyAction {
  id: string
  label: string
  scope: HotkeyScope
  /** Binding strings, e.g. 'Mod+L', 'Home', 'C', '/'. Some actions ship synonyms. */
  defaults: string[]
  /** Listed in the Shortcuts pane but not rebindable (Escape, digit blocks). */
  fixed?: boolean
  /** defaults are the nine digits '1'–'9'; resolveHotkey reports which digit matched. */
  digitBlock?: boolean
}

/** User rebinds, persisted under the settings-store key 'hotkeys'. Absent id = defaults. */
export type HotkeyOverrides = Record<string, string[]>

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

/** The single source of truth: the dispatcher resolves against this and the Shortcuts
 * pane renders from it, so behavior and the settings UI cannot drift apart. */
export const HOTKEY_ACTIONS: HotkeyAction[] = [
  { id: 'page.pre', label: 'Go to Pre-service', scope: 'global', defaults: ['Mod+1'] },
  { id: 'page.songs', label: 'Go to Songs', scope: 'global', defaults: ['Mod+2'] },
  { id: 'page.sermon', label: 'Go to Sermon', scope: 'global', defaults: ['Mod+3'] },
  { id: 'scripture.lookup', label: 'Scripture lookup', scope: 'global', defaults: ['Mod+L'] },
  { id: 'focus.search', label: 'Focus search / entry', scope: 'global', defaults: ['/'] },
  { id: 'field.clear', label: 'Clear field', scope: 'global', defaults: ['Mod+Backspace', 'Mod+Delete'] },
  { id: 'go.live', label: 'Go live / take down', scope: 'global', defaults: ['Enter', 'Space'] },
  { id: 'nav.next', label: 'Next', scope: 'global', defaults: ['ArrowRight', 'ArrowDown'] },
  { id: 'nav.prev', label: 'Previous', scope: 'global', defaults: ['ArrowLeft', 'ArrowUp'] },
  { id: 'item.delete', label: 'Delete selected', scope: 'global', defaults: ['Delete', 'Backspace'] },
  { id: 'app.escape', label: 'Close / clear', scope: 'global', defaults: ['Escape'], fixed: true },
  { id: 'song.chorus', label: 'Jump to chorus', scope: 'songs', defaults: ['Home', 'C'] },
  { id: 'song.bridge', label: 'Jump to bridge', scope: 'songs', defaults: ['B'] },
  { id: 'song.tag', label: 'Jump to tag / ending', scope: 'songs', defaults: ['T'] },
  { id: 'song.verse', label: 'Jump to Verse 1–9', scope: 'songs', defaults: DIGITS, fixed: true, digitBlock: true },
  { id: 'scripture.reading', label: 'Jump to reading 1–9', scope: 'scripture', defaults: DIGITS, fixed: true, digitBlock: true }
]
```

`src/shared/hotkeys/match.ts`:

```ts
import { HOTKEY_ACTIONS, type HotkeyAction, type HotkeyOverrides } from './actions'

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform)

export interface ResolvedHotkey {
  id: string
  /** Set for digitBlock actions: which digit key (1–9) matched. */
  digit?: number
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

/** Normalize a keydown to a stored binding string, or null for a bare modifier press.
 * 'Mod' is the platform-primary modifier (Cmd on mac, Ctrl elsewhere). Shift is only
 * recorded for non-printable keys — printable keys already carry shift in e.key
 * ('?' not 'Shift+/'), and letter case is normalized away. */
export function eventToBinding(e: KeyboardEvent, isMac: boolean = IS_MAC): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const parts: string[] = []
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey && e.key.length > 1) parts.push('Shift')
  parts.push(e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return parts.join('+')
}

const hasRealModifier = (binding: string): boolean => {
  const parts = binding.split('+')
  return parts.includes('Mod') || parts.includes('Alt')
}

const bindingsOf = (a: HotkeyAction, overrides: HotkeyOverrides): string[] =>
  a.fixed ? a.defaults : (overrides[a.id] ?? a.defaults)

/** Keydown → action id. Mode scope is checked before global so a rebind can shadow a
 * global key on one page without touching the other. While typing in a field, only
 * Mod/Alt bindings resolve (the typing guard). */
export function resolveHotkey(
  e: KeyboardEvent,
  opts: { scope: 'songs' | 'scripture' | null; typing: boolean; overrides: HotkeyOverrides; isMac?: boolean }
): ResolvedHotkey | null {
  const binding = eventToBinding(e, opts.isMac ?? IS_MAC)
  if (!binding) return null
  if (opts.typing && !hasRealModifier(binding)) return null
  const scoped = HOTKEY_ACTIONS.filter((a) => a.scope === opts.scope)
  const global = HOTKEY_ACTIONS.filter((a) => a.scope === 'global')
  for (const a of [...scoped, ...global]) {
    if (!bindingsOf(a, opts.overrides).includes(binding)) continue
    return a.digitBlock ? { id: a.id, digit: Number(binding) } : { id: a.id }
  }
  return null
}

/** Would assigning `binding` to `actionId` collide with another action the same keydown
 * could reach? Collisions exist within one scope and across global↔mode; the two mode
 * scopes never meet (different pages). Returns the holder, or null when free. */
export function bindingConflict(
  binding: string,
  actionId: string,
  overrides: HotkeyOverrides
): HotkeyAction | null {
  const action = HOTKEY_ACTIONS.find((a) => a.id === actionId)
  if (!action) return null
  for (const other of HOTKEY_ACTIONS) {
    if (other.id === actionId) continue
    const collide = other.scope === action.scope || other.scope === 'global' || action.scope === 'global'
    if (!collide) continue
    if (bindingsOf(other, overrides).includes(binding)) return other
  }
  return null
}

const KEY_GLYPHS: Record<string, string> = {
  ArrowRight: '→',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowDown: '↓'
}

/** Human chip text for a binding: 'Mod+L' → '⌘L' (mac) / 'Ctrl+L' (win). */
export function formatBinding(binding: string, isMac: boolean = IS_MAC): string {
  const parts = binding.split('+').map((p) => (p === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : (KEY_GLYPHS[p] ?? p)))
  return parts.join(isMac ? '' : '+')
}
```

Note on `formatBinding`: mac style joins without separators (`⌘L`), other platforms join with `+` (`Ctrl+L`). The mac join must not insert `+` — the test pins `'⌘L'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/hotkeys/match.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/shared/hotkeys
git commit -m "feat(hotkeys): keymap registry and binding matcher"
```

---

### Task 2: Song section-jump helpers (`src/shared/songs/sectionJump.ts`)

**Files:**
- Create: `src/shared/songs/sectionJump.ts`
- Test: `src/shared/songs/sectionJump.test.ts`

**Interfaces:**
- Consumes: `SongSection` from `src/shared/types.ts` (`{ label: string; lines: string[] }`).
- Produces: `chorusJump(sections: SongSection[], current: number): number | null`; `labelJump(sections: SongSection[], kind: 'bridge' | 'tag'): number | null`; `verseJump(sections: SongSection[], n: number): number | null`

- [ ] **Step 1: Write the failing tests**

`src/shared/songs/sectionJump.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chorusJump, labelJump, verseJump } from './sectionJump'
import type { SongSection } from '../types'

const sec = (label: string): SongSection => ({ label, lines: ['x'] })

const SONG = [sec('Verse 1'), sec('Chorus'), sec('Verse 2'), sec('Chorus 2'), sec('Bridge'), sec('Tag')]

describe('chorusJump', () => {
  it('goes to the first chorus from a non-chorus section', () => {
    expect(chorusJump(SONG, 0)).toBe(1)
  })
  it('cycles to the next chorus when already on one, wrapping', () => {
    expect(chorusJump(SONG, 1)).toBe(3)
    expect(chorusJump(SONG, 3)).toBe(1)
  })
  it('returns null when the song has no chorus', () => {
    expect(chorusJump([sec('Verse 1'), sec('Verse 2')], 0)).toBeNull()
  })
})

describe('labelJump', () => {
  it('finds bridge and tag by label', () => {
    expect(labelJump(SONG, 'bridge')).toBe(4)
    expect(labelJump(SONG, 'tag')).toBe(5)
  })
  it('tag also matches Ending', () => {
    expect(labelJump([sec('Verse 1'), sec('Ending')], 'tag')).toBe(1)
  })
  it('returns null when absent', () => {
    expect(labelJump([sec('Verse 1')], 'bridge')).toBeNull()
  })
})

describe('verseJump', () => {
  it('matches by verse LABEL, not card position', () => {
    // 'Verse 2' sits at index 2, not index 1.
    expect(verseJump(SONG, 2)).toBe(2)
  })
  it('returns null for a verse number the song does not have', () => {
    expect(verseJump(SONG, 7)).toBeNull()
  })
  it('does not confuse Verse 1 with Verse 11', () => {
    expect(verseJump([sec('Verse 11'), sec('Verse 1')], 1)).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/songs/sectionJump.test.ts`
Expected: FAIL — cannot resolve `./sectionJump`.

- [ ] **Step 3: Implement**

`src/shared/songs/sectionJump.ts`:

```ts
import type { SongSection } from '../types'

const CHORUS = /chorus/i
const KIND_RE = { bridge: /bridge/i, tag: /tag|ending/i } as const

/** First chorus from anywhere else; from a chorus, the NEXT chorus (wrapping) so a
 * repeat press cycles Chorus 1 → Chorus 2 → … → Chorus 1. Null when the song has none. */
export function chorusJump(sections: SongSection[], current: number): number | null {
  const idxs = sections.flatMap((s, i) => (CHORUS.test(s.label) ? [i] : []))
  if (!idxs.length) return null
  const pos = idxs.indexOf(current)
  return pos === -1 ? idxs[0] : idxs[(pos + 1) % idxs.length]
}

/** First section whose label names a bridge / tag (tag also matches 'Ending'). */
export function labelJump(sections: SongSection[], kind: 'bridge' | 'tag'): number | null {
  const i = sections.findIndex((s) => KIND_RE[kind].test(s.label))
  return i === -1 ? null : i
}

/** Section labeled 'Verse N' — label match with a word boundary so Verse 1 ≠ Verse 11. */
export function verseJump(sections: SongSection[], n: number): number | null {
  const re = new RegExp(`^verse\\s*${n}\\b`, 'i')
  const i = sections.findIndex((s) => re.test(s.label))
  return i === -1 ? null : i
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/songs/sectionJump.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/songs/sectionJump.ts src/shared/songs/sectionJump.test.ts
git commit -m "feat(songs): chorus/bridge/tag/verse section-jump helpers"
```

---

### Task 3: Dispatcher rework + App wiring + scripture lookup

**Files:**
- Modify: `src/renderer/operator/keyDispatch.ts`
- Modify: `src/renderer/operator/keyDispatch.test.ts`
- Modify: `src/renderer/operator/App.tsx`
- Modify: `src/renderer/operator/SermonMode.tsx` (accept `lookupNonce`, focus entry)
- Modify: `src/renderer/operator/SchedulePanel.tsx` (thread `entryRef`)

**Interfaces:**
- Consumes: `resolveHotkey`, `ResolvedHotkey` from `src/shared/hotkeys/match`; `HotkeyOverrides`, `AppActionId` from `src/shared/hotkeys/actions`.
- Produces:
  - `ModeKeyHandler` (App.tsx) gains `onAction?: (a: ResolvedHotkey) => void` — Tasks 4–5 implement it in the modes.
  - `KeyDispatchCtx` (keyDispatch.ts) becomes `{ settingsOpen; closeSettings; handler; scope: 'songs' | 'scripture' | null; overrides: HotkeyOverrides; onAppAction: (id: AppActionId) => void; isMac?: boolean }`.
  - `SermonModeProps` gains `lookupNonce: number`; `SchedulePanelProps` gains `entryRef?: RefObject<HTMLInputElement>`.

- [ ] **Step 1: Update the dispatcher tests (failing first)**

In `src/renderer/operator/keyDispatch.test.ts`, replace the `ev` and `baseCtx` helpers and add the new cases (existing cases stay, updated to the new ctx shape via `baseCtx()` spreading):

```ts
import { describe, expect, it, vi } from 'vitest'
import { dispatchModeKey, type KeyDispatchCtx } from './keyDispatch'
import type { ModeKeyHandler } from './App'

function makeHandler(over: Partial<ModeKeyHandler> = {}): ModeKeyHandler {
  return {
    onEscape: vi.fn(() => false),
    onArrow: vi.fn(),
    onGoLive: vi.fn(),
    isModalOpen: vi.fn(() => false),
    ...over
  }
}

function ev(key: string, opts: Partial<{ tag: string; ctrl: boolean; meta: boolean }> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: !!opts.ctrl,
    metaKey: !!opts.meta,
    altKey: false,
    shiftKey: false,
    target: { tagName: (opts.tag ?? 'body').toUpperCase() },
    preventDefault: vi.fn()
  } as unknown as KeyboardEvent
}

// isMac:false in tests → ctrlKey is Mod.
const baseCtx = (over: Partial<KeyDispatchCtx> = {}): Omit<KeyDispatchCtx, 'handler'> => ({
  settingsOpen: false,
  closeSettings: vi.fn(),
  scope: null,
  overrides: {},
  onAppAction: vi.fn(),
  isMac: false,
  ...over
})
```

Every existing test's `{ ...baseCtx(), handler }` call keeps working with the new helper. `ev('Delete', 'input')`-style calls become `ev('Delete', { tag: 'input' })`. Add these new cases:

```ts
describe('dispatchModeKey — hotkey actions', () => {
  it('Mod+2 fires the page.songs app action', () => {
    const ctx = baseCtx()
    dispatchModeKey(ev('2', { ctrl: true }), { ...ctx, handler: makeHandler() })
    expect(ctx.onAppAction).toHaveBeenCalledWith('page.songs')
  })

  it('Mod+L fires scripture.lookup even while typing', () => {
    const ctx = baseCtx()
    dispatchModeKey(ev('l', { ctrl: true, tag: 'input' }), { ...ctx, handler: makeHandler() })
    expect(ctx.onAppAction).toHaveBeenCalledWith('scripture.lookup')
  })

  it('app actions are suppressed while settings is open', () => {
    const ctx = baseCtx({ settingsOpen: true })
    dispatchModeKey(ev('2', { ctrl: true }), { ...ctx, handler: makeHandler() })
    expect(ctx.onAppAction).not.toHaveBeenCalled()
  })

  it('C in songs scope reaches onAction as song.chorus', () => {
    const onAction = vi.fn()
    dispatchModeKey(ev('c'), { ...baseCtx({ scope: 'songs' }), handler: makeHandler({ onAction }) })
    expect(onAction).toHaveBeenCalledWith({ id: 'song.chorus' })
  })

  it('digit 3 routes per scope (song.verse vs scripture.reading)', () => {
    const onAction = vi.fn()
    dispatchModeKey(ev('3'), { ...baseCtx({ scope: 'songs' }), handler: makeHandler({ onAction }) })
    expect(onAction).toHaveBeenCalledWith({ id: 'song.verse', digit: 3 })
    onAction.mockClear()
    dispatchModeKey(ev('3'), { ...baseCtx({ scope: 'scripture' }), handler: makeHandler({ onAction }) })
    expect(onAction).toHaveBeenCalledWith({ id: 'scripture.reading', digit: 3 })
  })

  it('slash focuses search when idle but is ignored while typing', () => {
    const onAction = vi.fn()
    dispatchModeKey(ev('/'), { ...baseCtx({ scope: 'songs' }), handler: makeHandler({ onAction }) })
    expect(onAction).toHaveBeenCalledWith({ id: 'focus.search' })
    onAction.mockClear()
    dispatchModeKey(ev('/', { tag: 'input' }), { ...baseCtx({ scope: 'songs' }), handler: makeHandler({ onAction }) })
    expect(onAction).not.toHaveBeenCalled()
  })

  it('Mod+Backspace while typing reaches onAction as field.clear (not onDelete)', () => {
    const onAction = vi.fn()
    const onDelete = vi.fn()
    dispatchModeKey(ev('Backspace', { ctrl: true, tag: 'input' }), { ...baseCtx(), handler: makeHandler({ onAction, onDelete }) })
    expect(onAction).toHaveBeenCalledWith({ id: 'field.clear' })
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('onAction is suppressed while a mode modal is open', () => {
    const onAction = vi.fn()
    dispatchModeKey(ev('c'), { ...baseCtx({ scope: 'songs' }), handler: makeHandler({ onAction, isModalOpen: () => true }) })
    expect(onAction).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npx vitest run src/renderer/operator/keyDispatch.test.ts`
Expected: FAIL — ctx shape / new cases.

- [ ] **Step 3: Rewrite `keyDispatch.ts`**

```ts
import type { ModeKeyHandler } from './App'
import type { AppActionId, HotkeyOverrides } from '../../shared/hotkeys/actions'
import { resolveHotkey } from '../../shared/hotkeys/match'

export interface KeyDispatchCtx {
  settingsOpen: boolean
  closeSettings: () => void
  handler: ModeKeyHandler | null
  /** Which mode-scope bindings are in play: Songs page → 'songs', Sermon page →
   * 'scripture' (SermonMode ignores scripture actions on its message/slides tracks),
   * Pre-service → null (global only). */
  scope: 'songs' | 'scripture' | null
  overrides: HotkeyOverrides
  onAppAction: (id: AppActionId) => void
  /** Test seam; defaults to real platform detection inside resolveHotkey. */
  isMac?: boolean
}

/**
 * Document-keydown → action dispatch. Escape stays hardcoded and first (closes any open
 * modal, even while typing; settings sits above the mode layer). Everything else resolves
 * through the hotkey registry: core actions keep their dedicated ModeKeyHandler methods
 * (arrows/goLive/delete, with their pre-existing guard semantics preserved exactly),
 * page-level actions go to App via onAppAction, and the rest reach the active mode's
 * optional onAction. The typing guard lives in resolveHotkey now: unmodified bindings
 * never fire from an input/textarea, Mod/Alt bindings do.
 */
export function dispatchModeKey(e: KeyboardEvent, ctx: KeyDispatchCtx): void {
  const target = e.target as HTMLElement | null
  const tag = target?.tagName?.toLowerCase()
  const typing = tag === 'input' || tag === 'textarea'
  const { handler } = ctx

  if (e.key === 'Escape') {
    if (ctx.settingsOpen) {
      ctx.closeSettings()
      return
    }
    handler?.onEscape()
    return
  }

  const resolved = resolveHotkey(e, { scope: ctx.scope, typing, overrides: ctx.overrides, isMac: ctx.isMac })
  if (!resolved) return

  switch (resolved.id) {
    case 'page.pre':
    case 'page.songs':
    case 'page.sermon':
    case 'scripture.lookup':
      // Behind Settings or a mode modal a silent page switch would strand the modal.
      if (ctx.settingsOpen || handler?.isModalOpen()) return
      e.preventDefault()
      ctx.onAppAction(resolved.id)
      return
    case 'nav.next':
      e.preventDefault()
      handler?.onArrow(1)
      return
    case 'nav.prev':
      e.preventDefault()
      handler?.onArrow(-1)
      return
    case 'go.live':
      e.preventDefault()
      // Guard Enter/Space→goLive behind an open modal (quick-add or settings).
      if (ctx.settingsOpen || handler?.isModalOpen()) return
      handler?.onGoLive()
      return
    case 'item.delete':
      // Only act when the active mode offers a delete AND no modal is up — a destructive
      // delete can't fire behind Settings/QuickAdd. (Backspace is the primary "delete"
      // key on Mac keyboards, so both map here by default.)
      if (!handler?.onDelete || ctx.settingsOpen || handler.isModalOpen()) return
      e.preventDefault()
      handler.onDelete()
      return
    default:
      // Mode-scoped extras (section jumps, reading jumps, focus/clear field). Same
      // modal guard as goLive/delete.
      if (ctx.settingsOpen || handler?.isModalOpen()) return
      if (!handler?.onAction) return
      e.preventDefault()
      handler.onAction(resolved)
  }
}
```

- [ ] **Step 4: Extend `ModeKeyHandler` in App.tsx and wire the new ctx**

In `App.tsx`:

```ts
import type { AppActionId, HotkeyOverrides } from '../../shared/hotkeys/actions'
import type { ResolvedHotkey } from '../../shared/hotkeys/match'
```

Add to `ModeKeyHandler` (after `onDelete`):

```ts
  /**
   * Registry-resolved hotkey actions beyond the core set (section jumps, reading
   * jumps, focus/clear field). Optional — modes ignore actions they don't own.
   * Suppressed by App while Settings or a mode modal is open, same as goLive/delete.
   */
  onAction?: (a: ResolvedHotkey) => void
```

Inside `App()` add state + handlers:

```ts
  // Hotkey rebinds, loaded once and kept in App state so Settings edits re-resolve
  // the live keymap immediately (dispatch reads this on every keydown).
  const [hotkeyOverrides, setHotkeyOverrides] = useState<HotkeyOverrides>({})
  useEffect(() => {
    void window.helm.settings
      .get<HotkeyOverrides>('hotkeys', {})
      .then(setHotkeyOverrides)
      .catch(console.error)
  }, [])
  const saveHotkeyOverrides = (next: HotkeyOverrides): void => {
    setHotkeyOverrides(next)
    window.helm.settings.set('hotkeys', next)
  }

  // Bumped by the scripture-lookup hotkey; SermonMode reacts by forcing its scripture
  // track and focusing the ref entry (same App-mediated pattern as biblesRevision).
  const [lookupNonce, setLookupNonce] = useState(0)

  const onAppAction = (id: AppActionId): void => {
    if (id === 'page.pre') setMode('pre')
    else if (id === 'page.songs') setMode('songs')
    else if (id === 'page.sermon') setMode('sermon')
    else {
      setMode('sermon')
      setLookupNonce((n) => n + 1)
    }
  }
```

Update the keydown effect (deps now include `mode` and `hotkeyOverrides`):

```ts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void =>
      dispatchModeKey(e, {
        settingsOpen,
        closeSettings: () => setSettingsOpen(false),
        handler: keyHandlerRef.current,
        scope: mode === 'songs' ? 'songs' : mode === 'sermon' ? 'scripture' : null,
        overrides: hotkeyOverrides,
        onAppAction
      })
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen, mode, hotkeyOverrides])
```

(If eslint's exhaustive-deps flags `onAppAction`, wrap it in `useCallback(..., [])` — it only touches stable setters.)

Pass the nonce to SermonMode:

```tsx
            <SermonMode
              themeMode={themeMode}
              keyHandlerRef={keyHandlerRef}
              active={mode === 'sermon'}
              onOpenSettings={() => setSettingsOpen(true)}
              biblesRevision={biblesRevision}
              lookupNonce={lookupNonce}
            />
```

- [ ] **Step 5: Thread the entry ref through SermonMode/SchedulePanel**

`SchedulePanel.tsx` — add to imports `type RefObject` from `'react'`, add prop + attach:

```ts
  /** Lets SermonMode focus the reading entry (scripture-lookup hotkey, '/'). */
  entryRef?: RefObject<HTMLInputElement | null>;
```

On the `<input>` inside the entry field: `ref={entryRef}`.

`SermonMode.tsx` — add `lookupNonce: number` to `SermonModeProps` (comment: bumped by App's scripture-lookup hotkey; effect below forces the scripture track and focuses the entry). In the component:

```ts
  const entryRef = useRef<HTMLInputElement | null>(null)

  // Scripture-lookup hotkey: land the operator ready to type a reference. setTrack
  // re-renders SchedulePanel first (it isn't mounted on the message/slides tracks), so
  // the focus call is deferred a tick to run against the committed input.
  useEffect(() => {
    if (lookupNonce === 0) return
    setTrack('scripture')
    const t = setTimeout(() => entryRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [lookupNonce])
```

Pass `entryRef={entryRef}` to `<SchedulePanel …>`.

- [ ] **Step 6: Verify**

Run: `npx vitest run src/renderer/operator/keyDispatch.test.ts` → PASS (old + new cases).
Run: `npm run typecheck` → clean.
Run: `npm test` → all suites pass (SermonMode tests must not break on the new required prop — if `SermonMode.test.tsx` mounts SermonMode, add `lookupNonce={0}` there).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/operator/keyDispatch.ts src/renderer/operator/keyDispatch.test.ts src/renderer/operator/App.tsx src/renderer/operator/SermonMode.tsx src/renderer/operator/SermonMode.test.tsx src/renderer/operator/SchedulePanel.tsx
git commit -m "feat(hotkeys): registry-driven dispatch, page switching, scripture lookup"
```

---

### Task 4: Songs page actions (chorus/bridge/tag/verse, focus, clear)

**Files:**
- Modify: `src/renderer/operator/SongsMode.tsx`
- Modify: `src/renderer/operator/SongSearchRail.tsx` (thread `inputRef`)
- Modify: `src/renderer/operator/SectionRail.tsx` (scroll cued card into view)
- Test: `src/renderer/operator/SongsMode.test.tsx` (add cases)

**Interfaces:**
- Consumes: `chorusJump`/`labelJump`/`verseJump` (Task 2), `ResolvedHotkey` (Task 1), `parseSongKey`/`keyForSong` from `src/shared/presentation/core`, `ModeKeyHandler.onAction` (Task 3).
- Produces: `SongSearchRailProps` gains `inputRef?: RefObject<HTMLInputElement | null>`.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/operator/SongsMode.test.tsx` (reuse `installHelmStub`/`renderMode`; the stub's `presentation.get` and song list need variants, so add a fixture and a parameterized stub — copy the existing `installHelmStub` shape):

```tsx
const CHORUS_SONG: Song = {
  id: 's2',
  title: 'With Chorus',
  author: 'A',
  sections: [
    { label: 'Verse 1', lines: ['v1'] },
    { label: 'Chorus', lines: ['c1'] },
    { label: 'Verse 2', lines: ['v2'] },
    { label: 'Chorus 2', lines: ['c2'] }
  ],
  source: 'manual',
  createdAt: 0
}

// Like installHelmStub but with a chorus-bearing song and a configurable live state.
function installHelmStubWith(songs: Song[], state: PresentationState): { goLive: ReturnType<typeof vi.fn> } {
  const goLive = vi.fn()
  ;(window as unknown as { helm: unknown }).helm = {
    songs: { list: () => Promise.resolve(songs), search: vi.fn(() => Promise.resolve([])) },
    presentation: {
      get: () => Promise.resolve(state),
      onState: () => () => {},
      cue: vi.fn(),
      goLive,
      setOutput: vi.fn()
    },
    songImport: {
      sources: () => Promise.resolve([]),
      scan: vi.fn(),
      commit: vi.fn(),
      onProgress: () => () => {}
    }
  }
  return { goLive }
}

describe('SongsMode hotkey jumps', () => {
  it('chorus jump moves the selection without going live when output is not live', async () => {
    installHelmStubWith([CHORUS_SONG], NOTHING_LIVE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    renderMode(keyHandlerRef)
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy())
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }))
    await waitFor(() => expect(screen.getByText('NOW SINGING · Chorus')).toBeTruthy())
  })

  it('chorus jump goes live in the same press when this song is already live', async () => {
    const live: PresentationState = { output: 'live', liveKey: 'song:s2:0', liveSnap: null }
    const { goLive } = installHelmStubWith([CHORUS_SONG], live)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    renderMode(keyHandlerRef)
    await waitFor(() => expect(keyHandlerRef.current?.onAction).toBeTruthy())
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }))
    await waitFor(() => expect(goLive).toHaveBeenCalledWith('song:s2:1', expect.objectContaining({ label: 'With Chorus · Chorus' })))
  })

  it('repeat chorus press cycles to Chorus 2; verse digit matches label', async () => {
    installHelmStubWith([CHORUS_SONG], NOTHING_LIVE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    renderMode(keyHandlerRef)
    await waitFor(() => expect(keyHandlerRef.current?.onAction).toBeTruthy())
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }))
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }))
    await waitFor(() => expect(screen.getByText('NOW SINGING · Chorus 2')).toBeTruthy())
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.verse', digit: 2 }))
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 2')).toBeTruthy())
  })

  it('field.clear empties the search query', async () => {
    installHelmStubWith([CHORUS_SONG], NOTHING_LIVE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    renderMode(keyHandlerRef)
    await waitFor(() => expect(keyHandlerRef.current?.onAction).toBeTruthy())
    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'grace' } })
    act(() => keyHandlerRef.current?.onAction?.({ id: 'field.clear' }))
    await waitFor(() => expect(input.value).toBe(''))
  })
})
```

Note: check the actual search-input placeholder in `SongSearchRail.tsx` while implementing and adjust the `getByPlaceholderText` matcher to it. The hero label is uppercased via CSS `textTransform` only — the DOM text keeps the label's original case (`NOW SINGING · Chorus`), which is what `getByText` matches.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx`
Expected: new cases FAIL (`onAction` undefined / no selection change).

- [ ] **Step 3: Implement in SongsMode**

`SongSearchRail.tsx`: add `inputRef?: RefObject<HTMLInputElement | null>` to `SongSearchRailProps` (import `type RefObject` from `'react'`), attach `ref={inputRef}` to the search `<input>`.

`SongsMode.tsx`:

```ts
import { keyForSong, parseSongKey } from '../../shared/presentation/core';
import { chorusJump, labelJump, verseJump } from '../../shared/songs/sectionJump';
import type { ResolvedHotkey } from '../../shared/hotkeys/match';
```

Inside the component:

```ts
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Section-jump hotkeys (chorus/bridge/tag/verse-N). The jump always moves the
  // selection; the projector follows ONLY when this song is already live — then the
  // target section goes live in the same keypress. On logo/black, or when a different
  // song is live, it's a quiet cue (the cue effect fires off the section change).
  const jumpSection = (idx: number | null): void => {
    if (idx === null || !activeSong) return;
    const target = activeSong.sections[idx];
    if (!target) return;
    setSection(idx);
    const liveSong = parseSongKey(liveKey);
    const key = keyForSong(activeSong.id, idx);
    // liveKey !== key: goLive on the already-live key means "take down" in main — a
    // no-op jump must not black the screen.
    if (output === 'live' && liveSong?.songId === activeSong.id && liveKey !== key) {
      window.helm.presentation.goLive(key, {
        kind: 'lyrics',
        accent: '#e0a341',
        label: `${activeSong.title} · ${target.label}`,
        lines: target.lines
      });
    }
  };

  const onAction = (a: ResolvedHotkey): void => {
    if (a.id === 'focus.search') {
      searchInputRef.current?.focus();
      return;
    }
    if (a.id === 'field.clear') {
      setQ('');
      return;
    }
    if (!activeSong) return;
    if (a.id === 'song.chorus') jumpSection(chorusJump(activeSong.sections, clampedSection));
    else if (a.id === 'song.bridge') jumpSection(labelJump(activeSong.sections, 'bridge'));
    else if (a.id === 'song.tag') jumpSection(labelJump(activeSong.sections, 'tag'));
    else if (a.id === 'song.verse' && a.digit) jumpSection(verseJump(activeSong.sections, a.digit));
  };
```

Register it in the existing keyHandler effect object: add `onAction` after `isModalOpen`. Pass `inputRef={searchInputRef}` to `<SongSearchRail …>`.

`SectionRail.tsx` — keep the cued card visible on hotkey jumps (mirrors ChapterRail's selection-scroll comment: an effect keyed on the index, not a callback ref, so manual scrolling isn't fought every render). Imports become `import { useEffect, useRef, type CSSProperties, type JSX } from 'react';`

```ts
  const cuedRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cuedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [cuedIndex]);
```

On the section row `<button>`: `ref={i === cuedIndex ? cuedRef : undefined}` (the map callback already has the index; if it's named differently, use that name).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/SongsMode.tsx src/renderer/operator/SongsMode.test.tsx src/renderer/operator/SongSearchRail.tsx src/renderer/operator/SectionRail.tsx
git commit -m "feat(songs): chorus/bridge/tag/verse hotkey jumps with live-follow"
```

---

### Task 5: Scripture page actions (reading 1–9, focus, clear) + ChapterRail scroll requests

**Files:**
- Modify: `src/renderer/operator/SermonMode.tsx`
- Modify: `src/renderer/operator/ChapterRail.tsx`
- Test: `src/renderer/operator/ChapterRail.test.tsx` (add cases)

**Interfaces:**
- Consumes: `ResolvedHotkey` (Task 1), `entryRef` (Task 3), `initialBuilder` (already imported in SermonMode).
- Produces: `ChapterRailProps` gains `scrollRequest?: { v: number; align: 'start' | 'nearest'; nonce: number } | null`.

- [ ] **Step 1: Write the failing ChapterRail tests**

Append to `src/renderer/operator/ChapterRail.test.tsx` (follow its existing render helper/props pattern — read the file first and reuse its `baseProps`-style setup; the essentials below):

```tsx
describe('ChapterRail scrollRequest', () => {
  it('scrolls the requested verse with the requested alignment', () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    render(rail({ verseCount: 10, scrollRequest: { v: 4, align: 'start', nonce: 1 } }))
    expect(spy).toHaveBeenCalledWith({ block: 'start' })
  })

  it('re-applies the same request when the chapter rows arrive (verseCount change)', () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    const { rerender } = render(rail({ verseCount: 1, scrollRequest: { v: 4, align: 'start', nonce: 1 } }))
    spy.mockClear()
    rerender(rail({ verseCount: 10, scrollRequest: { v: 4, align: 'start', nonce: 1 } }))
    expect(spy).toHaveBeenCalledWith({ block: 'start' })
  })

  it('does not scroll again on unrelated re-renders with an unchanged nonce', () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    const { rerender } = render(rail({ verseCount: 10, scrollRequest: { v: 4, align: 'nearest', nonce: 1 } }))
    spy.mockClear()
    rerender(rail({ verseCount: 10, scrollRequest: { v: 4, align: 'nearest', nonce: 1 } }))
    expect(spy).not.toHaveBeenCalled()
  })
})
```

Where `rail(overrides)` is the file's existing helper for rendering a ChapterRail with default props — extend it to accept `scrollRequest` and `verseCount` overrides. If the existing tests build props inline instead, add a small local helper in the new describe block with the same defaults those tests use.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/operator/ChapterRail.test.tsx`
Expected: new cases FAIL (unknown prop / no scroll).

- [ ] **Step 3: Implement ChapterRail's scrollRequest**

`ChapterRail.tsx` — add to props:

```ts
  /** One-shot scroll command from SermonMode. 'start' pins the verse to the top of the
   * rail (schedule click / reading hotkey / lookup jump); 'nearest' just keeps it in
   * view (arrow steps). The nonce makes each request fire exactly once; verseCount is a
   * dep too so a cross-chapter jump re-applies once the new chapter's rows exist. */
  scrollRequest?: { v: number; align: 'start' | 'nearest'; nonce: number } | null
```

In the component: attach `ref={listRef}` to the scrollable rows `<div>` (the one with `overflowY: 'auto'`), add `data-verse={v}` to each row `<button>`, and:

```ts
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!scrollRequest) return
    listRef.current
      ?.querySelector(`[data-verse="${scrollRequest.v}"]`)
      ?.scrollIntoView?.({ block: scrollRequest.align })
    // scrollRequest is consumed by identity of its nonce (one shot per request);
    // verseCount re-applies it when a cross-chapter jump's rows land a tick later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest?.nonce, verseCount])
```

- [ ] **Step 4: Wire SermonMode**

In `SermonMode.tsx`:

```ts
  // One-shot scroll commands for ChapterRail — see its scrollRequest prop doc.
  const [railScroll, setRailScroll] = useState<{ v: number; align: 'start' | 'nearest'; nonce: number } | null>(null)
  const requestRailScroll = (v: number, align: 'start' | 'nearest'): void =>
    setRailScroll((p) => ({ v, align, nonce: (p?.nonce ?? 0) + 1 }))
```

Change `stepVerse` to compute the target verse and request a keep-in-view scroll:

```ts
  const stepVerse = (dir: 1 | -1): void => {
    // Same stale-chapter guard as `goLive` and the show effect. While `liveChapter` is
    // null, `verseCount` falls back to 1, so `Math.min(verseCount, v + dir)` would
    // collapse the cursor to verse 1 — and the show effect would then put verse 1 on the
    // projector. Ignore the arrow for that tick; the operator can press again.
    if (!liveChapter) return
    const nv = Math.max(1, Math.min(verseCount, scrV + dir))
    setScrV(nv)
    requestRailScroll(nv, 'nearest')
  }
```

Reading jumps — add near `removeReading`:

```ts
  // The reading 1–9 hotkey and a schedule-row click are the same gesture: cursor to the
  // reading's start, row selected, rail pinned to that verse.
  const jumpToReading = (r: ScriptureReading): void => {
    jumpTo(r.book, r.ch, r.from)
    sel.select(r.id)
    requestRailScroll(r.from, 'start')
  }
```

In `scheduleRows`, replace the row's `onClick` body with `onClick: () => jumpToReading(r)`.

In `goLiveFromBuilder`, right after `jumpTo(p.book, p.ch, p.from)` add `requestRailScroll(p.from, 'start')`.

Extend the keyHandler registration object with:

```ts
      onAction: (a) => {
        if (track !== 'scripture') return
        if (a.id === 'scripture.reading' && a.digit) {
          const r = schedule[a.digit - 1]
          if (r) jumpToReading(r)
        } else if (a.id === 'focus.search') {
          entryRef.current?.focus()
        } else if (a.id === 'field.clear') {
          setBuilder(initialBuilder())
        }
      },
```

Pass `scrollRequest={railScroll}` to `<ChapterRail …>`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/renderer/operator/ChapterRail.test.tsx src/renderer/operator/SermonMode.test.tsx`
Expected: PASS.
Run: `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/SermonMode.tsx src/renderer/operator/ChapterRail.tsx src/renderer/operator/ChapterRail.test.tsx
git commit -m "feat(sermon): reading 1-9 hotkeys; rail scrolls clicked reading to top"
```

---

### Task 6: Shortcuts settings pane

**Files:**
- Create: `src/renderer/operator/ShortcutsSettings.tsx`
- Test: `src/renderer/operator/ShortcutsSettings.test.tsx`
- Modify: `src/renderer/operator/SettingsModal.tsx` (new section + props)
- Modify: `src/renderer/operator/App.tsx` (pass overrides + save callback)

**Interfaces:**
- Consumes: `HOTKEY_ACTIONS`, `HotkeyOverrides` (Task 1); `eventToBinding`, `bindingConflict`, `formatBinding` (Task 1); `saveHotkeyOverrides` in App (Task 3).
- Produces: `ShortcutsSettingsProps { overrides: HotkeyOverrides; onChange: (next: HotkeyOverrides) => void }`; `SettingsModalProps` gains `hotkeyOverrides: HotkeyOverrides; onHotkeyOverridesChange: (next: HotkeyOverrides) => void`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/operator/ShortcutsSettings.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShortcutsSettings } from './ShortcutsSettings'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { HotkeyOverrides } from '../../shared/hotkeys/actions'

afterEach(cleanup)

function renderPane(overrides: HotkeyOverrides = {}, onChange = vi.fn()): { onChange: ReturnType<typeof vi.fn> } {
  render(
    <ThemeCtx.Provider value={themeFor('dark')}>
      <ShortcutsSettings overrides={overrides} onChange={onChange} />
    </ThemeCtx.Provider>
  )
  return { onChange }
}

describe('ShortcutsSettings', () => {
  it('lists actions grouped with their current bindings', () => {
    renderPane()
    expect(screen.getByText('Jump to chorus')).toBeTruthy()
    expect(screen.getByText('Scripture lookup')).toBeTruthy()
    expect(screen.getByText('Home')).toBeTruthy()
  })

  it('captures a key to rebind and reports it via onChange', () => {
    const { onChange } = renderPane()
    fireEvent.click(screen.getByRole('button', { name: /rebind Jump to bridge/i }))
    expect(screen.getByText(/press a key/i)).toBeTruthy()
    fireEvent.keyDown(window, { key: 'x' })
    expect(onChange).toHaveBeenCalledWith({ 'song.bridge': ['X'] })
  })

  it('refuses a conflicting key and names the holder', () => {
    const { onChange } = renderPane()
    fireEvent.click(screen.getByRole('button', { name: /rebind Jump to bridge/i }))
    fireEvent.keyDown(window, { key: 'c' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/Jump to chorus/i, { selector: '[data-conflict]' })).toBeTruthy()
  })

  it('Escape cancels capture without changes', () => {
    const { onChange } = renderPane()
    fireEvent.click(screen.getByRole('button', { name: /rebind Jump to bridge/i }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/press a key/i)).toBeNull()
  })

  it('per-row reset restores defaults; reset all clears every override', () => {
    const { onChange } = renderPane({ 'song.bridge': ['X'], 'song.tag': ['Y'] })
    fireEvent.click(screen.getByRole('button', { name: /reset Jump to bridge/i }))
    expect(onChange).toHaveBeenCalledWith({ 'song.tag': ['Y'] })
    fireEvent.click(screen.getByRole('button', { name: /reset all/i }))
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('fixed actions offer no rebind button', () => {
    renderPane()
    expect(screen.queryByRole('button', { name: /rebind Close \/ clear/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /rebind Jump to Verse/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/operator/ShortcutsSettings.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the pane**

`src/renderer/operator/ShortcutsSettings.tsx`:

```tsx
import { useContext, useEffect, useState, type CSSProperties, type JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import { HOTKEY_ACTIONS, type HotkeyAction, type HotkeyOverrides, type HotkeyScope } from '../../shared/hotkeys/actions'
import { bindingConflict, eventToBinding, formatBinding } from '../../shared/hotkeys/match'

export interface ShortcutsSettingsProps {
  overrides: HotkeyOverrides
  onChange: (next: HotkeyOverrides) => void
}

const GROUPS: { scope: HotkeyScope; title: string }[] = [
  { scope: 'global', title: 'Everywhere' },
  { scope: 'songs', title: 'Songs page' },
  { scope: 'scripture', title: 'Scripture page' }
]

/** Settings → Shortcuts. Renders straight from HOTKEY_ACTIONS so the pane can never
 * disagree with what the dispatcher resolves. Rebinds live in `overrides` (owned by App,
 * persisted to the settings store) — this component is a pure editor over that map. */
export function ShortcutsSettings({ overrides, onChange }: ShortcutsSettingsProps): JSX.Element {
  const T = useContext(ThemeCtx)
  const [capturingId, setCapturingId] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ binding: string; holder: HotkeyAction } | null>(null)

  // Window-level capture-phase listener while a chip is armed: it must see the key
  // before App's document dispatcher does, and swallow it entirely.
  useEffect(() => {
    if (!capturingId) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturingId(null)
        setConflict(null)
        return
      }
      const binding = eventToBinding(e)
      if (!binding) return // bare modifier — keep capturing
      const holder = bindingConflict(binding, capturingId, overrides)
      if (holder) {
        setConflict({ binding, holder })
        return
      }
      onChange({ ...overrides, [capturingId]: [binding] })
      setCapturingId(null)
      setConflict(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturingId, overrides, onChange])

  const resetOne = (id: string): void => {
    const next = { ...overrides }
    delete next[id]
    onChange(next)
  }

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '9px 4px',
    borderBottom: `1px solid ${T.hairline}`
  }
  const chipStyle = (fixed: boolean, capturing: boolean): CSSProperties => ({
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '11px',
    fontWeight: 600,
    padding: '5px 9px',
    borderRadius: '7px',
    background: capturing ? `${T.accent}22` : T.panel3,
    boxShadow: `inset 0 0 0 1px ${capturing ? T.accent : T.border}`,
    color: fixed ? T.faint : T.text,
    cursor: fixed ? 'default' : 'pointer',
    whiteSpace: 'nowrap'
  })
  const groupTitleStyle: CSSProperties = {
    fontSize: '11px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: T.faint,
    fontWeight: 700,
    margin: '18px 0 4px'
  }
  const resetBtnStyle: CSSProperties = {
    height: '26px',
    padding: '0 10px',
    borderRadius: '7px',
    background: 'transparent',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '11.5px',
    fontWeight: 600,
    color: T.dim
  }

  return (
    <div>
      <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '4px' }}>Shortcuts</div>
      <div style={{ fontSize: '12.5px', color: T.dim, lineHeight: 1.4, marginBottom: '4px' }}>
        Click a key to rebind it, then press the new key. Single-letter keys never fire while
        you&rsquo;re typing in a field.
      </div>
      {GROUPS.map((g) => (
        <div key={g.scope}>
          <div style={groupTitleStyle}>{g.title}</div>
          {HOTKEY_ACTIONS.filter((a) => a.scope === g.scope).map((a) => {
            const bindings = a.fixed ? a.defaults : (overrides[a.id] ?? a.defaults)
            const overridden = !a.fixed && a.id in overrides
            const capturing = capturingId === a.id
            const chipText = a.digitBlock
              ? '1–9'
              : capturing
                ? 'Press a key…'
                : bindings.map((b) => formatBinding(b)).join(' / ')
            return (
              <div key={a.id} style={rowStyle}>
                <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: a.fixed ? T.dim : T.text }}>
                  {a.label}
                  {overridden && <span style={{ color: T.accent }}> •</span>}
                </span>
                {capturing && conflict && (
                  <span data-conflict style={{ fontSize: '11.5px', color: T.live }}>
                    {formatBinding(conflict.binding)} is used by “{conflict.holder.label}”
                  </span>
                )}
                {overridden && (
                  <button aria-label={`reset ${a.label}`} style={resetBtnStyle} onClick={() => resetOne(a.id)}>
                    Reset
                  </button>
                )}
                {a.fixed ? (
                  <span style={chipStyle(true, false)} title="Not rebindable">
                    {chipText}
                  </span>
                ) : (
                  <button
                    aria-label={`rebind ${a.label}`}
                    style={chipStyle(false, capturing)}
                    onClick={() => {
                      setConflict(null)
                      setCapturingId(capturing ? null : a.id)
                    }}
                  >
                    {chipText}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ))}
      <div style={{ marginTop: '16px' }}>
        <button aria-label="reset all shortcuts" style={resetBtnStyle} onClick={() => onChange({})}>
          Reset all to defaults
        </button>
      </div>
    </div>
  )
}
```

Note for the conflict test: the message renders inside the `data-conflict` span, so `getByText(/Jump to chorus/i, { selector: '[data-conflict]' })` distinguishes it from the chorus row's own label.

- [ ] **Step 4: Wire into SettingsModal and App**

`SettingsModal.tsx`:
- Import `ShortcutsSettings` and `type HotkeyOverrides` from the shared module.
- `SECTIONS`: insert `{ id: 'shortcuts', label: 'Shortcuts', enabled: true }` after the `displays` entry.
- `SettingsModalProps` gains:

```ts
  hotkeyOverrides: HotkeyOverrides
  onHotkeyOverridesChange: (next: HotkeyOverrides) => void
```

- In the content area, alongside the existing branches:

```tsx
              {section === 'shortcuts' && (
                <ShortcutsSettings overrides={hotkeyOverrides} onChange={onHotkeyOverridesChange} />
              )}
```

`App.tsx` — pass them:

```tsx
          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onBiblesChanged={() => setBiblesRevision((r) => r + 1)}
            hotkeyOverrides={hotkeyOverrides}
            onHotkeyOverridesChange={saveHotkeyOverrides}
          />
```

If a SettingsModal test mounts the modal, add the two new props there (`hotkeyOverrides={{}} onHotkeyOverridesChange={() => {}}`).

- [ ] **Step 5: Verify**

Run: `npx vitest run src/renderer/operator/ShortcutsSettings.test.tsx` → PASS.
Run: `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/ShortcutsSettings.tsx src/renderer/operator/ShortcutsSettings.test.tsx src/renderer/operator/SettingsModal.tsx src/renderer/operator/App.tsx
git commit -m "feat(settings): Shortcuts pane — rebind hotkeys with conflict guard"
```

---

### Task 7: Full verification + manual smoke test

**Files:** none new.

- [ ] **Step 1: Full automated pass**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all clean. Fix anything that surfaces before proceeding.

- [ ] **Step 2: Manual smoke test in the running app**

Launch with `npm run dev`. Verify (keyboard only):

1. Songs page, pick a chorus-bearing song: `Home`/`C` jumps to chorus; repeat `C` cycles; `2` jumps to Verse 2; with the song live, the jump changes the projector in one press; with output on logo, it only moves the selection.
2. `Mod+3` → Sermon page; `Mod+2` → back to Songs; `Mod+L` from Songs lands on Scripture track with the entry focused; type `John 3:16`, `Shift+Enter` → live.
3. `/` focuses song search (Songs) and ref entry (Sermon); `Mod+Backspace` clears each.
4. Scripture: press `2` → cursor jumps to reading 2 AND the rail pins that verse to the top; click a scheduled reading in another chapter → rail pins its start verse to the top after the chapter loads; arrow through verses → cued verse stays visible without the rail jumping.
5. Settings → Shortcuts: rebind bridge to `X`, confirm `X` works and `B` no longer does; try rebinding tag to `C` → conflict message; per-row Reset and Reset-all restore defaults; close and reopen the app → rebinds persist.

- [ ] **Step 3: Commit any smoke-test fixes**

```bash
git add -A src
git commit -m "fix(hotkeys): smoke-test fixes"
```

(Skip if nothing changed.)
