# Helm — Remove the pre-service live countdown

**Date:** 2026-07-05
**Status:** Draft — awaiting user review
**Master spec:** `docs/superpowers/specs/2026-07-03-helm-design.md`
**Supersedes:** the countdown portions of `docs/superpowers/specs/2026-07-04-helm-slice5-design.md` (§Decision 3, "Countdown is a target-timestamp under the hood… +1 min / reset / pause"). Also **drops** the Slice 5b "absolute countdown target" nicety — there is no longer a countdown feature to attach it to.

---

## 1. Purpose

The pre-service loop shipped in Slice 5 opens with a live-ticking **"Service begins in M:SS"** countdown card, backed by a drift-free target-timestamp clock and `+1 min / Pause / Reset` operator controls. We are removing it. The pre-service loop keeps rotating its static cards (welcome / verse / announcements / prayer / logo) on the dwell timer; the ticking clock and all its machinery go away.

Removal is **full**: `countdown` disappears from the type system (`SlideKind`, `PreCardType`), not merely from the seed or the UI, so it cannot silently resurface as an unhandled case.

## 2. Scope

**In:**
- Delete the `countdown` card type, the `countdown` slide kind, the engine clock (`targetMs`/`paused`/`pausedRemaining`), the `addMinute`/`resetCountdown`/`togglePause` engine methods + IPC channels + preload bindings, the operator `+1 min / Pause / Reset` controls, and the `SlideCanvas` countdown render.
- One-time DB migration to remove the auto-seeded countdown card from installed databases.
- Update the 4 affected test files; keep the gate green (typecheck clean, all tests pass, 0 lint errors).

**Out:**
- No change to the rest of the pre-service loop (rotation, dwell, enable/disable, card editor for the remaining types, engage/disengage).
- No change to Slides/media (video output, live verse cards remain separate 5b items).

## 3. Behavioral end state

- The pre-service card list no longer contains a Countdown card; on a fresh DB the seed set is welcome / verse / announcements / prayer / logo.
- The operator pre-service panel shows the loop/dwell controls but **no** `+1 min / Pause / Reset` row.
- The audience output never renders a ticking clock. Cards rotate on the dwell timer exactly as before.
- The 1-second engine timer stays — it still drives dwell rotation — but no longer re-cues a slide every second (nothing on a static card changes between dwell boundaries).

## 4. Changes by layer

### 4.1 Types — `src/shared/types.ts`
- `SlideKind` (L15): remove `'countdown'`.
- `Slide` (L21): remove `countdownText?`. Verify `message?` is countdown-only before removing it; if any other kind uses `message`, keep the field and only drop `countdownText`.
- `PreCardType` (L25): remove `'countdown'`.
- `PreState` (L125): remove `countdownText: string; paused: boolean;`.
- `CH` (L80–81): remove `preserviceAddMinute`, `preserviceReset`, `preserviceTogglePause`.
- `HelmApi` preservice interface: remove `addMinute` / `resetCountdown` / `togglePause` method signatures.

### 4.2 Shared logic — `src/shared/preservice/cards.ts`
- Remove the `countdown` case in `preSlideFor`. The `default:` branch (currently shared with `countdown`) becomes a defensive **logo** slide: `{ kind: 'logo', title: 'HELM' }`.
- `preSlideFor` loses its `countdownText` parameter (no remaining caller needs it).
- Delete `remainingMs` and `fmtCountdown` (countdown-only).

### 4.3 Engine — `src/main/preserviceEngine.ts`
- Remove state: `targetMs`, `pausedRemaining`, `paused`, `curRemaining`, `countdownText`, and the `defaultDurationS` / `nowFn` (`now`) options — all countdown-only once the tick stops reading the clock.
- Remove methods `addMinute`, `resetCountdown`, `togglePause` from the interface and the returned object.
- `state()` drops `countdownText`/`paused`.
- `tick()` simplifies to dwell rotation only: increment `loopT`, advance on `loopT >= dwellS`, yield if a non-`pre:` key took the live slot. It no longer takes a `nowMs` arg and no longer re-cues the current card every second. Timer callback becomes `setInterval(() => tick(), 1000)`.
- `slideFor` / `pushCue` calls drop the `countdownText` argument.

