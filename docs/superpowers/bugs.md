# Helm — Bug Log

A running list of known bugs to build up and work through. Each entry records
enough to reproduce and investigate later. When a bug is fixed, move it to
**Fixed** with the fixing commit. Suspected-cause notes are **hypotheses to
verify** (via `superpowers:systematic-debugging`), not confirmed root causes.

Entry template:

> ### BUG-NNN — <short title>
> **Status:** Open | Fixed (<commit>) · **Area:** <mode/component>
> **Repro:** numbered steps
> **Expected:** … **Actual:** …
> **Suspected cause (unverified):** … `file:line`
> **Notes:** …

---

## Open

### BUG-001 — Songs: stale highlight ring left on a mouse-selected section after arrowing away
**Status:** Open · **Area:** Songs → section rail (`SectionRail.tsx`)

**Repro:**
1. In Songs, open a song so its sections show in the rail.
2. **Click a section with the mouse** to select it, and go live (or already be live).
3. Use the **arrow keys** to navigate to a different section.

**Expected:** Only the current cued/live section carries a highlight; the previously
selected section returns to its normal (unhighlighted) state.

**Actual:** The originally mouse-selected section keeps a persistent, faded ("degraded")
highlight ring around it even after navigation has moved on.

**Suspected cause (unverified):** The mouse click gives the section `<button>` DOM focus
(`SectionRail.tsx:76`). Arrow-key navigation updates app state (the cued/live section) at
the mode level without blurring that button, so it retains a browser focus outline —
which reads as a stray ring distinct from the app's own cued ring
(`inset 0 0 0 1.5px ${T.accent}66`, `SectionRail.tsx:36`). Consistent with the bug only
appearing after a **mouse** select (keyboard-only nav never focuses the button). Needs
confirmation: is the ring the DOM focus outline or a diverging cued/live index?

**Notes:** Only observed via mouse selection, not keyboard-only navigation.

---

## Fixed

_(none yet)_
