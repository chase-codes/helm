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

> Bugs BUG-002…BUG-006 were found and **measured** in the song-search spike
> (`docs/superpowers/specs/2026-07-06-song-search-spike-findings.md`). The harness
> under `scratch/search-spike/` reproduces each against the real
> `songsRepo.search`/`rankSongs`/FTS pipeline. Severity is fit-to-workflow
> (`Enter`-takes-top ⇒ precision@1 is king).

### BUG-003 — Accented songs found by FTS then scored 0 by `norm()` · **SEV 2**
**Status:** Open · **Area:** Songs search (`fuzzy.ts` `norm`, `songScore.ts`) — **shared code**

**Repro:**
1. Library contains an accented title/lyric (e.g. `Renuévame`, `Señor`).
2. Search `renuevame` (All) or `senor` (Lyric) — unaccented, as an operator would type.

**Expected:** The accented song ranks 1.
**Actual:** Returns nothing / drops the song. Harness localization: `ftsHit(target)=TRUE, scorerScore=0` — FTS folds diacritics (`schema.ts:14`, `remove_diacritics 2`) and *returns* the song, but `norm()` (`fuzzy.ts:2`, `replace(/[^a-z0-9 ]/g,' ')`) turns every accented letter into a space (`renuévame`→`renu vame`), so the scorer can't match. Measured accented-text p@1 = **60%**; multi-word accented titles survive only on the fragile 360 snippet floor.

**Root cause (measured):** `norm()` destroys non-ASCII letters instead of folding them (NFD + strip combining marks + `ß`→`ss` would fix it).

**Notes:** ⚠️ `norm` is **shared** with message search (`messagesRepo.ts:117`, `messageScore.ts`) and scripture book-name/ref parsing (`scripture/books.ts`, `scripture/refs.ts`) — the fix helps those too but must be validated there. Priority scales with how multilingual real congregations are (open question for the team).

### BUG-004 — `≥30` FTS-hit fallback silently disables typo tolerance · **SEV 3**
**Status:** Open · **Area:** Songs search candidate gate (`songsRepo.ts:43`)

**Repro:**
1. Library large enough that a common word returns ≥30 prefix hits (a few hundred songs).
2. Search a multi-token query mixing a common correctly-spelled word with a misspelled *distinguishing* word: `holy reckelss` (meaning *Reckless Love*), `praise recukless`.