### 4.4 Repo + migration — `src/main/preCardsRepo.ts`
- Remove the `{ type: 'countdown', … }` entry from `SEED`.
- **One-time migration on repo init:** if any row has `type = 'countdown'`, delete **all** `pre_cards` and re-run the seed. Self-limiting — after re-seed no countdown row remains, so it never fires again. This is the user-approved "wipe & re-seed" (acceptable because pre-cards are still auto-seeded defaults at this stage; operator edits, if any, are discarded).
- Ordering: run the countdown-migration check **before** the existing `count == 0` seed guard so a populated-but-countdown-bearing DB is wiped and re-seeded rather than left as-is.

### 4.5 IPC + preload
- `src/main/ipc.ts` (L99–101): remove the `addMinute` / `reset` / `togglePause` handlers.
- `src/preload/index.ts` (L73–75): remove the three bindings.

### 4.6 Renderer
- `src/renderer/operator/PreServiceMode.tsx`:
  - Remove the `countdown` case in `snippetFor` and the `isCountdown` derivation.
  - Remove `countdownText` / `paused` from the `usePreState()` destructure.
  - Remove the `+1 min / Pause / Reset` control block.
  - Drop the `countdownText` argument from `preSlideFor` / `snippetFor` calls; the `cardForSlide` fallback default (currently `type: 'countdown'`) becomes a remaining type (e.g. `logo`) or is removed if `current` is always defined when rendered.
  - Card editor `canEdit` (L182) currently excludes `countdown` and `logo`; it now excludes only `logo`. Remove `countdown` from any card-type picker in the editor.
- `src/renderer/shared/SlideCanvas.tsx`:
  - Remove the countdown background (L29), `countdownStyle` / `countdownMsgStyle`, and the countdown render branch (`isCountdown`, the message + clock `<div>`s).
  - Simplify the label/lower-third guards (L260, L343) that special-cased `kind !== 'countdown'`.

### 4.7 Tests
- `src/main/preserviceEngine.test.ts` — remove countdown/pause/addMinute/reset assertions and the clock-related `nowFn`/`defaultDurationS` harness options; keep and adjust the rotation/engage/yield tests.
- `src/shared/preservice/cards.test.ts` — remove `fmtCountdown`/`remainingMs`/countdown-slide tests; add/adjust a test that the `default:` fallback renders a logo slide.
- `src/renderer/operator/PreServiceMode.test.tsx` — remove countdown-control assertions.
- `src/renderer/shared/SlideCanvas.sanity.test.tsx` — remove the countdown-kind render case.

## 5. Testing strategy

Behavior-focused, matching the existing suites:
- **Engine:** rotation still advances on dwell; engaging goes live with the first enabled card; a non-`pre:` live key disengages the loop. No countdown state on `PreState`.
- **Cards:** each remaining card type maps to its expected slide; an unknown/`default` type renders the logo fallback.
- **Migration:** seeding a DB that contains a countdown row and re-opening the repo yields a countdown-free card set of the expected size; a fresh DB seeds the countdown-free default set; a countdown-free populated DB is left untouched (migration does not re-fire).
- **Renderer:** `SlideCanvas` has no countdown path; `PreServiceMode` renders no `+1 min / Pause / Reset` controls.

Full gate before done: `npm run typecheck`, `npm test` (rebuild `better-sqlite3` for the Node ABI to run main-process tests, then `npm run postinstall` to restore the Electron ABI), `npx eslint .` → 0 errors.

## 6. Risks / notes

- **`Slide.message` shared use** — the one field to double-check before deletion. If only the countdown slide used it, remove it; otherwise keep it and remove only `countdownText`.
- **Migration timing** — the wipe must run before the `count == 0` guard, else an existing countdown-bearing DB never gets cleaned.
- **`nowFn` removal** — confirm nothing outside the countdown clock relied on injected time; the dwell loop counts ticks (`loopT`), not wall-clock, so it does not.
