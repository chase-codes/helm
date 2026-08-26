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

/** Effective bindings for an action once user overrides are applied (fixed actions
 * ignore overrides). Empty when the user cleared the binding. */
export function bindingsFor(actionId: string, overrides: HotkeyOverrides): string[] {
  const a = HOTKEY_ACTIONS.find((x) => x.id === actionId)
  return a ? bindingsOf(a, overrides) : []
}

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
