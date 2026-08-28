// Measured floors/ceilings for the labeled corpus (356 curated+filler songs).
// RULES: a task that IMPROVES a metric MUST tighten its constant in the same
// commit — that is the ratchet. No task may loosen a value unless its plan step
// explicitly authorizes it. Latency is a local-machine guard with ~1.5x headroom,
// not a CI benchmark.
export const RATCHET = {
  // Quality floors (eval.test.ts)
  unweightedP1Min: 48,              // count of rank-1 hits over QUERIES
  weightedP1MinPct: 92,             // intent-weighted p@1, percent (exact 92.86%, floored)
  recall50MinPct: 97,               // intent-weighted recall@50, percent
  // Stability ceilings (stability.test.ts)
  churnMax: 143,                    // top-1 changes across all replayed keystrokes
  monotonicityMax: 20,              // target held rank 1, then a further keystroke of the labeled query demoted it
  giveMeYourHandRegressionsMax: 0,  // hit→miss regressions replaying the reported bug
  // Perf ceiling (eval.test.ts latency loop)
  latencyMs3000Max: 200,            // avg ms/search at 3000 songs (P5: banded early-exit levenshtein; pinned from slowest observed run 131.41ms x 1.5, rounded up to nearest 10)
};
