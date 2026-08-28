// Measured floors/ceilings for the labeled corpus (356 curated+filler songs).
// RULES: a task that IMPROVES a metric MUST tighten its constant in the same
// commit — that is the ratchet. No task may loosen a value unless its plan step
// explicitly authorizes it. Latency is a local-machine guard with ~1.5x headroom,
// not a CI benchmark.
export const RATCHET = {
  // Quality floors (eval.test.ts)
  unweightedP1Min: 51,                // count of rank-1 hits over QUERIES (W6 #121: partial-band idf tie-break; was 50)
  weightedP1MinPct: 97,               // intent-weighted p@1, percent (W6 #121: exact 97.62%, floored — unchanged)
  recall50MinPct: 98,                 // intent-weighted recall@50, percent (W6 #121: asbury target now inside top-50; was 97)
  // Stability ceilings (stability.test.ts)
  churnMax: 135,                      // top-1 changes across all replayed keystrokes (W6 #121: exact-gated + quantized idf; was 136)
  monotonicityMax: 18,                // target held rank 1, then a further keystroke of the labeled query demoted it (W6 #121: exact-gated + quantized idf; was 19)
  giveMeYourHandRegressionsMax: 0,    // hit→miss regressions replaying the reported bug
  // Perf ceiling (eval.test.ts latency loop)
  latencyMs3000Max: 120,              // avg ms/search at 3000 songs (P10: vocab-expansion fallback replaces the full-library scan; pinned from slowest observed run 79.49ms x 1.5, rounded up to nearest 10)
};
