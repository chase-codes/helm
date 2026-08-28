# Song Search Follow-ups (W6 / W8 / W10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three deferred song-search issues — #121 (W6: exact author match loses band ties), #122 (W8: `10000` loses to a nearer numeric title), #123 (W10: same-distance vocab ties) — with measured fixes for #121/#122 and an evidence-based verdict for #123.

**Architecture:** Two production changes: (1) `norm()` joins digit-group commas so `10,000 Reasons` tokenizes with a `10000` title word (W8); (2) `rankSongs` gains a candidate-set IDF tie-break (`idfWeight`) consulted only inside the partial band (score 360), so a rare matched token (`asbury`, df≈2) beats a common one (`worship`, df≈240) when partial matches compete (W6). W10 gets a scratchpad evidence pass against the finished code, expected to produce a close-without-code recommendation.

**Tech Stack:** TypeScript, vitest, better-sqlite3/node:sqlite FTS5. Harness: `scratch/search-spike/`.

**Spec:** GitHub issues #121/#122/#123; `docs/superpowers/specs/2026-08-27-song-search-accuracy-findings.md` §W6/§W8/§W10; `docs/superpowers/specs/2026-08-27-song-search-phase1-2-execution-notes.md` (all rulings binding, incl. Phase 3–4 addenda); `docs/superpowers/specs/2026-08-27-song-search-breakdown.md`.

## Investigation results this plan is built on (measured 2026-08-27, main @ 320b371)

- **#121 reproduces**: `asbury worship` (all) → ABSENT. The harness's "scorer scored it 0" ABSENT label is a stale diagnosis: Reckless Love scores **360** (covWeight 6, dist 0) but 240 candidates score > 0 and every `worship`-matcher carries covWeight 7 (`worship` = 7 chars > `asbury` = 6), so the target never makes the top-50 cap.
- **The doc-hinted plain `authorCoverage` signal fails its own target case**: corpus song `King of Kings / Hillsong Worship` gets an exact *author*-word hit on `worship`, would tie Reckless Love on `authorCoverage=1` and beat it on covWeight 7 > 6. Author-field credit alone reproduces the same common-word noise in a new field; token *rarity* is the distinguishing signal. Hence the IDF design.
- **#122 reproduces**: `10000` (all) → rank 3, behind `1000 Tongues` [392] and `Sing Redeemer 100` [392]; target also [392] via 2-edit fuzz to token `000`.
- **#123's original detector no longer fires**: `faithfullness` → rank 1 at **both** 356 and 3000 songs (Phase 4 vocab expansion re-query restores bm25+tf, which break the old full tie; the findings doc's "ABSENT at 3,048" claim is now false). Only the constructed same-distance-ties-at-scale exposure remains to check.
- Current harness baseline (all green): unweighted p@1 **49**/53, weighted 94.64%, recall@50 97.62%, churn **137**, monotonicity **20**, GMYH **0**, latency ~80 ms @3000.

## Global Constraints

