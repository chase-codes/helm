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

### BUG-007 — Scripture text too small on the audience (projector) view, no way to adjust
**Status:** Open · **Area:** Sermon/Scripture — audience output display
**Repro:** Found during the Windows/projector rehearsal. Schedule and go live with a scripture reading; view the audience output on the projector.
**Expected:** Text sized for legibility at projector distance, with some operator control over size.
**Actual:** Text renders noticeably small on the projector; there's no setting/control to increase it.
**Notes:** Related roadmap ask — songs wants auto min/max sizing based on verse length (see `roadmap.md` Songs section); scripture may want a simpler manual size control first.

---

## Fixed

### BUG-008 — Pre-service card tap silently did nothing while a song was live
**Status:** Fixed (`c59565d`, `56c67e7`, `31870e6`) · **Area:** Pre-service (`preserviceEngine.ts`, `PreServiceMode.tsx`)

**Reported as:** "live notification still shows the pre-existing song/scripture after the
pre-service loop starts," suspected to be `Header.tsx` reading a stale `liveSnap`.

**Root cause (measured — the report's hypothesis was wrong):** `liveSnap` updates
correctly; the header was telling the truth. Measured against the real engine + real
`shared/presentation/core` reducer, the **"Start loop" button path works** (`liveKey` →
`pre:…`, header → `LIVE — WELCOME`). The actual hole was `showCard`/`step`
(`preserviceEngine.ts:69-70`), both gated on `if (engaged) pushLive()`. With a song live
and the loop not started, tapping a card moved only `idx` — the preview updated, the
audience screen and header kept the song. The view's own hint text promised the
opposite: *"Tap any card to show it immediately."* Two further UI elements
(`● ON SCREEN`, `PROJECTING`) derived from the engine's `engaged` flag rather than
presentation state, so they claimed a screen the app didn't own.

**Fix:** `ownsScreen()` gates selection — `showCard`/`step` take the screen only when
nothing has been up (`liveKey === null`) or pre-service is what put the current content
there, and never interrupt another flow. Takeover is deliberate only: **Start loop**
(`engage()`, unchanged) or the new **Show this card** (`showNow()` — one card, no
rotation). Badges now read `output`/`liveKey`; a queued-but-not-live card shows
`● ARMED`, which also satisfies the roadmap's *pre-live selection marker*.

Keyed on `liveKey` rather than output mode (`31870e6`, from code review): a blacked-out
screen is **not** free real estate. Mid-sermon the operator blanks the screen and browses
pre-service, where a row click is the only way to select a card — under an output-mode
test that click projected it to the congregation.

Three further defects surfaced by the new "live with no rotation behind it" state, each
reproduced before fixing (`56c67e7`): `showNow` left a still-engaged loop running so the
held card rotated away; editing the live card never re-pushed it; and `removeCard` was
gated on `engaged`, leaving a deleted card projected and able to yank the audience off a
live song during the yield window.

**Proof:** 18 engine cases + 5 renderer cases (`npm test`, 378 passing). Verified in the
running app end-to-end (`scratch/verify-bug008.mjs`, 14/14) across the full
renderer → preload → main → engine → presentation path: tap with a song live leaves
`liveKey=song:abc:0` and arms the card; Show this card takes it without engaging the
loop; tap with nothing live shows immediately; a blackout from a song keeps taps in
arm-only mode.

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
