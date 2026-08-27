# Song Search — Accuracy/Relevance Investigation

## 1. Harness metrics (current, `main` @ 20401e5)

`npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept` — 348 songs, 46 labeled queries.

| intent | n | p@1 | p@3 | recall@50 | MRR |
|---|---|---|---|---|---|
| known-title-pressure | 10 | 100% | 100% | 100% | 1.00 |
| audible-partial | 8 | 100% | 100% | 100% | 1.00 |
| forgot-title-lyric | 8 | 88% | 88% | 88% | 0.88 |
| misspelled-title | 8 | 88% | 88% | 100% | 0.89 |
| wrong-word-order | 4 | 100% | 100% | 100% | 1.00 |
| inflected-form | 3 | 100% | 100% | 100% | 1.00 |
| accented-text | 5 | 80% | 100% | 100% | 0.90 |

**Weighted p@1 = 95%, p@3 = 96%, recall@50 = 98%, MRR = 0.96.** Unweighted p@1 = 93% (43/46). Latency 5.0 / 18.8 / 41.7 ms at 200 / 1k / 3k songs.

### The three p@1 misses, localized

| query | rank | localization |
|---|---|---|
| `my chains are gone` (all) | ABSENT | **Not a bug.** Corpus genuinely lacks the refrain. Labeled as an expected miss in `queries.ts:77-78`. |
| `faithfullness` (all) | 10 | **Scorer/tie-break.** FTS returns 0 hits → per-token gate correctly full-scans. Target scores 392, but so do 20+ filler `X Faithfulness` titles. tCov=1, tClose=1, covW=13, phrase=1, cov=1, rel=0, tf=0 are **identical** for all of them → decided by `titleLen` (`songScore.ts:108`), and `Great Is Thy Faithfulness` (25 ch) loses to `How Faithfulness` (16 ch). **Degrades to ABSENT at 3,000 songs** (falls past the 50-cap). |
| `senor` (lyric) | 2 | **Scorer band.** Both `Renuévame` and `Sublime Gracia` score 392; lyric mode zeroes tCov/tClose (`songScore.ts:88`) so nothing separates them but `titleLen`. Diacritic folding itself is fine (probe confirms `ftsHit=true`, score>0). |

### ⚠️ The harness's own fallback probe is wrong — do not trust it

`scratch/search-spike/eval.test.ts:39` computes `fallback: rowids.length < 30`. That is the **pre-#13** gate. The real gate (`songsRepo.ts:144`) is `hits.length >= 30 && tokens.every(tokenHasHit)`. So the report section *"PROBE: >=30 FTS-hit fallback gap"* prints `fallback=false` for `praise recukless` / `holy reckelss` and concludes *"the fuzzy pass that would catch it never runs"* — **that conclusion is false**. Verified directly: `perTokenHasHit=[["praise",true],["recukless",false]]` → gate returns `false` → full scan **does** run, the scorer **does** see the target. The real cause is the comparator (W1 below). Fix the probe or the planner will chase the wrong layer.

---

## 2. Confirmed weaknesses, ranked by operator impact

### W1 — `titleCloseness` outranks `covWeight`: an exactly-matched common word beats a near-matched rare one — **SEVERITY: HIGH**

`compareRelevance` order is `titleCoverage` (`songScore.ts:100`) → **`titleCloseness` (:101)** → `covWeight` (:102). Both candidates tie at `titleCoverage=1`, so the *edit-distance of one title word* decides before *how much of the query matched* is ever consulted.

Repro (348-song spike corpus, `all`):

| query | expected | actual rank-1 | target rank |
|---|---|---|---|
| `praise recukless` | Reckless Love | `Rise Praise` | **27** |
| `holy reckelss` | Reckless Love | `Holy, Holy, Holy` | **15** |

Isolated signals: `Praise Song` → `tCov=1 tClose=0 covW=6`; `Reckless Love` → `tCov=1 tClose=1 covW=9`. tClose 0 < 1 wins; covW 9 > 6 is never read.

**Fix:** swap lines `songScore.ts:101` and `:102`.