- Branch: `song-search-followups` off `main` (320b371). One PR. Do not merge it.
- TDD every production change. Harness run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`.
- Ratchet (`scratch/search-spike/ratchet.ts`): currently `unweightedP1Min=49, weightedP1MinPct=94, recall50MinPct=97, churnMax=137, monotonicityMax=20, giveMeYourHandRegressionsMax=0, latencyMs3000Max=120`. **Tighten any metric a task improves, in the same commit. NEVER loosen.** Latency is a local-machine guard.
- Pinned contracts that must not change: `scoreSong('swet zzzzz',…,'lyric')===360`; the `matchTol` table pins; `FTS_CANDIDATE_LIMIT===1000`; the import re-search 2-call pin; `'zephaniah of'` honest-empty; bible quick-find gold guards; GMYH=0; strongSolid/bestSolidMatch pins; the all-digit full-scan exemption pin (`songsRepo.test.ts:36-43`) — investigation confirms it stays REQUIRED after W8 (FTS still indexes raw `10,000` as `10`/`000`, so a `10000` query has zero FTS hits and only the full scan reaches the song).
- W8 touches shared `norm()` ⇒ the FULL repo suite and the cross-feature suites are mandatory (`messageScore`, `verseScore`, `highlight`, `passages`, `biblesRepo`, `bibleSearchRanking`), and verse/quote behavior must be argued in the PR body.
- If an expected result does not reproduce (a test that should fail passes, a ratchet can't be met, a pinned value would have to change): **STOP the task and report back.** Do not improvise.
- Never run `prettier --write`. Commit subjects: short conventional-commit style, no trailers.

## File Structure

- Modify: `src/shared/search/fuzzy.ts` — `norm()` digit-comma join (Task 1)
- Modify: `src/shared/search/fuzzy.test.ts` — new norm pins (Task 1)
- Modify: `src/shared/search/songScore.ts` — `idfWeight` signal + comparator step (Task 3)
- Modify: `src/shared/search/songScore.test.ts` — partial-band IDF tests (Task 3)
- Modify: `src/main/songSearchRanking.test.ts` — real-pipeline fixtures for both fixes (Tasks 2, 4)
- Modify: `scratch/search-spike/ratchet.ts` — tightened constants (Tasks 2, 4)
- Modify: `scratch/search-spike/queries.ts` — stale notes on the two labeled queries (Tasks 2, 4)
- Modify: `docs/superpowers/specs/2026-08-27-song-search-phase1-2-execution-notes.md` — Phase 5 addendum (Task 6)
- No new production modules. W10 probes live in the session scratchpad, never in the repo.

---

### Task 1: W8 — `norm()` joins digit-group commas

**Files:**
- Modify: `src/shared/search/fuzzy.ts:7-17` (`norm`)
- Test: `src/shared/search/fuzzy.test.ts`

**Interfaces:**
- Produces: `norm('10,000 Reasons')` → `'10000 reasons'`. Non-digit commas unchanged (`'a,b'` → `'a b'`). Everything downstream (song/message/verse scorers, FTS query builders) picks this up automatically because they all tokenize through `norm()`.

- [ ] **Step 1: Write the failing tests** — add to the `norm` describe-block region of `src/shared/search/fuzzy.test.ts` (alongside the existing punctuation pins at the top of the file):

```ts
test('norm joins digit-group commas so "10,000" is one token (W8)', () => {
  expect(norm('10,000 Reasons (Bless the Lord)')).toBe('10000 reasons bless the lord');
  expect(norm('1,000,000')).toBe('1000000');
  // Comma joins ONLY between digits — word commas still split:
  expect(norm('Holy, Holy, Holy')).toBe('holy holy holy');
  // Comma followed by a space is a list separator, not a digit group:
  expect(norm('Psalm 23, 16')).toBe('psalm 23 16');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/search/fuzzy.test.ts -t 'digit-group'`
Expected: FAIL — `'10 000 reasons bless the lord'` (current behavior splits on the comma).

- [ ] **Step 3: Implement** — in `norm()`, insert the digit-join replace between the apostrophe strip and the generic punctuation replace:

```ts
    .replace(/['’`]/g, '')
    // Digit-group separators join rather than split: the operator types "10000"
    // for "10,000 Reasons", and "10 000" would never match it whole-word (W8).
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
```

- [ ] **Step 4: Run the new tests + the whole fuzzy suite**

Run: `npx vitest run src/shared/search/fuzzy.test.ts`
Expected: PASS (no existing pin asserts digit-comma splitting — verified in investigation).

- [ ] **Step 5: Cross-feature blast-radius check** — run the full repo suite (root config covers `src/**`), then explicitly confirm the named cross-feature suites are green:

Run: `npx vitest run`
Then: `npx vitest run src/shared/search/messageScore.test.ts src/shared/search/verseScore.test.ts src/shared/search/highlight.test.ts src/shared/scripture/passages.test.ts src/main/biblesRepo.test.ts src/main/bibleSearchRanking.test.ts`
Expected: ALL PASS. (Scripture ref parsing norms only book-name tokens — `parseRef`'s regex handles digits before `norm` ever sees them — and verse/quote text and queries share the same `norm`, so both sides of any digit-comma text shift together. If ANY of these suites fails: STOP and report; do not adapt the failing test.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/search/fuzzy.ts src/shared/search/fuzzy.test.ts
git commit -m "fix(search): norm() joins digit-group commas (W8, #122)"
```

---

### Task 2: W8 — end-to-end ranking proof + ratchet tighten

**Files:**
- Modify: `src/main/songSearchRanking.test.ts` (append fixture songs + test)
- Modify: `scratch/search-spike/ratchet.ts`, `scratch/search-spike/queries.ts:58-59`

**Interfaces:**
- Consumes: Task 1's `norm()` behavior.
- Produces: tightened ratchet constants later tasks must keep.

- [ ] **Step 1: Write the failing real-pipeline test** — in `src/main/songSearchRanking.test.ts`, add fixture songs inside `beforeAll` using the existing `add` helper, and a test after the existing ones:

```ts
  // W8 (#122): the canonical typed form "10000" must beat the nearer numeric
  // title "1000 Tongues" — norm() joins the digit-group comma so the real title
  // carries a whole word "10000" (title-startsWith band), while "1000" only
  // fuzz-matches at distance 1.
  add('ten-thousand', '10,000 Reasons (Bless the Lord)', [
    'Chorus', 'Bless the Lord O my soul', 'Worship His holy name',
  ].join('\n'));
  add('thousand-tongues', '1000 Tongues', [
    'Verse 1', 'A thousand tongues could never say', 'How good you are to me',
  ].join('\n'));
```

```ts
test('W8 (#122): "10000" ranks 10,000 Reasons above the nearer numeric collision', () => {
  expect(rankOf('10000', 'all', 'ten-thousand')).toBe(1);
  expect(rankOf('10000', 'all', 'thousand-tongues')).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Verify it passes already** (Task 1 made the mechanism work; this test pins it at the real-pipeline layer)

Run: `npx vitest run src/main/songSearchRanking.test.ts`
Expected: PASS, including all pre-existing tests. If the new test FAILS: STOP and report (the Task 1 mechanism did not land as designed). Also confirm the all-digit exemption pin still passes: `npx vitest run src/main/songsRepo.test.ts` → PASS (the exemption is still the only path that reaches the song — do NOT remove it).

- [ ] **Step 3: Run the harness, record measurements**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected movement: `10000` labeled query rank 3 → **1** (score 1000-band). Unweighted p@1 49 → **50**. Weighted p@1 ≈ 97% (remaining weighted misses: `my chains are gone` 3, `senor` 1, `asbury worship` 1). Recall@50 unchanged (~97.62). Churn ≤ 137, monotonicity ≤ 20, GMYH = 0, latency ≤ 120. If ANY ceiling is exceeded or p@1 did not improve: STOP and report with the printed diagnostics.

- [ ] **Step 4: Tighten the ratchet + fix the stale query note** — in `scratch/search-spike/ratchet.ts` set `unweightedP1Min: 50` and raise `weightedP1MinPct` to the floored measured value (expected 97; use the printed exact number), updating each value's provenance comment. Tighten `churnMax`/`monotonicityMax` too if the measured values improved. In `scratch/search-spike/queries.ts` update the `10000` query's note:

```ts
  { intent: 'audible-partial', q: '10000', field: 'all', target: '10000-reasons',
    note: 'W8 (#122 fixed): norm() joins the digit-group comma; whole-word "10000" wins the title band' },
```

- [ ] **Step 5: Re-run the harness to confirm the tightened ratchet holds**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/songSearchRanking.test.ts scratch/search-spike/ratchet.ts scratch/search-spike/queries.ts
git commit -m "test(search): pin 10000-vs-1000 ranking; ratchet p@1 50/97 (W8)"
```

---

### Task 3: W6 — candidate-set IDF tie-break in the partial band

**Files:**
- Modify: `src/shared/search/songScore.ts`
- Test: `src/shared/search/songScore.test.ts`

**Interfaces:**
- Consumes: `textSignals(...).bestDist: number[]` (already exposed; 99 = token unmatched).
- Produces: `ScoredSong.idfWeight: number` — Σ over matched tokens of `ln((n+1)/(df+1))`, where `n` = candidates that scored > 0 and `df` = how many of them matched that token. Filled **only by `rankSongs`**; `scoreSong` always returns 0 (single-song scoring has no candidate set). Comparator consults it ONLY when both scores are 360 (the partial band). Task 4 relies on exactly this.

- [ ] **Step 1: Write the failing tests** — append to `src/shared/search/songScore.test.ts` (uses the file's existing `song(id, title, author, secs)` helper):

```ts
// W6 (#121): inside the partial band (360), candidates matched DIFFERENT token
// subsets. A rare matched token (an author name) carries more operator intent than
// a common one (a word in dozens of titles/lyrics) — regardless of WHICH field
// matched it. Plain author-field credit is not enough: an author like
// "Hillsong Worship" earns the same exact author-word hit on the common token.
test('partial band: the candidate matching the RARE token beats the common-token crowd (W6)', () => {
  const target = song('target', 'Reckless Love', 'Cory Asbury', [
    ['Chorus', ['Oh the overwhelming never ending love of God']],
  ]);
  const decoys = ['w1', 'w2', 'w3', 'w4'].map((id, i) =>
    song(id, `${['Heart of', 'Here I Am to', 'Come Now and', 'House of'][i]} Worship`, 'Nobody', [
      ['Verse 1', ['We sing together in this place']],
    ]));
  const authorDecoy = song('kok', 'King of Kings', 'Hillsong Worship', [
    ['Verse 1', ['In the darkness we were waiting']],
  ]);
  const r = rankSongs('asbury worship', [ ...decoys, authorDecoy, target ], 'all');
  expect(r[0].song.id).toBe('target');
});

test('idfWeight never reorders the full-match band (all tokens matched => identical idf)', () => {
  // Both match both tokens; ordering must stay what the existing signals decide.
  const a = song('a', 'Amazing Grace', 'John Newton', [
    ['Verse 1', ['Amazing grace how sweet the sound']],
  ]);
  const b = song('b', 'Grace Amazing Anthem', 'Nobody', [
    ['Verse 1', ['An amazing kind of grace']],
  ]);
  const r = rankSongs('amazing grace', [b, a], 'all');
  expect(r[0].song.id).toBe('a'); // exact-title band, untouched by idf
  expect(scoreSong('amazing grace', a, 'all').idfWeight).toBe(0); // scoreSong: no candidate set
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/search/songScore.test.ts -t 'W6'`
Expected: first test FAILS (a `Worship`-titled decoy wins on titleCoverage/covWeight); second test FAILS on the missing `idfWeight` property.

- [ ] **Step 3: Implement** in `src/shared/search/songScore.ts`:

3a. Extend `ScoredSong` (after the `dist` field, matching the comment style):

```ts
  idfWeight: number;       // Σ ln((n+1)/(df+1)) over matched tokens, df = candidate-set
                           // document frequency — rare matched tokens carry more intent
                           // than common ones. Filled only by rankSongs (candidate-set
                           // scoped); consulted only inside the partial band (W6)
```

3b. Internal type + plumbing. Above `scoreSignals`:

```ts
// rankSongs needs per-token match info to compute candidate-set df; the public
// ScoredSong stays free of it.
interface ScoredInternal extends ScoredSong { bestDist: number[] }
```

Change `scoreSignals`' return type to `ScoredInternal`; add `idfWeight: 0` and `bestDist: []` to the `empty` literal, and `idfWeight: 0, bestDist: sig.bestDist` to the final return object. `scoreSong` strips the internal field:

```ts
export function scoreSong(query: string, song: Song, field: SearchField, rel = 0): ScoredSong {
  const q = norm(query);
  const { bestDist: _internal, ...s } = scoreSignals(q, q ? q.split(' ') : [], song, field, rel, true);
  return s;
}
```

3c. `rankSongs` computes df over the scored candidate set, then fills `idfWeight` before sorting:

```ts
export function rankSongs(query: string, songs: Song[], field: SearchField, rel?: Map<string, number>, limit = Infinity): SongSearchResult[] {
  const q = norm(query);
  if (!q) return songs.slice(0, limit).map((song) => ({ song, score: 1, snippet: '' }));
  const qts = q.split(' ');
  const scored = songs
    .map((song) => ({ song, s: scoreSignals(q, qts, song, field, rel?.get(song.id) ?? 0, false) }))
    .filter((r) => r.s.score > 0);
  // Candidate-set document frequency per token: how many surviving candidates
  // matched it. Rarity is what separates "asbury" (a couple of songs) from
  // "worship" (hundreds) when partial matches compete for the band (W6).
  const df = qts.map((_, j) => scored.reduce((acc, r) => acc + (r.s.bestDist[j] < 99 ? 1 : 0), 0));
  for (const r of scored) {
    let w = 0;
    for (let j = 0; j < qts.length; j++) if (r.s.bestDist[j] < 99) w += Math.log((scored.length + 1) / (df[j] + 1));
    r.s.idfWeight = w;
  }
  return scored
    .sort((a, b) => compareRelevance(a.s, b.s))
    .slice(0, limit)
    .map(({ song, s }) => ({ song, score: s.score, snippet: field !== 'title' ? bestSnippet(qts, song, docFor(song)) : '' }));
}
```

3d. Comparator — insert directly after the `score` step:

```ts
  if (b.score !== a.score) return b.score - a.score;
  // Partial band only (score 360): the candidates matched DIFFERENT token subsets,
  // and a rare matched token outranks a common one wherever it matched (W6). Full
  // bands matched every token, so their idfWeight is identical by construction —
  // the guard just makes that scoping explicit.
  if (a.score === 360 && b.idfWeight !== a.idfWeight) return b.idfWeight - a.idfWeight;
  if (b.titleCoverage !== a.titleCoverage) return b.titleCoverage - a.titleCoverage;
```

- [ ] **Step 4: Run the scorer suite**

Run: `npx vitest run src/shared/search/songScore.test.ts src/main/songSearchRanking.test.ts src/main/songsRepo.test.ts`
Expected: ALL PASS, including the pinned `scoreSong('swet zzzzz',…,'lyric')===360` (idf never changes `score`) and every strongSolid/bestSolidMatch pin. If a pre-existing test fails: STOP and report.

- [ ] **Step 5: Commit**

```bash
git add src/shared/search/songScore.ts src/shared/search/songScore.test.ts
git commit -m "feat(search): rare-token idf tie-break in the partial band (W6, #121)"
```

---

### Task 4: W6 — end-to-end proof + ratchet tighten

**Files:**
- Modify: `src/main/songSearchRanking.test.ts`
- Modify: `scratch/search-spike/ratchet.ts`, `scratch/search-spike/queries.ts:123-124`

**Interfaces:**
- Consumes: Task 3's `idfWeight` behavior.

- [ ] **Step 1: Write the real-pipeline test** — `songSearchRanking.test.ts`'s `add` helper hardcodes `author: ''`; add an author-aware variant beside it:

```ts
const addBy = (key: string, title: string, author: string, text: string): void => {
  ids.set(key, repo.add({ title, author, text, source: 'seed' }).id);
};
```

In `beforeAll`, seed the W6 shape (author-recall query, common-token title crowd, author-word decoy):

```ts
  // W6 (#121): "asbury worship" — the exact-author match must win the partial band
  // over both title matchers ("Heart of Worship") and an author whose NAME contains
  // the common token ("Hillsong Worship").
  addBy('reckless', 'Reckless Love', 'Cory Asbury', [
    'Chorus', 'Oh the overwhelming never ending reckless love of God',
  ].join('\n'));
  addBy('heart-of-worship', 'Heart of Worship', 'Matt Redman', [
    'Verse 1', 'When the music fades all is stripped away',
  ].join('\n'));
  addBy('king-of-kings', 'King of Kings', 'Hillsong Worship', [
    'Verse 1', 'In the darkness we were waiting',
  ].join('\n'));
```

```ts
test('W6 (#121): exact author match wins the partial band over common-token matchers', () => {
  expect(rankOf('asbury worship', 'all', 'reckless')).toBe(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/main/songSearchRanking.test.ts`
Expected: ALL PASS (Task 3 provides the mechanism; this pins it through FTS5+bm25). If it fails: STOP and report — the FTS candidate path differs from the unit fixture and the difference must be understood, not patched around.

- [ ] **Step 3: Run the harness, record measurements**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected movement: `asbury worship` ABSENT → rank **1**. Unweighted p@1 50 → **51**. Weighted misses left: `my chains are gone` (3) + `senor` (1). Recall@50 rises (asbury target now inside the top-50) — expected ≈ 98.2 → floor 98. Churn ≤ current ratchet, monotonicity ≤ 20, GMYH = 0, latency ≤ 120. Any ceiling exceeded or no p@1 gain: STOP and report with diagnostics.

- [ ] **Step 4: Tighten ratchet + query note** — `ratchet.ts`: `unweightedP1Min: 51`, `recall50MinPct: 98`, raise `weightedP1MinPct` to the floored measured value; tighten churn/monotonicity if improved; update provenance comments. `queries.ts` asbury note:

```ts
  { intent: 'author-recall', q: 'asbury worship', field: 'all', target: 'reckless-love',
    note: 'W6 (#121 fixed): rare-token idf tie-break — the exact author match wins the partial band' },
```

- [ ] **Step 5: Re-run harness to confirm the tightened ratchet holds**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS.

- [ ] **Step 6: Full repo suite** (the comparator is shared surface):

Run: `npx vitest run`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/songSearchRanking.test.ts scratch/search-spike/ratchet.ts scratch/search-spike/queries.ts
git commit -m "test(search): pin author-recall rank 1; ratchet p@1 51, recall 98 (W6)"
```

---

### Task 5: W10 — evidence pass against the finished code (#123)

**Files:**
- Scratchpad ONLY (session scratchpad dir; nothing committed). Follow the probe pattern from the accuracy investigation: a vitest config with absolute-path include + a `node_modules` symlink beside it.

**Interfaces:**
- Consumes: the final Task 1–4 code.
- Produces: a written verdict (used verbatim by Task 6): either "close #123 — no realistic reproduction" with the probe evidence, or a STOP report describing the realistic failing case found.

- [ ] **Step 1: Re-confirm the labeled query stays rescued** — probe `faithfullness` at 356 and 3000 songs (`buildCorpus(300)` / `buildCorpus(3000)`, real repo pipeline): target `great-is-thy-faithfulness` expected rank 1 at both sizes.

- [ ] **Step 2: Construct same-distance vocab-tie cases.** The residual W10 claim is: a typo equidistant from ≥2 vocabulary terms puts both term-families in the candidate set, the scorer sees identical fuzzy distance, and the wrong family wins at scale. Build probes over the 3000-song corpus with realistic single-token typos that are distance-1 from several vocab terms, e.g.:

```ts
// each: [typo, intended target key] — d=1 to the intended term AND d=1 to ≥1 other vocab term
[['gace', 'amazing-grace'],   // grace | face | gate | pace ...
 ['worshp', /* worship-family target */],
 ['glry', /* glory-family target */],
 ['prase', /* praise vs phrase */]]
```

For each: run `repo.search(typo, 'all')`, print the top 6 with per-song `scoreSong` signals, record the intended family's best rank. A case only counts as a W10 failure if (a) the typo is a plausible operator misspelling of a real song's word, (b) the intended song loses rank 1 to a same-distance other-family song, and (c) the deciding signal is the blind tail (`titleLen`/`title`) rather than bm25/tf/titleCoverage doing its legitimate job.

- [ ] **Step 3: Single-token queries land the full-match band (392), where `idfWeight` is deliberately not consulted** — verify in the probe output that the W6 change did not silently take over these ties (idfWeight must be equal across candidates matching the same single token; assert or eyeball `idfWeight` equality in the printed signals).

- [ ] **Step 4: Verdict.** If no constructed case satisfies (a)+(b)+(c): the recommendation is **close #123 without code** — the Phase 4 expansion re-query already feeds bm25/tf into these ties, and the shipped IDF signal is scoped away from them on purpose. Write the verdict with the probe numbers. If a realistic failing case DOES appear: STOP — report the case, its diagnosis, and do NOT design a fix inside this task.

---

### Task 6: Docs addendum + PR

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-song-search-phase1-2-execution-notes.md` (append a Phase 5 addendum)

- [ ] **Step 1: Append the Phase 5 addendum** to the execution-notes doc, following the Phase 3/4 addendum format: branch name, measured end state (all harness metrics + final ratchet block), and rulings, which must include at least: (1) plain `authorCoverage` was investigated and rejected with the measured `King of Kings / Hillsong Worship` counter-case — rarity (candidate-set IDF), not field identity, is the distinguishing signal; idfWeight is consulted only in the 360 partial band, provably neutral in full-match bands; (2) `norm()` joins digit-group **commas only** (`/(?<=\d),(?=\d)/`), comma-space list forms unaffected; the all-digit full-scan exemption remains REQUIRED (FTS still indexes raw `10,000` as `10`/`000`); (3) the W10 verdict from Task 5 with its evidence; (4) the harness ABSENT label "scorer scored it 0" is a stale diagnosis (it fires for past-the-50-cap too) — parked, not fixed here.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-27-song-search-phase1-2-execution-notes.md
git commit -m "docs(spec): phase 5 addendum - W6/W8 fixes, W10 verdict"
```

- [ ] **Step 3: Push and open ONE PR** (do not merge):

```bash
git push -u origin song-search-followups
gh pr create --title "Song search follow-ups: author-recall idf tie-break (W6) + digit-group norm (W8)" --body "<body per below>"
```

PR body must contain: per-issue before/after harness evidence (`10000` rank 3 → 1, `asbury worship` ABSENT → 1, each with band/signal detail); the ratchet delta table (before → after for all seven constants); the verse/quote argument for the shared `norm()` change (both query and text sides shift together; scripture ref parsing norms only book-name tokens; cross-feature suites listed and green); every ruling from the addendum; `Closes #121`, `Closes #122`; and the #123 recommendation (close with evidence — quote the Task 5 verdict — or the STOP report if one occurred). End with the standard Claude Code attribution line.

---

## Self-review notes

- Spec coverage: #122 → Tasks 1–2; #121 → Tasks 3–4; #123 → Task 5; documentation/PR duties from the operator brief → Task 6. Step-zero reproduction was done in-session before this plan (results recorded above).
- Type consistency: `ScoredInternal.bestDist` (Task 3) matches `TextSignals.bestDist: number[]` already exported by `fuzzy.ts`; `idfWeight` name is used identically in Tasks 3, 4, 5.
- The two ratchet-tightening tasks (2, 4) each re-run the harness AFTER editing `ratchet.ts` so the tightened floors are proven in the same commit.
