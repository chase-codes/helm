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

### BUG-009 — No error boundary: any renderer exception blanks the projector mid-service · **SEV 2**
**Status:** Open · **Area:** app-wide (renderer) — worst at the audience output (`src/renderer/output/main.tsx`, `OutputApp.tsx`)

**Repro:** any uncaught exception thrown during render or in a layout/effect
callback in the output window. No deliberate repro exists today — this is a
structural gap, not a triggered defect (see *Reachability*).

**Expected:** a renderer fault degrades to something the congregation can look at —
the last good slide, a black screen, anything — and the operator is told.
**Actual:** React unmounts the whole root. The audience screen goes blank and stays
blank; there is no recovery path short of restarting the app mid-service.

**Root cause (verified):** there is no error boundary anywhere in the renderer —
`grep -rn "ErrorBoundary|componentDidCatch|getDerivedStateFromError" src/` returns
**zero hits**. `src/renderer/output/main.tsx` renders `<OutputApp />` directly into
the root with nothing between it and `createRoot`, and `OutputApp.tsx:14-24`
dispatches straight to `SlideCanvas` / `ReadingCanvas` / `VideoCanvas`. React's
default behaviour on an uncaught render error is to unmount the entire tree.

**Why it matters more here than in most apps:** the operator window failing is
recoverable — a human is sitting in front of it and can restart. The *output* window
is on a projector in front of a congregation, unattended, mid-service. The blast
radius of any renderer bug is therefore "the screen goes black and stays black,"
which is the one outcome this software exists to prevent.

**Reachability:** no known trigger today. It surfaced while reviewing the BUG-007
auto-fit work: a fix wave made `useFitText` throw on an empty candidate band, which
would have put a `throw` directly in the output window's layout-effect path. That
was reverted (`f4aba98` — the hook now fails safe and `console.error`s; only the
pure `fitFontSize` still throws). The episode is the point: one plausible-looking
"fail loud" decision in a shared renderer module is all it takes, and nothing in the
codebase would have stopped it reaching the projector.

**Fix candidates:** an error boundary around `OutputApp` that holds the last good
payload rather than unmounting; the same around the operator's mode surfaces so one
broken mode doesn't take the app down; a `window.onerror` hook reporting renderer
faults to main so the operator sees something. Worth pairing with a decision about
what the audience screen *should* show when the renderer is broken — last good
slide, or clean black.

**Notes:** Found 2026-07-29 during the BUG-007 final review. Pre-existing and
unrelated to that branch.

### BUG-010 — Typing a reference at speed silently drops its digits · **SEV 2**
**Status:** Open · **Area:** Sermon/Scripture ref builder (`SermonMode.tsx:199-215`, `refBuilder.ts:99-121`)

