# Song Search Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Helm's song search measurably more accurate (fix the reported "give me your hand" stopword-fuzz bug plus five investigated ranking weaknesses) and ~5–10x faster per keystroke, with a hardened measurement harness that ratchets every improvement so it cannot silently regress.

**Architecture:** Four PR-sized phases (this repo's convention is 3–5 same-cluster changes per branch). Phase 1 fixes the measuring stick (`scratch/search-spike/` harness: false probe, unrealistic corpus, missing adversarial cases, no stability metrics). Phase 2 lands five measured zero-regression accuracy fixes in the JS scorer/repo. Phase 3 fixes the user-reported stopword-fuzz bug and keystroke rank instability, validated against Phase 1's ratchets. Phase 4 removes the measured performance hot spots (redundant Title-mode search, per-keystroke re-derivation of per-song data, full-library fallback scans).

**Tech Stack:** TypeScript, Electron (main-process search over better-sqlite3 / node:sqlite in tests), SQLite FTS5 (+ fts5vocab), React (operator UI), vitest.

**Spec:** (these three documents ARE the spec — read them before executing)
- `docs/superpowers/specs/2026-08-27-song-search-accuracy-findings.md` (weaknesses W1–W10, measured A/Bs)
- `docs/superpowers/specs/2026-08-27-song-search-perf-findings.md` (opportunities #1–#9, measured)
- `docs/superpowers/specs/2026-08-27-song-search-breakdown.md` (algorithm breakdown of the current pipeline)

## Global Constraints

- Repo root: `/Users/lem/repos/helm`. Run all commands from there. Base branch: `main`.
- **NEVER run `prettier --write` on this repo.**
- Commit messages: concise conventional-commit subject (e.g. `fix(search): …`). **No `Co-Authored-By` or `Claude-Session` trailers.**
- Harness runs: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`. Unit tests: the repo's standard `npx vitest run <file …>`.
- **"The song-search suite"** referenced by every task means:
  `npx vitest run src/shared/search/songScore.test.ts src/shared/search/fuzzy.test.ts src/main/songsRepo.test.ts src/main/songSearchRanking.test.ts src/main/ftsQuery.test.ts src/shared/songs/secondaryLyric.test.ts src/renderer/operator/SongsMode.test.tsx src/renderer/operator/SongSearchRail.test.tsx`
- **"The cross-feature suites"** (mandatory whenever `src/shared/search/fuzzy.ts` changes) means additionally:
  `npx vitest run src/shared/search/messageScore.test.ts src/shared/search/verseScore.test.ts src/shared/search/highlight.test.ts src/shared/scripture/passages.test.ts src/main/biblesRepo.test.ts src/main/bibleSearchRanking.test.ts`
- Every task is TDD: write the failing test, watch it fail, implement, watch it pass, run the touched files AND the full song-search suite (plus cross-feature suites when fuzzy.ts changed) before committing.
- The accuracy report's measured A/B claims (e.g. "W1 is zero-regression") were measured in a **scratch reimplementation** of the pipeline. Every task must re-verify its claim against the **real** harness after the real change — the scratch numbers are a prediction, not proof.
- **Ratchet discipline:** `scratch/search-spike/ratchet.ts` (created in Task 4) holds measured floors/ceilings. A task that improves a metric MUST tighten the corresponding constant in the same commit. No task may loosen a ratchet value unless its steps explicitly authorize it with a reason.
- **Pinned values that must not change anywhere in this plan:** `scoreSong('swet zzzzz', …, 'lyric').score === 360` (`songScore.test.ts:116-121`); `matchTol(4)===1, matchTol(5)===2, matchTol(6)===2` (`fuzzy.test.ts:24-30`); `FTS_CANDIDATE_LIMIT === 1000` (shared with messages/bibles — do not touch); the import re-search pin of exactly 2 `search` calls (`SongsMode.test.tsx:257`); the honest-empty `'zephaniah of'` behavior; the bible quick-find gold guards (never relaxed — house rule).
- Line numbers cited below are from `main @ 20401e5` and drift as tasks land — anchor edits by the quoted code, not the number.
- Each phase is one branch and one PR. Verify `git status` is clean and you are on the phase branch before each task.

## Out of Scope — do NOT drift into these

Executors: if you find yourself touching any of these, stop — they are deliberately excluded.

- **FTS5 `prefix=` index** — measured no perceptible gain; needs a full index-rebuild migration (perf report §3).
- **Candidate-set reuse across keystrokes** — unsound: score bands are not monotone in query length; only 36% of keystrokes produce subset results (perf report §3).
- **Lowering `FTS_CANDIDATE_LIMIT`** — shared constant with `messagesRepo.ts` and `biblesRepo.ts` (used as a truncation sentinel at `biblesRepo.ts:173`); measured only a 1.5x span anyway.
- **Moving ranking into SQL** — forfeits the fuzzy/phrase/tie-break work pinned by `songSearchRanking.test.ts` for a stage that is 1–5% of the budget.
- **Search-library swap (MiniSearch/Orama/FlexSearch)** — the measured problem is per-keystroke re-derivation, not the algorithm; a swap re-opens every settled ranking decision (#53/PR-70/BUG-002).
- **P9: worker-thread / utilityProcess search** — only if Phase 4 misses its latency targets; file an issue instead of implementing.
- **W10 (`faithfullness` full-tie decided by `titleLen`)** — needs a genuinely new IDF-like signal; filed as a follow-up issue in Task 19.
- **W8 (numeric-grouping in `norm()`: `10,000` → `10 000`)** — touches shared `norm()` used by verse/quote paths; filed as a follow-up issue in Task 19. (Task 3 adds the `1000 Tongues` competitor so the harness *documents* the gap; the `10000` labeled query is expected to sit at rank 2 until that follow-up lands.)
- **W6 (author words carry no title-tie signal)** — judgment call: EXCLUDED from Phase 2. It is the only unmeasured accuracy fix, and re-deriving its example under the post-W1 comparator shows extending `titleCoverage` with author words does **not** put the exact-author match at rank 1 (`Worship Tonight` still wins on `covWeight` 7 vs 6) — it only lifts it from rank 3 to 2, while diluting what the title signals mean. Filed as a follow-up issue in Task 19; the `asbury worship` labeled query added in Task 3 documents the gap (expect it to remain a p@1 miss).
- **P6 (short-circuit 1–2 char queries)** — most of its value arrives free with the debounce (Task 16) and precomputed docs (Task 17); revisit only if Task 19's final measurements demand it.
- **`highlight.ts` for song snippets** — unused by songs on purpose; adding it would add cost.

## File Structure

No new production modules; the work deepens existing ones (repo convention: focused edits over restructuring).

- `scratch/search-spike/eval.test.ts` — metrics + probes; gains ratchet assertions (Tasks 1–4)
- `scratch/search-spike/corpus.ts` — realistic filler + adversarial curated targets (Tasks 2–3)
- `scratch/search-spike/queries.ts` — adversarial labeled queries + new intent (Task 3)
- `scratch/search-spike/corpus.test.ts` — NEW: corpus-shape guard (Task 2)
- `scratch/search-spike/stability.test.ts` — NEW: keystroke-replay churn/monotonicity (Task 4)
- `scratch/search-spike/ratchet.ts` — NEW: measured ratchet constants (Task 4)
- `src/shared/search/songScore.ts` — comparator, bands, segments, doc cache (Tasks 5–7, 9–12, 17)
- `src/shared/search/fuzzy.ts` — `bestDist`/`strongSolid` exposure, `pairTol`, `levWithin` (Tasks 11–13, 18)
- `src/main/songsRepo.ts` — candidate ordering, statement hoist, merged query, song cache, vocab expansion (Tasks 8, 17, 19)
- `src/main/schema.ts` — `song_vocab` fts5vocab table (Task 19)
- `src/renderer/operator/SongsMode.tsx` — lyric-hint gating, debounce (Tasks 15–16)
- Tests beside each of the above.

---

# Phase 1 — Harness first (the measuring stick)

Branch: `git checkout main && git pull && git checkout -b song-search-harness`

### Task 1: Fix the harness's false fallback probe

The probe at `scratch/search-spike/eval.test.ts:39` computes `fallback: rowids.length < 30` — the **pre-#13** gate. The real gate (`songsRepo.ts:144`) is `hits.length >= 30 && tokens.every(tokenHasHit)`. The probe therefore prints `fallback=false` for `praise recukless` and the harness narrates a false diagnosis ("the fuzzy pass never runs" — it does run; the miss is comparator-level, see accuracy report W1/§1).

**Files:**
- Modify: `scratch/search-spike/eval.test.ts` (function `ftsProbe`, lines 33–40; interpretation strings, lines 117–136)

**Interfaces:**
- Consumes: `norm` from `src/shared/search/fuzzy`, the `song_fts` table (already imported/available in the file).
- Produces: `ftsProbe(db, q)` keeps its return shape `{ hitRowids: Set<number>; count: number; fallback: boolean }` — only the `fallback` computation changes. Later tasks (2–4) rely on the harness being trustworthy.

- [ ] **Step 1: Write the failing assertion**

In `eval.test.ts`, directly after the existing loop that prints `'praise recukless' / 'holy reckelss' / 'god goodnes'` probes (after line 134, before the two `console.log('interpretation…')` lines):

```ts
  // GUARD: the probe must mirror the REAL gate (#13, songsRepo.search): a token with
  // no FTS hit of its own forces the full scan even when another token clears 30 hits.
  // The pre-#13 probe reported fallback=false here and blamed the wrong layer.
  expect(ftsProbe(b.db, 'praise recukless').fallback).toBe(true);
  expect(ftsProbe(b.db, 'holy reckelss').fallback).toBe(true);
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: FAIL — `expected false to be true` (old probe: `'praise'` alone yields ≥30 hits so `count >= 30` → `fallback=false`).

- [ ] **Step 3: Fix the probe**

Replace the whole `ftsProbe` function (currently lines 33–40) with:

```ts
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
```

(The repo caps `hits` at `LIMIT 1000`; the probe is uncapped — irrelevant for a `>= 30` comparison.)

- [ ] **Step 4: Correct the false narration**

Replace the two interpretation lines at the end of that probe section (currently `eval.test.ts:135-136`):

```ts
  console.log('interpretation: a token with no FTS hit of its own forces the full scan (#13),');
  console.log('so these queries DO reach the fuzzy scorer; their rank-1 misses are comparator-level (see W1).');
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS, and the probe section now prints `fallback=true` for `praise recukless` / `holy reckelss`.

- [ ] **Step 6: Commit**

```bash
git add scratch/search-spike/eval.test.ts
git commit -m "test(search-spike): probe mirrors the real per-token fallback gate"
```

### Task 2: Realistic filler corpus + terminating title generator

`corpus.ts:145-152` builds 39-word filler songs (real songs are 150–350 words), understating rank cost ~3.5x, and `makeFiller` spins forever past ~5.8k title combinations (`LEAD×MID×TAIL` = 5760; the `if (seen.has(title)) continue` loop never exits).

**Files:**
- Modify: `scratch/search-spike/corpus.ts` (const `LYRIC_WORDS`, function `makeFiller`)
- Create: `scratch/search-spike/corpus.test.ts`
- Modify: `scratch/search-spike/eval.test.ts` (latency loop `REPS`, test timeout — the realistic corpus is slower)

**Interfaces:**
- Consumes: existing `mulberry32`, `LEAD`/`MID`/`TAIL`, `CorpusSong`.
- Produces: `makeFiller(n, seed?)` same signature, now terminating for any `n` and emitting ~150–350-word songs. All harness tests re-baseline on this corpus.

- [ ] **Step 1: Write the failing test** — create `scratch/search-spike/corpus.test.ts`:

```ts
import { test, expect } from 'vitest';
import { makeFiller, type CorpusSong } from './corpus';

const words = (s: CorpusSong): number => s.text.split(/\s+/).filter(Boolean).length;

test('filler songs are realistically sized (~150-350 words like real pasted songs)', () => {
  const filler = makeFiller(200);
  const avg = filler.map(words).reduce((a, b) => a + b, 0) / filler.length;
  expect(avg).toBeGreaterThan(150);
  expect(avg).toBeLessThan(350);
});

test('generation terminates past the ~5.8k title-combination space', () => {
  // The old skip-on-duplicate loop spun forever here (LEAD×MID×TAIL = 5760 titles).
  const filler = makeFiller(6000);
  expect(filler).toHaveLength(6000);
  expect(new Set(filler.map((s) => s.title)).size).toBe(6000);
}, 30000);
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept scratch/search-spike/corpus.test.ts`
Expected: FAIL — first test: avg ≈ 45 words; second test: 30s timeout (infinite loop).

- [ ] **Step 3: Implement**

In `corpus.ts`, replace the `LYRIC_WORDS` constant with a realistic vocabulary (real lyrics are heavy with stopwords — keep them; they create the exact fuzz pressure W2/W4 need):

```ts
const LYRIC_WORDS = [
  // content words
  'grace', 'mercy', 'love', 'holy', 'praise', 'glory', 'jesus', 'lord', 'saviour',
  'redeemer', 'mighty', 'faithful', 'forever', 'worthy', 'kingdom', 'freedom',
  'salvation', 'righteousness', 'hallelujah', 'wonderful', 'everlasting', 'shepherd',
  'heart', 'soul', 'sing', 'voice', 'raise', 'hands', 'lift', 'high', 'above',
  'heaven', 'earth', 'mountain', 'valley', 'river', 'ocean', 'fire', 'light',
  'darkness', 'morning', 'evening', 'night', 'shining', 'hope', 'joy', 'peace',
  'rest', 'breath', 'life', 'living', 'risen', 'alive', 'blood', 'cross', 'crown',
  'throne', 'king', 'father', 'spirit', 'name', 'word', 'truth', 'way', 'strong',
  'tower', 'refuge', 'shelter', 'shield', 'victory', 'power', 'honour', 'majesty',
  'wisdom', 'wonder', 'beauty', 'call', 'answer', 'seek', 'find', 'know', 'trust',
  'believe', 'follow', 'surrender', 'worship', 'bow', 'kneel', 'stand', 'walk',
  'run', 'dance', 'shout', 'whisper', 'cry', 'tears', 'blessing', 'promise',
  'anchor', 'storm', 'wind', 'waves', 'deep', 'wide', 'broken', 'healed', 'whole',
  'free', 'chains', 'door', 'gates', 'garden', 'vine', 'bread', 'water', 'fountain',
  'rain', 'desert', 'wilderness', 'home', 'again', 'always', 'never', 'every',
  'within', 'through', 'before', 'beyond',
  // stopwords — real lyric density, and the fuzz pressure the W2/W4 cases need
  'the', 'and', 'of', 'my', 'your', 'our', 'is', 'in', 'to', 'we', 'you', 'me',
  'all', 'will', 'with', 'for', 'are', 'be', 'his', 'him',
];
```

Replace `makeFiller` with:

```ts
export function makeFiller(n: number, seed = 12345): CorpusSong[] {
  const rnd = mulberry32(seed);
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const out: CorpusSong[] = [];
  const seen = new Set<string>();
  let i = 0;
  const line = (): string => {
    const w: string[] = [];
    const len = 6 + Math.floor(rnd() * 4); // 6-9 words per line
    for (let k = 0; k < len; k++) w.push(pick(LYRIC_WORDS));
    return w.join(' ');
  };
  const section = (label: string): string => {
    const lines: string[] = [];
    const nLines = 4 + Math.floor(rnd() * 4); // 4-7 lines per section
    for (let l = 0; l < nLines; l++) lines.push(line());
    return `${label}\n${lines.join('\n')}`;
  };
  while (out.length < n) {
    i++;
    const parts = rnd() < 0.5
      ? [pick(LEAD), pick(MID), pick(TAIL)]
      : [pick(LEAD), pick(TAIL)];
    let title = parts.join(' ');
    // LEAD×MID×TAIL is only ~5.8k combinations; the old skip-on-duplicate loop spun
    // forever once the space was exhausted. A deterministic suffix keeps titles
    // unique (and keeps the leading-word collision pressure) at any n.
    if (seen.has(title)) title = `${title} ${out.length + 1}`;
    seen.add(title);
    const chorus = section('Chorus'); // repeated verbatim — realistic term frequency
    const text = [section('Verse 1'), chorus, section('Verse 2'), chorus, section('Verse 3'), section('Bridge')].join('\n\n');
    out.push({ key: `filler-${i}`, title, author: `Author ${i}`, text });
  }
  return out;
}
```

- [ ] **Step 4: Adapt the latency loop to the slower realistic corpus**

In `eval.test.ts`: change `const REPS = 5;` to `const REPS = 2;` and the test timeout from `60000` to `300000` (last argument of the `test('song search spike — measured evaluation', …)` call). The realistic corpus is ~3.5x slower per search; 5 reps at 3000 songs would run minutes.

- [ ] **Step 5: Run both harness files to verify green + record the new baseline**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS (including the existing BUG-002 order-independence GUARD and Task 1's probe guard). Note the newly printed metrics and latency — they are the post-realism baseline Task 4 pins. Expect ms/search at 3000 songs to jump to roughly ~140 ms (perf report §0).

- [ ] **Step 6: Commit**

```bash
git add scratch/search-spike/corpus.ts scratch/search-spike/corpus.test.ts scratch/search-spike/eval.test.ts
git commit -m "test(search-spike): realistic filler corpus; terminate title generation"
```

### Task 3: Adversarial corpus targets + labeled queries

The 46-query set detected none of W1–W10 (accuracy report: "a regression guard, not a detector"). Add the investigated adversarial cases as labeled queries, plus the corpus songs they need.

**Files:**
- Modify: `scratch/search-spike/corpus.ts` (append to `CURATED`)
- Modify: `scratch/search-spike/queries.ts` (`Intent` union, `INTENT_WEIGHT`, append to `QUERIES`)

**Interfaces:**
- Consumes: `CorpusSong`, `LabeledQuery` shapes (unchanged).
- Produces: new corpus keys `take-my-hand`, `heart-of-worship`, `son-of-god`, `person-of-peace`, `wellspring`, `farewell-song`, `standing-firm`, `1000-tongues`; new intent `'author-recall'`. Task 4's replay and every later ratchet run include these.

- [ ] **Step 1: Add the adversarial targets/competitors to `CURATED`** (append before the closing `];` of the array, after the `grosser-gott` entry):

```ts
  // --- Adversarial targets/competitors (2026-08-27 accuracy investigation) ---
  { key: 'take-my-hand', title: 'Take My Hand', author: 'Nobody Fictional',
    text: 'Verse 1\nWhen the road is long and the night is cold\nI will walk beside you still\n\nChorus\nGive me your hand and walk with me\nThrough the valley to the morning light' },
  { key: 'heart-of-worship', title: 'Heart of Worship', author: 'Matt Redman',
    text: 'Verse 1\nWhen the music fades all is stripped away\nAnd I simply come\n\nChorus\nI am coming back to the heart of worship\nAnd it is all about You all about You Jesus' },
  { key: 'son-of-god', title: 'The Son of God', author: 'Traditional',
    text: 'Verse 1\nThe Son of God goes forth to war\nA kingly crown to gain' },
  { key: 'person-of-peace', title: 'Person of Peace', author: 'Nobody Fictional',
    text: 'Verse 1\nA person of peace came near to me\nAnd showed me a better way' },
  { key: 'wellspring', title: 'Wellspring', author: 'Nobody Fictional',
    text: 'Verse 1\nWellspring of wonder fountain of life\nOverflowing in my soul' },
  { key: 'farewell-song', title: 'Farewell Song', author: 'Nobody Fictional',
    text: 'Verse 1\nSing farewell to the night\nMorning breaks and all is new' },
  { key: 'standing-firm', title: 'Standing Firm', author: 'Nobody Fictional',
    text: 'Verse 1\nStanding on the promises\nUpheld forever by his word' },
  { key: '1000-tongues', title: '1000 Tongues', author: 'Nobody Fictional',
    text: 'Verse 1\nA thousand tongues could never say\nHow good you are to me' },
```

(`1000 Tongues` is the W8 numeric competitor: it makes the existing `10000` labeled query honestly fail at rank 2 — documenting the out-of-scope W8 gap instead of letting the harness overstate quality.)

- [ ] **Step 2: Extend the intent set in `queries.ts`**

Add to the `Intent` union: `| 'author-recall'   // knows the artist, not the title`
Add to `INTENT_WEIGHT`: `'author-recall': 1,`

- [ ] **Step 3: Append the adversarial labeled queries** (end of `QUERIES`, before `];`):

```ts
  // --- Adversarial additions (2026-08-27 accuracy investigation) ---
  { intent: 'misspelled-title', q: 'praise recukless', field: 'all', target: 'reckless-love',
    note: 'W1: an exactly-matched common word must not beat the near-matched rare one' },
  { intent: 'misspelled-title', q: 'holy reckelss', field: 'all', target: 'reckless-love',
    note: 'W1 companion (the original #13 shape, now comparator-bound)' },
  { intent: 'audible-partial', q: 'art', field: 'all', target: 'how-great-thou-art',
    note: 'W3: word-interior substring ("Heart", "Departed") must not outrank the word-start match' },
  { intent: 'audible-partial', q: 'son', field: 'all', target: 'son-of-god',
    note: 'W3: "Person of Peace" word-interior trap' },
  { intent: 'audible-partial', q: 'well', field: 'all', target: 'wellspring',
    note: 'W3: word-START "Wellspring" is legitimate type-ahead; "Farewell" is not' },
  { intent: 'forgot-title-lyric', q: 'give me your hand', field: 'all', target: 'take-my-hand',
    note: 'W2: the user-reported stopword-fuzz bug; also replayed per-keystroke in stability.test.ts' },
  { intent: 'author-recall', q: 'asbury worship', field: 'all', target: 'reckless-love',
    note: 'W6 (unfixed, follow-up issue): exact author match cannot win a band tie today — expected miss' },
];
```

Note: the accuracy report's single-token `and` case has **no legitimate target**, so it cannot be a labeled query; it lands as a direct assertion in Task 6 (after the W3 fix makes it pass) and its corpus competitor (`standing-firm`) is added here.

- [ ] **Step 4: Run the harness to verify green and see the new misses**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS (there are no per-query assertions yet). The p@1-miss section must now list `praise recukless`, `holy reckelss`, `art`, `son`, `asbury worship`, `10000` (rank 2 behind `1000 Tongues`) — the harness is now a detector. If any of those unexpectedly ranks 1, re-read the corpus entry you added (a collision is missing) and fix it before continuing.

- [ ] **Step 5: Commit**

```bash
git add scratch/search-spike/corpus.ts scratch/search-spike/queries.ts
git commit -m "test(search-spike): adversarial targets and labeled queries"
```

### Task 4: Keystroke-replay stability metrics + metric ratchets; open the PR

Adopt churn + monotonicity as asserted metrics (accuracy report W4: 19% of keystrokes change the row Enter would cue; 22 violations of "once the target is rank 1, adding correct characters must not demote it"), and pin quality/latency floors so Phases 2–4 must not regress and must ratchet improvements.

**Files:**
- Create: `scratch/search-spike/ratchet.ts`
- Create: `scratch/search-spike/stability.test.ts`
- Modify: `scratch/search-spike/eval.test.ts` (import RATCHET; add assertions)

**Interfaces:**
- Consumes: `buildCorpus`, `QUERIES`, `createSongsRepo`, `openTestDb`.
- Produces: `RATCHET` constants — `unweightedP1Min`, `weightedP1MinPct`, `recall50MinPct`, `churnMax`, `monotonicityMax`, `giveMeYourHandRegressionsMax`, `latencyMs3000Max`. **Every later task that runs the harness reads and (on improvement) tightens these.**

- [ ] **Step 1: Create `scratch/search-spike/ratchet.ts`** with deliberately impossible initial values (the failing-test step — the first run prints the real numbers to pin):

```ts
// Measured floors/ceilings for the labeled corpus (348 curated+filler songs).
// RULES: a task that IMPROVES a metric MUST tighten its constant in the same
// commit — that is the ratchet. No task may loosen a value unless its plan step
// explicitly authorizes it. Latency is a local-machine guard with ~1.5x headroom,
// not a CI benchmark.
export const RATCHET = {
  // Quality floors (eval.test.ts)
  unweightedP1Min: 999,            // count of rank-1 hits over QUERIES
  weightedP1MinPct: 100,           // intent-weighted p@1, percent
  recall50MinPct: 100,             // intent-weighted recall@50, percent
  // Stability ceilings (stability.test.ts)
  churnMax: 0,                     // top-1 changes across all replayed keystrokes
  monotonicityMax: 0,              // rank-1 target demoted by a CORRECT added character
  giveMeYourHandRegressionsMax: 0, // hit→miss regressions replaying the reported bug
  // Perf ceiling (eval.test.ts latency loop)
  latencyMs3000Max: 1,             // avg ms/search at 3000 songs
};
```

- [ ] **Step 2: Create `scratch/search-spike/stability.test.ts`**:

```ts
// Keystroke replay over every labeled query: measures (a) top-1 churn — how often
// the row Enter would cue changes under the operator's fingers — and (b)
// monotonicity violations — the target held rank 1, then a CORRECT added
// character demoted it. Both are asserted against RATCHET so accuracy work can
// only improve them. Run with the harness config:
//   npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept
import { test, expect } from 'vitest';
import { openTestDb } from '../../src/main/testDb';
import { createSongsRepo, type SongsRepo } from '../../src/main/songsRepo';
import { buildCorpus } from './corpus';
import { QUERIES } from './queries';
import { RATCHET } from './ratchet';

interface Replay { churn: number; mono: number; steps: number; regressions: Map<string, number> }

function replay(repo: SongsRepo, keyToId: Map<string, string>): Replay {
  let churn = 0; let mono = 0; let steps = 0;
  const regressions = new Map<string, number>();
  for (const q of QUERIES) {
    const targetId = keyToId.get(q.target)!;
    let prevTop: string | null = null;
    let prevWasRank1 = false;
    let reg = 0;
    for (let i = 1; i <= q.q.length; i++) {
      const prefix = q.q.slice(0, i);
      if (!prefix.trim()) continue;
      steps++;
      const res = repo.search(prefix, q.field);
      const top = res[0]?.song.id ?? null;
      if (prevTop !== null && top !== prevTop) churn++;
      prevTop = top;
      const isRank1 = top !== null && top === targetId;
      if (prevWasRank1 && !isRank1) { mono++; reg++; }
      prevWasRank1 = isRank1;
    }
    regressions.set(q.q, reg);
  }
  return { churn, mono, steps, regressions };
}

test('keystroke replay — churn, monotonicity and the reported bug stay ratcheted', () => {
  const repo = createSongsRepo(openTestDb());
  const keyToId = new Map<string, string>();
  for (const s of buildCorpus(300)) {
    keyToId.set(s.key, repo.add({ title: s.title, author: s.author, text: s.text, source: 'seed' }).id);
  }
  const r = replay(repo, keyToId);
  console.log(`replay: ${r.steps} keystrokes | top-1 churn ${r.churn} | monotonicity violations ${r.mono}`);
  console.log(`"give me your hand" hit→miss regressions: ${r.regressions.get('give me your hand')}`);
  expect(r.churn).toBeLessThanOrEqual(RATCHET.churnMax);
  expect(r.mono).toBeLessThanOrEqual(RATCHET.monotonicityMax);
  expect(r.regressions.get('give me your hand')).toBeLessThanOrEqual(RATCHET.giveMeYourHandRegressionsMax);
}, 300000);
```

- [ ] **Step 3: Add the quality + latency assertions to `eval.test.ts`**

Import at the top: `import { RATCHET } from './ratchet';`

Directly after the `unweighted p@1=` console.log (line ~84):

```ts
  // ---- RATCHET: quality floors — tighten in ratchet.ts whenever a fix improves them ----
  expect(uHit1).toBeGreaterThanOrEqual(RATCHET.unweightedP1Min);
  expect((100 * wP1) / wSum).toBeGreaterThanOrEqual(RATCHET.weightedP1MinPct);
  expect((100 * wRec) / wSum).toBeGreaterThanOrEqual(RATCHET.recall50MinPct);
```

Inside the latency loop, after the per-size `console.log`:

```ts
    if (size === 3000) expect(perSearch).toBeLessThanOrEqual(RATCHET.latencyMs3000Max);
```

- [ ] **Step 4: Run and verify it fails, harvesting the real numbers**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: FAIL on the new assertions, with the console printing the true measured values (e.g. `unweighted p@1=… (43/53)`, `replay: … churn 135 | monotonicity 22`-ish, `3000 songs: ~140 ms/search`). The exact numbers depend on Tasks 2–3's corpus and cannot be known before this run.

- [ ] **Step 5: Pin the measured values in `ratchet.ts`**

Set each constant from the run's output, exactly:
- `unweightedP1Min` = the printed rank-1 hit count; `weightedP1MinPct` / `recall50MinPct` = the printed percentages, rounded DOWN to the integer below.
- `churnMax` / `monotonicityMax` / `giveMeYourHandRegressionsMax` = the printed values, exactly.
- `latencyMs3000Max` = printed ms × 1.5, rounded up to the nearest 10 (local-machine headroom).

- [ ] **Step 6: Run twice to verify stable green**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept` (twice — the corpus PRNG is seeded, so metrics must be identical run-to-run; only latency varies, inside its headroom).
Expected: PASS both times.

- [ ] **Step 7: Commit and open the Phase 1 PR**

```bash
git add scratch/search-spike/ratchet.ts scratch/search-spike/stability.test.ts scratch/search-spike/eval.test.ts
git commit -m "test(search-spike): keystroke-replay stability metrics + ratchets"
git push -u origin song-search-harness
gh pr create --title "Song search: harness hardening (probe fix, realistic corpus, adversarial set, stability ratchets)" --body "$(cat <<'EOF'
Phase 1 of the song-search improvement plan (docs/superpowers/plans/2026-08-27-song-search-improvements.md).

- Fixes the harness's false fallback probe (it asserted the pre-#13 gate and blamed the wrong layer)
- Realistic ~150-350-word filler corpus; makeFiller now terminates past the ~5.8k title space
- Adds the investigated adversarial cases as labeled queries + corpus targets (W1/W2/W3/W6/W8 detectors)
- Adds keystroke-replay churn/monotonicity metrics and ratchets quality/stability/latency baselines

Harness only — no production code changed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Phase 2 — Measured zero-regression accuracy fixes

Branch (after Phase 1 merges): `git checkout main && git pull && git checkout -b song-search-accuracy`

### Task 5: W1 — `covWeight` before `titleCloseness` in the comparator

An exactly-matched common word currently beats a near-matched rare one: `compareRelevance` consults `titleCloseness` (`songScore.ts:101`) before `covWeight` (`:102`), so `praise recukless` ranks `Rise Praise` (tClose 0, covW 6) above `Reckless Love` (tClose 1, covW 9) — target at rank 27. Measured A/B (scratch): swapping is zero-regression on the labeled set and fixes both W1 queries to rank 1. Re-verify on the real harness here.

**Files:**
- Modify: `src/shared/search/songScore.ts:100-102` (`compareRelevance`)
- Test: `src/shared/search/songScore.test.ts`
- Modify (ratchet tighten): `scratch/search-spike/ratchet.ts`

**Interfaces:**
- Consumes: existing `ScoredSong` fields (no shape change).
- Produces: comparator order `score, titleCoverage, covWeight, titleCloseness, phrase, coverage, rel, tf, titleStartsWith, titleLen, title`. Task 7 inserts `dist` after `titleCloseness`.

- [ ] **Step 1: Write the failing test** (append to `songScore.test.ts`):

```ts
// --- W1: how much of the query matched outranks how closely one title word matched ---
test('more of the query matched beats a closer single-word title fuzz (W1)', () => {
  // "praise" matches Rise Praise exactly (tClose 0) but covers 6 chars of the query;
  // "recukless"~"reckless" is 1 edit (tClose 1) but covers 9. The fuller match wins.
  const praise = song('praise', 'Rise Praise', '', [['V', ['rise up and praise']]]);
  const reckless = song('reckless', 'Reckless Love', '', [['V', ['oh the overwhelming never ending reckless love of god']]]);
  for (const lib of [[praise, reckless], [reckless, praise]]) {
    expect(rankSongs('praise recukless', lib, 'all')[0].song.id).toBe('reckless');
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/shared/search/songScore.test.ts`
Expected: FAIL — both songs score 360, `titleCoverage` ties at 1, `titleCloseness` 0 < 1 picks `Rise Praise`.

- [ ] **Step 3: Swap the two comparator lines** in `compareRelevance` (`songScore.ts`):

```ts
  if (b.titleCoverage !== a.titleCoverage) return b.titleCoverage - a.titleCoverage;
  if (b.covWeight !== a.covWeight) return b.covWeight - a.covWeight; // more of the query matched (W1) — stopwords weigh less
  if (a.titleCloseness !== b.titleCloseness) return a.titleCloseness - b.titleCloseness;
```

- [ ] **Step 4: Run the song-search suite** (the accuracy report predicts no fixture disagrees — verify):

Run: the song-search suite (see Global Constraints).
Expected: all PASS, including the new test.

- [ ] **Step 5: Re-verify on the real harness and tighten the ratchet**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS; `praise recukless` and `holy reckelss` leave the p@1-miss list (rank 1). In `ratchet.ts`, raise `unweightedP1Min` (and `weightedP1MinPct` if the printed value rose) to the new printed values; if churn/monotonicity printed lower, lower those ceilings too. Re-run to confirm green with the tightened values.

- [ ] **Step 6: Commit**

```bash
git add src/shared/search/songScore.ts src/shared/search/songScore.test.ts scratch/search-spike/ratchet.ts
git commit -m "fix(search): covWeight outranks titleCloseness in tie-break (W1)"
```

### Task 6: W3 — the title-substring band anchors at a word start

`songScore.ts:77` `title.includes(q)` is a raw substring test while everything else is whole-word: `art` lands ~998 inside "He**art** of Worship", above `How Great Thou Art` (985). Anchor the band at a word start (index 0 or preceded by a space); score values are preserved (`1000 - index-of-the-word-start`), so mid-word *type-ahead from a word start* (`wor` → "Worship", `well` → "Wellspring") is untouched. Measured zero-cost on the labeled set.

**Files:**
- Modify: `src/shared/search/songScore.ts:77`
- Test: `src/shared/search/songScore.test.ts`, `src/main/songSearchRanking.test.ts`
- Modify: `scratch/search-spike/eval.test.ts` (the `'and'` guard), `scratch/search-spike/ratchet.ts` (tighten)

**Interfaces:**
- Consumes: `title` (normalized), `q` (normalized) — already in scope.
- Produces: same band values for word-start hits: `title === q` → 1200; `startsWith` → 1000; interior word-start at index i → `1000 - i`. Word-interior substrings fall through to the token bands.

- [ ] **Step 1: Write the failing tests**

Append to `songScore.test.ts`:

```ts
// --- W3: the title-substring band must anchor at a word start ---
test('a word-interior substring does not take the title band: "art" vs "Heart" (W3)', () => {
  const heart = song('heart', 'Heart of Worship', '', [['V', ['when the music fades']]]);
  const thouArt = song('thouart', 'How Great Thou Art', '', [['V', ['then sings my soul']]]);
  for (const lib of [[heart, thouArt], [thouArt, heart]]) {
    expect(rankSongs('art', lib, 'all')[0].song.id).toBe('thouart');
  }
  // and the interior hit contributes no title band at all
  expect(scoreSong('art', heart, 'all').score).toBe(0);
});

test('word-start type-ahead keeps its exact band values (W3)', () => {
  const wellspring = song('wellspring', 'Wellspring', '', [['V', ['water rises']]]);
  expect(scoreSong('well', wellspring, 'all').score).toBe(1000);           // startsWith
  const itIsWell = song('itiswell', 'It Is Well With My Soul', '', [['V', ['it is well']]]);
  expect(scoreSong('well', itIsWell, 'all').score).toBe(994);              // ' well' at index 6 → 1000-6
});
```

Append to `songSearchRanking.test.ts` (fixture `standing` already exists there):

```ts
test('a word-interior title substring does not put a song in ALL-field results (W3)', () => {
  // the existing 'and' guard at the end of this file only proves the LYRIC field;
  // 'all' is what operators actually use, and pre-fix "Standing Firm" scored 998 here
  const hits = repo.search('and', 'all').map((r) => r.song.id);
  expect(hits).not.toContain(ids.get('standing'));
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `npx vitest run src/shared/search/songScore.test.ts src/main/songSearchRanking.test.ts`
Expected: FAIL — `heart` wins at 998; `search('and','all')` contains Standing Firm at 998.

- [ ] **Step 3: Implement** — replace `songScore.ts:77`:

```ts
  // Title-substring band anchors at a WORD START (W3): "art" may hit "How Great
  // Thou Art" but never the inside of "Heart". A word-start hit at index i keeps
  // the exact legacy weight 1000 - i, so earlier-in-title still ranks higher and
  // word-start type-ahead ("wor" → Worship) is unchanged.
  if (field !== 'lyric') {
    if (title === q) score = 1200;
    else if (title.startsWith(q)) score = 1000;
    else {
      const i = title.indexOf(` ${q}`);
      if (i >= 0) score = 1000 - (i + 1);
    }
  }
```

- [ ] **Step 4: Run the song-search suite**

Run: the song-search suite.
Expected: all PASS (the pinned type-ahead tests at `songScore.test.ts:132-142` are `lyric`-field and unaffected; `songSearchRanking.test.ts:134` keeps passing).

- [ ] **Step 5: Re-verify on the harness, add the `'and'` guard, tighten the ratchet**

In `eval.test.ts`, after the Task 1 probe guards, add:

```ts
  // W3 guard (all-field): a word-interior substring must not fabricate a result.
  expect(b.repo.search('and', 'all').map((r) => r.song.title)).not.toContain('Standing Firm');
```

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS; `art` / `son` / `well` leave the p@1-miss list. Tighten `unweightedP1Min` (and weighted/stability values if improved) in `ratchet.ts`; re-run to confirm.

- [ ] **Step 6: Commit**

```bash
git add src/shared/search/songScore.ts src/shared/search/songScore.test.ts src/main/songSearchRanking.test.ts scratch/search-spike/eval.test.ts scratch/search-spike/ratchet.ts
git commit -m "fix(search): title-substring band anchors at word starts (W3)"
```

### Task 7: W5 — add the already-computed `dist` signal to the comparator

Lyric mode zeroes `titleCoverage`/`titleCloseness` (`songScore.ts:88`), leaving no edit-distance discrimination at all: an exact lyric match cannot outrank a 2-edit fuzz (`senor` sits at rank 2). `textSignals` already computes `dist` (`fuzzy.ts:74-76`) and nothing consumes it. Surface it and compare it after the title signals (which satisfies the spec's "after covWeight" and keeps the two title signals adjacent).

**Files:**
- Modify: `src/shared/search/songScore.ts` (`ScoredSong`, `scoreSignals`, `compareRelevance`)
- Test: `src/shared/search/songScore.test.ts`
- Modify (tighten): `scratch/search-spike/ratchet.ts`

**Interfaces:**
- Consumes: `textSignals(...).dist` (already returned by `fuzzy.ts`).
- Produces: `ScoredSong.dist: number` (Σ best match distance of matched tokens; lower wins). Comparator order after this task: `score, titleCoverage, covWeight, titleCloseness, dist, phrase, coverage, rel, tf, titleStartsWith, titleLen, title`. Tasks 11–12 read `textSignals` fields beside it.

- [ ] **Step 1: Write the failing test** (append to `songScore.test.ts`):

```ts
// --- W5: lyric mode gains edit-distance discrimination via the dist signal ---
test('an exact match outranks an equally covered fuzzy match in lyric mode (W5)', () => {
  // Constructed so every pre-dist signal ties: both match both tokens (covW 10),
  // both have a 2-run phrase, and tf ties at 2 ("sanor" is not an exact occurrence
  // but "jesus" appears twice). Pre-fix the shorter title wins; dist must decide.
  const exact = song('exact', 'Alphabet Song', '', [['V', ['senor jesus reigns']]]);
  const fuzz = song('fuzz', 'Beta', '', [['V', ['sanor jesus jesus']]]);
  for (const lib of [[exact, fuzz], [fuzz, exact]]) {
    expect(rankSongs('senor jesus', lib, 'lyric')[0].song.id).toBe('exact');
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/shared/search/songScore.test.ts`
Expected: FAIL — all signals tie until `titleLen` picks `Beta` (4 < 13).

- [ ] **Step 3: Implement.** Three edits in `songScore.ts`:

(a) Add to the `ScoredSong` interface, after `covWeight`:

```ts
  dist: number;            // Σ best match distance of matched tokens (exact 0, prefix 1,
                           // fuzzy = edit distance) — lower wins; the only match-quality
                           // signal that survives into lyric mode (W5)
```

(b) In `scoreSignals`: destructure and return it —

```ts
  const { matched, strong, covWeight, tf, phrase, dist } = textSignals(segs, qts);
```

add `dist: 0,` to the `empty` literal (line 60), and `dist,` to the returned object literal (line 93, next to `covWeight`).

(c) In `compareRelevance`, insert after the `titleCloseness` line:

```ts
  if (a.dist !== b.dist) return a.dist - b.dist;                     // closer/more exact matches win (W5)
```

- [ ] **Step 4: Run the song-search suite**

Run: the song-search suite.
Expected: all PASS — every existing tie-break fixture has equal `dist` on both sides (exact matches), so `dist` is neutral where it isn't the fix.

- [ ] **Step 5: Re-verify on the harness; decision gate**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS; `senor` (lyric) reaches rank 1. **Decision gate:** if the stability ratchet fails (dist can theoretically demote a target mid-word when a competitor matches a shorter prefix more exactly — e.g. the `blese` step of `blesed assurance`), move the `dist` comparison down to sit after `coverage` instead, re-run both suites and the harness, and note the placement in the commit body. Do not loosen the ratchet. Tighten ratchet values that improved; re-run to confirm.

- [ ] **Step 6: Commit**

```bash
git add src/shared/search/songScore.ts src/shared/search/songScore.test.ts scratch/search-spike/ratchet.ts
git commit -m "feat(search): dist tie-break separates exact from fuzzy matches (W5)"
```

### Task 8: W7 — order the FTS-path candidate fetch like `list()`

Two songs identical on every signal make `compareRelevance` return 0, so `Array.sort` stability hands the decision to candidate-array order — and the two candidate paths order differently: the FTS-path fetch (`songsRepo.ts:146`) has no `ORDER BY` (rowid order), while the fallback `list()` orders by `created_at, title`. Crossing the 30-hit gate mid-typing can flip which of two identical arrangements Enter cues.

**Files:**
- Modify: `src/main/songsRepo.ts:146`
- Test: `src/main/songsRepo.test.ts`

**Interfaces:**
- Consumes: existing `songs` table columns.
- Produces: both candidate paths deliver `ORDER BY created_at, title` order. Task 17 preserves this contract when it merges the queries (JS-side sort `libraryOrder`), guarded by this task's test.

- [ ] **Step 1: Write the failing test** (append to `songsRepo.test.ts`):

```ts
test('FTS-path candidate order matches list() order, so full ties rank identically on both paths (W7)', () => {
  const db = openTestDb();
  const r = createSongsRepo(db);
  // Two byte-identical arrangements: every relevance signal ties, so candidate
  // order is the only decider. Give the LATER rowid the EARLIER created_at.
  const a = r.add({ title: 'Duplicate Anthem', text: 'Verse 1\nduplicate light shines' });
  const b = r.add({ title: 'Duplicate Anthem', text: 'Verse 1\nduplicate light shines' });
  db.prepare('UPDATE songs SET created_at = ? WHERE id = ?').run(1000, b.id);
  db.prepare('UPDATE songs SET created_at = ? WHERE id = ?').run(2000, a.id);
  // 30 decoys sharing the token, so the FTS path (not the full scan) runs.
  for (let i = 0; i < 30; i++) r.add({ title: `Filler ${i}`, text: 'Verse 1\nduplicate voices sing' });
  const viaFts = r.search('duplicate', 'all').map((x) => x.song.id);
  expect(viaFts.indexOf(b.id)).toBeLessThan(viaFts.indexOf(a.id)); // created_at order, like list()
  // and the full-scan path agrees ("duplicqte" has no FTS hit → library scan)
  const viaScan = r.search('duplicqte', 'all').map((x) => x.song.id);
  expect(viaScan.indexOf(b.id)).toBeLessThan(viaScan.indexOf(a.id));
});
```

(`created_at` is not in `song_fts`, so the raw UPDATE desyncs nothing.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/songsRepo.test.ts`
Expected: FAIL on the first assertion — the `IN (…)` fetch returns rowid order, putting `a` (earlier rowid) first.

- [ ] **Step 3: Implement** — in `songsRepo.ts` `search()`, add the ORDER BY to the candidate fetch:

```ts
        candidates = (db.prepare(`SELECT rowid, * FROM songs WHERE rowid IN (${qs}) ORDER BY created_at, title`).all(...hits.map((h) => h.rowid)) as Row[]).map(toSong);
```

- [ ] **Step 4: Run the song-search suite**

Run: the song-search suite. Expected: all PASS (zero ranking-semantics change — only full-tie order).

- [ ] **Step 5: Harness sanity run**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS, metrics unchanged (the corpus has no full-tie duplicates; this is a correctness guard, not a metric mover).

- [ ] **Step 6: Commit**

```bash
git add src/main/songsRepo.ts src/main/songsRepo.test.ts
git commit -m "fix(search): FTS-path candidates ordered like list() (W7)"
```

### Task 9: W9 — title and author become separate phrase segments; open the PR

`songScore.ts:70` builds ONE segment from `norm(title + ' ' + author)`, so a phrase run bridges title into author: `scoreSong('grace john', AmazingGrace-by-John-Newton).phrase === 2`. The comment at `:64-66` promises segments don't bridge — make it true.

**Files:**
- Modify: `src/shared/search/songScore.ts:70`
- Test: `src/shared/search/songScore.test.ts`

**Interfaces:**
- Consumes: `title` (already normalized at `:59`), `song.author`.
- Produces: `segs` = `[titleWords, authorWords, ...sectionWords]` for `all` field. `tf`/`coverage`/`covWeight` are unchanged (they sum across segments); only phrase adjacency stops bridging. Task 17's `SongDoc` reproduces exactly this segmentation.

- [ ] **Step 1: Write the failing test** (append to `songScore.test.ts`; `AMAZING` — title "Amazing Grace", author "John Newton" — is the fixture at the top of the file):

```ts
// --- W9: phrase runs must not bridge from title into author ---
test('a phrase run cannot bridge title into author (W9)', () => {
  expect(scoreSong('grace john', AMAZING, 'all').phrase).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/shared/search/songScore.test.ts`
Expected: FAIL — phrase is 2 (the merged `[amazing, grace, john, newton]` segment).

- [ ] **Step 3: Implement** — replace the merged-segment line in `scoreSignals` (`songScore.ts:70`):

```ts
    if (field !== 'lyric') {
      // Title and author are separate segments (W9): "grace john" must not earn a
      // phrase run bridging "Amazing Grace" into "John Newton".
      const tw = title.split(' ').filter(Boolean);
      if (tw.length) segs.push(tw);
      const aw = norm(song.author).split(' ').filter(Boolean);
      if (aw.length) segs.push(aw);
    }
```

- [ ] **Step 4: Run the song-search suite**

Run: the song-search suite. Expected: all PASS (tf/coverage are segment-order-independent; no fixture asserts a title→author phrase).

- [ ] **Step 5: Harness re-verify + final Phase 2 ratchet pass**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS. Confirm `ratchet.ts` now reflects every Phase 2 improvement (Tasks 5–7 tightened as they landed; verify the printed metrics equal the ratchet floors or better). Also run the full repo suite once before the PR: `npx vitest run`.

- [ ] **Step 6: Commit and open the Phase 2 PR**

```bash
git add src/shared/search/songScore.ts src/shared/search/songScore.test.ts
git commit -m "fix(search): title and author are separate phrase segments (W9)"
git push -u origin song-search-accuracy
gh pr create --title "Song search: measured zero-regression accuracy fixes (W1, W3, W5, W7, W9)" --body "$(cat <<'EOF'
Phase 2 of docs/superpowers/plans/2026-08-27-song-search-improvements.md.

- W1: covWeight outranks titleCloseness — "praise recukless" 27→1, "holy reckelss" 15→1
- W3: title-substring band anchors at word starts — kills the "art"→"Heart" false-positive class
- W5: dist tie-break — lyric mode can finally tell exact from fuzzy ("senor" 2→1)
- W7: FTS-path candidate fetch ordered like list() — full ties no longer flip across the 30-hit gate
- W9: title/author phrase segments split

Each fix re-verified against the hardened spike harness; quality ratchets tightened accordingly.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Phase 3 — The reported bug (W2 "give me your hand") + W4 stability

Branch (after Phase 2 merges): `git checkout main && git pull && git checkout -b song-search-stopword-fuzz`

Context for every task in this phase (accuracy report W2): with no song containing the phrase, rank 1 for `give me your hand` is a song that matched **one stopword** (`your~your`), because (1) the 360 band admits any `strong > 0` match and `matchTol` lets `hand`~`and`, `your`~`you`/`our`, `me`~`he`/`we`; (2) `titleCoverage` counts 1–2 char tokens; (3) the `<3`-char prefix gate collapses the full band mid-word (`…your ha` drops 428→360). Phase 1's replay metrics arbitrate every change here.

### Task 10: 1–2 char query tokens earn no title credit

`songScore.ts:89-90` counts every query token toward `titleCoverage`/`titleCloseness` with no length guard, unlike `strong` in `textSignals` (≥3). A title containing `your` (or fuzzing `me`→`we`) earns full title relevance.

**Files:**
- Modify: `src/shared/search/songScore.ts:88-91`
- Test: `src/shared/search/songScore.test.ts`
- Modify (tighten): `scratch/search-spike/ratchet.ts`

**Interfaces:**
- Consumes: `bestMatch` (unchanged).
- Produces: `titleCoverage`/`titleCloseness` count only tokens of length ≥ 3 (mirror of the `strong` rule).

- [ ] **Step 1: Write the failing test** (append to `songScore.test.ts`):

```ts
// --- W2 hardening: 1-2 char tokens fuzz into any title and earn no title credit ---
test('a 1-2 char query token earns no title relevance credit (W2)', () => {
  // pre-fix "me"~"we" (lev 1, tol 1) inflated titleCoverage to 2 / titleCloseness to 1
  const s = song('wesing', 'We Sing', '', [['V', ['we sing together']]]);
  const r = scoreSong('me sing', s, 'all');
  expect(r.titleCoverage).toBe(1);   // "sing" only
  expect(r.titleCloseness).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/shared/search/songScore.test.ts`
Expected: FAIL — `titleCoverage` is 2, `titleCloseness` 1.

- [ ] **Step 3: Implement** — in `scoreSignals`, the tie-break block:

```ts
  let titleCoverage = 0; let titleCloseness = 0;
  if (field !== 'lyric') {
    const titleWords = title.split(' ');
    for (const t of qts) {
      if (t.length < 3) continue; // mirror `strong`: a 1-2 char stopword fuzzes into any title (W2)
      const d = bestMatch(t, titleWords);
      if (d < 99) { titleCoverage++; titleCloseness += d; }
    }
  }
```

- [ ] **Step 4: Run the song-search suite**

Run: the song-search suite. Expected: all PASS (every existing title-signal fixture uses ≥3-char tokens).

- [ ] **Step 5: Harness re-verify + tighten**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS; churn/monotonicity typically improve (stopword title-credit was a W4 driver) — tighten `ratchet.ts` to the printed values and re-run to confirm.

- [ ] **Step 6: Commit**

```bash
git add src/shared/search/songScore.ts src/shared/search/songScore.test.ts scratch/search-spike/ratchet.ts
git commit -m "fix(search): 1-2 char tokens earn no title credit"
```

### Task 11: A short trailing token no longer collapses the full-match band

Mid-word on the 4th word — `give me your ha` — the trailing `ha` (< 3 chars: no prefix credit at `fuzzy.ts:47`, fuzz-blind) fails `matched === qts.length`, so the target drops 428 → 360 into the stopword soup. Exempt the **last** token, when < 3 chars and unmatched, from the full-band requirement — extending the pinned mid-word type-ahead guarantee (`songScore.test.ts:137-142`, `songSearchRanking.test.ts:120-124`), not weakening it. Requires knowing *which* token went unmatched → expose `bestDist` from `textSignals` (additive).

**Files:**
- Modify: `src/shared/search/fuzzy.ts` (`TextSignals` + `textSignals` return)
- Modify: `src/shared/search/songScore.ts` (band logic)
- Test: `src/shared/search/fuzzy.test.ts`, `src/shared/search/songScore.test.ts`

**Interfaces:**
- Consumes: `textSignals` internals (the `bestDist` array already exists locally).
- Produces: `TextSignals.bestDist: number[]` — per query token, best admissible match distance, `99` = unmatched. Additive: message/verse scorers and `passages.ts` ignore it. Task 12 extends the same struct again.

- [ ] **Step 1: Write the failing tests**

Append to `fuzzy.test.ts`:

```ts
describe('textSignals bestDist', () => {
  test('exposes per-token best distance, 99 for unmatched', () => {
    const s = textSignals([['give', 'me', 'your', 'hand']], ['give', 'your', 'zz']);
    expect(s.bestDist).toEqual([0, 0, 99]);
  });
});
```

Append to `songScore.test.ts` (`TWO_LINES` is the existing fixture):

```ts
// --- W2: the operator's unfinished trailing token must not collapse the band ---
test('a short trailing mid-word token keeps the full-match band (W2)', () => {
  // "ha" (2 chars) cannot match "hand" yet; the three complete tokens still carry
  // the band ("give me your h" held 428 one keystroke earlier)
  const s = song('takemyhand', 'Take My Hand', '', [['V', ['give me your hand tonight']]]);
  expect(scoreSong('give me your ha', s, 'all').score).toBe(416); // 380 + 3*12
  // only the TRAILING token is exempt — an unmatched short middle token is not
  expect(scoreSong('give zx your hand', s, 'all').score).toBe(360);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/shared/search/fuzzy.test.ts src/shared/search/songScore.test.ts`
Expected: FAIL — `bestDist` undefined; `give me your ha` scores 360.

- [ ] **Step 3: Implement**

In `fuzzy.ts`, add to the `TextSignals` interface:

```ts
  bestDist: number[]; // per query token: best admissible match distance, 99 = unmatched.
                      // Lets a caller see WHICH token missed (the trailing-token band
                      // exemption in songScore). Additive: other consumers ignore it.
```

and change `textSignals`'s return to include it: `return { matched, strong, covWeight, tf, phrase, dist, bestDist };`

In `songScore.ts` `scoreSignals`, keep the full signals object and rewrite the band block:

```ts
  const sig = textSignals(segs, qts);
  const { matched, strong, covWeight, tf, phrase, dist } = sig;

  let score = 0;
  if (field !== 'lyric') {
    if (title === q) score = 1200;
    else if (title.startsWith(q)) score = 1000;
    else {
      const i = title.indexOf(` ${q}`);
      if (i >= 0) score = 1000 - (i + 1);
    }
  }
  // Mid-word type-ahead: the operator's unfinished LAST token (<3 chars — too short
  // for prefix credit, fuzz-blind) must not collapse the full-match band the query
  // held one keystroke ago ("give me your ha" after "give me your h") (W2).
  const last = qts.length - 1;
  const trailingExempt = qts.length > 1 && qts[last].length < 3
    && sig.bestDist[last] === 99 && matched === qts.length - 1;
  if ((matched === qts.length || trailingExempt) && matched > 0) score = Math.max(score, 380 + matched * 12);
  // The partial band needs at least one significant matched token — 1-2 char stopwords
  // fuzz into nearly anything and must not qualify a song on their own.
  else if (strong > 0 && field !== 'title') score = Math.max(score, 360);
```

- [ ] **Step 4: Run the song-search suite + cross-feature suites** (fuzzy.ts changed):

Run: the song-search suite, then the cross-feature suites.
Expected: all PASS (`bestDist` is additive; `'zephaniah of'` stays honest-empty — its trailing `of` MATCHES, so `bestDist[last] !== 99` and no exemption applies).

- [ ] **Step 5: Harness re-verify + tighten**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS; the `give me your hand` replay regressions should drop (the step-15 collapse is gone) — tighten `giveMeYourHandRegressionsMax` and any improved churn/mono values; re-run to confirm.

- [ ] **Step 6: Commit**

```bash
git add src/shared/search/fuzzy.ts src/shared/search/fuzzy.test.ts src/shared/search/songScore.ts src/shared/search/songScore.test.ts scratch/search-spike/ratchet.ts
git commit -m "feat(search): short trailing token keeps the full-match band"
```

### Task 12: The 360 band requires a *solid* strong match

`songScore.ts:81` admits any song with `strong > 0`, and `matchTol` lets `hand`~**`and`**, `your`~`you`/`our` — so 16% of the library qualifies on stopword fuzz alone (the reported bug's rank-1 rows). Constraint: `songScore.test.ts:116-121` pins `swet zzzzz` at **exactly 360** (`swet`~`sweet`: 4-char token, dist 1) — so no per-token length/dist rule can work; the discriminator must look at the **matched word**. Chosen mechanism: a band-qualifying strong token must have an admissible match to a word **at least as long as the token** (`w.length >= t.length`). Fuzzing *into a shorter word* (`hand`→`and`, `your`→`you`, `me`→`he`) is the stopword-noise signature; exact matches, prefix matches and typo fixes (`swet`→`sweet`, `reckelss`→`reckless`) are all equal-or-longer. This keeps every pinned test true — the pinned 360 value does NOT change.

**Files:**
- Modify: `src/shared/search/fuzzy.ts` (`TextSignals.strongSolid` + computation)
- Modify: `src/shared/search/songScore.ts:81` (band gate)
- Test: `src/shared/search/fuzzy.test.ts`, `src/shared/search/songScore.test.ts`

**Interfaces:**
- Consumes: the per-word loop in `textSignals` (word text `w` is in scope).
- Produces: `TextSignals.strongSolid: number` — matched tokens of length ≥ 3 with at least one admissible match to a word with `w.length >= t.length`. The 360 band gates on `strongSolid > 0` instead of `strong > 0`. `strong` itself is unchanged (message scorer keeps its meaning).

- [ ] **Step 1: Write the failing tests**

Append to `fuzzy.test.ts`:

```ts
describe('textSignals strongSolid', () => {
  test('a fuzz into a SHORTER word is not solid; equal-or-longer is', () => {
    expect(textSignals([['and']], ['hand']).strongSolid).toBe(0);   // hand→and (4→3): noise signature
    expect(textSignals([['sweet']], ['swet']).strongSolid).toBe(1); // swet→sweet (4→5): typo fix
    expect(textSignals([['reckless']], ['reckelss']).strongSolid).toBe(1);
    expect(textSignals([['the']], ['the']).strongSolid).toBe(1);    // exact match is always solid
  });
});
```

Append to `songScore.test.ts`:

```ts
// --- W2: stopword-fuzz alone cannot open the partial band ---
test('a fuzz into a shorter stopword cannot open the partial band (W2)', () => {
  // "hand" edit-matches "and" — present in essentially every worship lyric; that
  // alone must not admit a song
  const s = song('andsong', 'Faithful Anthem', '', [['V', ['faithful and true forever']]]);
  expect(scoreSong('give me your hand', s, 'all').score).toBe(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/shared/search/fuzzy.test.ts src/shared/search/songScore.test.ts`
Expected: FAIL — `strongSolid` undefined; the Faithful Anthem case scores 360.

- [ ] **Step 3: Implement**

In `fuzzy.ts`, `TextSignals` gains:

```ts
  strongSolid: number; // strong tokens whose match is "solid": exact, prefix, or a fuzz
                       // into a word at least as long as the token. Fuzzing INTO a
                       // shorter word (hand→and, your→you) is the stopword-noise
                       // signature and cannot anchor the partial band on its own (W2).
```

In `textSignals`, add a `solid` tracker beside `bestDist`:

```ts
  const bestDist: number[] = qts.map(() => 99);
  const solid: boolean[] = qts.map(() => false);
  const wordMask = new Map<string, number>();
  for (const w of counts.keys()) {
    let mask = 0;
    for (let j = 0; j < qts.length; j++) {
      const d = matchDist(qts[j], w);
      if (d <= matchTol(qts[j].length)) {
        if (j < PHRASE_MAX_TOKENS) mask |= 1 << j;
        if (d < bestDist[j]) bestDist[j] = d;
        if (w.length >= qts[j].length) solid[j] = true;
      }
    }
    if (mask) wordMask.set(w, mask);
  }
  let matched = 0; let strong = 0; let strongSolid = 0; let covWeight = 0; let tf = 0; let dist = 0;
  for (let j = 0; j < qts.length; j++) {
    if (bestDist[j] < 99) {
      matched++; covWeight += qts[j].length; dist += bestDist[j];
      if (qts[j].length >= 3) { strong++; if (solid[j]) strongSolid++; }
    }
    tf += counts.get(qts[j]) ?? 0;
  }
```

and return it: `return { matched, strong, strongSolid, covWeight, tf, phrase, dist, bestDist };`

In `songScore.ts`, destructure `strongSolid` from `sig` and change the 360 gate:

```ts
  else if (strongSolid > 0 && field !== 'title') score = Math.max(score, 360);
```

(keep destructuring `strong` OUT of the songScore if now unused — remove it from the destructuring list to keep lint clean.)

- [ ] **Step 4: Run the song-search suite + cross-feature suites**

Run: the song-search suite, then the cross-feature suites.
Expected: all PASS. Specifically re-check the pins this was engineered around: `swet zzzzz` still exactly 360 (`sweet` is longer than `swet` → solid); `'the god of angel armies'` fixture still ranks `rareword` first (both sides keep a solid strong match — `armies` exact, `the` exact); `'zephaniah of'` still empty.

- [ ] **Step 5: Harness re-verify + tighten**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS. The reported-bug shape is now bounded: rank-1 can no longer be a `hand~and`-class fuzz (exact stopword hits like `your`~`your` remain admissible — they are genuine word hits and order below fuller matches via W1's covWeight). Tighten improved ratchet values; re-run to confirm.

- [ ] **Step 6: Commit**

```bash
git add src/shared/search/fuzzy.ts src/shared/search/fuzzy.test.ts src/shared/search/songScore.ts src/shared/search/songScore.test.ts scratch/search-spike/ratchet.ts
git commit -m "fix(search): partial band needs a solid strong match"
```

### Task 13: Pairwise fuzzy tolerance — the shorter side sets the budget (matchTol monotonicity)

W4 driver: `matchTol` steps 1→2 at length 5, so typing the 5th character **widens** the admitted set (`wors` tol 1 → `worsh` tol 2 re-admits `word`, `words`…). The `matchTol()` boundary values are pinned by `fuzzy.test.ts:24-30` and shared with the message/verse scorers — so `matchTol` itself is untouched. Chosen mechanism: at each token↔word comparison, the admission tolerance is `matchTol(min(t.length, w.length))` — a 5+-char token can no longer spend 2 edits against a ≤4-char word, which is precisely the short-word noise that re-enters at the step. Verified against every pin: `beleive`↔`believe` (7↔7 → 2) kept; `graev`↔`graves` (5↔6 → 2) kept; `swet`↔`sweet` (4↔5 → 1, lev 1) kept; `worsh`↔`word` (5↔4 → 1, lev 2) now rejected.

**Cross-feature blast radius (state this in the PR):** `textSignals` is consumed by `songScore`, `messageScore`, `verseScore`, and `scripture/passages`; `bestMatch` by `songScore` only; `highlight.ts` is aligned so verse highlighting matches what the verse scorer admits. `matchTol`, `fuzzyTok`, `matchDist`, `lev` and `biblesRepo.expandToken` are unchanged. The change is strictly narrowing (never admits a pair the old rule rejected).

**Files:**
- Modify: `src/shared/search/fuzzy.ts` (new `pairTol`; `textSignals` tol check; `bestMatch`)
- Modify: `src/shared/search/highlight.ts:8`
- Test: `src/shared/search/fuzzy.test.ts`
- Modify (tighten): `scratch/search-spike/ratchet.ts`

**Interfaces:**
- Consumes: `matchTol` (unchanged).
- Produces: `pairTol(t: string, w: string): number` exported from `fuzzy.ts`. Admission everywhere `textSignals`/`bestMatch`/`highlight` check tolerance becomes `d <= pairTol(token, word)`.

- [ ] **Step 1: Write the failing tests** (append to `fuzzy.test.ts`):

```ts
describe('pairTol', () => {
  test('the shorter side of the pair sets the edit budget', () => {
    expect(pairTol('worsh', 'word')).toBe(1);   // 5↔4 → the 4-char side budgets 1
    expect(pairTol('worsh', 'world')).toBe(2);  // 5↔5
    expect(pairTol('beleive', 'believe')).toBe(2);
    expect(pairTol('hand', 'and')).toBe(1);
  });
});

test('a 5+ char token cannot spend 2 edits against a <=4 char word (W4 monotonicity)', () => {
  // "worsh" (tol 2 by its own length) must not re-admit "word" (lev 2) that the
  // 4-char prefix "wors" (tol 1) had already rejected
  expect(textSignals([['word']], ['worsh']).matched).toBe(0);
  expect(textSignals([['words']], ['worsh']).matched).toBe(1); // 5↔5 keeps tol 2
});
```

(Remember to import `pairTol` in the test file's import list.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/shared/search/fuzzy.test.ts`
Expected: FAIL — `pairTol` not exported; `worsh`→`word` currently matched.

- [ ] **Step 3: Implement**

In `fuzzy.ts`, after `matchTol`:

```ts
// Tolerance for a specific token↔word pair: the SHORTER side sets the budget. A
// 5+ char token must not spend its widened 2-edit tolerance against a <=4-char
// word — that is exactly the short-word noise that RE-enters when the 5th typed
// character bumps matchTol from 1 to 2 ("wors"→"worsh" re-admitting "word"),
// breaking rank monotonicity under the operator's fingers (W4). Strictly
// narrowing; matchTol keeps the per-length table (pinned, shared cross-feature).
export function pairTol(t: string, w: string): number {
  return matchTol(Math.min(t.length, w.length));
}
```

In `textSignals`, the admission check becomes:

```ts
      const d = matchDist(qts[j], w);
      if (d <= pairTol(qts[j], w)) {
```

Rewrite `bestMatch` to apply the pair budget per word (its final blanket `matchTol(t.length)` check is superseded):

```ts
// Best admissible matchDist of token `t` against any word in `words`, or 99 if
// nothing is within its pair tolerance (see pairTol).
export function bestMatch(t: string, words: string[]): number {
  let best = 99;
  for (const w of words) {
    const dd = matchDist(t, w);
    if (dd === 0) return 0;
    if (dd <= pairTol(t, w) && dd < best) best = dd;
  }
  return best;
}
```

In `highlight.ts:8`, align the display rule with the scorer:

```ts
const isHit = (w: string, qts: string[]): boolean => qts.some((t) => matchDist(t, w) <= pairTol(t, w));
```

(add `pairTol` to that file's import from `./fuzzy`).

- [ ] **Step 4: Run the FULL repo suite** (not just the search suites — this is the cross-feature task):

Run: `npx vitest run`
Expected: all PASS. **Contingency (only if a message/verse/passages/highlight or bible gold-guard test fails):** do NOT relax any pinned test. Instead scope the rule to songs: give `textSignals` a trailing parameter `pairwise = false`, check `d <= (pairwise ? pairTol(qts[j], w) : matchTol(qts[j].length))`, pass `true` only from `songScore.ts`'s call, revert the `highlight.ts` edit, keep the `bestMatch` change (song-only consumer), and move the two W4 `textSignals` tests to call `textSignals(segs, qts, true)`. Note the scoping and the failing suite in the commit body.

- [ ] **Step 5: Harness re-verify — this task is keep-or-revert**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Decision gate: the change must (a) keep every quality floor and (b) improve or hold churn/monotonicity. If a quality floor fails (a labeled typo no longer rescued), `git revert` this commit's changes and record the measured reason in the plan-execution notes — the ratchets exist precisely so this experiment is cheap. On success, tighten the improved stability values; re-run to confirm.

- [ ] **Step 6: Commit**

```bash
git add src/shared/search/fuzzy.ts src/shared/search/fuzzy.test.ts src/shared/search/highlight.ts scratch/search-spike/ratchet.ts
git commit -m "feat(search): pairwise fuzzy tolerance - shorter side sets the budget"
```

### Task 14: Phase 3 validation — replay the reported bug end-to-end; open the PR

**Files:**
- Modify: `scratch/search-spike/ratchet.ts` (final Phase 3 tightening)

**Interfaces:** none new — this is the phase gate.

- [ ] **Step 1: Full harness run**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS. Inspect the stability output: `"give me your hand" hit→miss regressions` should now print **0** (the accuracy report measured 3 pre-fix). If it is not 0, STOP and diagnose by replaying the query prefix-by-prefix through `repo.search` (the accuracy report's W2 section shows the exact replay table to reproduce) before proceeding — do not paper over it by leaving a loose ratchet.

- [ ] **Step 2: Tighten the final Phase 3 ratchet values**

Pin `giveMeYourHandRegressionsMax: 0` (assuming Step 1 showed 0) and the final churn/monotonicity ceilings to the printed values. Re-run to confirm green.

- [ ] **Step 3: Full repo suite**

Run: `npx vitest run` — all PASS.

- [ ] **Step 4: Commit and open the Phase 3 PR**

```bash
git add scratch/search-spike/ratchet.ts
git commit -m "test(search-spike): tighten stability ratchets after W2/W4 fixes"
git push -u origin song-search-stopword-fuzz
gh pr create --title "Song search: fix the stopword-fuzz rank-1 bug and keystroke instability (W2, W4)" --body "$(cat <<'EOF'
Phase 3 of docs/superpowers/plans/2026-08-27-song-search-improvements.md — the user-reported
"give me your hand" bug, where a song matching a single fuzzed stopword took rank 1.

- 1-2 char tokens no longer earn title-relevance credit (mirror of the strong rule)
- The unfinished trailing token no longer collapses the full-match band mid-word
- The 360 band requires a SOLID strong match: fuzzing into a shorter word (hand→and,
  your→you) can no longer admit a song on its own — the pinned "swet zzzzz"=360 contract holds
- Pairwise fuzzy tolerance: the shorter side of a token↔word pair sets the edit budget,
  removing the length-5 matchTol step's noise re-admission (cross-feature: textSignals is
  shared with message/verse scorers — full suite run; matchTol/lev/fuzzyTok unchanged)

Validated by the Phase 1 keystroke-replay ratchets; "give me your hand" hit→miss regressions: 3 → 0.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Phase 4 — Performance

Branch (after Phase 3 merges): `git checkout main && git pull && git checkout -b song-search-perf`

Measured context (perf report): the JS rank stage is 88–97% of every keystroke; Title mode pays a 12x lyric-hint multiplier; there is no debounce; the full-library fallback runs on 23–31% of keystrokes; everything re-derives per-song data per keystroke.

### Task 15: P2 — fetch the lyric hint only when title results are thin

`SongsMode.tsx:206-218` runs a full lyric-scored search on every Title-mode keystroke; the result is thrown away whenever `results.length >= SECONDARY_TITLE_MAX` (3). Fold the hint fetch into the main search's resolution so it fires only in the thin case, with exact (not stale) gating.

**Files:**
- Modify: `src/renderer/operator/SongsMode.tsx` (merge the two search effects)
- Test: `src/renderer/operator/SongsMode.test.tsx`

**Interfaces:**
- Consumes: `SECONDARY_TITLE_MAX` (existing const, value 3), `window.helm.songs.search`.
- Produces: one `[q, field]` search effect; `lyricHint` is set only when `field === 'title'` and the fresh title results are thin. Task 16 wraps exactly this effect in the debounce.

- [ ] **Step 1: Write the failing test** (add to the first `describe` block of `SongsMode.test.tsx`, alongside the existing search tests):

```tsx
  it('title mode skips the lyric-hint search when title results are not thin', async () => {
    const rows: SongSearchResult[] = ['t1', 't2', 't3'].map((id, i) => ({
      song: { ...SONGS[0], id, title: `Grace ${i}` }, score: 1000, snippet: ''
    }));
    const { search } = installHelmStub((_q, field) => Promise.resolve(field === 'lyric' ? [] : rows));
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await screen.findByText(/John Newton ·/);
    fireEvent.click(screen.getByText('Title'));
    const input = screen.getByPlaceholderText('Search titles…');
    fireEvent.change(input, { target: { value: 'grace' } });
    await waitFor(() => expect(screen.getByText('Grace 0')).toBeTruthy());
    expect(search.mock.calls.filter((c) => c[1] === 'lyric')).toHaveLength(0);
  });

  it('title mode still fetches the lyric hint when title results are thin', async () => {
    const HINT: SongSearchResult = { song: { ...SONGS[0], id: 'h1', title: 'Hidden Gem' }, score: 400, snippet: 'a lyric line' };
    installHelmStub((_q, field) => Promise.resolve(field === 'lyric' ? [HINT] : []));
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await screen.findByText(/John Newton ·/);
    fireEvent.click(screen.getByText('Title'));
    fireEvent.change(screen.getByPlaceholderText('Search titles…'), { target: { value: 'gem' } });
    await waitFor(() => expect(screen.getByText('Hidden Gem')).toBeTruthy());
  });
```

- [ ] **Step 2: Run to verify the first fails**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx`
Expected: first new test FAILS (the parallel effect fires `search(q, 'lyric')` on every Title-mode keystroke); second passes (guards the hint against regression).

- [ ] **Step 3: Implement** — in `SongsMode.tsx`, replace BOTH search effects (`:190-199` and the whole hint effect `:201-218`, including its comment) with one:

```tsx
  // Re-query on every keystroke / field change. Empty query shows the library instead
  // (displayedRows only reads `results` when the query is non-empty, so no reset needed).
  // In Title mode the subordinate "Also in lyrics" hint is fetched only AFTER the title
  // results land and only when they are thin (< SECONDARY_TITLE_MAX) — the common fat
  // case previously paid a full lyric-scored search per keystroke (~12x the title cost)
  // and threw the result away (secondaryLyricRows returns [] when titles are not thin).
  useEffect(() => {
    if (!q.trim()) return;
    let live = true;
    void window.helm.songs.search(q, field).then((r) => {
      if (!live) return;
      setResults(r);
      if (field === 'title' && r.length < SECONDARY_TITLE_MAX) {
        void window.helm.songs
          .search(q, 'lyric')
          .then((h) => {
            if (live) setLyricHint(h);
          })
          .catch(console.error);
      }
    }).catch(console.error);
    return () => {
      live = false;
    };
  }, [q, field]);
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx src/shared/songs/secondaryLyric.test.ts src/renderer/operator/SongSearchRail.test.tsx`
Expected: all PASS (no test pins a lyric-hint call count; `secondaryLyricRows` and the rail are pure consumers).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/SongsMode.tsx src/renderer/operator/SongsMode.test.tsx
git commit -m "perf(songs): skip lyric-hint search when title results are not thin"
```

### Task 16: P3 — trailing debounce on the keystroke search

13 keystrokes for `amazing grace` = 13 main-process searches (531 ms blocked at 3000 songs), stalling `presTake`/`presGoLive` behind them. A ~120 ms trailing debounce collapses that to 2–4. The `onImportCompleted` path (`SongsMode.tsx:176-186`) calls `search` directly and stays un-debounced — `SongsMode.test.tsx:257` pins exactly 2 calls. Prior art for the trailing-timer shape: `src/main/index.ts:87-93`.

**Files:**
- Modify: `src/renderer/operator/SongsMode.tsx` (the Task 15 effect + a constant)
- Test: `src/renderer/operator/SongsMode.test.tsx`

**Interfaces:**
- Consumes: the merged search effect from Task 15.
- Produces: `SEARCH_DEBOUNCE_MS = 120` module const; search IPC fires ≥120 ms after the last keystroke. Existing `waitFor`-based pins (default 1000 ms polling) still pass — verified by the run, not assumed.

- [ ] **Step 1: Write the failing test** (same describe block as Task 15's tests):

```tsx
  it('rapid keystrokes coalesce into a single search for the final query', async () => {
    const { search } = installHelmStub();
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await screen.findByText(/John Newton ·/);
    const input = screen.getByPlaceholderText('Title or a lyric line…');
    // synchronous burst — no timer can fire between these, so a trailing debounce
    // must collapse them into exactly one IPC call for the final value
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'am' } });
    fireEvent.change(input, { target: { value: 'ama' } });
    await waitFor(() => expect(search).toHaveBeenCalledWith('ama', 'all'));
    expect(search).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx`
Expected: FAIL — `search` called 3 times (once per keystroke).

- [ ] **Step 3: Implement**

Add near the other module constants (below `SECONDARY_LIMIT`):

```tsx
// Trailing debounce for the keystroke search (same shape as the operator-window
// 'moved' resync debounce in src/main/index.ts): at normal typing speed only the
// last 2-4 keystrokes of a query reach the main process, which otherwise blocks
// presTake/presGoLive behind every intermediate search. The import-completed
// re-search stays un-debounced — it is one deliberate call, not a keystroke.
const SEARCH_DEBOUNCE_MS = 120;
```

Wrap the Task 15 effect body in the trailing timer:

```tsx
  useEffect(() => {
    if (!q.trim()) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void window.helm.songs.search(q, field).then((r) => {
        if (!live) return;
        setResults(r);
        if (field === 'title' && r.length < SECONDARY_TITLE_MAX) {
          void window.helm.songs
            .search(q, 'lyric')
            .then((h) => {
              if (live) setLyricHint(h);
            })
            .catch(console.error);
        }
      }).catch(console.error);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q, field]);
```

(keep the Task 15 comment block above it, adding: `// Debounced: see SEARCH_DEBOUNCE_MS.`)

- [ ] **Step 4: Run the FULL SongsMode + rail suites** — the perf report reasoned (from source, unexecuted) that the once-per-keystroke pins tolerate a ≤200 ms trailing debounce because they use real-timer `waitFor`; this run is the required confirmation. The fake-timer tests in the file scope `vi.useFakeTimers()` to the remove-confirm arming and never type queries, so they are unaffected — but the run proves it:

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx src/renderer/operator/SongSearchRail.test.tsx`
Expected: all PASS, including `:250` (single keystroke still yields 1 call — later) and `:257` (import re-search still pins 2 total calls).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/SongsMode.tsx src/renderer/operator/SongsMode.test.tsx
git commit -m "perf(songs): debounce keystroke searches"
```

### Task 17: P1 (+P8, P7) — precomputed per-song docs, hoisted statements, merged SQL query

The rank stage re-derives everything per candidate per keystroke: `norm()` over title/author/every section (`songScore.ts:58-71`), snippet re-norms every line (`:38`), and the repo re-`JSON.parse`s `sections_json` (`songsRepo.ts:64/:146`) and re-prepares statements (`:128/:136`). Measured: 5x on the rank stage with 24/24 top-9 fidelity (perf report #1). Design: (a) the repo memoizes `Song` objects by id (`songCache`), invalidated at exactly the three `song_fts` sync sites; (b) `songScore` memoizes a `SongDoc` of normalized words per `Song` **object identity** (WeakMap) — so cache invalidation collapses to "a write produces a new Song object"; (c) statements are prepared once (P8); (d) the FTS query selects `s.*` so the second `rowid IN (…)` query disappears (P7) — Task 8's W7 test guards the candidate order, now applied as a JS sort.

**Files:**
- Modify: `src/shared/search/songScore.ts` (SongDoc, doc cache, scoreSignals/bestSnippet over docs)
- Modify: `src/main/songsRepo.ts` (songCache, hoisted statements, merged query)
- Test: `src/shared/search/songScore.test.ts`, `src/main/songsRepo.test.ts`

**Interfaces:**
- Consumes: Task 9's segmentation (title/author/sections as separate segments) — the doc reproduces it exactly.
- Produces: `buildSongDoc(song: Song): SongDoc` and `interface SongDoc { title: string; titleWords: string[]; authorWords: string[]; sectionWords: string[][]; lineWords: string[][][] }` exported from `songScore.ts`. **`rankSongs` and `scoreSong` keep their signatures.** Repo-side: `toSongCached`, `libraryOrder` (internal). Task 19 reuses the hoisted `searchStmt`/`probeStmt` and `toSongCached`/`libraryOrder`.

- [ ] **Step 1: Write the failing tests**

Append to `songScore.test.ts`:

```ts
// --- P1: precomputed per-song normalized docs ---
test('buildSongDoc precomputes normalized words for title, author, sections and lines', () => {
  const d = buildSongDoc(AMAZING);
  expect(d.title).toBe('amazing grace');
  expect(d.titleWords).toEqual(['amazing', 'grace']);
  expect(d.authorWords).toEqual(['john', 'newton']);
  expect(d.sectionWords[0]).toEqual(['amazing', 'grace', 'how', 'sweet', 'the', 'sound', 'that', 'saved', 'a', 'wretch', 'like', 'me']);
  expect(d.lineWords[0][1]).toEqual(['that', 'saved', 'a', 'wretch', 'like', 'me']);
});
```

(import `buildSongDoc` in the test's import line.)

Append to `songsRepo.test.ts`:

```ts
// --- P1: the repo memoizes Song objects so the scorer's doc cache can key on identity ---
test('search returns the same Song object across searches until the song is written (P1)', () => {
  const s = repo.add({ title: 'Cache Song', text: 'Verse 1\nwonderful unique zebra' });
  const first = repo.search('zebra', 'lyric')[0].song;
  const second = repo.search('zebra', 'lyric')[0].song;
  expect(second).toBe(first); // identity, not equality — this is what makes doc caching safe
  repo.update(s.id, { title: 'Cache Song', sections: [{ label: 'Verse 1', lines: ['wonderful unique zebra rides'] }] });
  const third = repo.search('zebra', 'lyric')[0].song;
  expect(third).not.toBe(first); // a write invalidates: fresh object → fresh doc
  expect(third.sections[0].lines[0]).toBe('wonderful unique zebra rides');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/shared/search/songScore.test.ts src/main/songsRepo.test.ts`
Expected: FAIL — `buildSongDoc` doesn't exist; `toSong` builds a fresh object per row.

- [ ] **Step 3: Implement `songScore.ts`**

Add after the `ScoredSong` interface:

```ts
// Precomputed normalized token views of a song. Built once per Song OBJECT and
// cached by identity (WeakMap) — the repo hands out memoized Song objects and
// replaces them on write, so invalidation is object replacement, never bookkeeping
// here. Reproduces scoreSignals' segmentation exactly: title and author are
// separate segments (W9); one segment per section; per-line words feed the snippet.
export interface SongDoc {
  title: string;            // norm(song.title)
  titleWords: string[];     // title.split(' ') minus empties
  authorWords: string[];    // norm(song.author).split(' ') minus empties
  sectionWords: string[][]; // per section, all words
  lineWords: string[][][];  // per section, per line
}

export function buildSongDoc(song: Song): SongDoc {
  const title = norm(song.title);
  const lineWords = song.sections.map((sc) => sc.lines.map((ln) => norm(ln).split(' ').filter(Boolean)));
  return {
    title,
    titleWords: title.split(' ').filter(Boolean),
    authorWords: norm(song.author).split(' ').filter(Boolean),
    sectionWords: lineWords.map((ls) => ls.flat()),
    lineWords,
  };
}

const DOCS = new WeakMap<Song, SongDoc>();
function docFor(song: Song): SongDoc {
  let d = DOCS.get(song);
  if (!d) {
    d = buildSongDoc(song);
    DOCS.set(song, d);
  }
  return d;
}
```

Rewrite `bestSnippet` to consume the doc (same algorithm, no re-norm):

```ts
function bestSnippet(qts: string[], song: Song, doc: SongDoc): string {
  const density = (words: string[]): number => {
    let n = 0;
    for (const t of qts) if (bestMatch(t, words) < 99) n++;
    return n;
  };
  let single = { d: 0, text: '' };
  let pair = { d: 0, text: '' };
  for (let si = 0; si < song.sections.length; si++) {
    const sc = song.sections[si];
    const words = doc.lineWords[si];
    for (let i = 0; i < sc.lines.length; i++) {
      const d1 = density(words[i]);
      if (d1 > single.d) single = { d: d1, text: sc.lines[i] };
      if (i + 1 < sc.lines.length) {
        const d2 = density(words[i].concat(words[i + 1]));
        if (d2 > pair.d) pair = { d: d2, text: `${sc.lines[i]} / ${sc.lines[i + 1]}` };
      }
    }
  }
  return pair.d > single.d ? pair.text : single.text;
}
```

Rewrite `scoreSignals` to take pre-normalized query parts and read the doc (private function — callers below updated):

```ts
function scoreSignals(q: string, qts: string[], song: Song, field: SearchField, rel: number, withSnippet: boolean): ScoredSong {
  const doc = docFor(song);
  const title = doc.title;
  const empty: ScoredSong = { score: 1, snippet: '', titleCoverage: 0, titleCloseness: 0, dist: 0, phrase: 0, coverage: 0, covWeight: 0, rel: 0, tf: 0, titleStartsWith: false, titleLen: title.length, title };
  if (!q) return empty;

  const segs: string[][] = [];
  if (field === 'title') segs.push(title.split(' '));
  else {
    if (field !== 'lyric') {
      if (doc.titleWords.length) segs.push(doc.titleWords);
      if (doc.authorWords.length) segs.push(doc.authorWords);
    }
    for (const ws of doc.sectionWords) if (ws.length) segs.push(ws);
  }

  const sig = textSignals(segs, qts);
  const { matched, strongSolid, covWeight, tf, phrase, dist } = sig;

  let score = 0;
  if (field !== 'lyric') {
    if (title === q) score = 1200;
    else if (title.startsWith(q)) score = 1000;
    else {
      const i = title.indexOf(` ${q}`);
      if (i >= 0) score = 1000 - (i + 1);
    }
  }
  const last = qts.length - 1;
  const trailingExempt = qts.length > 1 && qts[last].length < 3
    && sig.bestDist[last] === 99 && matched === qts.length - 1;
  if ((matched === qts.length || trailingExempt) && matched > 0) score = Math.max(score, 380 + matched * 12);
  else if (strongSolid > 0 && field !== 'title') score = Math.max(score, 360);
  const snippet = withSnippet && score > 0 && field !== 'title' ? bestSnippet(qts, song, doc) : '';

  let titleCoverage = 0; let titleCloseness = 0;
  if (field !== 'lyric') {
    const titleWords = title.split(' ');
    for (const t of qts) {
      if (t.length < 3) continue;
      const d = bestMatch(t, titleWords);
      if (d < 99) { titleCoverage++; titleCloseness += d; }
    }
  }
  const titleStartsWith = field !== 'lyric' && title.startsWith(q);
  return { score, snippet, titleCoverage, titleCloseness, dist, phrase, coverage: matched, covWeight, rel, tf, titleStartsWith, titleLen: title.length, title };
}
```

(Carry over the existing explanatory comments for the segments/bands/tie-break blocks — they still apply; this listing omits repeats for brevity, but keep them in the file. Note the comment blocks from Tasks 6/9/10/11/12 must survive.)

Update the two public callers (signatures UNCHANGED):

```ts
export function scoreSong(query: string, song: Song, field: SearchField, rel = 0): ScoredSong {
  const q = norm(query);
  return scoreSignals(q, q ? q.split(' ') : [], song, field, rel, true);
}

export function rankSongs(query: string, songs: Song[], field: SearchField, rel?: Map<string, number>, limit = Infinity): SongSearchResult[] {
  const q = norm(query);
  if (!q) return songs.slice(0, limit).map((song) => ({ song, score: 1, snippet: '' }));
  const qts = q.split(' ');
  return songs
    .map((song) => ({ song, s: scoreSignals(q, qts, song, field, rel?.get(song.id) ?? 0, false) }))
    .filter((r) => r.s.score > 0)
    .sort((a, b) => compareRelevance(a.s, b.s))
    .slice(0, limit)
    .map(({ song, s }) => ({ song, score: s.score, snippet: field !== 'title' ? bestSnippet(qts, song, docFor(song)) : '' }));
}
```

- [ ] **Step 4: Implement `songsRepo.ts`** (song cache + hoisted statements + merged query)

Inside `createSongsRepo`, after the existing prepared statements, add:

```ts
  // Memoized Song objects by id: JSON.parse of sections_json was measured at up to
  // ~36 ms per keystroke at 10k songs, and object identity is what keys the scorer's
  // per-song doc cache. Writes DELETE from the cache (never insert) so a rolled-back
  // transaction can never leave a ghost — the next read lazily re-caches from the row.
  const songCache = new Map<string, Song>();
  const toSongCached = (r: Row): Song => {
    const hit = songCache.get(r.id);
    if (hit) return hit;
    const s = toSong(r);
    songCache.set(r.id, s);
    return s;
  };
  // Both candidate paths must agree with list()'s ORDER BY created_at, title so a
  // full relevance tie ranks identically on either path (W7, guarded by the repo test).
  const libraryOrder = (a: Song, b: Song): number =>
    a.createdAt - b.createdAt || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  // P8: prepare once, not per keystroke (the probe was re-prepared per TOKEN).
  const probeStmt = db.prepare('SELECT 1 FROM song_fts WHERE song_fts MATCH ? LIMIT 1');
  // P7: the FTS query already JOINs songs — select the full row so the second
  // `rowid IN (...)` query (and the bound-variable dance) disappears.
  const searchStmt = Object.fromEntries(
    (Object.keys(BM25) as SearchField[]).map((f) => [
      f,
      db.prepare(`SELECT s.rowid AS rowid, s.id AS id, s.title AS title, s.author AS author, s.sections_json AS sections_json, s.source AS source, s.created_at AS created_at, s.music_key AS music_key, -${BM25[f]} AS rel FROM song_fts JOIN songs s ON s.rowid = song_fts.rowid WHERE song_fts MATCH ? ORDER BY rel DESC LIMIT ${FTS_CANDIDATE_LIMIT}`),
    ])
  ) as Record<SearchField, ReturnType<typeof db.prepare>>;
```

Change `list` and `get` to use `toSongCached` instead of `toSong`.

Invalidate at exactly the three `song_fts` sync sites:
- in `update(...)`, after the transaction: `songCache.delete(id);` (place it immediately after `})();` and before `return song;`)
- in `remove(...)`, after the transaction, before `return list();`: `songCache.delete(id);`
- `insertOne` needs no delete (fresh id) — add a comment saying so next to it.

Replace the `search` method:

```ts
    search(q, field) {
      const tokens = norm(q).split(' ').filter(Boolean);
      if (!tokens.length) return rankSongs('', list(), field);
      const tokenHasHit = (t: string): boolean => (probeStmt.get(ftsTerm(t, true)) as unknown) !== undefined;
      const match = orPrefixMatch(tokens);
      // bm25 gives TF-IDF relevance the JS scorer can't (#53); `field` arrives over
      // IPC, so it is whitelisted before selecting a prepared statement.
      const stmt = Object.hasOwn(searchStmt, field) ? searchStmt[field as SearchField] : searchStmt.all;
      const hits = stmt.all(match) as (Row & { rel: number })[];
      const rel = new Map(hits.map((h) => [h.id, h.rel]));
      let candidates: Song[];
      // Typo detection is per TOKEN, not per hit count (#13): any token with no FTS
      // hit of its own → scan the library (FTS rows keep their bm25 prior via `rel`).
      if (hits.length >= 30 && tokens.every((t) => tokenHasHit(t))) {
        candidates = hits.map(toSongCached).sort(libraryOrder);
      } else candidates = list(); // sparse hits or an unmatched token → typo likely; scorer handles fuzz
      return rankSongs(q, candidates, field, rel, 50);
    },
```

- [ ] **Step 5: Run the song-search suite**

Run: the song-search suite.
Expected: all PASS — including Task 8's W7 test (now proving `libraryOrder`), the FTS reindex/orphan tests (cache-invalidation behavior), and every ranking fixture (fidelity: the doc reproduces the old derivation byte-for-byte).

- [ ] **Step 6: Harness re-verify + latency ratchet tighten**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS with **identical quality/stability metrics** (this task must not move a single rank — if any quality number changed, that is a fidelity bug: stop and diff the doc segmentation against the pre-task derivation). Latency at 3000 songs should drop ~4–6x. Tighten `latencyMs3000Max` to the new printed value × 1.5 rounded up to the nearest 10.

- [ ] **Step 7: Commit**

```bash
git add src/shared/search/songScore.ts src/shared/search/songScore.test.ts src/main/songsRepo.ts src/main/songsRepo.test.ts scratch/search-spike/ratchet.ts
git commit -m "perf(search): precompute per-song docs; hoist statements; merge queries"
```

### Task 18: P5 — banded early-exit Levenshtein behind `matchDist`

`lev` is a full O(m×n) DP with no early exit, ~0.834 µs/call; a banded version measured 0.225 µs. `fuzzy.test.ts` pins `lev()` exactly and `textSignals().dist` per tier — so `lev` stays exported and exact; add `levWithin(a, b, tol)` used **only** from `matchDist`. Every `matchDist` consumer admits distances ≤ 2 at most (`matchTol` ceiling), so `matchDist` can call `levWithin(t, w, 2)`: exact for d ≤ 2, any value > 2 otherwise.

**Files:**
- Modify: `src/shared/search/fuzzy.ts`
- Test: `src/shared/search/fuzzy.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `levWithin(a: string, b: string, tol: number): number` — exact when the true distance ≤ tol, else returns `tol + 1`. `matchDist` behavior is observably unchanged for every admissible distance (0/1/2) and still returns ≥ 3 ("too far") beyond.

- [ ] **Step 1: Write the failing tests** (append to `fuzzy.test.ts`):

```ts
describe('levWithin', () => {
  test('exact within tolerance, sentinel beyond', () => {
    expect(levWithin('grace', 'grace', 2)).toBe(0);
    expect(levWithin('beleive', 'believe', 2)).toBe(2);
    expect(levWithin('cat', 'dog', 2)).toBeGreaterThan(2);
    expect(levWithin('abcdefgh', 'a', 2)).toBeGreaterThan(2); // length-gap short-circuit
    expect(levWithin('', 'ab', 2)).toBe(2);
  });
  test('agrees with exact lev for every pair of a realistic word list', () => {
    const words = ['grace', 'grase', 'graces', 'worship', 'worsh', 'and', 'hand', 'sweet',
      'swet', 'believe', 'beleive', 'a', '', 'ab', 'faithfulness', 'faithfullness'];
    for (const a of words) for (const b of words) {
      const exact = lev(a, b);
      const banded = levWithin(a, b, 2);
      if (exact <= 2) expect(banded).toBe(exact);
      else expect(banded).toBeGreaterThan(2);
    }
  });
});
```

(add `levWithin` to the import list.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/shared/search/fuzzy.test.ts`
Expected: FAIL — `levWithin` not exported.

- [ ] **Step 3: Implement** — in `fuzzy.ts`, after `lev`:

```ts
// Levenshtein restricted to distances <= tol: exact inside the band, `tol + 1`
// beyond it, with a per-row early exit. Two rolling rows instead of the full
// matrix; cells with |i-j| > tol are clamped to tol+1 (their true distance is at
// least |i-j|, so the clamp can never fake an admissible path). `lev` stays
// exported and exact — tests and any caller needing true distances keep using it.
export function levWithin(a: string, b: string, tol: number): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > tol) return tol + 1;
  if (!m || !n) return Math.max(m, n); // <= tol by the guard above
  const BIG = tol + 1;
  let prev = Array.from({ length: n + 1 }, (_, j) => (j <= tol ? j : BIG));
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    let rowMin = BIG;
    for (let j = 0; j <= n; j++) {
      if (Math.abs(i - j) > tol) { cur[j] = BIG; continue; }
      if (j === 0) { cur[0] = i; rowMin = i; continue; }
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      cur[j] = v > BIG ? BIG : v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > tol) return BIG;
    const t = prev; prev = cur; cur = t;
  }
  return prev[n] > tol ? BIG : prev[n];
}
```

and switch `matchDist`'s last line to use it:

```ts
  // No caller admits a distance above 2 (matchTol's ceiling), so the DP may bail
  // early and report 3 for "too far" instead of computing the exact distance.
  return Math.abs(w.length - t.length) <= 2 ? levWithin(t, w, 2) : 99;
```

- [ ] **Step 4: Run the song-search suite + cross-feature suites** (fuzzy.ts changed; `matchDist` feeds verse expansion and highlighting too — all admit ≤ 2, so behavior is identical):

Run: the song-search suite, then the cross-feature suites.
Expected: all PASS, including the exact `lev` and `textSignals().dist` pins.

- [ ] **Step 5: Commit**

```bash
git add src/shared/search/fuzzy.ts src/shared/search/fuzzy.test.ts
git commit -m "perf(search): banded early-exit levenshtein in matchDist"
```

### Task 19: P4 — vocabulary-expansion fallback replaces the full-library scan; final validation; open the PR

The fallback (`songsRepo.ts:144-147`) scans the ENTIRE library on 23–31% of keystrokes (mean 189 ms at 3000 songs). Bible search already ships the replacement pattern: an fts5vocab table (`schema.ts:38`) + nearest-tier `expandToken` (`biblesRepo.ts:79-93`). Transplant to songs: a token with no FTS prefix hit is OR-expanded with its nearest vocabulary terms and the FTS gate re-run — the fuzzy pass runs once against the distinct-term list instead of every word of every song. Measured: 2.3x average, 11x on typos, rank-1 unchanged or improved on the labeled set, **except `"10000"`** — `10,000 Reasons` tokenizes as `10`/`000`, no vocab term prefixes `10000`, and only `matchDist`'s digit-prefix rule over the full library rescues it. **All-digit tokens with no hits therefore keep the full-scan path.**

**Files:**
- Modify: `src/main/schema.ts` (add `song_vocab`)
- Modify: `src/main/songsRepo.ts` (vocab cache, `expandToken`, new `search` flow, invalidation)
- Test: `src/main/songsRepo.test.ts` (rewrite the #13 guard's framing; new digit + invalidation tests)
- Modify (tighten): `scratch/search-spike/ratchet.ts`

**Interfaces:**
- Consumes: `matchDist`/`matchTol` from fuzzy (Task 18's banded version), Task 17's `searchStmt`/`probeStmt`/`toSongCached`/`libraryOrder`, `ftsTerm`/`orPrefixMatch`.
- Produces: `song_vocab` fts5vocab table (created by the idempotent `SCHEMA` exec on existing DBs at next open — same auto-migration route as every other `IF NOT EXISTS` table); internal `expandToken(tok): string[]` returning nearest-tier vocabulary terms (empty when none). The `hits.length >= 30` gate is retired: candidates always come from FTS except the all-digit-no-hit case.

- [ ] **Step 1: Write the failing tests**

In `songsRepo.test.ts`, replace the body-comment of the existing #13 test (keep its assertions — they are exactly the regression guard the new mechanism must satisfy) and add two tests:

```ts
test('a typo in the distinguishing token is rescued even when a common token clears 30 hits (#13, via vocab expansion)', () => {
  // 30 decoys all match "holy"; the target matches only "reckless", and only fuzzily.
  // The old mechanism full-scanned; the new one expands "reckelss" against song_vocab
  // to the nearest tier ("reckless") and re-runs the FTS gate. Same observable rescue.
  for (let i = 0; i < 30; i++) repo.add({ title: `Holy Hymn ${i}`, text: `Verse 1\nHoly, holy is the Lord number ${i}` });
  repo.add({ title: 'Reckless Love', text: 'Chorus\nOh the overwhelming never-ending reckless love of God' });
  const r = repo.search('holy reckelss', 'all').map((x) => x.song.title);
  expect(r).toContain('Reckless Love');
});

test('an all-digit token with no FTS hit still finds its song via the full scan ("10000")', () => {
  // "10,000" indexes as "10"/"000": nothing prefixes "10000" and vocab expansion
  // would fuzz it away (measured regression) — digits keep the full-scan path where
  // matchDist's digit-prefix rule rescues them.
  repo.add({ title: '10,000 Reasons (Bless the Lord)', text: 'Chorus\nBless the Lord O my soul' });
  for (let i = 0; i < 30; i++) repo.add({ title: `Hymn ${i}`, text: `Verse 1\nsing praise number ${i}` });
  const r = repo.search('10000', 'all').map((x) => x.song.title);
  expect(r[0]).toBe('10,000 Reasons (Bless the Lord)');
});

test('vocabulary expansion sees terms from songs added after the first search', () => {
  repo.add({ title: 'Cornerstone', text: 'Chorus\nChrist alone cornerstone' });
  repo.search('cornerstoen', 'all'); // warms the vocab cache
  repo.add({ title: 'Wellspring', text: 'Verse 1\nwellspring of wonder' });
  const r = repo.search('wellspirng', 'all').map((x) => x.song.title); // needs post-add vocab
  expect(r).toContain('Wellspring');
});
```

(The existing #13 test text is replaced by the first block above — same file position, same assertions.)

- [ ] **Step 2: Run to verify the new ones fail**

Run: `npx vitest run src/main/songsRepo.test.ts`
Expected: the #13-shaped test still PASSES (old mechanism also rescues it — it is the invariant, not the delta); the invalidation test FAILS (no `song_vocab`/expansion exists yet — `wellspirng` has no FTS hit and the *old* full-scan… note: under the OLD code this test actually passes via full scan, so run this step primarily to confirm compilation; the real failing state arrives mid-implementation. The non-negotiable gate is Step 5's green run). The digit test PASSES pre-change (full scan) — it exists to pin the exemption once the scan is gone.

- [ ] **Step 3: Add the vocab table to `schema.ts`** (right after the `song_fts` CREATE):

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS song_vocab USING fts5vocab(song_fts, 'row');
```

(Exact placement: a new line in the `SCHEMA` template string below the `song_fts` statement. Existing DBs pick it up on next open via the idempotent schema exec in `db.ts` — same route `verse_vocab` shipped through.)

- [ ] **Step 4: Implement in `songsRepo.ts`**

Imports: extend the fuzzy import to `import { norm, matchDist, matchTol } from '../shared/search/fuzzy';`

Inside `createSongsRepo`, next to the Task 17 additions:

```ts
  // Vocabulary of every indexed song term, loaded on first use and dropped whenever
  // song_fts changes — the verse pattern (biblesRepo.expandToken / verse_vocab).
  const selectVocab = db.prepare('SELECT term FROM song_vocab');
  let vocab: string[] | null = null;
  const invalidateVocab = (): void => { vocab = null; };
  const getVocab = (): string[] => (vocab ??= (selectVocab.all() as { term: string }[]).map((r) => r.term));
  // Nearest-tier expansion for a token with NO FTS prefix hit of its own: only the
  // vocabulary terms at the smallest edit distance found join the OR group (ties
  // included) — everything within tolerance would pollute retrieval AND ranking.
  // Returns [] when the token is too short or nothing is in reach; the scorer then
  // simply never matches that token, same as a fruitless full scan today.
  const expandToken = (tok: string): string[] => {
    if (tok.length < 3) return [];
    const tol = matchTol(tok.length);
    let best = Infinity;
    let near: string[] = [];
    for (const t of getVocab()) {
      const d = matchDist(tok, t);
      if (d > tol) continue;
      if (d < best) { best = d; near = [t]; }
      else if (d === best) near.push(t);
    }
    return near;
  };
```

Add `invalidateVocab()` at the three `song_fts` sync sites:
- `insertOne`: after `insertFts.run(...)`, before `return song;`
- `update`: after the transaction call, next to `songCache.delete(id);`
- `remove`: after the transaction call, next to `songCache.delete(id);`

Replace the `search` method (final form):

```ts
    search(q, field) {
      const tokens = norm(q).split(' ').filter(Boolean);
      if (!tokens.length) return rankSongs('', list(), field);
      const tokenHasHit = (t: string): boolean => (probeStmt.get(ftsTerm(t, true)) as unknown) !== undefined;
      const stmt = Object.hasOwn(searchStmt, field) ? searchStmt[field as SearchField] : searchStmt.all;
      let match = orPrefixMatch(tokens);
      let hits = stmt.all(match) as (Row & { rel: number })[];
      const noHit = tokens.filter((t) => !tokenHasHit(t));
      // All-digit tokens can't be vocabulary-expanded: "10,000" indexes as "10"/"000",
      // no term prefixes "10000" — only matchDist's digit-prefix rule over the full
      // library rescues it (the measured "10000" regression). The one surviving
      // full-scan class.
      if (noHit.some((t) => /^[0-9]+$/.test(t))) {
        return rankSongs(q, list(), field, new Map(hits.map((h) => [h.id, h.rel])), 50);
      }
      // Typo handling is per TOKEN (#13), now by vocabulary expansion instead of a
      // full-library scan: each no-hit token ORs in its nearest indexed terms and the
      // candidate gate re-runs — the fuzzy pass costs O(vocab), not O(library words).
      if (noHit.length) {
        const extra = [...new Set(noHit.flatMap((t) => expandToken(t)))];
        if (extra.length) {
          match = [match, ...extra.map((t) => ftsTerm(t, false))].join(' OR ');
          hits = stmt.all(match) as (Row & { rel: number })[];
        }
      }
      const rel = new Map(hits.map((h) => [h.id, h.rel]));
      const candidates = hits.map(toSongCached).sort(libraryOrder);
      return rankSongs(q, candidates, field, rel, 50);
    },
```

(The `hits.length >= 30` gate is gone: with per-token expansion, sparse-but-correct prefix hits ARE the right candidates, and the mid-word 33–54% full-scan storms disappear. Behavior risk — a fuzzy-only match reachable neither by prefix nor by expansion drops out — is exactly what Step 5's suites and Step 6's harness recall floor check.)

- [ ] **Step 5: Run the song-search suite**

Run: the song-search suite.
Expected: all PASS — in particular the #13 rescue, `'only beleive'` (expands to `believe`), `'swet the sound'` ranking fixtures (expands to `sweet`), the W7 order test, the accent tests, and the three new tests.

- [ ] **Step 6: Full harness + final ratchet tightening**

Run: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
Expected: PASS every quality/stability floor (perf report measured rank-1 unchanged-or-better; `faithfullness` may improve — if the printed p@1 rose, tighten the quality floors). Latency: expect roughly another 2x on average and ~10x on typo keystrokes; tighten `latencyMs3000Max` to printed × 1.5 rounded up to the nearest 10. If any floor FAILS, the expansion lost a labeled target — diagnose per token with the Task 1 probe before touching anything, and if the loss is real, restore the non-digit full-scan for the failing class rather than loosening a ratchet.

- [ ] **Step 7: Full repo suite**

Run: `npx vitest run` — all PASS.

- [ ] **Step 8: Commit, file the follow-up issues, open the Phase 4 PR**

```bash
git add src/main/schema.ts src/main/songsRepo.ts src/main/songsRepo.test.ts scratch/search-spike/ratchet.ts
git commit -m "perf(search): vocabulary-expansion fallback replaces full-library scan"
gh issue create --title "Song search: exact author match cannot win a band tie (W6)" --label sev-4 --label "area:songs" --body "See docs/superpowers/plans/2026-08-27-song-search-improvements.md (out-of-scope). titleCoverage/titleCloseness scan title words only (songScore.ts); an exact author hit ('asbury') loses to any fuzzily-similar title word. Extending the scan list measured insufficient (covWeight still outranks it) — likely needs an authorCoverage signal. The 'asbury worship' labeled query in scratch/search-spike/queries.ts documents the gap."
gh issue create --title "Song search: '10000' cannot beat a nearer numeric collision (W8)" --label sev-4 --label "area:songs" --body "norm() maps ',' to a space, so '10,000 Reasons' tokenizes as '10 000' and the canonical query '10000' survives only by 2-edit fuzz — any nearer numeric title ('1000 Tongues') wins. Fix direction: join digit-group separators in norm() (touches shared verse/quote paths — needs its own cross-feature pass). The '1000 Tongues' corpus competitor keeps the labeled '10000' query honestly at rank 2."
gh issue create --title "Song search: full-tie single-token typos decided by titleLen (W10)" --label sev-4 --label "area:songs" --body "'faithfullness' ties 20+ filler titles on every signal and titleLen picks the shortest — canonical long hymn titles systematically lose, degrading to ABSENT at 3k songs. Needs a genuinely new IDF-like or dist-weighted title signal; out of scope for the 2026-08-27 plan."
git push -u origin song-search-perf
gh pr create --title "Song search: performance (hint gating, debounce, precomputed docs, vocab-expansion fallback)" --body "$(cat <<'EOF'
Phase 4 of docs/superpowers/plans/2026-08-27-song-search-improvements.md.

- Title-mode lyric hint fetched only when title results are thin (was 12x the keystroke cost, discarded)
- 120 ms trailing debounce on keystroke searches (import re-search stays un-debounced, pinned)
- Precomputed per-song normalized docs keyed by Song object identity + repo Song memoization,
  hoisted prepared statements, merged FTS/data query (measured ~5x on the rank stage, top-9 identical)
- levWithin banded early-exit Levenshtein behind matchDist (lev stays exported and exact)
- Vocabulary-expansion fallback (song_vocab fts5vocab, the verse pattern) replaces the
  full-library scan; all-digit tokens keep the full scan (the measured "10000" regression)

Quality/stability ratchets unchanged or tightened; latency ratchet tightened at 3000 songs.
Not pursued (measured, see plan): FTS prefix index, candidate reuse, cap lowering, SQL ranking,
library swap, worker-thread search (P9 — file if targets ever slip).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review record (performed while authoring)

- **Spec coverage:** W1→T5, W2→T10/T11/T12 (+T14 gate), W3→T6, W4→T4 (metrics) + T13 (+T14), W5→T7, W7→T8, W9→T9; W6/W8/W10 explicitly out-of-scope with follow-up issues (T19) and harness documentation (T3). Perf #1→T17, #2→T15, #3→T16, #4→T19, #5→T18, #7/#8→T17, #6/#9 out-of-scope with reasons. Harness items: probe→T1, corpus realism + infinite loop→T2, adversarial set→T3, churn/monotonicity ratchets→T4.
- **Deliberate scope judgments:** `and` is an eval assertion (T6), not a labeled query (no legitimate target). The `swet zzzzz` 360 pin is preserved by construction in T12 (word-length "solid" rule) — no pinned value changes anywhere. T13 keeps `matchTol` untouched (pinned) and narrows admission pairwise instead, with a scoped fallback if cross-feature suites object.
- **Type consistency:** `TextSignals` gains `bestDist` (T11) then `strongSolid` (T12); `ScoredSong` gains `dist` (T7); T17's `scoreSignals(q, qts, song, field, rel, withSnippet)` is private and both public signatures are unchanged; T19 consumes T17's `searchStmt`/`probeStmt`/`toSongCached`/`libraryOrder` by exactly those names.
- **Ratchet lifecycle:** created T4 with impossible sentinels → pinned from a real run → tightened at T5, T6, T7, T10–T14, T17, T19; loosening forbidden globally.
