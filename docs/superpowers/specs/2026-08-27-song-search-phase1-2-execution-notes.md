# Song Search Plan — Phases 1–2 Execution Notes (2026-08-27)

Record of the SDD execution of Phases 1–2 of `docs/superpowers/plans/2026-08-27-song-search-improvements.md`. Both phases merged: PR #118 (`song-search-harness`) then PR #119 (`song-search-accuracy`), main @ `e545a1c`. Phases 3–4 (Tasks 10–19) remain; a future executor should honor the rulings below — they are decisions the plan's text either predicted wrongly or could not know.

## Measured results (53 labeled queries, seeded harness)

| Metric | Task 4 baseline | Post-Phase 2 | Ratchet (scratch/search-spike/ratchet.ts) |
|---|---|---|---|
| weighted p@1 | 85% (84.52 exact) | 93% (92.86 exact) | ≥ 92 |
| p@3 (weighted) | 92% | 96% | — |
| MRR | 0.88 | 0.94 | — |
| unweighted p@1 | 44/53 | 48/53 | ≥ 48 |
| recall@50 | 98% (97.62 exact) | unchanged | ≥ 97 |
| top-1 churn (774 keystrokes) | 164 | 158 | ≤ 158 |
| monotonicity violations | 28 | 25 | ≤ 25 |
| "give me your hand" regressions | 2 | 1 | ≤ 1 |
| latency 200/1000/3000 songs | 45.6 / 155.2 / 264.9 ms | 41.2 / 139.9 / 218.9 ms | ≤ 410 @ 3000 (local-machine guard) |

Per-fix: W1 fixed `praise recukless` 25→1, `holy reckelss` 17→1. W3 fixed `art`/`son` and the word-interior title false-positive class in `all` mode. W5 delivered the churn/monotonicity gains. W7/W9 are correctness guards (metrics intentionally unchanged).

## Rulings (binding context for Phases 3–4)

1. **`senor` (lyric) stays rank 2 — this is NOT an unfixed W5.** Reviewer-confirmed: both curated Spanish songs (`renuevame`, `sublime-gracia`) contain an exact `senor` after `norm()`, so W5's `dist` ties at 0 by design; the decider is a pre-existing tf/occurrence-count gap (`renuevame` has 2 occurrences vs 1). The spec's W5 example misattributed this miss. PR #119's body was corrected to the measured truth. Do not "fix" senor via dist changes in later phases.
2. **`10000` sits at rank 3** (plan predicted 2): rank 1 is `1000 Tongues` (the intended W8 competitor); rank 2 is the Task 2 filler `Sing Redeemer 100` whose dedup-suffix token `100` fuzz-matches `10000` (lev 2 ≤ tol 2). Accepted as corpus drift from the sanctioned realism change; the W8-documenting substance holds.
3. **`well` was never a p@1 miss** on the realistic corpus — the plan's Task 6 "leaves the miss list" narration was inaccurate; the exact band-value pins (1000 / 994) carry the intent instead.
4. **`asbury worship` is ABSENT** (not rank 2–3 as the spec estimated) — still the labeled W6 expected miss; no assertion binds its rank.
5. **Latency ceiling re-pinned 400 → 410** during the Phase 1 fix wave, per the plan's own ×1.5-round-up rule applied to the slowest observed run (~272 ms). Latency is a local-machine guard, observed 188–272 ms at 3000 songs depending on load.
6. **eval.test.ts quality floors use `expect.soft`** so a quality regression still prints the p@1-miss localization, probes, and latency diagnostics before failing. The latency assertion and stability.test.ts assertions are hard.
7. **W5 `dist` placement**: after `titleCloseness`, before `phrase` — the Task 7 decision gate (move after `coverage`) did not fire. Final comparator order: `score, titleCoverage, covWeight, titleCloseness, dist, phrase, coverage, rel, tf, titleStartsWith, titleLen, title`.

## Parked minors (non-blocking; where they get fixed)

