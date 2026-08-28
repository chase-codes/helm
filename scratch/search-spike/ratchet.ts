// Measured floors/ceilings for the labeled corpus (356 curated+filler songs).
// RULES: a task that IMPROVES a metric MUST tighten its constant in the same
// commit — that is the ratchet. No task may loosen a value unless its plan step
// explicitly authorizes it. Latency is a local-machine guard with ~1.5x headroom,
// not a CI benchmark.
export const RATCHET = {
  // Quality floors (eval.test.ts)
  unweightedP1Min: 50,                // count of rank-1 hits over QUERIES (W8 #122: digit-group norm; was 49)
  weightedP1MinPct: 97,               // intent-weighted p@1, percent (W8 #122: digit-group norm; exact 97.02%, floored; was 94)
  recall50MinPct: 97,                 // intent-weighted recall@50, percent (exact 97.62%, floored — unchanged)
  // Stability ceilings (stability.test.ts)
  churnMax: 136,                      // top-1 changes across all replayed keystrokes (W8 #122: digit-group norm; was 137)
  monotonicityMax: 19,                // target held rank 1, then a further keystroke of the labeled query demoted it (W8 #122: digit-group norm; was 20)
  giveMeYourHandRegressionsMax: 0,    // hit→miss regressions replaying the reported bug
  // Perf ceiling (eval.test.ts latency loop)
  latencyMs3000Max: 120,              // avg ms/search at 3000 songs (P10: vocab-expansion fallback replaces the full-library scan; pinned from slowest observed run 79.49ms x 1.5, rounded up to nearest 10)
};
