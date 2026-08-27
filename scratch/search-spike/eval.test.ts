/* eslint-disable no-console */
// Spike measurement harness. Drives the REAL pipeline: createSongsRepo over the
// same FTS5 tokenizer the app uses (node:sqlite bundles it). Prints a report; the
// single assertion just keeps vitest green. Run:
//   npx vitest run -c scratch/search-spike/vitest.config.ts
import { test, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { openTestDb } from '../../src/main/testDb';
import { createSongsRepo, type SongsRepo } from '../../src/main/songsRepo';
import { norm } from '../../src/shared/search/fuzzy';
import { scoreSong } from '../../src/shared/search/songScore';
import { buildCorpus, type CorpusSong } from './corpus';
import { QUERIES, INTENT_WEIGHT, type Intent, type LabeledQuery } from './queries';
import { RATCHET } from './ratchet';

interface Built { repo: SongsRepo; db: Database.Database; keyToRowid: Map<string, number>; keyToId: Map<string, string>; }

function build(corpus: CorpusSong[]): Built {
  const db = openTestDb();
  const repo = createSongsRepo(db);
  const keyToId = new Map<string, string>();
  for (const s of corpus) {
    const song = repo.add({ title: s.title, author: s.author, text: s.text, source: 'seed' });
    keyToId.set(s.key, song.id);
  }
  const keyToRowid = new Map<string, number>();
  for (const [key, id] of keyToId) {
    const r = db.prepare('SELECT rowid FROM songs WHERE id = ?').get(id) as { rowid: number };
    keyToRowid.set(key, r.rowid);
  }
  return { repo, db, keyToRowid, keyToId };
}

// Replicate the repo's REAL candidate-path decision (songsRepo.search) to localize
// failures: the FTS set is used only when hits >= 30 AND every token has at least
// one prefix hit of its own (#13). Anything else full-scans, so the fuzzy scorer
// DOES see the whole library in those cases.
function ftsProbe(db: Database.Database, q: string): { hitRowids: Set<number>; count: number; fallback: boolean } {
  const tokens = norm(q).split(' ').filter(Boolean);
  if (!tokens.length) return { hitRowids: new Set(), count: 0, fallback: true };
  const match = tokens.map((t) => `"${t}"*`).join(' OR ');
  const rowids = (db.prepare('SELECT rowid FROM song_fts WHERE song_fts MATCH ?').all(match) as { rowid: number }[]).map((r) => r.rowid);
  const tokenHasHit = (t: string): boolean =>
    db.prepare('SELECT 1 FROM song_fts WHERE song_fts MATCH ? LIMIT 1').get(`"${t}"*`) !== undefined;
  const fallback = !(rowids.length >= 30 && tokens.every(tokenHasHit));
  return { hitRowids: new Set(rowids), count: rowids.length, fallback };
}

interface Eval { query: LabeledQuery; rank: number; top1: string; targetScore: number; ftsHit: boolean; ftsCount: number; fallback: boolean; }

function evalQuery(b: Built, query: LabeledQuery): Eval {
  const targetId = b.keyToId.get(query.target)!;
  const targetRowid = b.keyToRowid.get(query.target)!;
  const results = b.repo.search(query.q, query.field);
  const idx = results.findIndex((r) => r.song.id === targetId);
  const rank = idx < 0 ? -1 : idx + 1;
  const top1 = results[0]?.song.title ?? '(none)';
  const targetScore = idx < 0 ? 0 : results[idx].score;
  const fp = ftsProbe(b.db, query.q);
  return { query, rank, top1, targetScore, ftsHit: fp.hitRowids.has(targetRowid), ftsCount: fp.count, fallback: fp.fallback };
}

function pct(n: number, d: number): string { return d ? `${((100 * n) / d).toFixed(0)}%` : 'n/a'; }

test('song search spike — measured evaluation', () => {
  const corpus = buildCorpus(300); // ~346 songs total
  const b = build(corpus);
  console.log(`\n=== CORPUS: ${corpus.length} songs (${QUERIES.length} labeled queries) ===`);

  const evals = QUERIES.map((q) => evalQuery(b, q));

  // ---- Per-intent metrics ----
  const intents = [...new Set(QUERIES.map((q) => q.intent))] as Intent[];
  const hitAt = (e: Eval, k: number): boolean => e.rank >= 1 && e.rank <= k;
  console.log('\n=== METRICS BY INTENT (unweighted) ===');
  console.log('intent'.padEnd(24), 'n'.padStart(3), 'p@1'.padStart(6), 'p@3'.padStart(6), 'recall@50'.padStart(10), 'MRR'.padStart(6));
  let wSum = 0, wP1 = 0, wP3 = 0, wRec = 0, wMrr = 0;
  for (const it of intents) {
    const es = evals.filter((e) => e.query.intent === it);
    const p1 = es.filter((e) => hitAt(e, 1)).length;
    const p3 = es.filter((e) => hitAt(e, 3)).length;
    const rec = es.filter((e) => e.rank >= 1).length;
    const mrr = es.reduce((s, e) => s + (e.rank >= 1 ? 1 / e.rank : 0), 0);
    console.log(it.padEnd(24), String(es.length).padStart(3), pct(p1, es.length).padStart(6), pct(p3, es.length).padStart(6), pct(rec, es.length).padStart(10), (mrr / es.length).toFixed(2).padStart(6));
    const w = INTENT_WEIGHT[it];
    wSum += w * es.length; wP1 += w * p1; wP3 += w * p3; wRec += w * rec; wMrr += w * mrr;
  }
  console.log('\n=== INTENT-WEIGHTED OVERALL (weights favor live-service frequency/criticality) ===');
  console.log(`weighted p@1=${pct(wP1, wSum)}  p@3=${pct(wP3, wSum)}  recall@50=${pct(wRec, wSum)}  MRR=${(wMrr / wSum).toFixed(2)}`);
  const uHit1 = evals.filter((e) => hitAt(e, 1)).length;
  console.log(`unweighted p@1=${pct(uHit1, evals.length)}  (${uHit1}/${evals.length})`);

  // ---- RATCHET: quality floors — tighten in ratchet.ts whenever a fix improves them ----
  expect(uHit1).toBeGreaterThanOrEqual(RATCHET.unweightedP1Min);
  expect((100 * wP1) / wSum).toBeGreaterThanOrEqual(RATCHET.weightedP1MinPct);
  expect((100 * wRec) / wSum).toBeGreaterThanOrEqual(RATCHET.recall50MinPct);

  // ---- Failures (rank != 1), with localization ----
  console.log('\n=== NOTABLE OUTCOMES: p@1 misses (rank>1 or absent) ===');
  console.log('these are the queries where Enter would NOT cue the expected song\n');
  for (const e of evals.filter((x) => x.rank !== 1)) {
    const loc = e.rank < 0
      ? (!e.ftsHit && !e.fallback ? 'ABSENT — FTS returned >=30 prefix hits, target not among them, fallback NOT triggered (scorer never saw it)'
        : !e.ftsHit ? 'ABSENT — FTS missed target but full-scan fallback ran; in-memory scorer scored it 0'
        : 'ABSENT — target was a candidate but scorer scored it 0')
      : `rank ${e.rank} (top1="${e.top1}")`;
    console.log(`[${e.query.intent}] "${e.query.q}" (${e.query.field}) → ${loc}`);
    if (e.query.note) console.log(`      note: ${e.query.note}`);
    console.log(`      target score=${e.targetScore}  ftsHit=${e.ftsHit}  ftsCount=${e.ftsCount}  fallback=${e.fallback}`);
  }

  // ---- Full ranked output for a few emblematic cases ----
  console.log('\n=== SAMPLE RANKED OUTPUT (top 5) FOR KEY CASES ===');
  for (const q of ['how great is our god', 'grace amazing', 'praising my saviour', 'cuan grande', 'faithfullness']) {
    const lq = QUERIES.find((x) => x.q === q)!;
    const rs = b.repo.search(lq.q, lq.field).slice(0, 5);
    console.log(`\nquery "${q}" (${lq.field}), expect key=${lq.target}:`);
    rs.forEach((r, i) => console.log(`  ${i + 1}. [${r.score}] ${r.song.title}${r.snippet ? `  «${r.snippet}»` : ''}`));
    if (!rs.length) console.log('  (no results)');
  }

  // ---- Targeted mechanic probes ----
  console.log('\n=== PROBE: diacritic folding — is the failure FTS-side or scorer-side? ===');
  for (const e of evals.filter((x) => x.query.intent === 'accented-text')) {
    console.log(`"${e.query.q}" → rank=${e.rank}  ftsHit(target)=${e.ftsHit}  scorerScore=${e.targetScore}`);
  }
  console.log('interpretation: ftsHit=true + score=0 ⇒ FTS folds diacritics but norm()/scorer does not.');

  console.log('\n=== PROBE: >=30 FTS-hit fallback gap (typo hidden behind many prefix hits) ===');
  console.log('single-token typos (the common audible case) → 0 FTS hits → fallback full-scan → fuzzy reachable:');
  for (const q of ['cornerstoen', 'reckles', 'blesed']) {
    const fp = ftsProbe(b.db, q);
    console.log(`  "${q}": ftsCount=${fp.count} fallback=${fp.fallback}`);
  }
  console.log('multi-token typo where a COMMON correctly-spelled token alone yields >=30 hits:');
  // A typo token with no FTS hit forces full-scan fallback (#13), so the scorer
  // DOES see the target; the miss is comparator-level (see W1 / accuracy report).
  for (const q of ['praise recukless', 'holy reckelss', 'god goodnes']) {
    const fp = ftsProbe(b.db, q);
    const recklessRowid = b.keyToRowid.get('reckless-love')!;
    const res = b.repo.search(q, 'all');
    const rank = res.findIndex((r) => r.song.id === b.keyToId.get('reckless-love')) + 1;
    console.log(`  "${q}": ftsCount=${fp.count} fallback=${fp.fallback} targetInFtsHits=${fp.hitRowids.has(recklessRowid)} → Reckless Love rank=${rank || 'ABSENT'}`);
  }
  // GUARD: the probe must mirror the REAL gate (#13, songsRepo.search): a token with
  // no FTS hit of its own forces the full scan even when another token clears 30 hits.
  // The pre-#13 probe reported fallback=false here and blamed the wrong layer.
  expect(ftsProbe(b.db, 'praise recukless').fallback).toBe(true);
  expect(ftsProbe(b.db, 'holy reckelss').fallback).toBe(true);

  console.log('interpretation: a token with no FTS hit of its own forces the full scan (#13),');
  console.log('so these queries DO reach the fuzzy scorer; their rank-1 misses are comparator-level (see W1).');

  // ---- Tie-break fragility: is Enter's rank-1 a real winner or an insertion-order coin flip? ----
  // The A1 fix keeps the flat primary `score` buckets and breaks ties by relevance
  // sub-signals, so raw score equality no longer implies a coin flip. The meaningful
  // question is whether rank-1 and rank-2 are identical on EVERY relevance signal
  // (title string aside — that's the deterministic fallback). Those residual ties are
  // the ones A2 (score spreading) would target.
  const sigEqual = (q: LabeledQuery, x: number, y: number, res: ReturnType<SongsRepo['search']>): boolean => {
    const a = scoreSong(q.q, res[x].song, q.field); const c = scoreSong(q.q, res[y].song, q.field);
    return a.score === c.score && a.titleCoverage === c.titleCoverage && a.titleCloseness === c.titleCloseness
      && a.coverage === c.coverage && a.titleStartsWith === c.titleStartsWith && a.titleLen === c.titleLen;
  };
  console.log('\n=== PROBE: rank-1 tie fragility (does the top hit actually beat #2 on relevance, or only by title string?) ===');
  let tiedTop = 0; const tieExamples: string[] = []; let scoreTied = 0;
  for (const q of QUERIES) {
    const res = b.repo.search(q.q, q.field);
    if (res.length < 2) continue;
    if (res[0].score === res[1].score) scoreTied++;
    if (sigEqual(q, 0, 1, res)) {
      tiedTop++;
      if (tieExamples.length < 8) tieExamples.push(`"${q.q}" → rank-1/2 identical on all signals (score ${res[0].score}); only title string separates them`);
    }
  }
  console.log(`${scoreTied}/${QUERIES.length} queries still share a raw primary score at rank 1/2 (expected — buckets are unchanged)`);
  console.log(`${tiedTop}/${QUERIES.length} queries have rank-1 UNRESOLVED by relevance (identical on every signal) → the A2 residue`);
  tieExamples.forEach((e) => console.log('  ' + e));

  // ---- Order sensitivity: rebuild with curated targets inserted LAST (filler first),
  // so ties resolve against the target. Quantifies how much of measured p@1 is real
  // relevance vs. an artifact of insertion order. ----
  console.log('\n=== EXPERIMENT: p@1 when targets are inserted LAST (ties break AGAINST them) ===');
  const filler = buildCorpus(300).filter((s) => s.key.startsWith('filler-'));
  const curated = buildCorpus(0); // curated only
  const adversarial = [...filler, ...curated]; // targets added last → lose every score tie
  const b2 = build(adversarial);
  let flips = 0; const flipEx: string[] = [];
  for (const q of QUERIES) {
    const before = evals.find((e) => e.query === q)!.rank;
    const targetId = b2.keyToId.get(q.target)!;
    const res = b2.repo.search(q.q, q.field);
    const after = res.findIndex((r) => r.song.id === targetId) + 1;
    if (before === 1 && after !== 1) { flips++; if (flipEx.length < 10) flipEx.push(`"${q.q}" rank 1 → ${after || 'ABSENT'}`); }
  }
  const p1After = QUERIES.filter((q) => {
    const targetId = b2.keyToId.get(q.target)!;
    return b2.repo.search(q.q, q.field)[0]?.song.id === targetId;
  }).length;
  console.log(`insertion-order-first p@1 = ${pct(uHit1, evals.length)} (${uHit1}/${evals.length})`);
  console.log(`insertion-order-last  p@1 = ${pct(p1After, QUERIES.length)} (${p1After}/${QUERIES.length})  ← same ranker, only insertion order changed`);
  console.log(`${flips} queries flipped from rank-1 to NOT rank-1 purely due to insertion order:`);
  flipEx.forEach((e) => console.log('  ' + e));

  // GUARD (BUG-002): rank-1 must be decided by relevance, not insertion order. With the
  // A1 tie-breaker in place, flipping the insertion order of the whole corpus must not
  // change any target's rank-1 status → inserted-first p@1 === inserted-last p@1.
  console.log(`\nGUARD: order-independence — inserted-first p@1 (${uHit1}) must equal inserted-last p@1 (${p1After}); flips must be 0.`);
  expect(p1After).toBe(uHit1);
  expect(flips).toBe(0);

  // ---- Latency at library sizes ----
  console.log('\n=== LATENCY (avg ms/search over labeled query set) ===');
  for (const size of [200, 1000, 3000]) {
    const bb = build(buildCorpus(size - CURATED_LEN()));
    // warm up
    for (const q of QUERIES) bb.repo.search(q.q, q.field);
    const start = process.hrtime.bigint();
    const REPS = 2;
    for (let r = 0; r < REPS; r++) for (const q of QUERIES) bb.repo.search(q.q, q.field);
    const ns = Number(process.hrtime.bigint() - start);
    const perSearch = ns / 1e6 / (REPS * QUERIES.length);
    console.log(`  ${String(size).padStart(4)} songs: ${perSearch.toFixed(2)} ms/search`);
    if (size === 3000) expect(perSearch).toBeLessThanOrEqual(RATCHET.latencyMs3000Max);
  }

  expect(evals.length).toBe(QUERIES.length);
}, 300000);

function CURATED_LEN(): number {
  // curated count, imported lazily to avoid a second import line up top
  // (buildCorpus prepends CURATED then adds n filler)
  return buildCorpus(0).length;
}
