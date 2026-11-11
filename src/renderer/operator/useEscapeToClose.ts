import { useLayoutEffect } from 'react'

/**
 * Rung 1 of the Escape ladder (grammar rule 9) for a popover that keeps its own open state,
 * so the page ladder cannot see it. Listens on window in the CAPTURE phase, which runs before
 * App's document-level dispatcher, and stops the press there: Escape closes the popover and
 * nothing else, the same contract ContextMenu keeps for its own keys. Only Escape is taken;
 * every other key still reaches the page. Layout timing for the reason SongsMode registers its
 * key delegate that way: a key handle must never lag the commit on screen.
 */
export function useEscapeToClose(open: boolean, onClose: () => void): void {
  useLayoutEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])
}
