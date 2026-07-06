# BUG-002 fix — deterministic relevance tie-breaker for song search (A1)

**Date:** 2026-07-06 · **Bug:** BUG-002 (SEV 1) · **Scope:** `src/shared/search/songScore.ts` only

## Problem (measured)

`rankSongs` sorts by `score` alone. The scorer collapses many distinct matches to
identical scores (flat buckets: `360` snippet floor, `380+12·matched`). When rank-1
ties rank-2, `Array.sort` stability makes the winner **insertion order**, not relevance.
Harness proof: same ranker, targets inserted last instead of first → intent-weighted
p@1 **91% → 83%**; `10000`, `amazin grace`, `faithfullness`, `grace amazing` flip from
rank 1. In production `list()` orders by `created_at, title`, so an operator's
later-pasted songs *lose* these ties — `Enter`-takes-top is untrustworthy on exactly
the typo/reorder/inflection queries the fuzzy path exists to serve.

## Goal / acceptance bar

**Order-independence.** After the fix, harness p@1 with targets inserted *last* must
equal p@1 with targets inserted *first* — insertion order no longer decides the winner.
The four flips must be gone. Precision@1 is the workflow metric.

Genuinely-ambiguous queries where no title signal separates the target from a filler
(`faithfullness`: target and fillers all carry exactly one title word "Faithfulness" at
edit-distance 1) may not land the target at #1. That residue is the **documented trigger
for A2** (spread the score buckets), out of scope here.

## Approach — A1: deterministic relevance tie-breaker (no score change)

Keep the primary `score` buckets untouched (cheap, safe, preserves the clean cases that
already measure 100%). `scoreSong` returns a few relevance sub-signals alongside `score`;
`rankSongs` compares them **lexicographically after `score`**, before any insertion-order
fallback. The tie-breaker only ever activates on equal `score`, so non-tied ordering is
unchanged.

Sub-signals returned per song (all derived from the *title* and query, no external state):

| # | Signal | Direction | Fixes / why |
|---|--------|-----------|-------------|
| 1 | **title-token coverage** — # query tokens fuzzy-matching a title word | higher | `grace amazing` (target has both tokens in title; fillers have "grace" only in lyric), `amazin grace`, `kings king of` |
| 2 | **title-match closeness** — total edit distance of those title matches | lower | exact title words beat fuzzy ones |
| 3 | **overall coverage** — # query tokens matched anywhere in the blob | higher | cross-bucket safety |
| 4 | **title-starts-with-query** | true first | audible-partial / prefix intents |
| 5 | **title length** | shorter | a tight "Amazing Grace" beats a padded "Amazing of Grace" |
| 6 | **title string compare** | lexicographic | fully deterministic, content-based final fallback so insertion order never decides between two distinct titles → guarantees order-independence |

`fuzzy.ts` is **not** touched — protecting the shared message + scripture search paths,
per the kickoff constraint.

## Testing

- **Permanent guard** — `src/shared/search/songScore.test.ts` (runs under `npm test`):
  unit tests asserting the tie-breaker orders known plateaus by relevance and is
  order-independent (same result when the tied songs are supplied in reverse array order).
- **Metric / proof** — the spike harness (`scratch/search-spike/`), extended so its guard
  is meaningful for a pure tie-breaker:
  - assert **inserted-first p@1 === inserted-last p@1** (the order-independence guard),
  - redefine the reported "unresolved rank-1 tie" as *rank-1 and rank-2 identical on every
    signal* (should drop toward 0), since raw `score` equality no longer implies a coin flip.
  - Run before/after: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`

## Non-goals

Diacritics (BUG-003), the ≥30 fallback (BUG-004), stemming (BUG-005), latency (BUG-006),
and A2 score-spreading — all separate.