**Measured A/B** (scratchpad reimplementation of the full pipeline):

| variant | p@1 | p@3 | MRR | wtd p@1 | churn | monotonicity violations |
|---|---|---|---|---|---|---|
| V0 baseline | 93% | 96% | 0.95 | 95% | 133 | 22 |
| **V1 covW before tClose** | **93%** | **96%** | **0.95** | **95%** | 135 | **22** |

`praise recukless` 27→**1**; `holy reckelss` 15→**1**. Zero regression anywhere on the labeled set. This is the single highest-value one-line change found.

**Test risk: none identified.** Every fixture that could disagree ties on both signals or is decided earlier — `songScore.test.ts:54-61` (decided at `titleCoverage`), `:63-68` (tCov/tClose/covW all tie → `titleLen`), `:123-130`/`:151-157`/`:163-171`/`:173-179` (all `lyric`, where tCov/tClose are forced 0 at `songScore.ts:88`). `songSearchRanking.test.ts` is `lyric` except `:95`, where both songs have `tCov=0`. Could not run the suite with the change (read-only investigation) — verify before merging.

---

### W2 — REPORTED BUG: `give me your hand` — stopword fuzz owns rank 1 — **SEVERITY: HIGH**

**Repro** (348-song spike corpus, `all`, no song contains the phrase):

```
[360] Turn Your Eyes Upon Jesus   why: your~your(0)        ← rank 1
[360] Great Are You Lord          why: your~you(1)   cov=3
[360] How Great Is Our God        why: your~our(1)   cov=3
[360] Él Vive                     why: give~vive(1)
[360] Praise and Faithfulness     why: hand~and(1)
[360] Faithful and Hope           why: hand~and(1)
[360] Forever and Heaven          why: hand~and(1)
```

Rank 1 matched **one stopword** and nothing else — exactly the user's report. 56/348 songs (16% of library) clear the bar.

Keystroke replay against a library where the target *does* exist (`Take My Hand`, lyric contains the phrase):

```
step query              gate       top-1                          target rank
  3  giv                FULL-SCAN  Take My Hand[392]                    1
  9  give me y          FTS-set    Take My Hand[416]                    1
 10  give me yo         FTS-set    Great Are You Lord[416]              5   ← regression
 14  give me your h     FTS-set    Take My Hand[428]                    1
 15  give me your ha    FTS-set    Turn Your Eyes Upon Jesus[360]       2   ← regression
 17  give me your hand  FTS-set    Take My Hand[428]                    1
→ churn 8, hit→miss regressions while ADDING characters: 3
```

**Four interacting root causes** (in order of contribution):

1. **(a) — the 360 partial band's `strong` guard is far too weak.** `songScore.ts:81` admits any song with `strong > 0`; `strong` = matched tokens of length ≥3 (`fuzzy.ts:102`). `your`(4), `hand`(4), `give`(4) all qualify. Combined with `matchTol`, `hand`~**`and`** (lev 1, `fuzzy.ts:33` → tol 1) and `your`~`our`/`you`/`hour`, `me`~`he`/`we`/`be`/`my`, `give`~`live`/`gave`. `and` appears in essentially every worship lyric.
2. **W1 again** — inside the flat 360 band, `Turn Your Eyes Upon Jesus` (`tClose=0`, `covW=8`, `cov=2`) beats `Great Are You Lord` (`tClose=1`, `covW=10`, `cov=3`). Applying V1 alone moves `Great Are You Lord` to rank 1 — still not a good answer, but no longer the pure-stopword row.
3. **`titleCoverage`/`titleCloseness` count stopwords with no length guard** (`songScore.ts:89-90`), unlike `strong` in `textSignals`. A title containing `your` earns full title-relevance credit.
4. **(c) confirmed** — the `<3`-char prefix gate at `fuzzy.ts:47` (`t.length >= 3 || /^[0-9]+$/`). `matchDist("ha","hand") = 2 > tol(2)=1 → no match`, so at step 15 `matched !== qts.length` and the target drops **428 → 360**, into the stopword soup. `han` (3 chars) prefixes at 1 and it recovers to 428.
5. **(b) confirmed but not causal here** — the gate does flip mid-typing (`g`→FTS-set, `gi`..`give`→FULL-SCAN, `give m`→FTS-set), changing the candidate pool between keystrokes. It didn't cause a miss at 348 songs, but see W8.