- `songScore.test.ts` comment "` well` at index 6" is off by one in prose (indexOf returns 5; the math `1000-6` is right). Plan-seeded wording — fold into any Phase 3 commit touching the file.
- No dedicated `title`-field W3 assertion (coverage is transitive through the shared band code today). Add one alongside Task 17's `SongDoc` work, where the shared-path argument stops holding automatically.
- `eval.test.ts`'s `'Standing Firm'` guard is keyed on the literal title and would go silently vacuous if the corpus entry were renamed.
- `stability.test.ts` churn counts non-null→null top-1 transitions but not recoveries, and trailing-space keystrokes count as steps — deterministic and negligible; kept as-is so churn/monotonicity ratchets stay comparable across phases.

## Process notes

- The monotonicity metric replays labeled queries verbatim (misspellings included), so it counts demotion by *any* further keystroke of the labeled query — slightly broader than W4's "correct added character" definition. Comments were reworded to match; Phase 3's W4 work should measure against what the code counts.
- The measurement corpus is 356 songs (56 curated + 300 filler). Metrics are deterministic run-to-run (seeded PRNG); only latency varies.
- The working SDD ledger (full per-task history) lives at `.superpowers/sdd/2026-08-27-song-search-improvements/progress.md` (git-ignored); resume Phases 3–4 by extending it. This document is the durable extract.

---

## Phase 3 addendum (2026-08-27, branch `song-search-stopword-fuzz`)

Tasks 10–14. Measured end state (356-song corpus, 53 labeled queries): weighted p@1 93% / p@3 96% / recall@50 98% / MRR 0.94; unweighted 48/53; churn **143** (was 158); monotonicity **20** (was 25); `"give me your hand"` hit→miss regressions **0** (was 1); latency ~208–239 ms @3000 (ceiling 330). Full repo suite 1394/1394.

Rulings (owner-approved where marked):

1. **Task 12's literal solid rule was amended (OWNER).** The plan's `w.length >= t.length` breaks quality floors: an insertion typo (`recukless` 9 → `reckless` 8) maps token→shorter word, geometrically identical to `hand`→`and`; measured p@1 48→47, weighted 91.07 < 92, recall 95.83 < 97. Shipped rule: solid = `w.length >= t.length || (w.length >= 5 && d <= 1)`. All pins hold; metrics identical to baseline.
2. **Task 13 (pairTol) REVERTED** per its own Step 5 gate: pairTol clamps digit-token admission — `10000` vs tokenized `000` needs d=2 but pairTol = matchTol(3) = 1, so the labeled `10000` query dropped from rank-3 hit to unmatched (recall 95.24 < 97). Stability had improved (churn 142, mono 20) but not at a quality floor's expense. The W4 matchTol-step noise remains (churn/mono ratchets still guard it); any numeric-token special-case is new design, not attempted.
3. **Task 14's GMYH=0 gate required one extra owner-approved fix**: after Tasks 10–12 the last regression was no longer a band collapse but a tie-break loss at `give me your ha` — `titleCoverage` credited `your`→`you` (fuzz into a shorter title word). Fix: title tie-break credit requires the same solid rule (`bestSolidMatch`, single shared `isSolidMatch` predicate). GMYH 1→0, churn 144→143, mono 21→20.
4. Task 10 folded the parked `' well' at index 6` comment fix; the plan's expectation that Task 11 alone would drop GMYH did not reproduce (documented in ledger; mechanism moved, count held at 1 until ruling 3).

Ratchet after Phase 3: `unweightedP1Min=48, weightedP1MinPct=92, recall50MinPct=97, churnMax=143, monotonicityMax=20, giveMeYourHandRegressionsMax=0, latencyMs3000Max=330` (330 pinned in Task 10 from 217.63×1.5).

## Phase 4 addendum (2026-08-27, branch `song-search-perf`, stacked on Phase 3)

