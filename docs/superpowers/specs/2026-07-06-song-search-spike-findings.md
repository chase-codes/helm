# Song search — quality & fit-to-workflow spike (findings)

**Date:** 2026-07-06 · **Type:** time-boxed investigative spike (read-only on `src/`) · **Status:** findings, not a build.

Deliverable is this document. A throwaway measurement harness lives under `scratch/search-spike/`; no production code was modified. Any implementation is a separate brainstorm.

---

## TL;DR

Helm's song search is **good at recall and good at the easy cases**, but it has one **workflow-critical** weakness and two **correctness gaps** that bite exactly the operators the feature exists for.

- **The one that matters most (severity 1):** the ranker produces large **flat score plateaus** — many songs tie at the same score (360 / 392 / 404 / 416). When the top hit is tied, `Enter` (which cues `displayedRows[0]`, `SongsMode.tsx:155`) picks the winner **by database insertion order, not relevance**. Measured: same ranker, same corpus, targets inserted *last* instead of *first* → intent-weighted **p@1 drops 91% → 83%**, with real queries flipping from rank 1 to **rank 8 and rank 10**. In a live library that grows over time (operator's own pasted songs sort *after* the seed hymns by `created_at`), this is the realistic direction. **`Enter` is not trustworthy on typo/reordered/inflected queries** — the precise cases the fuzzy matcher was built to serve.
- **Diacritics are half-broken (severity 2):** the FTS index folds accents (`schema.ts:14`, `remove_diacritics 2`) but the in-memory scorer's `norm()` **destroys** accented letters (turns `é` → space, `fuzzy.ts:2`). Result: FTS *finds* the accented song, hands it to the scorer, and the scorer **scores it 0**. Measured accented-text p@1 = **60%**; `renuévame` and `señor` return the target from FTS then get dropped.
- **The ≥30 fallback has a structural hole (severity 3):** typo tolerance is silently disabled whenever FTS returns ≥30 prefix hits (`songsRepo.ts:43`). Single-token typos (the common audible case) are safe (they yield 0 FTS hits → full-scan). But a multi-token query mixing one common correctly-spelled word with one misspelled *distinguishing* word makes the target **unreachable** — proven with a constructed repro (`"holy reckelss"` → *Reckless Love* ABSENT, though `lev=1`).

Everything else (known-title, audible-partial, lyric-recall, single-token typo) measured at or near 100% on a 348-song corpus. Latency is fine today (≤18 ms at 1,000 songs) but grows ~linearly and the cheapest-to-mistype queries hit the most expensive code path.

The highest-leverage fix is **not** a better algorithm — it's **breaking the score ties** (a deterministic tie-breaker + a couple of ranking signals) so `Enter` becomes trustworthy, plus **fixing diacritic folding in `norm()`**. Both are small. The open question the team must answer is whether to layer in **workflow signals** (recency / today's set) — that requires product input, not just code.

---

## Step 0 — The real workflow & operator intents (grounded in code)

### The invocation path

1. Operator is in **Songs mode** (`SongsMode.tsx`). One text input (`SongSearchRail.tsx:142`) with three field tabs — **All / Title / Lyric** (`SongSearchRail.tsx:14`). Default is **All** (`SongsMode.tsx:59`).
2. **Every keystroke** re-queries (`SongsMode.tsx:88–97`) → `window.helm.songs.search(q, field)` → `songsRepo.search` (`songsRepo.ts:37`).
3. In **Title** mode only, a **second parallel search** runs against `lyric` on every keystroke (`SongsMode.tsx:104–116`) to feed the subordinate **"Also in lyrics"** hint (`secondaryLyricRows`, shown only when title hits are "thin", `< 3`).
4. Results render as a list; the operator either **clicks a row** or presses **`Enter`, which selects `displayedRows[0]`** — the top result (`SongsMode.tsx:155–158`). **`Escape` clears the query** (`:159`).
5. Selecting a song **immediately cues** its first section to the projection preview (`SongsMode.tsx:123–134`) — so a wrong top hit isn't just a bad list, it **puts the wrong thing on the cue bus**.
6. Empty query → **library browse** (all songs, `SongsMode.tsx:147–149`).
7. `songsRepo.search` returns up to **50** results (`songsRepo.ts:47`); the UI shows the first **9** (`SongsMode.tsx:147`).