**Fix direction.** W1's swap is the cheap first step but does not resolve W2 alone. The structural problem is that **bm25 is the only IDF-aware signal in the chain and it sits at position 7**, below four non-IDF signals — so `your` and `reckless` are worth the same to `titleCoverage`. (Noting the interaction, not relitigating the PR #70 placement.) Options, in increasing risk:
- Add a length guard to `titleCoverage`/`titleCloseness` (`songScore.ts:89-90`) mirroring `strong`'s ≥3, or better, make `titleCoverage` length-weighted like `covWeight`. *Measured: length-weighting alone (V2) added nothing over V1 on the labeled set.*
- Raise the 360-band bar so a stopword-fuzz-only match cannot qualify — e.g. require one matched token with `dist === 0`, or `covWeight ≥ half` of `Σ|qts|`. **Constrained by `songScore.test.ts:116-121`** (`swet zzzzz` must score exactly 360; `swet` is 4 chars at dist 1 with covW 4/9 = 44%) — a naïve length or fraction threshold breaks it.
- Make the `<3`-char trailing token non-fatal: exempt the **last** token of a query from the `matched === qts.length` requirement while the operator is mid-word, so the band doesn't collapse at step 15. **Constrained by `songScore.test.ts:137-142` and `songSearchRanking.test.ts:120-124`**, which pin that a mid-word prefix *keeps* the ≥380 band — this change extends that guarantee rather than breaking it.

---

### W3 — the title-substring band ignores word boundaries — **SEVERITY: HIGH (audible-partial)**

`songScore.ts:77`: `title.includes(q)` → `1000 - title.indexOf(q)` is a **raw substring test**, while every other match in the scorer is whole-word. Any interior hit lands ~1000, far above the full-match band's ceiling (`380 + 12n`).

| query | rank-1 today | the real target |
|---|---|---|
| `art` | `Heart of Worship` **[998]**, then `Departed Glory` **[997]** | `How Great Thou Art` [985] — **rank 3** |
| `son` | `Person of Peace` **[997]** | `The Son of God` [996] — rank 2 |
| `well` | `Wellspring` [1000], `Farewell Song` **[996]** | `It Is Well With My Soul` [994] — rank 3 |
| `and` | `Standing Firm` **[998]** | — |

The last row is the repo's own fixture: `songSearchRanking.test.ts:134` pins that `search('and','lyric')` must not contain `Standing Firm`. It passes — but **only because it uses `lyric`, where the title band is disabled.** In `all` mode the same false positive returns at score 998. The test's stated intent is defeated in the mode operators actually use.

**Fix direction — measured.** Anchor the substring to a **word start** (index 0 or preceded by a space); fall through to the token bands otherwise:

```
q="art"   today: Heart of Worship[998] | Departed Glory[997] | How Great Thou Art[985]
       anchored: How Great Thou Art[985]
q="and"   today: Standing Firm[998]        anchored: (empty)
q="well"  today: Wellspring[1000] | Farewell Song[996] | It Is Well…[994]
       anchored: Wellspring[1000] | It Is Well With My Soul[994]
q="wor"   today: Heart of Worship[991]     anchored: Heart of Worship[991]   ← type-ahead preserved
```

**Cost: zero.** V1+anchored measures p@1 93% / p@3 96% / MRR 0.95 / weighted 95% — identical to baseline — and churn 134 vs 133. Word-*start* anchoring is the right cut: it kills word-interior noise while preserving mid-word type-ahead (`wor`→`Worship`, `well`→`Wellspring`), which `songScore.test.ts:132-135` and `:137-142` pin (both `lyric`, so unaffected either way).

---

### W4 — rank instability across keystrokes — **SEVERITY: HIGH (new evaluation dimension)**

