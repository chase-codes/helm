import type { OutputMode } from '../../shared/types'
import type { ListSelection } from './useListSelection'

/** One rung: does its one thing and returns true when it consumed the press, or false to
 * let the next rung try. */
export type EscapeRung = () => boolean

/**
 * The Escape ladder every operator page follows (docs/ux-grammar.md rule 9). Each press
 * backs out exactly one layer, in this fixed order:
 *   1. closeOverlay    a modal or popover the page owns
 *   2. cancelEdit      an edit in progress (section quick-edit, a half-built reference)
 *   3. clearSelection  picked-out rows, or a queued item
 *   4. leaveField      blur the focused text field (default: blurFocusedField)
 *   5. takeDown        black the screen, only while something is live
 * The order lives here rather than in each mode so no page can skip or reorder a rung: an
 * operator who is typing, or who has rows picked out, never blacks the screen with a stray
 * Escape. Popovers that own their own open state close first, before this ladder ever
 * runs, through useEscapeToClose.
 */
export interface EscapeLadder {
  closeOverlay?: EscapeRung
  cancelEdit?: EscapeRung
  clearSelection?: EscapeRung
  /** Omit for the default blur. `false` only where the page has no text field outside the
   * overlay rung 1 already closes. */
  leaveField?: EscapeRung | false
  takeDown?: EscapeRung
}

export function runEscapeLadder(l: EscapeLadder): boolean {
  const leave = l.leaveField === false ? undefined : (l.leaveField ?? blurFocusedField)
  for (const rung of [l.closeOverlay, l.cancelEdit, l.clearSelection, leave, l.takeDown]) {
    if (rung?.()) return true
  }
  return false
}

/** Rung 4: leave a focused input or textarea. Buttons are not fields. */
export function blurFocusedField(): boolean {
  const el = document.activeElement as HTMLElement | null
  const tag = el?.tagName?.toLowerCase()
  if (tag !== 'input' && tag !== 'textarea') return false
  el?.blur()
  return true
}

/** Rung 5: the screen comes down only while something is live; black and logo pass. */
export function takeDownWhenLive(output: OutputMode, takeDown: () => void): EscapeRung {
  return () => {
    if (output !== 'live') return false
    takeDown()
    return true
  }
}

/** Rung 3 for any list built on useListSelection. One place decides what counts as "a
 * selection worth an Escape" (today: any non-empty one, matching Pre-service). */
export function clearSelectionRung(sel: Pick<ListSelection, 'selectedIds' | 'clear'>): EscapeRung {
  return () => {
    if (sel.selectedIds.length === 0) return false
    sel.clear()
    return true
  }
}