### The ranking mechanics (what actually decides the winner)

- **FTS candidate gate** (`songsRepo.ts:40–46`): tokenize via `norm`, build `"tok"* OR "tok"*`, query `song_fts`. **If ≥30 rowids → rank only those. If <30 → rank the *entire* library** ("sparse hits ⇒ typo likely"). The scorer does the real work either way.
- **Scorer** (`scoreSong`, `songScore.ts:7–31`):
  - title exact = **1200**; title substring = **1000 − indexOf** (`:13`)
  - token-AND fuzzy: every query token must fuzzy-match some word (`lev` within `matchTol`, length window ±2, `:19`). All matched → `max(score, 380 + 12·matched)` (`:23`)
  - snippet = first lyric line containing any query token (`:24–27`); a snippet floors non-title scores to **360** (`:29`)
- **Tolerance** (`fuzzy.ts:18`): token ≤4 chars → 1 edit, else → 2. Shared with message + scripture search.

### Operator intents, ranked by live-service frequency × criticality

| # | Intent | Why it dominates | Weight |
|---|--------|------------------|--------|
| 1 | **Known-title under pressure** ("audible called — cue a song I know exists, <2 s, keyboard-only") | The core live-service loop. Type → `Enter` → it's on the cue bus. `Enter`-takes-top means **p@1 is the metric that matters**. | 5 |
| 2 | **Audible partial** (short prefix, half-typed) | Same moment, even less typed. Operator trusts the top hit before finishing the word. | 4 |
| 3 | **Forgot the title, remember a lyric** | Common for newer/less-familiar songs. Drives the All/Lyric split and the "Also in lyrics" hint. | 3 |
| 4 | **Misspelled title** (fat-fingered under pressure) | Frequent precisely because they're rushing. The whole fuzzy layer exists for this. | 3 |
| 5 | **Wrong word order / partial rearrangement** | "grace amazing", "kings king of". Happens when recalling from memory. | 2 |
| 6 | **Inflected form** (praise/praising, sorrow/sorrows) | Lower frequency; usually still recoverable. | 1 |
| 7 | **Accented / multilingual** | Depends entirely on congregation. Zero for many, constant for Spanish/multilingual churches. | 1 |

### Workflow constraints that define "best result" here

- **Keyboard-first, `Enter`-takes-top** ⇒ **precision@1 is king**, far more than a good page of results. A correct song at rank 2 is still a *miss* for the audible case.
- **Time pressure** (seconds, mid-service) ⇒ no time to disambiguate a list; the top hit must be right.
- **Selecting cues to the bus** ⇒ a wrong p@1 has an outward-facing cost, not just a UI annoyance.
- **Operator usually already knows the song exists** ⇒ recall is rarely the problem; *ranking the known item to the top* is.
- **Offline / local library, grows over time** ⇒ insertion order is *not* relevance, and it drifts as songs are added.

### Assumptions & open questions for the team

These shape which recommendations are worth building; the spike **tees them up rather than guessing**:

1. **Library size?** Measured latency is fine to ~1,000 and workable to ~3,000. If real libraries stay in the low hundreds, latency and the ≥30 fallback matter less; if they reach thousands, both need attention. *(Corpus assumed a few hundred; open.)*
2. **Do operators reuse songs weekly / seasonally?** If yes, a **recency/frequency boost** is likely the single highest-value ranking signal and would resolve most tie-break ambiguity for free. If usage is flat, it buys little. **This is the biggest open product question.**
3. **Is there a notion of "today's set" / service plan** that search could boost toward? (There are `services`/`service_items` tables in `schema.ts:27` — is that surfaced to the operator during live search?)
4. **Title vs. lyric — which do operators search by more often?** Determines whether the All/Title/Lyric split earns its complexity or should collapse into one smart mode.
5. **How multilingual are real congregations?** Sets the priority of the diacritics fix.
6. **Is `Enter`-takes-top a deliberate, trusted affordance** (operators rely on it) or incidental? If trusted, the tie-break fragility is severity 1 as ranked; if operators always visually confirm, it drops.