Replaying every labeled query character-by-character, 704 steps total:

- **top-1 churn: 135 events = 19% of keystrokes change the row Enter would cue.**
- **Monotonicity violations (target was rank 1, then a *correct* added character pushed it out): 22.**

Sample violations:
```
"how great thou art"   rank1 at "how g"  → lost at "how gr"  (now How Great Is Our God)
"goodness of god"      rank1 at "go"     → lost at "goo"     (now Good Good Father)
"crimson stain"        rank1 at "crim"   → lost at "crims"   (now Hope Cross)
"blesed assurance"     rank1 at "bles"   → lost at "blese"   (now 10,000 Reasons)
"you turn mourning…"   rank1 at "…mou"   → lost at "…mour"   (now Turn Your Eyes Upon Jesus)
```

Two mechanical drivers beyond W1/W2/W3:

1. **`matchTol` is a step function at length 5** (`fuzzy.ts:32-34`: `≤4 → 1`, else `2`). Typing the 5th character **widens** the match set:
   ```
   "wors"  (tol 1) → worship, word, works, words
   "worsh" (tol 2) → worship, worthy, world, word, works, words   ← noise comes BACK
   ```
   Observed live: `wors` returns 2 rows; `worsh` returns 4, with `Worthy`/`World Changer` reappearing.
2. **The `<3`-char prefix gate** (`fuzzy.ts:47`) makes the full-match band flicker on/off as each new word is typed (W2 cause 4).

**Fix direction:** make `matchTol` monotone in what it admits — e.g. cap fuzzy tolerance for a token by *how much of the candidate word it covers*, or grow tolerance continuously (`floor(len/4)`) rather than stepping. **`fuzzy.test.ts` explicitly pins the `matchTol()` boundaries and `fuzzyTok()` tolerance**, and `matchTol` is shared by the message and verse scorers (`fuzzy.ts:31-32`) — any change is cross-feature. Adopt churn + monotonicity as harness assertions first; they cost nothing and currently detect nothing.

---

### W5 — lyric mode has *no* edit-distance discrimination at all — **SEVERITY: MEDIUM**

`songScore.ts:88` forces `titleCoverage = titleCloseness = 0` when `field === 'lyric'`. Nothing else in `ScoredSong` carries match quality. `textSignals()` **does** compute `dist` (`fuzzy.ts:74-76`, accumulated at `:102`) — with a comment saying "existing consumers ignore it" — and `songScore` never reads it.

```
q="your grace is enough" [lyric]
  [428] Alpha  (lyric: "your grace is enough for me")    ← exact
  [428] Beta   (lyric: "your peace is enough for me")    ← 2-edit fuzz
  [428] Gamma  (lyric: "your place is enough for me")    ← 2-edit fuzz
```
Identical on every comparator signal but `tf`/`titleLen`. This is why `senor` (lyric) sits at rank 2 — an exact lyric match cannot outrank a fuzzy one. **Fix:** add `dist` to `compareRelevance` (lower wins), positioned after `covWeight`. Low blast radius: already computed, neutral when all matches are exact, no test asserts on it.

---

### W6 — author matches carry zero title signal and can never win a band tie — **SEVERITY: MEDIUM**

`songScore.ts:89` scans `title.split(' ')` only; author words never contribute to `titleCoverage`/`titleCloseness` (comparator positions 2–3). Any song with one fuzzily-similar *title* word outranks an exact *author* match in the same band:

```
q="asbury worship" [all]
  [360] Worship Tonight  (author "Nobody")       tCov=1 covW=7   ← rank 1
  [360] Asbury Hymn      (author "Nobody")       tCov=1 covW=6
  [360] Reckless Love    (author "Cory Asbury")  tCov=0 covW=6   ← exact author match, rank 3
```
bm25 does weight author at 2 (`songsRepo.ts:37`) but sits at position 7. **Fix:** extend the `titleCoverage`/`titleCloseness` word list to include author words when `field !== 'lyric'`, or add a parallel `authorCoverage`. Would not disturb any current test (none search by author).

