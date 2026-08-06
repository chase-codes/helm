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