---

## Step 1 — Measured evaluation

### Method

The harness (`scratch/search-spike/`) drives the **real pipeline**: `createSongsRepo` over the **same FTS5 tokenizer the app uses** (`node:sqlite` bundles it with the identical `unicode61 remove_diacritics 2` schema, `testDb.ts`), the real `songsRepo.search`, the real `rankSongs`/`scoreSong`. So diacritic folding, the ≥30 fallback, and tie behavior are all faithful — not re-implemented.

- **Corpus:** 348 songs = 48 curated real worship songs/hymns (the labeled targets, incl. repeated choruses + 5 accented/multilingual) + 300 synthetic filler with deliberately colliding leading words (to create FTS prefix pressure and score ties). `corpus.ts`.
- **Query set:** 46 labeled queries organized **by intent** (`queries.ts`), each with the song a human would expect cued and the field tab realistically active.
- **Metrics:** p@1 (the one that matters), p@3, recall@50, MRR — reported per-intent and **intent-weighted**. Plus targeted probes that **localize** each failure (FTS-layer vs. scorer) and an **insertion-order experiment**.

Reproduce: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`

### Results by intent (measured)

| Intent | n | p@1 | p@3 | recall@50 | MRR |
|--------|---|-----|-----|-----------|-----|
| known-title-pressure | 10 | **100%** | 100% | 100% | 1.00 |
| audible-partial | 8 | **100%** | 100% | 100% | 1.00 |
| forgot-title-lyric | 8 | 88% | 88% | 88% | 0.88 |
| misspelled-title | 8 | **100%*** | 100% | 100% | 1.00 |
| wrong-word-order | 4 | 75%* | 75% | 100% | 0.80 |
| inflected-form | 3 | 100% | 100% | 100% | 1.00 |
| accented-text | 5 | **60%** | 60% | 60% | 0.60 |

**Intent-weighted: p@1 = 95%, p@3 = 95%, recall@50 = 97%, MRR = 0.95.** Unweighted p@1 = 91% (42/46).

**\* These numbers are inflated by insertion order** — see gap #1. The single lyric miss ("my chains are gone") is a genuine *content* gap (that refrain isn't in our classic Amazing Grace text), not a ranker failure — so real lyric recall is stronger than 88%.

### Severity-ranked gap list (with repros)

---

#### GAP 1 — Score-tie plateaus make `Enter` pick by insertion order, not relevance · **SEVERITY 1**

**Intents hit:** misspelled-title, wrong-word-order, inflected-form, forgot-title-lyric — i.e. *every intent that relies on the fuzzy path* rather than a clean title substring.

**Mechanism:** the scorer collapses many distinct matches to identical scores. A single fuzzy-matched token → `380 + 12·1 = 392` for *every* song containing that word (`songScore.ts:23`). A snippet with no better score → floor **360** (`:29`). Reordered full-token match → `380 + 12·n`. `rankSongs` sorts by score only (`songScore.ts:38`); ties fall to `Array.sort` stability = **insertion order**.

**Measured tie fragility (real pipeline):** 8/46 labeled queries have rank-1 **tied** with rank-2:

```
"faithfullness"  → 10 songs tied at 392   (Great Is Thy Faithfulness wins only by being seeded first)
"grace amazing"  →  9 songs tied at 404
"kings king of"  →  9 songs tied at 416   (target actually lands rank 5)
"amazin grace"   →  9 songs tied at 404
```

**Proof it's insertion order, not relevance — same ranker, only order changed:**

```
targets inserted FIRST:  p@1 = 91% (42/46)
targets inserted LAST:   p@1 = 83% (38/46)
flips (rank 1 → not):  "faithfullness" 1→10,  "amazin grace" 1→8,  "grace amazing" 1→8,  "10000" 1→2
```

In production, `list()` orders by `created_at, title` (`songsRepo.ts:22`), and the FTS-candidate branch orders by rowid — both ≈ insertion order. **An operator's freshly-pasted song sorts *after* the seed hymns**, so the realistic direction is the "inserted last" column: **`Enter` cues the wrong song on exactly the typo/reorder/inflection queries the fuzzy matcher was built to rescue.** The 95% weighted p@1 is a corpus-ordering artifact; true worst-case p@1 for a tied query is ~1/N.

**Why it's severity 1:** it directly breaks the #1 and #2 intents' core promise (`Enter`-takes-top must be right), and it's *invisible* in aggregate metrics unless you probe ties.

---

#### GAP 2 — Diacritic handling is inconsistent: FTS folds, scorer destroys · **SEVERITY 2**

**Intent hit:** accented / multilingual (p@1 = 60%).

**Mechanism:** `norm()` (`fuzzy.ts:2`) lowercases then `replace(/[^a-z0-9 ]/g, ' ')` — every accented letter becomes a **space**. `Renuévame` → `renu vame` (two tokens); `Señor` → `se or`. The FTS index, by contrast, folds diacritics cleanly (`schema.ts:14`), so it *returns* the accented song as a candidate — then the scorer, using `norm`, can't match the unaccented query against the shattered tokens and scores it **0**.

**Measured localization (the probe proves it's scorer-side, not FTS-side):**

```
"renuevame" → rank -1  ftsHit(target)=TRUE   scorerScore=0     ← FTS found it, scorer dropped it
"senor"     → rank -1  ftsHit(target)=TRUE   scorerScore=0
"cuan grande" → rank 1  scorerScore=360       ← survives only on the 360 snippet floor (fragile)
"sublime gracia" → rank 1 scorerScore=1200    ← works: no accent in the query's matched tokens
```

Multi-word accented titles limp through on the **360 snippet floor** (one clean token is enough to floor them), but that's a low, tie-prone score (see gap 1). Single-accented-word titles (`Renuévame`) and accented lyric search (`Señor`) **fail outright**.

**Note the asymmetry:** because FTS already folds, *recall* mostly works; it's the *scorer* that throws the result away. A one-line `norm` change (Unicode NFD + strip combining marks, and handle `ß`) closes most of this — **but `norm` is shared** (see blast-radius flag).

---

#### GAP 3 — The ≥30-hit fallback silently disables typo tolerance · **SEVERITY 3**

**Intent hit:** misspelled-title (multi-token subset).

**Mechanism:** `songsRepo.ts:43` — `if (rowids.length >= 30) { rank only those } else { rank whole library }`. The full-library scan is what gives the scorer a chance to *fuzzy*-match a typo. When ≥30 prefix hits come back, that scan never runs, so a target reachable only via fuzzy (its correct spelling isn't a prefix of any query token) is **excluded before scoring**.

**Measured:**

```
single-token typos → 0 FTS hits → fallback fires → fuzzy reachable  ✅
   "cornerstoen" ftsCount=0   "blesed" ftsCount=0   "reckles" ftsCount=1