---

### W7 — path-dependent tie order: rank 1 can flip on which candidate path ran — **SEVERITY: MEDIUM**

Two songs identical on every signal *including title* make `compareRelevance` return 0 (`songScore.ts:109`), so `Array.sort` stability hands the decision to **candidate-array order** — and the two paths order differently:

- FTS path: `songsRepo.ts:146` — `SELECT rowid, * FROM songs WHERE rowid IN (…)` with **no `ORDER BY`** → rowid order.
- Fallback path: `songsRepo.ts:64` `list()` — `ORDER BY created_at, title`.

Verified flip (rowid order A,B; created_at order B,A):
```
full-scan path (<30 hits) → top-1 = B
FTS path       (≥30 hits) → top-1 = A
```
Realistic trigger: imported songs whose `created_at` ordering differs from insertion rowid order (batch import, backdated timestamps). Crossing the 30-hit gate mid-typing then flips which of two identical arrangements Enter cues. **Fix:** add `ORDER BY created_at, title` (or `rowid`) to the `IN (…)` fetch so both paths agree. Zero ranking-semantics change; `songsRepo.test.ts` does not pin this.

---

### W8 — numeric titles: `10000` ranks the wrong song — **SEVERITY: LOW-MEDIUM**

`norm("10,000 Reasons (Bless the Lord)")` → `"10 000 reasons bless the lord"` (`fuzzy.ts:14` maps `,` to a space). The canonical spelling operators type — `10000` — matches **no whole word** in that title. It survives only by a 2-edit fuzz to the token `000` (`matchDist("10000","000") = 2`, tol 5 = 2). Any nearer numeric collision wins:

```
q="10000"  →  1. [392] "1000 Tongues"                       tClose=1
              2. [392] "10,000 Reasons (Bless the Lord)"     tClose=2   ← the real song
```
The spike's `10000` query passes only because its corpus has no numeric competitor. Also: the digit-prefix exemption (`fuzzy.ts:47`) means `10` matches both at 1000, and single digits match freely (`matchDist("2","o") = 1`). `Psalm 23` vs `Psalm 24` works correctly. **Fix direction:** strip digit-group separators in `norm()` (join `\d,\d` rather than splitting), or index a digits-collapsed alias. Touches shared `norm()` — `fuzzy.test.ts` pins punctuation behavior and the change affects the verse/quote paths too.

---

### W9 — phrase runs bridge title → author — **SEVERITY: LOW**

`songScore.ts:70` builds **one** segment from `norm(`${song.title} ${song.author}`)`. The comment at `:64-66` says the title/author segment "never bridges into the lyrics" — but title and author bridge into *each other*. `scoreSong('grace john', {title:'Amazing Grace', author:'John Newton'}).phrase === 2`. Cosmetic today (phrase is comparator position 5), but a false signal. **Fix:** push two segments instead of one.

---

### W10 — `faithfullness`: a genuine full tie decided by `titleLen`, and it scales badly — **SEVERITY: LOW-MEDIUM**

All signals tie (see §1); `titleLen` (`songScore.ts:108`) picks the shortest title, so canonical long hymn titles systematically lose to short ones. At 348 songs the target is rank 10; **at 3,048 songs it is ABSENT** (past the 50-cap at `songsRepo.ts:148`). Neither V1 nor the anchored band helps — nothing distinguishes the candidates. Needs a genuinely new signal (bm25 is 0 here because FTS returned no hits on the typo; a fuzzy-aware IDF or a `dist`-weighted title score would).

---

## 3. Verified FINE — do not chase