Tasks 15–19. Measured end state: quality/stability unchanged-or-better vs Phase 3 (unweighted p@1 **49**/53 — `faithfullness` now hits via vocab expansion; weighted 95%; recall@50 98%; churn **137**; monotonicity 20; GMYH 0). Latency (avg ms/search, labeled set): **20.0 / 66.3 / 78.4** at 200/1000/3000 songs vs the 41.2/139.9/218.9 post-Phase-2 baseline (~2.1–2.8x per search), before counting the 120 ms debounce (only 2–4 of ~13 keystrokes reach the main process) and the Title-mode hint gate (~12x off the common Title-mode case). Full repo suite 1405/1405.

Rulings:

1. **Task 19's expansion compares normalized vocab terms (OWNER).** The brief's literal code compared raw fts5 vocab terms against `norm()`-ed query tokens; unicode61 leaves `ß` unfolded, so `großer` measured 3 edits from `gros` (not 1) and "Großer Gott" fell out of its own expansion tier (measured monotonicity break). Shipped: `getVocab()` caches `{raw, norm}` pairs — distance on `norm`, FTS re-query on `raw`. The brief's named contingency (full-scan restore) was inapplicable (expansion non-empty, just wrong).
2. **The fallback retirement is broader than the ≥30 gate**: the old sparse-hits (<30) full-scan is gone too — candidates are always FTS+expansion except all-digit-no-hit tokens. Plan-authorized; measured better; noted because a stored-typo song whose query token FTS-hits elsewhere is a newly unreachable edge class.
3. Latency ratchet was corrected 260→270 mid-phase (formula uses the slowest observed run), then tightened 270→200 (Task 18) →**120** (Task 19, slowest 79.49×1.5→120).
4. Final-review minors parked: serial hint fetch (one-round-trip-later hint, plan-designed), songCache direct-SQL test-authoring hazard (documented in code), libraryOrder UTF-16-vs-BINARY (unreachable for realistic titles).

Ratchet after Phase 4: `unweightedP1Min=49, weightedP1MinPct=94, recall50MinPct=97, churnMax=137, monotonicityMax=20, giveMeYourHandRegressionsMax=0, latencyMs3000Max=120`.

## Phase 5 addendum (2026-08-27, branch `song-search-followups`, stacked on Phase 4)

Tasks 1–6, closing #121 (author-recall idf tie-break) and #122 (digit-group `norm()`); #123 (blind-tail fuzzy ties) got an evidence pass, not code. Measured end state: unweighted p@1 **51**/53 (was 49); weighted p@1 **97.62%** (was 94.64%); recall@50 **98.21%** (was 97.62%); churn **135** (was 137); monotonicity **18** (was 20); GMYH regressions **0** (unchanged); latency ~80ms @3000 (guard 120, unchanged). Per-fix: `10000` rank 3→1 (W8, #122); `asbury worship` ABSENT→1 (W6, #121). Full repo suite 1410/1410.

Rulings:

