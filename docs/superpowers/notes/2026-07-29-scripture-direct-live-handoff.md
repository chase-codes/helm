# Handoff — direct preview → live for scripture

**Date:** 2026-07-29 · **State:** mid-brainstorm, no code written, no spec written.

Roadmap item: *"Direct preview → live/cue for scripture, without scheduling first"*
(`docs/superpowers/roadmap.md`, Sermon/Scripture section). Found during Windows rehearsal
testing 2026-07-08.

---

## The behaviour today — verified in code, not assumed

All line numbers are `src/renderer/operator/SermonMode.tsx` unless noted.

1. **Every builder route to live also schedules.** `commitBuilder(goLiveToo)` (`:363`) calls
   `window.helm.schedule.add(p)` **unconditionally** — before it even checks `goLiveToo`. So
   pressing Enter to go live leaves a schedule entry behind whether or not the operator
   wanted one.

2. **Tapping a verse card does not cue.** `ChapterRail`'s tap goes to `onRailSelectVerse`
   (`:418`), which only writes into the ref builder. This is deliberate and documented —
   `ChapterRail.tsx:20-25`: *"rather than jumping the live/cued verse directly — the builder
   is the single source of truth for what's selected, and the caller decides when/whether
   that turns into a live preview."* Shift-tap extends a range (`setEnd`).

3. **There *is* a no-schedule path, but only for the already-cued verse.** `goLive()` (`:247`)
   pushes `scrV` live without touching the schedule. It's wired to SermonCenter's button
   (`:576`) and a key handler (`:503`).

4. **The only ways to change *which* passage is cued** are clicking a schedule row
   (`jumpTo`, `:269`, called at `:445`) or committing the builder — which schedules.

**Therefore the actual gap** is narrower than the roadmap wording suggests: it is not that
going live is impossible without scheduling, it is that *changing the cued passage* is
impossible without either a schedule entry or a pre-existing schedule row.

---

## Decision already made by the human partner

Asked: tapping a verse card currently builds a range (shift-tap extends). If tap also cues,
those conflict. How should the operator say "put this up now"?

**Chosen: tap cues, and range-building is dropped from the rail.** The rail becomes pure
navigation; multi-verse ranges get typed into the builder instead.

Worth flagging to the human partner: this was **not** the recommended option — the
recommendation was "tap cues, shift-tap still range-builds," which preserves the existing
range gesture. The chosen option is simpler to explain but removes shift-tap range
selection that works today. Confirm they want that trade before building on it.

---

## Open questions — none of these have been asked yet

- **Does tap cue only, or cue *and* go live?** The roadmap says *"if the sermon view is
  already live, switch straight to it"* — implying it follows the existing live state rather
  than forcing output on. Needs confirming.
- **What happens to shift-tap** once range-building leaves the rail — inert, or same as tap?
- **Multi-verse readings.** With ranges gone from the rail, showing a range means typing a
  reference. Is that acceptable mid-service, which is the moment this feature exists for?
- **Should the direct path record anything at all?** Some operators treat the schedule as
  the service's record. "Without scheduling first" may mean "don't *require* it" rather than
  "never write one."
- **Does `commitBuilder`'s unconditional `schedule.add` stay** for the deliberate
  build-a-reading flow, or does that also become opt-in?

---

## The second rehearsal item — untouched

*"Background choices for scripture (and similar) audience output."* Not started. Judged an
independent subsystem: audience-output styling plus a settings flow, sharing no code with
the above and blocking nothing. Should get its own spec → plan cycle.

Two things already in place that it can build on:
- `SlideCanvas.tsx:45-52` already honours a per-slide `s.bg` override, falling back to
  kind-specific gradients. There is an existing seam.
- Settings are already plumbed end-to-end: generic key/value via `CH.settingsGet` /
  `CH.settingsSet` (`src/main/ipc.ts:70-72`, `src/main/settingsRepo.ts`).

---

## Repo state

`master`, clean tree, everything merged. **412/412 tests, typecheck clean.**
Recently landed: BUG-007 (audience text auto-fit), BUG-008 (pre-service screen ownership),
plus the roadmap's pre-live selection marker and min/max audience font sizing.
BUG-009 logged (no error boundary — any renderer exception blanks the projector).

Real-app verification drivers live in `scratch/` (untracked, run from the repo root so
`playwright-core` resolves): `verify-bug008.mjs`, `verify-autofit.mjs`.