**Repro:**
1. Cursor is in Genesis (or any book other than the one you're about to type).
2. Type `Romans 8:28` at normal speed into the schedule entry field.
3. The field reads `Romans` — the chapter and verse digits are gone.

**Expected:** the whole reference lands. **Actual:** every digit typed before the
book's extent fetch resolves is swallowed.

**Root cause (verified):** `applyKey`'s chapter/verse cases clamp each digit as it
arrives — `clampChapter(n, extent)` with `EMPTY_EXTENT` (`{chapters: 0}`) computes
`Math.min(Math.max(n,1), 0)` = `0`, and `printable` then stores `c || null`, so the
digit is discarded. Extents are fetched per book by an effect, so any digit typed
before that IPC resolves is lost. The effect prefetches the *cued* book, which is why
this only bites when typing a reference in a different book.

**Fix candidates:** buffer digits typed against an absent extent and re-apply on
arrival, or clamp lazily at commit rather than per keystroke.

**Notes:** Found 2026-07-29 in the scripture direct-live re-review. Pre-existing;
the branch's extent prefetch mitigates but does not fix it. A test in that branch had
to type the book, await, then the digits, to work around it.

### BUG-011 — Entry field cannot be cleared with the mouse · **SEV 3**
**Status:** Open · **Area:** Sermon/Scripture ref builder (`SchedulePanel.tsx:113-120`, `SermonMode.tsx` `onEntryChange`)

**Repro:** type a partial reference, then try to clear the field without the keyboard —
select-all-and-delete, cut, or paste-empty.

**Expected:** the field clears. **Actual:** it snaps back to the previous value.

**Root cause (verified):** the input is controlled by `renderBuilder(builder)`, and
`onEntryChange` only writes state when `parseRef(v)` succeeds. `parseRef('')` returns
null, so an emptying edit is discarded. `applyKey` handles `Backspace` but not
`Delete`, so that key is inert too. Escape and Backspace are the only ways out.

**Fix candidates:** a small × in the input; or have `onEntryChange` treat an empty
string as `initialBuilder()`.

**Notes:** Found 2026-07-29 in the scripture direct-live re-review.

### BUG-012 — "Install a Bible" hint shown while bibles are installed · **SEV 3**
**Status:** Open · **Area:** Sermon/Scripture (`SermonMode.tsx` show effect + `stepVerse`, `biblesRepo.getChapter`)

**Repro:** either of —
- **(a)** With no bible installed, click a schedule row for Genesis 1:5, then press
  `Next verse ›`.
- **(b)** With bibles installed, paste `Genesis 99:1` into the entry field and press
  Shift+Enter.

**Expected:** (a) navigates normally; (b) refuses an out-of-range chapter.
**Actual:** both put the `INSTALL_HINT` slide — "Install a Bible in Settings" — on the
projector; (a) additionally collapses the cursor to verse 1.

**Root cause (verified):** `biblesRepo.getChapter` echoes `{book, chapter,
verseCount: 0, verses: {}}` for data it doesn't have rather than returning null. So
`liveChapter` is non-null, the show effect's stale-chapter guard passes, `cols` is
empty, and the install-hint fallback fires. In (a) `verseCount` is 0, so
`verseCount || 1` makes `stepVerse` clamp any cursor to verse 1. In (b) the paste path
bypasses `clampChapter` — typed digits are clamped, pasted ones are not.

**Fix candidates:** distinguish "chapter absent" from "no bible installed" at the repo
boundary; validate pasted refs against the book extent in `onEntryChange`.

**Notes:** Found 2026-07-29 in the scripture direct-live final review. Both triggers
are pre-existing; the branch made the second one reachable from the builder.

### BUG-013 — Blank-the-projector guards read renderer-mirrored state, so a stale read can still black the screen · **SEV 3**
**Status:** Open · **Area:** Sermon/Scripture (`SermonMode.tsx` `goLiveFromBuilder` guard, `cuedIsLive`) + `shared/presentation/core.ts` `goLive`

**Repro:** no deterministic repro — a race with a window of a few milliseconds.
Move the cursor (rail tap/arrow) and, within the same tick, trigger Shift+Enter or
the `● Go live` button on that same verse.

**Expected:** the verse stays on screen. **Actual:** the projector can go black.

**Root cause (verified):** `output`/`liveKey` come from `usePresentationState()`, which
mirrors main over an IPC broadcast, so it lags main by a round trip plus a React
render. The show effect sends `presentation.show(...)` fire-and-forget, so main's
`liveKey` can already equal the target key while the renderer still holds the old
value. Both blank-guards then read false and fall through to `presentation.goLive`,
whose core verb sees `output === 'live' && liveKey === key` and flips output to
`'black'`. `cuedIsLive` has the mirror-image exposure: a stale-false read leaves the
button labelled `● Go live` while main already has that key live, so a click blanks.

**Fix candidates:** make the decision authoritative in main — a non-toggling
`goLiveOrShow` verb — so the renderer never has to compare mirrored state. That also
subsumes the label/behaviour coupling the `Go live`/`Take down` button relies on.

**Notes:** Found 2026-07-29 in the scripture direct-live code review. The behavioural
half of this (a trained two-step gesture reaching the toggle) was fixed on that branch
by having the button act on its own label; this entry is the residual race.

### BUG-014 — Arrow keys and Prev/Next are silently inert during a cross-chapter fetch · **SEV 4**
**Status:** Open · **Area:** Sermon/Scripture (`SermonMode.tsx` `stepVerse`)

**Repro:** click a schedule row for a different book, then immediately press
`Next verse ›` or the right arrow.

**Expected:** the cursor advances, or the control visibly can't be used.
**Actual:** the keystroke is silently dropped.

**Root cause (verified):** `stepVerse` returns early while `liveChapter` is null. That
guard is correct — it prevents `verseCount` falling back to 1 and collapsing the cursor
to verse 1 — but it gives no feedback, and the code comment's mitigation ("the operator
can press again") assumes the operator notices.

**Fix candidates:** queue the pending step and apply it when the chapter resolves, or
disable the Prev/Next buttons while `liveChapter` is null so the state is visible.

**Notes:** Found 2026-07-29 in the scripture direct-live code review. Window is one
local SQLite read.

### BUG-015 — A second shift-tap grows the range instead of pivoting · **SEV 4**
**Status:** Open · **Area:** Sermon/Scripture (`shared/scripture/selection.ts` `railSelect`)

**Repro:** cursor at verse 5. Shift-tap verse 2 (range reads `2-5`). Shift-tap verse 9.

**Expected (conventional shift-click):** `5-9` — the anchor stays put and the range
pivots. **Actual:** `2-9` — the range grows.

**Root cause (verified):** an ordered range stores `min` as `startVerse`, and
`railSelect` now prefers `builder.startVerse` as the anchor (correctly — that fix stopped
a typed start verse being discarded). So after a backwards shift-tap the stored start is
the *lower* verse, and the next shift-tap anchors there rather than at the original
cursor. A true pivot needs the anchor tracked separately from the ordered range.

**Notes:** Found 2026-07-29 in the re-review of the scripture direct-live code-review
fixes. A direct consequence of the "prefer the typed start verse" rule and arguably more
consistent with the rail's own highlight — but it is a behaviour change nobody pinned,
and no test covers a second consecutive shift-tap.

### BUG-016 — A large song import freezes live output control · **SEV 3**
**Status:** Open · **Area:** Song import (`songImport.ts` commit loop, `songsRepo.add`)

**Repro:**
1. Import an EasyWorship library of a few thousand songs (Songs → Import a song library).
2. While the import runs, try to cue, go live, blank the screen, or control video.

**Expected:** the operator keeps control of the projector throughout.
**Actual:** every presentation IPC (`presCue`, `presGoLive`, `presSetOutput`, video control)
is unserviced until the import finishes.

**Root cause (verified by review, not yet measured):** `commit` (`songImport.ts:103`) is a
fully synchronous loop, and each `repo.add` opens its own `db.transaction` — therefore its own
fsync — per song. The whole run occupies the main process's single thread, so nothing else is
serviced. Progress events are emitted but the renderer cannot paint them either.

**Fix candidates:** chunk the inserts into batched transactions and/or yield between chunks.
⚠️ **Do not collapse the import into one transaction** — that is the obvious fix and it breaks
a load-bearing property: one bad song must never abort a library migration
(`songImport.ts:115-118`). Any batching has to preserve per-song failure isolation, or a
single unparseable lyric rolls back the entire migration.

**Notes:** Found 2026-07-31 in the code review of the song-import branch. Severity assumes an
import is not run mid-service; it is SEV 2 if it ever is. No measurement yet of where the
freeze becomes noticeable — worth timing against the real library during the Windows session.

### BUG-017 — The import review list is unvirtualized · **SEV 4**
**Status:** Open · **Area:** Song import (`SongImport.tsx` review step)

**Repro:** import a library of a few thousand songs and look at the review step.

**Expected:** the list scrolls smoothly. **Actual:** one flex row per scanned song is mounted
at once — a 2000–4000 node list inside a modal.

**Root cause (verified):** `step.rows.map(...)` (`SongImport.tsx:186`) renders every row with
no windowing. Migrating an entire library is the feature's purpose, so the large list is the
expected case rather than the edge case.

**Notes:** Found 2026-07-31 in the same review. `SongSearchRail`'s no-query path has the same
shape (`SongsMode.tsx:176`) — pre-existing, but this feature makes a very large `library`
reachable for the first time, so the two are worth solving together.

---

### BUG-018 — A single click on a pre-service card projects it with no chance to edit first · **SEV 3**
**Status:** Open · **Area:** Pre-service (`PreServiceMode.tsx:271`, `preserviceEngine.ts` `showCard`)

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

**Root cause (verified by reading, not measured):** the row's only handler is
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

**Fix is a design decision, not an obvious patch — needs a brainstorm.** The options are not
equivalent: making a row click select-only is the safest and reuses **Show this card** as the
sole takeover, but it contradicts the documented behaviour and costs a click during the loop,
which is when the operator most wants speed. A double-click-to-show, or show-on-click only
while the loop is *engaged*, are both plausible middle grounds. See the roadmap's Pre-service
section.

**Notes:** Reported 2026-08-04 from live use. Worth checking whether the same "big target is
the live action" shape exists elsewhere — `SongsMode`'s section rail and the sermon list are
the obvious places to look.

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