| Probed | Verdict |
|---|---|
| **≥30-hit + per-token gate** (`songsRepo.ts:144`) | **Works correctly.** `perTokenHasHit=[praise:Y, recukless:N]` → correctly full-scans. The #13 fix is live and effective. The *harness's* narrative about it is stale (§1 warning). No case found where it wrongly keeps the FTS set. It does over-full-scan on rare correctly-spelled tokens (<30 hits) — perf, not accuracy. |
| **`FTS_CANDIDATE_LIMIT = 1000` truncation** | Latent only. At 3,048 songs, 15/46 queries exceed the cap, but p@1 misses stay at 3/46 — the bm25 `ORDER BY` keeps targets in the surviving 1000. |
| **Multi-token word order** | Correct. `reckless love oh the overwhelming` → Reckless Love [440] rank 1; `oh the overwhelming never ending` → rank 1 via phrase=5. |
| **Stopword-heavy titles** | Correct. `come to the altar` → `O Come to the Altar` [998]; `it is well` → `It Is Well With My Soul` [1000]; `is well` → correct at 997 vs 996. |
| **Parenthetical / CCLI alternate titles** | Correct. `worthy is the lamb` → exact title 1200 above `Agnus Dei (Worthy Is The Lamb)` 990; `agnus dei`, `where feet may fail`, `oceans`, `cornerstone` all rank 1. |
| **Duplicate / near-duplicate arrangements** | Deterministic and stable within one candidate path. `Amazing Grace` (1200) correctly beats `Amazing Grace (My Chains Are Gone)` (1000). Cross-path flip is W7. |
| **Lyrics-full-match vs title-substring, multi-token** | Direction is right. `you turn mourning to dancing` → Graves Into Gardens [440] over decoy titles [360]. Multi-token substring requires the whole normalized query contiguous in the title — genuinely strong. The inversion is **single-token / word-interior only** (W3). |
| **`matchTol` 2-edit on 5-char tokens** | Narrower than feared. `grace`~`great` is lev **3** → no match. Admits `grave`/`grade`/`brace`/`trace` (1), `peace`/`place` (2), but `titleCloseness` cleans up rank 1 in `all` mode. 3-char `god`~`good`/`gold`/`rod` noise likewise contained at rank 1. **Pollutes ranks 3-9 of the 9 visible rows, not rank 1** — except when combined with W2. |
| **Diacritic folding** (#12) | Working. `cuan grande`, `renuevame`, `sublime gracia`, `grosser gott` all rank 1 with `ftsHit=true`. `senor` at rank 2 is W5, not folding. |
| **Field whitelist** (`songsRepo.ts:135`) | Safe as pinned. |

---

## 4. Suggested ordering for the planner

1. **W1** (swap `songScore.ts:101`↔`:102`) — one line, measured zero-regression, fixes two rank-27/rank-15 misses.
2. **W3** (word-start anchor on `songScore.ts:77`) — measured zero-cost, closes the highest-visibility false-positive class, restores the intent of `songSearchRanking.test.ts:134` in `all` mode.
3. **W2** (stopword/short-token hardening) — the user-reported bug; needs W1+W3 first, then a decision on band admission vs. IDF ordering, constrained by `songScore.test.ts:116-121`.
4. **W4** — adopt churn + monotonicity as harness assertions *before* touching `matchTol` (shared with message/verse scorers).
5. **W5**, **W6**, **W7** — small, low-risk, independently landable.
6. **Fix `scratch/search-spike/eval.test.ts:39`** so the harness stops reporting a false diagnosis.

**Harness caveat:** V0–V3 all measure identical p@1/p@3/MRR on the 46-query set. The set neither regressed on any fix nor detected any of W1–W10. It is a regression guard, not a detector — the adversarial cases need to be added to it.

**Scratchpad artifacts** (repo untouched):
`/private/tmp/claude-501/-Users-lem-repos-helm/35947157-c5d3-4daf-a35e-8cc7af114e80/scratchpad/song-search/probe/` — `adv.config.ts` (vitest config, `root` = repo), `a.adv.test.ts` (bands/fuzzy/gate/author/numeric/duplicates/parentheticals), `b.adv.test.ts` (keystroke replay + stability + path-dependence), `c.adv.test.ts` (`give me your hand` isolation), `d.adv.test.ts` + `f.adv.test.ts` (comparator/band A/B), `e.adv.test.ts` (3k-song scale + `all`-mode substring). Run any with `npx vitest run -c <adv.config.ts> --disableConsoleIntercept -t 'round N'`.
