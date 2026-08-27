// Measured floors/ceilings for the labeled corpus (356 curated+filler songs).
// RULES: a task that IMPROVES a metric MUST tighten its constant in the same
// commit — that is the ratchet. No task may loosen a value unless its plan step
// explicitly authorizes it. Latency is a local-machine guard with ~1.5x headroom,
// not a CI benchmark.
export const RATCHET = {
  // Quality floors (eval.test.ts)
  unweightedP1Min: 44,              // count of rank-1 hits over QUERIES
  weightedP1MinPct: 84,             // intent-weighted p@1, percent
  recall50MinPct: 97,               // intent-weighted recall@50, percent
  // Stability ceilings (stability.test.ts)
  churnMax: 164,                    // top-1 changes across all replayed keystrokes
  monotonicityMax: 28,              // target held rank 1, then a further keystroke of the labeled query demoted it
  giveMeYourHandRegressionsMax: 2,  // hit→miss regressions replaying the reported bug
  // Perf ceiling (eval.test.ts latency loop)
  latencyMs3000Max: 410,            // avg ms/search at 3000 songs (pinned from the slowest observed run)
};
