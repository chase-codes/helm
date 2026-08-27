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
