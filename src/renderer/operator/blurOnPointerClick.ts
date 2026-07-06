// A mouse click focuses the clicked <button> (default pointer behavior). This app
// navigates via a global keydown delegate (App.tsx) that updates state without ever
// moving DOM focus, so a mouse-clicked control keeps focus — and once arrow-key
// navigation begins, the browser promotes that still-focused button to :focus-visible
// and paints a focus ring that lingers on the last-clicked control (BUG-001).
//
// Blur pointer-activated buttons so no control retains focus between a click and later
// keyboard navigation. Keyboard-activated clicks (Enter/Space produce a click event with
// detail === 0) are left focused, so genuine keyboard focus indication is preserved.
// Registered once on `document` in App; only acts on the nearest <button> ancestor of the
// click target, so inputs/textareas and non-button clicks are untouched.
export function blurOnPointerClick(e: MouseEvent): void {
  if (e.detail === 0) return // keyboard-synthesized click — keep focus for a11y
  const btn = (e.target as Element | null)?.closest('button')
  if (btn instanceof HTMLElement) btn.blur()
}
