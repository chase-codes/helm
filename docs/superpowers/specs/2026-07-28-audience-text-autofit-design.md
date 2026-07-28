# Helm — Audience text auto-fit (scripture + song lyrics)

**Date:** 2026-07-28
**Closes:** BUG-007 (scripture too small on the projector, no way to adjust) and the Songs
roadmap item *"Min/max audience-view font size based on verse length."*

---

## Why

Found during Windows/projector rehearsal testing: scripture renders noticeably small on
the audience screen, and there's no control to increase it.

The cause is measured, not suspected. `SlideCanvas` sizes every text style with
`clamp(min, N cqmin, max)` — a container-relative size with a hard **pixel ceiling**.
`cqmin` is 1% of the container's shorter side, so on a 1920×1080 projector one `cqmin`
is 10.8px:

| Text | Style (`SlideCanvas.tsx`) | Wants | Renders at |
| --- | --- | --- | --- |
| Song lyrics | `clamp(11px, 7.4cqmin, 72px)` (`:64`) | 80px | **72px** |
| Scripture verse | `clamp(10px, 4.7cqmin, 40px)` (`:115`) | 51px | **40px** |

Scripture lands at **40px — 55% the size of lyrics on the same screen.**

The ceilings only bind once the container's shorter side exceeds ~850px. They therefore do
nothing in the operator's small preview panes and throttle the text **only on the real
projector** — which is why this survived until a rehearsal on real hardware.

A fixed size is the wrong fix regardless of value: a short verse and a 60-word verse cannot
share one size and both read well. Text should fill the space it has.

## What we're building

Audience text **auto-fits**: it grows to fill its box and shrinks only as far as the content
requires, between a floor and a ceiling. No operator input — it is correct by default on any
projector. Scope is **scripture and song lyrics** only: the two reported cases, and the two
places where content length genuinely varies.

Each slide is sized independently, capped at a ceiling so consecutive slides don't swing
wildly in size.

## Design

### 1. Selection logic — a pure function

`src/shared/slides/fitText.ts`:

```ts
/** Largest candidate whose `fits` returns true; the smallest candidate if none do. */
export function fitFontSize(candidates: number[], fits: (cqmin: number) => boolean): number
```

Candidates are `cqmin` values in descending order. Measurement is **injected**, so the
selection rule is a plain unit-tested function and the DOM read is the only untested part.

Sizes stay in `cqmin` rather than px so everything remains relative to the container. That
keeps the operator's small preview panes faithful miniatures of the projector — the property
that makes the preview worth trusting.

### 2. Measurement — a hook

`src/renderer/shared/useFitText.ts`: `useFitText(ref, deps)` supplies the `fits` callback.
In a `useLayoutEffect` it walks candidates descending, applies each size, and reads
`scrollHeight <= clientHeight && scrollWidth <= clientWidth`. Re-runs when the slide content
changes and when the container resizes (`ResizeObserver`).

**Fallback:** if measurement is unavailable — jsdom, a zero-size container, no
`ResizeObserver` — it returns today's clamp-based size. It never renders nothing.

### 3. Applying it in `SlideCanvas`

Only two styles change:

- `lineStyle` (lyrics, `SlideCanvas.tsx:62`)
- `verseTextStyle` (scripture, `SlideCanvas.tsx:113`)

Both lose their pixel ceilings — those caps are the defect. Starting bands, to be tuned
against a real 1080p render before landing:

| Text | Band (cqmin) | Candidates | Was |
| --- | --- | --- | --- |
| Lyrics | 8.0 → 3.5 | 19 | `7.4`, capped at 72px |
| Scripture | 6.5 → 3.0 | 15 | `4.7`, capped at 40px |

Candidates step by **0.25 cqmin** — ~2.7px apart on a 1080p projector, fine enough that the
chosen size never looks like it left space on the table, coarse enough to keep the walk short.

Scripture stays slightly below lyrics — it is serif body text and typically longer — but
ends up in the same league instead of 55% the size.

Existing pixel **floors** stay: they only bind in very small containers, where they keep
preview text legible.

**Parallel versions.** Two-column scripture (`single === false`, `:101`) measures the taller
column and applies one size to both. Two versions of the same passage rendering at different
sizes would read as broken.

### Out of scope

Quote, title, sermon, and pre-service list slides keep their current sizing. They are not
reported as wrong, and their content length is bounded by the operator's own input rather
than by a passage. No operator-facing size control: auto-fit is meant to remove the need for
one, and adding a knob before knowing auto-fit is insufficient would be premature.

## Testing

**Unit — `fitFontSize`,** against a fake measurer:
- returns the largest candidate that fits
- returns the smallest candidate when none fit
- handles a single candidate
- never returns a value outside the supplied candidates

**Renderer — `SlideCanvas`:** the fitted size reaches the rendered element, and the no-layout
fallback path renders at the clamp size (jsdom has no layout engine, so measurement is
stubbed).

**Real app — the check that actually closes BUG-007.** Drive a 1920×1080 output window and
screenshot four cases: short verse, long verse, short stanza, long stanza. Confirm scripture
is legible at projector scale, nothing overflows or clips, and the two-column case agrees.
Same driver pattern as the BUG-008 verification (`scratch/verify-bug008.mjs`). The defect
only exists at projector size, so unit tests alone cannot close it.

## Risks

**Measure-and-shrink runs on every slide change.** The loop is a handful of synchronous
layout reads over at most 19 candidates on one element. If it shows up as a visible hitch when
cueing, switch the descending walk to a binary search over the same candidate list —
`fitFontSize` already takes the candidates as data, so this changes one call site.

**Tuning is guesswork until seen at size.** The bands above are a starting point derived from
the existing ratios, not from a measured render. The real-app screenshots come before the
numbers are final.
