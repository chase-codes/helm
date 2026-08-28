// Space no longer goes live (#52) — but the browser's native "Space activates the focused
// <button>" would let a tabbed-to Go live, Take down, or the header's live chip fire
// anyway, and the chip's click blacks the screen. While Space was bound to go.live the
// dispatcher's preventDefault happened to suppress that; nothing does once it is unbound.
//
// The mirror of blurOnPointerClick: registered once on `document`, capture phase so it
// runs before any element handler, and it only cancels Space when a <button> has focus.
// Inputs and textareas keep typing spaces, and a role="menu" keeps its own Space/Enter
// handling (ContextMenu activates the focused item on both).
export function suppressSpaceActivation(e: KeyboardEvent): void {
  if (e.key !== ' ') return
  const el = document.activeElement
  if (!(el instanceof HTMLButtonElement)) return
  if (el.closest('[role="menu"]')) return
  e.preventDefault()
}