1. **Plain `authorCoverage` was investigated pre-plan and rejected**, with the measured counter-case: `King of Kings` / Hillsong Worship earns the same exact author-word hit on the common token `worship` and outranks the target on `covWeight` — rarity, not field identity, is the distinguishing signal. `idfWeight` is consulted only inside the 360 partial band and is provably neutral in full-match bands (Task 5's Step 3: all 96 sampled full-band candidates score exactly 392, where the idf branch — gated on `a.score === 360` — is architecturally unreachable).
2. **The plan's `idfWeight = Σ ln((n+1)/(df+1))` was amended mid-execution TWICE, both controller-ruled**: (a) Σ → MAX over matched tokens — the sum degenerates to matched-token count when all df tie, breaking the pinned `covWeight` test; (b) MAX further refined to exact-gated + quantized — only exact whole-word matches (`bestDist === 0`) contribute to idfWeight, and the 360-band comparison uses `Math.round(idfWeight)` — after the raw (MAX) signal measured churn 139 (>136 ceiling) / monotonicity 20 (>19 ceiling): transient df=1 prefix/fuzzy hits on the operator's half-typed last token were vaulting arbitrary candidates to top-1 for a keystroke or two (full mechanism + variant table: `churn-diagnosis.md`; a gap-threshold (`|Δ|>ln2`) alternative was rejected as intransitive — it can make `.sort()` output depend on candidate array order, the same class of bug the eval GUARD's order-independence check exists to catch). Final form measures churn **135** / monotonicity **18** — better than the pre-W6 baseline (136/19) on both.
3. **`norm()` joins digit-group COMMAS only** (`/(?<=\d),(?=\d)/`) — comma-space list forms unaffected. The all-digit full-scan exemption remains REQUIRED: FTS still indexes raw `10,000` as two tokens `10`/`000`, so a `10000` query has zero FTS hits and only the full scan reaches the song — the `songsRepo` pin stays. Final-review pass surfaced a latent cross-feature gap in the same family: verse search has no full-scan fallback, so a hypothetical translation that writes numerals as "144,000" would index as `144`/`000` while the query normalizes to `144000` — unreachable by number at the FTS gate, since `expandToken` can't bridge 3 edits; `highlight.ts`'s word regex similarly splits digit-comma runs. The bundled KJV spells numbers out (verified in review), so nothing reachable today is affected — recorded so a future numeral-using translation doesn't rediscover it.
4. **W10 verdict (Task 5, #123 evidence pass)**: "No constructed probe satisfies (a) + (b) + (c). Eight single-token typos — the four named in the brief (`gace`, `prase`, `worshp`, `glry`) plus four more chosen against real curated-corpus words (`godnes`, `strem`, `wrshp`, `mecry`), including one case (`strem`) where two genuinely different, real curated songs tie at the same fuzzy distance — were run against `repo.search` at both 356 and 3056 songs. Every candidate lands the 392 full-match band, where `compareRelevance`'s idfWeight branch (`a.score === 360`) is architecturally unreachable — confirmed by asserting `score === 392` on all 96 sampled rows, not just the labeled query. Where a genuine rival term family existed in the candidate set (`gace`, `godnes`, `strem`, `wrshp`), the intended song won rank 1 in every case, and by replaying `compareRelevance`'s exact comparison order the deciding signal was always a legitimate one — `rel`/bm25 (fed by the Phase 4 expansion re-query, real and monotonic even for hyper-common corpus words down to the 6th decimal place) or `titleCoverage` — never `titleLen`/`title`. The one case where the intended target dropped out of the results (`mecry`) is explained by a different, legitimate, and already-shipped mechanism (title-match preferred over lyric-only match), not by W10's blind-tail mechanism. Recommendation: close #123 without code — the Phase 4 expansion re-query already feeds bm25/tf into these ties, and the shipped IDF signal (W6) is scoped away from them on purpose."
5. **The harness's ABSENT diagnosis label "target was a candidate but scorer scored it 0" is stale** — it also fires for past-the-50-cap targets. That was `asbury worship`'s actual pre-fix mechanism: score 360, ranked outside the top-50 behind roughly 240 `worship` matchers — not a score of 0. Parked, not fixed here.

Ratchet after Phase 5: `unweightedP1Min=51, weightedP1MinPct=97, recall50MinPct=98, churnMax=135, monotonicityMax=18, giveMeYourHandRegressionsMax=0, latencyMs3000Max=120`.

## Phase 6 addendum (2026-08-28, branch `fix/search-stemming`)

Closes #14 (no stemming: a bare inflected token misses the base form). `praising`↔`praise` is edit distance 3 against a `matchTol` ceiling of 2, and the anchored-prefix tier only fires when the CORPUS word is the longer one, so neither direction matched; the three `inflected-form` harness queries all passed only because a second, clean token rescued them. Measured end state on the 54-query set (one bare query added, see ruling 4): unweighted p@1 **52**/54 (51 before the fix on the same set); weighted p@1 ~97.65% (floor 97 unchanged); recall@50 ~98.2% (unchanged); churn **136** (138 before the fix on the same set); monotonicity **18** (19 before); GMYH **0**; latency ~81ms @3000 (guard 120). Full repo suite green; the bible ranking gold, `passages.test.ts`, `highlight.test.ts` and every band pin pass untouched.

Rulings:

1. **Stemming lives in `matchDist`, not `norm()` and not the FTS tokenizer.** `norm()` is the write side of the FTS index: folding suffixes there would bump `NORM_VERSION` (reindex on every install), rewrite the title-substring bands (`title === q` → 1200 compares folded strings), and reach scripture book/reference parsing (`books.ts`, `refs.ts`, `refBuilder.ts` — Kings→king, Judges→judg). A `porter` FTS tokenizer would stem the retrieval gate while leaving the scorer blind, which is exactly the gate/scorer disagreement #169 just removed. `matchDist` is the one function every consumer routes through — `textSignals`, `bestMatch`, `bestSolidMatch`, `highlight.isHit`, and both repos' `expandToken` — so a stem tier there opens retrieval AND scoring in one place, and bolding still agrees with scoring.
2. **The stem tier is a light fold, not Porter, and reports distance 1.** `stem()` strips one of `-ies`(→y)/`-ing`/`-ed`/`-es`/`-s` from a word of 5+ letters leaving 3+; `stemsPair` accepts equal stems, or stems differing only by the dropped `-e` (`prais`/`praise`) or the doubled consonant (`runn`/`run`) — spelled out as pairing rules so `stem` never collapses `blessing`→`bles`. Digit tokens never fold. It sits after exact and prefix and before the banded Levenshtein. The distance is the prefix tier's **1**, on purpose: never 0, because the 360-band idf tie-break is exact-gated (ruling 2 of Phase 5) and a stem hit must not feed it; and ≤ every `matchTol`, so `isSolidMatch` opens the partial band for it as for a prefix. Over-match risk is symmetric with the existing prefix tier (`even`→`evening` already matched at 1; the tier adds the reverse direction and the dropped-`e` forms).
3. **A stem-only match opens the full-match band but earns no per-token credit** (`textSignals.stemRescued`, consumed in `songScore`: `380 + (matched − stemRescued) × 12`). First cut without this: `praising my saviour` fell from rank 1 to rank 25 — every filler song saying "praise … saviour" joined the 416 band and `compareRelevance` (titleCoverage first) handed it to whichever had "saviour" in its title. With it the song that SAYS "praising" scores 416 and the base-form filler 404, and the labeled query is back at rank 1. Same shape as W2's trailing-token exemption.
4. **The bare `praising` query the issue names is not a stem case in this harness** — the corpus's Blessed Assurance literally contains "Praising", so it is an exact hit. The added labeled query is `traded` → *Trading My Sorrows*: no FTS prefix hit, `trading` is 3 edits away, and only the stem tier bridges it (ABSENT → rank 1). The in-repo `songSearchRanking.test.ts` pins the seed-lyric case (`praises` reaches Blessed Assurance at all) and the `songScore.test.ts` pin holds the 416/404 ordering.
5. **Known limit, recorded not fixed:** a token with a prefix hit of its own is never vocabulary-expanded (`songsRepo.search`, `biblesRepo.expandToken:85`), so `praise` cannot reach a song whose only form is `praising` when any other song says `praise`. That is retrieval-gate design (expansion is for no-hit tokens) and predates #14; changing it means expanding hit tokens too, which is a perf/churn decision of its own.
6. **`churnMax` was re-based, not loosened.** The ceiling is a raw count over the replayed query set; adding `traded` adds six replayed keystrokes. On the 54-query set churn measured 138 before the stem tier and 136 after, so 136 is the tighter ceiling on the new basis. `unweightedP1Min` tightened 51→52.

Ratchet after Phase 6: `unweightedP1Min=52, weightedP1MinPct=97, recall50MinPct=98, churnMax=136, monotonicityMax=18, giveMeYourHandRegressionsMax=0, latencyMs3000Max=120`.
