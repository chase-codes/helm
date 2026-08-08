# Helm — Bug Log

**Open bugs are now tracked as [GitHub issues](https://github.com/chase-codes/helm/issues?q=is%3Aissue+is%3Aopen+label%3Abug).**

File new bugs there with the `bug` label, a severity label (`sev-1` critical …
`sev-4` minor/watch), and an `area:*` label. Carry the same rigor this file
required: numbered repro steps, expected vs. actual, and suspected causes marked
as **hypotheses to verify** (via `superpowers:systematic-debugging`) unless
measured. When a bug is fixed, close the issue with the fixing commit referenced.

The open entries formerly logged here (2026-08-07 migration):

| Old ID | Issue | Title |
|---|---|---|
| BUG-003 | [#12](https://github.com/chase-codes/helm/issues/12) | Accented songs found by FTS then scored 0 by `norm()` |
| BUG-004 | [#13](https://github.com/chase-codes/helm/issues/13) | `≥30` FTS-hit fallback silently disables typo tolerance |
| BUG-005 | [#14](https://github.com/chase-codes/helm/issues/14) | No stemming; bare inflected single-token queries miss |
| BUG-006 | [#15](https://github.com/chase-codes/helm/issues/15) | Search latency grows linearly with library size |
| BUG-009 | [#16](https://github.com/chase-codes/helm/issues/16) | No error boundary: renderer exception blanks the projector |
| BUG-010 | [#17](https://github.com/chase-codes/helm/issues/17) | Typing a reference at speed silently drops its digits |
| BUG-011 | [#18](https://github.com/chase-codes/helm/issues/18) | Entry field cannot be cleared with the mouse |
| BUG-012 | [#19](https://github.com/chase-codes/helm/issues/19) | "Install a Bible" hint shown while bibles are installed |
| BUG-013 | [#20](https://github.com/chase-codes/helm/issues/20) | Stale renderer-mirrored state can black the screen |
| BUG-014 | [#21](https://github.com/chase-codes/helm/issues/21) | Arrows/Prev/Next silently inert during cross-chapter fetch |
| BUG-015 | [#22](https://github.com/chase-codes/helm/issues/22) | Second shift-tap grows the range instead of pivoting |
| BUG-016 | [#23](https://github.com/chase-codes/helm/issues/23) | A large song import freezes live output control |
| BUG-017 | [#24](https://github.com/chase-codes/helm/issues/24) | The import review list is unvirtualized |
| BUG-018 | [#25](https://github.com/chase-codes/helm/issues/25) | Pre-service card click projects with no chance to edit — fixed (`c687062`), closed |
| BUG-019 | [#27](https://github.com/chase-codes/helm/issues/27) | Deleting a card moves the audience onto a card nobody selected |
| BUG-020 | [#28](https://github.com/chase-codes/helm/issues/28) | Deleting the last pre-service card leaves it projected forever |
| BUG-021 | [#29](https://github.com/chase-codes/helm/issues/29) | Pre-service tap can start projecting when live with no live key |

Bugs fixed **before** the migration remain below with their full write-ups —
several are referenced from specs, plans, and commit messages by their BUG-NNN
ids.

---

## Fixed

### BUG-018 — A single click on a pre-service card projects it with no chance to edit first · **SEV 3**
**Status:** Fixed (`c687062`) · **Area:** Pre-service (`PreServiceMode.tsx:271`, `preserviceEngine.ts` `showCard`)

**Repro:**
1. Be in Pre-service with **nothing live yet** (`liveKey === null`), or with pre-service
   already owning the screen — i.e. the ordinary state before a service starts.
2. Click any card row in the list, for any reason: to read it, to check a name, to fix a
   typo before it goes up.

**Expected:** A click selects the card so the operator can look at it and edit it. Putting it
in front of the congregation is a separate, deliberate act — **Show this card** already exists
for exactly that (`showNow()`, added by BUG-008).

**Actual:** The click projects it immediately. The card is on the congregation's screen before
the operator has had any opportunity to review or correct it. There is no undo — the only
recovery is to take it down or click something else, both of which the room sees.

**Root cause (measured — an existing test asserted the defect as intended behaviour):** the
`preserviceEngine` suite pinned `showCard(2)` with nothing live producing `output: 'live'`
against the real presentation reducer, which is precisely the operator's complaint. The row's
only handler is
`onClick={() => window.helm.preservice.showCard(i)}` (`PreServiceMode.tsx:271`). After the
BUG-008 fix, `showCard` takes the screen whenever `ownsScreen()` is true — which includes the
`liveKey === null` case. Editing is reachable only via smaller nested controls on the row that
`stopPropagation`, so the large, easy-to-hit target is the destructive one and the safe
actions are the small ones.

**This is the residual of BUG-008's design, not a regression of it.** BUG-008 correctly stopped
a tap from interrupting *another* flow, and deliberately kept "tap shows it now" when
pre-service owns the screen — the hint text still promises that (`PreServiceMode.tsx:22,195`).
What was not considered is that "we own the screen" is the *normal* pre-service state, so the
guard does not protect the most common case: an operator setting up before anyone is watching
the operator, but with the projector already showing the loop.

**Decided rule (operator, 2026-08-04):** *switching* what is already on screen is free;
*starting* to project is not.

- **Pre-service is already projecting** (`output === 'live'` and `liveKey` starts with `pre:`)
  → a click switches cards immediately, as today. The screen is already committed, the
  congregation is already looking at pre-service content, and swapping one card for another
  reveals nothing that was not already a decision. Speed matters here and costs nothing.
- **Nothing is live** (`liveKey === null`) → a click must **select only**. Going live is a
  state change the room notices, so it needs shown intent: **Show this card** or **Start loop**.

**★ The rule is already implemented — pre-service just calls the wrong verb.**
`shared/presentation/core.ts` deliberately offers three verbs at three intent levels, and the
middle one *is* this rule:

| verb | behaviour | meant for |
|---|---|---|
| `goLive` | starts projecting from any state; toggles to black when re-fired on the live key | deliberate takeover — a **Go live** button, Start loop, Show this card |
| `showLive` (`presentation.show`) | **`if (st.output !== 'live') return st;`** then updates within the same kind | navigation — taps, arrows, cursor moves |
| `applyCue` | same-*flow* hot update only | cueing that must never jump the screen |

`showLive` refuses to start projecting and switches freely once live — the decided rule,
verbatim, in a primitive that already exists and is already tested.

**Songs, Sermon and Message already observe this discipline.** In each, `goLive` is bound to an
explicit control (`SongsMode.tsx:521`, `SermonCenter.tsx:266`, `MessageMode.tsx:405`) while
navigation goes through `show` — `SermonMode.tsx:245` even documents it: *"main's `showLive`
no-ops unless output is live."* **Pre-service is the only mode that routes a tap through
`goLive`** (`preserviceEngine.ts:44`), which is the whole bug.

**Fix:** `pushLive()` was shared by five callers with two different intents. It is now split:
`pushLive()` (goLive, deliberate — `engage()` / `showNow()`) and `pushShow()` (`showLive`,
navigation — the loop tick, `showCard()`, `step()`, `removeCard()`). `PresentationSink` gained a
`show` member wired to the already-existing `stateStore.show` (`stateStore.ts:16`).

`ownsScreen()` did **not** survive — every caller that used it now routes through `pushShow`, so
it and `PresentationSink.liveKey` were deleted. `showLive`'s two guards express BUG-008's rule
more strictly than the `liveKey` test did: `output !== 'live'` refuses a dark screen outright
(including one pre-service itself took down — a behaviour change, see below), and `sameKind`
refuses another flow's screen.

`removeCard` was included deliberately: it carried the same defect, since deleting a card while
nothing was live would start projecting the next one.

**Known limits of the guarantee, all logged rather than papered over:** the "a tap never starts
projecting" rule holds in every state except `output === 'live'` with `liveKey === null`, which
`showLive` allows on purpose for scripture's benefit (**BUG-021**). And `removeCard` still has
two pre-existing defects this change moved but did not cure — a delete before the live card
shifts the audience onto an untouched one (**BUG-019**), and deleting the last card leaves it
projected with nothing left to replace it (**BUG-020**).

**Behaviour change worth knowing:** a screen pre-service took down is no longer treated as
unowned. Under BUG-008 a tap after ✕ Take down brought the card back up; now it only selects,
and **Show this card** / **Start loop** bring it back. This follows from the decided rule —
that tap *starts* projecting — and both hint texts (`PreServiceMode.tsx:22,195`) were reworded
to promise exactly what the engine now does.

**Proof:** 27 engine cases + 8 renderer cases (`npm test`, **579 passing**), typecheck clean.
The four cases that reproduce the bug failed first with `expected 'live' to be 'black'` against
the real presentation reducer, then passed. Verified in the running app end-to-end
(`scratch/verify-bug018.mjs`, **14/14**) across renderer → preload → main → engine →
presentation: a tap with nothing live leaves `output=black liveKey=null` while the card reads
● ARMED; Show this card and Start loop both still take the screen; a tap switches cards freely
once pre-service is projecting; a tap after take-down does not resurrect the screen; and a tap
still never interrupts a live song (BUG-008 regression).

Three existing tests asserted the old rule and were rewritten rather than kept: the two that
pinned "showCard/step puts the card up immediately when nothing is live", and the one that
pinned tapping back a screen pre-service took down. A fourth asserted the rotation calls
`goLive` specifically — it now asserts the resulting presentation state instead, which is what
the audience actually sees and is indifferent to which verb delivers it.

**Notes:** Reported 2026-08-04 from live use. Worth checking whether the same "big target is
the live action" shape exists elsewhere — `SongsMode`'s section rail and the sermon list are
the obvious places to look.

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
shrink path never engaged and a two-word verse looked no bigger than a forty-word one). A
post-review follow-up caught the same defect hiding in the scripture ref and version
labels, which still carried their own fixed-px `clamp()` ceilings even though they sit
*inside* the measured box — so the ref/version, projector, and preview could disagree on
proportions. They now scale off the fitted verse size via `fitSizeScaled()`, at their
original ratios to it (ref `0.62×`, version `0.47×`), floored at their original 8px/7px —
so the whole scripture block scales, and fits, as one unit.

**Proof:** `fitText.test.ts`, `useFitText.test.tsx`, and `SlideCanvas.test.tsx`/
`SlideCanvas.sanity.test.tsx` cover the band search and the DOM wiring (shape of the
fitted value, not the specific band numbers, so retuning doesn't churn these tests). The
measurement walk is covered by a jsdom test that stubs layout so `scrollHeight` responds to
the probe — it fails if the walk is replaced with "take the largest candidate" or if the fit
comparison is inverted; a sibling test pins the module-scope band hoisting by asserting the
effect doesn't re-run when a re-render leaves the deps referentially stable (without it, the
stage display's per-second `clock` tick would re-measure every second); further tests pin
the exact `fitSizeScaled()` output for the ref/version labels and assert neither carries a
px ceiling. Full suite `npm test`
— **391/391 passing**, `npm run typecheck` clean. Real-app proof at 1920×1080
via `scratch/verify-autofit.mjs` (Electron + `playwright-core`, a genuine output window,
not jsdom): short-verse 108.0px, long-verse 91.8px, short-stanza 113.4px, long-stanza
99.9px, two-column 91.8px — all comfortably above the old 40px ceiling, short content
measurably larger than long content (the shrink path now visibly engages), and nothing
clipped in any case. (The scripture figures are a touch below the pre-label-scaling run —
97.2/94.5 — because the ref and version labels now scale with the fit and take their share
of the box. The block sizes as one unit, which is the point.)

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