**Expected:** Fuzzy match rescues the typo (`lev("reckelss","reckless")`≈1).
**Actual:** Target **absent**. `songsRepo.ts:43`: `if (rowids.length >= 30)` ranks only the FTS candidates; the whole-library fuzzy scan (the only path that can catch a typo whose correct spelling isn't a token prefix) never runs. Harness: `holy reckelss` → ftsCount=252, fallback=false, *Reckless Love* ABSENT.

**Root cause (measured):** typo tolerance is gated on an arbitrary hit-count constant (30) and library size, not on "did a token fail to match?".

**Notes:** Single-token typos (the common audible mistype) are safe — they yield sparse FTS hits and full-scan fires — so this only bites the multi-token subset (measured misspelled-title p@1 was still 100%). Lower severity but a silent cliff. Fix: union FTS candidates with a fuzzy pass, or gate on unmatched tokens rather than raw count.

### BUG-005 — No stemming; bare inflected single-token queries miss · **SEV 4 (minor)**
**Status:** Open · **Area:** Songs search tokenization (`fuzzy.ts`, `songScore.ts`)
**Repro:** search `praising` alone for a song whose lyric says "Praising" (base form `praise`). **Expected:** match. **Actual:** `lev("praise","praising")=3 > tol 2` → no token match; only rescued when the query also contains a clean token (why inflected-form measured 100% — those queries had a second matching word). **Notes:** shared `norm`/tokenizer surface; light suffix folding (`-ing/-ed/-s`) closes it. Low frequency.

### BUG-006 — Search latency grows linearly; cheapest-to-mistype query hits the most expensive path · **SEV 4 (watch)**
**Status:** Open · **Area:** Songs search (`songsRepo.ts` fallback scan, `SongsMode.tsx:104` parallel lyric pass)
**Repro:** measure ms/search vs library size. Harness: **3.9 ms @200, 18.3 ms @1000, 56.5 ms @3000** songs. **Notes:** per keystroke; **Title mode doubles it** (parallel lyric search, `SongsMode.tsx:104`); the sparse-FTS fallback runs full-library Levenshtein, so a single-token typo — the hurried operator's likely input — triggers the most expensive path. Fine today; watch if libraries reach thousands. Fix candidates: debounce, drop/relax the double search, cap the fuzzy scan.

### BUG-008 — Live notification still shows the pre-existing song/scripture after the pre-service loop starts
**Status:** Open · **Area:** Header live status (`Header.tsx`) / pre-service loop (`preserviceEngine.ts`)
**Repro:**
1. Go live with a song or scripture reading.
2. Engage the pre-service loop.

**Expected:** The live status/notification updates to reflect the pre-service loop as the actual live output.
**Actual:** It keeps showing the previously-live song/scripture, not the pre-service loop.
**Suspected cause (unverified):** `Header.tsx` derives its label from `usePresentationState()`'s `liveSnap` (`Header.tsx:22,27`); the pre-service engine likely drives output without updating `liveSnap`, leaving the stale song/scripture label in place.
**Notes:** Found during Windows rehearsal testing, 2026-07-09.

---

## Fixed

### BUG-007 — Scripture text too small on the audience (projector) view, no way to adjust
**Status:** Fixed (`de0d393`) · **Area:** Sermon/Scripture — audience output display

**Root cause (measured):** the audience text styles used `clamp(min, N cqmin, MAXpx)` — a
fixed pixel ceiling. That ceiling only binds once the container's shorter side passes
`100 × MAXpx / N` — **~851px for scripture** (`4.7cqmin`/`40px`) and **~973px for lyrics**
(`7.4cqmin`/`72px`). Both thresholds sit above the operator's small preview panes and below
a 1080p projector, so the cap did nothing where the bug was looked for and throttled the
text only where it mattered. Measured on a 1080p output: scripture pinned at 40px next to
lyrics at 72px on the same screen — visibly mismatched, and both far below what the box had
room for.

**Fix:** replaced the fixed-px clamp for scripture and lyrics with a content-driven
auto-fit — `src/shared/slides/fitText.ts` (`bandCandidates`/`fitFontSize`, pure and
unit-tested) tries a descending band of `cqmin` sizes and keeps the largest that fits;
`src/renderer/shared/useFitText.ts` runs that search against the real DOM box in a layout
effect (and on resize) and writes the result to a `--helm-fit-size` custom property that
the text styles read via `fitSizeValue()`, wrapped in `max(11px, …)` / `max(10px, …)` so the
original pixel **floors** survive in very small containers (the ceilings are what had to go,
not the floors). `SlideCanvas.tsx` supplies the two bands: scripture
`bandCandidates(10, 3)`, lyrics `bandCandidates(10.5, 3.5)` (an earlier tuning pass had them
at 6.5–3 and 8–3.5; both ceilings were raised after real-projector verification showed
every case — short and long content alike — pinned at those lower ceilings, meaning the
shrink path never engaged and a two-word verse looked no bigger than a forty-word one).

**Proof:** `fitText.test.ts`, `useFitText.test.tsx`, and `SlideCanvas.test.tsx`/
`SlideCanvas.sanity.test.tsx` cover the band search and the DOM wiring (shape of the
fitted value, not the specific band numbers, so retuning doesn't churn these tests). The
measurement walk is covered by a jsdom test that stubs layout so `scrollHeight` responds to
the probe — it fails if the walk is replaced with "take the largest candidate" or if the fit
comparison is inverted; a sibling test pins the module-scope band hoisting by asserting the
effect doesn't re-run when a re-render leaves the deps referentially stable (without it, the
stage display's per-second `clock` tick would re-measure every second). Full suite `npm test`
— **381/381 passing**, `npm run typecheck` clean. Real-app proof at 1920×1080
via `scratch/verify-autofit.mjs` (Electron + `playwright-core`, a genuine output window,
not jsdom): short-verse 108.0px, long-verse 97.2px, short-stanza 113.4px, long-stanza
99.9px, two-column 94.5px — all comfortably above the old 40px ceiling, short content
measurably larger than long content (the shrink path now visibly engages), and nothing
clipped in any case.

### BUG-002 — `Enter` cues by DB insertion order, not relevance (score-tie plateaus) · **SEV 1**
**Status:** Fixed (`00340da`) · **Area:** Songs search ranking (`songScore.ts`, consumed by `SongsMode.tsx` Enter path)

**Root cause (measured):** flat score buckets — a single fuzzy token → `380+12·matched` for every song with that word; snippet floor `360` — plus `rankSongs` sorting by `score` only, so tied top hits fell through to `Array.sort` stability = **insertion order**. In production `list()` orders by `created_at, title` (`songsRepo.ts:22`), so an operator's later-pasted songs *lost* these ties. Harness proof: same ranker, targets inserted last instead of first → **p@1 91%→83%**, `faithfullness` 1→10, `amazin grace`/`grace amazing` 1→8.

**Fix (A1 — deterministic relevance tie-breaker):** `scoreSong` now returns relevance sub-signals and `rankSongs` compares them after `score`, before any insertion-order fallback: title-token coverage → title-match closeness → overall coverage → title-starts-with → shorter title → title string (a content-based, fully deterministic final key). Primary score buckets are unchanged, so the clean cases that already measured 100% are untouched. `fuzzy.ts` is deliberately not touched (protects shared message + scripture search). Design: `docs/superpowers/specs/2026-07-06-song-search-tiebreaker-design.md`.

**Proof:** spike harness now asserts order-independence — inserted-first p@1 == inserted-last p@1 = **91%** (was 83% when last), **0 flips**, **0/46** rank-1 pairs unresolved by relevance. Covered permanently by `songScore.test.ts` tie-breaker cases (`npm test`).

**Remaining / follow-up:** `faithfullness` and its filler ties are separated deterministically but the *real* song still isn't rank 1 (target and fillers are identical on every title signal; only lyric term-frequency would distinguish them). That residue is the documented trigger for **A2** (spread the flat score buckets into a continuous score) — deferred, tracked in the spike findings' Recommendation.

### BUG-001 — Stale focus ring persists on mouse-clicked controls after keyboard navigation
**Status:** Fixed (`7b34971`) · **Area:** app-wide (operator) — first seen in Songs → section rail + transport (`SectionRail.tsx`, `SongsMode.tsx`)

**Root cause (verified):** A mouse click focuses the clicked `<button>` (default pointer
behavior). The app navigates via a global `document` keydown delegate (`App.tsx`) that
updates React state **without moving DOM focus**, so the last-clicked button keeps focus;
when arrow-key navigation begins, Chromium promotes that still-focused button to
`:focus-visible` and paints a focus ring that lingers. Confirmed on both a stateful section
row and a stateless transport button, which ruled out the diverging cued/live index
hypothesis (the transport button has no cued/live styling yet showed the ring).

**Fix:** A global click handler (`blurOnPointerClick.ts`, registered on `document` in
`App.tsx`) blurs pointer-activated buttons (`click.detail > 0`) so no control retains focus
into subsequent keyboard navigation. Keyboard-activated clicks (`detail === 0`) stay
focused, preserving keyboard focus indication. Covered by `blurOnPointerClick.test.ts`.

**Remaining:** on-screen visual confirmation in the running app (click a control → arrow-key
away → no lingering ring) — natural to eyeball during the Windows smoke test.

**Repro (two confirmed triggers):**
- _Section rail:_
  1. In Songs, open a song so its sections show in the rail.
  2. **Click a section with the mouse** to select it, and go live (or already be live).
  3. Use the **arrow keys** to navigate to a different section.
- _Transport button:_
  1. **Click "Cue next ›" (or "‹ Prev") with the mouse** (`SongsMode.tsx:426,429`).
  2. Continue navigating with the **arrow keys**.

**Expected:** Only the current cued/live section carries a highlight; nothing else retains
a ring once navigation (keyboard) moves on.

**Actual:** Whatever was **last clicked with the mouse** keeps a persistent, faded
("degraded") ring — the originally selected section row, and separately the Cue-next
transport button.

**Suspected cause (unverified):** A lingering DOM focus outline. A mouse click focuses the
clicked `<button>` (section rows `SectionRail.tsx:76`; transport `SongsMode.tsx:426,429`).
Arrow-key navigation is handled at the mode level and updates app state **without moving or
clearing DOM focus**, so the last-clicked element keeps a browser focus ring. That it
reproduces on both a section row **and** an unrelated transport button — and only after a
**mouse** click (keyboard-only nav never focuses these) — points to a general focus-outline
issue, not per-component state. If confirmed, the fix is likely global (e.g. a
`:focus-visible`-only outline policy, or blur-on-click) rather than one-off per control.
Rule out a diverging cued/live index during verification.

**Notes:** Only observed after a mouse click; keyboard-only navigation doesn't leave a ring.
Two distinct controls affected (section row + transport), suggesting broad scope.