multi-token, one common word ≥30 hits + one misspelled distinguishing word → target excluded ❌
   "praise recukless" ftsCount=243 fallback=false → Reckless Love ABSENT  (lev("recukless","reckless")=1)
   "holy reckelss"    ftsCount=252 fallback=false → Reckless Love ABSENT
```

**Why severity 3, not higher:** the *common* audible mistype is a single misspelled token, which yields sparse FTS hits and is safely rescued (hence misspelled-title measured 100%). The hole only opens for multi-token queries mixing a common word with a misspelled distinguishing word — real but less frequent. Still, it's a **silent** correctness cliff tied to an arbitrary constant (30) and library size.

---

#### GAP 4 — No stemming; inflected forms rely on edit-distance luck · **SEVERITY 4 (minor)**

`praise`/`praising` is `lev=3` (> tol 2) — not matched as a token. Measured inflected-form p@1 was 100% only because those queries **also** contained a clean token (`praising my saviour` matched on `my`/`saviour` and floored at 360 via snippet). Bare inflected single-token queries (`praising` alone → *Blessed Assurance*) would miss. Light stemming (strip `-ing/-ed/-s`) or a token-prefix relaxation would close it. Low frequency ⇒ low severity.

---

#### GAP 5 — Latency grows linearly; cheapest-to-mistype queries hit the most expensive path · **SEVERITY 4 (watch)**

Measured avg ms/search over the labeled set:

```
  200 songs:  3.9 ms      1000 songs: 18.3 ms      3000 songs: 56.5 ms
```

Fine today. But: (a) it's **per keystroke**; (b) **Title mode doubles it** (the parallel lyric pass, `SongsMode.tsx:104`); (c) the **sparse-FTS fallback scans the whole library with Levenshtein per word** — so a single-token typo, the hurried operator's most likely input, triggers the *most* expensive path. At 3,000 songs a mistyped keystroke ≈ 56 ms × 2 (title mode). Watch if libraries get large.

---

## Step 2 — Recommendations (open-ended, tied to intents)

Each tagged with the intent it serves, rough effort (S/M/L), and risk. Grouped as the spike requested: result-quality, workflow-signal, interaction/UX. **These are options to brainstorm, not a committed plan.**

### A. Result quality

| # | Change | Serves | Effort | Tradeoff / risk |
|---|--------|--------|--------|-----------------|
| A1 | **Deterministic, relevance-based tie-breaker** in `rankSongs` — before falling to insertion order, break ties by (title-startswith-query, then shorter title, then higher token-coverage ratio, then title length). Directly attacks GAP 1. | 1,2,4,5 | **S** | Pure ranking change; safe. Biggest bang-for-buck. Doesn't add *new* signal, just stops the coin flip. |
| A2 | **Spread the score plateaus** — replace the flat `380+12·matched` / `360 floor` with a continuous score: incorporate per-token edit distance (closer match = higher), token coverage ratio, and field weight (title-hit > lyric-hit). Fewer exact ties to begin with. | 1,4,5,6 | **M** | Requires re-tuning the constants; needs the harness as a regression guard. Higher upside than A1 alone; do A1 first, A2 if ties persist. |
| A3 | **Fix `norm()` diacritic folding** (NFD normalize + strip combining marks + map `ß`→`ss`). Closes GAP 2. | 7 | **S** | ⚠️ **Shared** — `norm` also powers message search and scripture book-name matching (blast-radius flag below). Needs a couple of message/scripture tests. High value for multilingual churches, near-zero for others. |
| A4 | **Remove / raise / make-adaptive the ≥30 fallback** (GAP 3) — e.g. always union the FTS candidates with a fuzzy pass, or gate on "did any token fail to prefix-match?" rather than a raw count. | 4 | **M** | Cost is latency (more full scans). Pairs naturally with A6. Lower priority than A1–A3. |
| A5 | **Light stemming / suffix folding** in tokenization (GAP 4). | 6 | **S–M** | Shared `norm`/tokenizer surface; small recall win, small over-match risk. |
| A6 | **Adopt FTS5 BM25 ranking** for the candidate ordering and/or an **in-process library** (MiniSearch / Orama / FlexSearch) instead of the hand-rolled scorer. | 1–7 | **L** | Buys principled ranking (no plateaus), stemming, prefix, typo, and speed — but replaces a small, well-understood, *offline* module with a dependency, and re-tuning field boosts to match the current title-first feel is real work. **Only worth it if A1–A3 don't get us there.** Recommend deferring until the cheap fixes are measured. |

### B. Workflow-signal ranking (needs product input — see open questions)

| # | Change | Serves | Effort | Tradeoff / risk |
|---|--------|--------|--------|-----------------|
| B1 | **Recency / frequency boost** — bump songs used recently or often. Likely the single highest-value *signal* and it **resolves most tie-break ambiguity for free** (a reused song outranks a filler tie). | 1,2 | **M** | Needs a "song last/used count" store (small). **Gated on open question 2** — only worth it if operators reuse songs. Very low UX risk (boost is invisible until it helps). |
| B2 | **"Today's set" boost** — if a service plan exists (`services`/`service_items`), boost its songs during live search. | 1 | **M–L** | **Gated on open question 3** (is a set surfaced during live search?). High value for the audible case if sets are planned; zero if they aren't. |
| B3 | **Learn from the operator's own selections** — when a query is disambiguated by a click, remember it. | 1,4 | **L** | Cold-start + complexity; only after B1 proves the appetite for signal-based ranking. |
| B4 | **Confidence on p@1** — when the top hit doesn't clearly beat #2 (post-A1, a real tie or near-tie), *don't* let bare `Enter` cue blindly; require a confirm or highlight ambiguity. | 1,2 | **S–M** | Directly protects the cue bus from GAP-1-style wrong-cues. Small, high-trust. Pairs with C3. |

### C. Interaction / UX

| # | Change | Serves | Effort | Tradeoff / risk |
|---|--------|--------|--------|-----------------|
| C1 | **Question the All/Title/Lyric split** — gated on open question 4. If operators can't predict which tab wins, one **smart "All" mode** that ranks title-hits above lyric-hits and shows lyric matches inline (the "Also in lyrics" idea, but always-on) may beat three tabs. | 1,3 | **M** | Removes a control some operators may rely on; validate with usage first. The current secondary-hint machinery (`secondaryLyric.ts`) is a half-step toward this already. |
| C2 | **Better empty-state / browse** — the empty query dumps the whole library in `created_at` order. Recently-used-first (ties into B1) makes browse-to-build-a-set faster. | (build/confirm set) | **S** | Low risk; depends on B1's usage store. |
| C3 | **Audible-call keyboard affordance** — make the trustworthiness of `Enter` visible: e.g. a subtle "1 strong match" vs "several close matches" cue so the operator knows when to trust blind `Enter` (ties into B4). | 1,2 | **S** | Pure additive UI; the highest-leverage *UX* complement to the A1 ranking fix. |
| C4 | **Kill the double search in Title mode** or debounce — the parallel lyric pass runs every keystroke (`SongsMode.tsx:104`). If C1 collapses the tabs, this disappears; otherwise debounce both. | (latency) | **S** | Minor; relevant only at larger libraries. |

### Shared-code blast-radius flag (`src/shared/search/fuzzy.ts`)

`fuzzy.ts` is a **single source of truth** consumed well beyond songs:

- `norm` → **song search**, **message/quote search** (`messagesRepo.ts:117`, `messageScore.ts`), and **scripture** book-name + ref parsing (`scripture/books.ts`, `scripture/refs.ts`).
- `matchTol` / `lev` / `fuzzyTok` → song + message scorers.

So **A3 (diacritics), A5 (stemming), and any `matchTol` change touch scripture and message search too.** That's mostly *upside* (accent-folding helps Spanish book names like "Génesis" and message titles equally) but it **must** be validated against those flows, not just songs. Any change here should extend the harness pattern to message/scripture before shipping.

---

## Recommendation

**Do the cheap, high-certainty fixes first, measure, then decide on the big questions.**

1. **A1 (tie-breaker) + A3 (diacritic `norm` fix)** — small, surgical, and they hit the two highest-severity gaps. A1 makes `Enter` trustworthy for the dominant intents; A3 fixes multilingual. Guard both with the spike harness (extend it to message/scripture for A3).
2. **Then answer open questions 2 & 3** (song reuse? today's set?) — because **B1 (recency boost)** is plausibly the highest-value single change *and* it dovetails with the tie-break problem, but it's a **product** decision, not a code one.
3. **A2 / A4 / B4 / C3** as a fast-follow if measurement shows residual ties or wrong-cues.
4. **Defer A6 (library / BM25 rewrite)** until the cheap fixes are proven insufficient — replacing a small offline module is only justified if A1–A3 leave real quality on the table.

Any of these is a separate brainstorm; this spike's job was to find where the search fails the operator and prove it with numbers. The headline: **the search recalls well but ranks by insertion order under the hood, and `Enter`-takes-top turns that into wrong cues on exactly the hurried, imperfect queries the feature exists to serve.**

---

## Appendix — reproducing the measurements

```
scratch/search-spike/
  corpus.ts        # 47 curated targets (incl. accented) + deterministic filler
  queries.ts       # 46 labeled queries by intent + intent weights
  eval.test.ts     # drives real songsRepo.search; metrics + localization probes + experiments
  vitest.config.ts # include glob for scratch/ (root config is src/-only)

npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept
```

The harness is throwaway; delete `scratch/search-spike/` when the findings are consumed. All numbers in this doc are from the real `songsRepo`/`rankSongs`/FTS pipeline via `node:sqlite` (same tokenizer as the app).
