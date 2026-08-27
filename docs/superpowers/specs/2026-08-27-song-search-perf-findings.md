# Song search — performance investigation

**Method.** Extended the committed spike harness into a scratch copy at `/private/tmp/claude-501/-Users-lem-repos-helm/35947157-c5d3-4daf-a35e-8cc7af114e80/scratchpad/song-search/h/` (`lib.ts`, `perf.test.ts`, `proto.test.ts`, `vocab.test.ts`; logs `run1.log`–`run4.log`). Nothing in the repo was modified. It drives the real `createSongsRepo` over `node:sqlite`; **>88% of every measured keystroke is pure JS in `songScore.ts`/`fuzzy.ts`**, which is byte-identical in production, so the engine caveat only affects the SQL stages (1–5% of the budget).

## 0. The committed harness understates cost by ~3.5x

`scratch/search-spike/corpus.ts:145-152` builds filler songs of **39 words / 21 unique** from a 22-word vocabulary. Real songs (the curated set, and real pastes) are 150–350 words. Measured with realistic filler (159 words / 91 unique):

| library | spike filler | realistic filler |
|---|---|---|
| 1000 | 19.6 ms/search | **66.7 ms/search** |
| 3000 | 40.7 ms/search | **142.3 ms/search** |

The `41.54 ms/search @ 3000` the committed harness prints today is ~3.5x optimistic. (Aside: `makeFiller` cannot build more than ~5.8k songs — `LEAD×MID×TAIL` is 5760 combinations and the `if (seen.has(title)) continue` loop at `corpus.ts:150` spins forever past that. The scratch copy forces uniqueness.)

## 1. Cost model of one keystroke

Stage breakdown, realistic corpus, median of 7 (`run1.log` §B):

| library | case | fts | probe | fetch | **rank** | total | path |
|---|---|---|---|---|---|---|---|
| 200 | `amazing grace` | 0.16 | 0.03 | 0.24 | **20.4** | 20.8 | fts, 93 cands |
| 1000 | `amazing grace` | 0.68 | 0.05 | 1.25 | **59.2** | 61.1 | fts, 525 cands |
| 3000 | `amazing grace` | 1.77 | 0.07 | 2.39 | **99.0** | 103.3 | fts, **1000** cands |
| 3000 | `cornerstoen` | 0.07 | 0.00 | 12.9 | **91.3** | 104.3 | FALLBACK, 3000 |
| 10000 | `cornerstoen` | 0.07 | 0.00 | 39.7 | **301.0** | 340.9 | FALLBACK, 10000 |

**The rank stage is 88–97% of every keystroke at every library size.** SQL is never the problem: the MATCH query alone is 0.43–9.35 ms (`run2.log` §M).

Cost scales with **candidates × unique-words-per-song × query-tokens**. The query-token factor makes long lyric recall queries the worst case (`spirit lead me where my trust is without borders`, 9 tokens, 3000 songs → the p95/max in §D below).

### The FTS gate barely gates

`orPrefixMatch` (`ftsQuery.ts:17-19`) ORs prefix terms over common worship vocabulary, so at 3000+ songs it routinely returns the full `LIMIT 1000`. Typing `amazing grace`, the hit count goes `115 → 1000` the instant the second token appears (`run1.log` §C). So at ≥3000 songs the "candidate path" and the "fallback path" cost roughly the same — the fallback is *not* uniquely scary, the whole thing is.

### Per-keystroke, typing one real query

Sum of main-process block for typing `amazing grace` (13 keystrokes):

| library | total blocked | worst single keystroke |
|---|---|---|
| 200 | 140 ms | 20.4 ms |
| 1000 | **347 ms** | 68.1 ms |
| 3000 | **531 ms** | 104.0 ms |
| 10000 | **668 ms** | 106.7 ms |

Because `ipcMain.handle(CH.songsSearch, …)` (`ipc.ts:58`) runs synchronously, this blocks `presCue`/`presGoLive`/`presTake` (`ipc.ts:65-68`) too. At 1000 songs an operator typing a song name holds the main process for a third of a second; a hotkey take fired mid-typing waits behind it.

### Fallback frequency (every prefix of all 46 labeled queries — 704 keystrokes)

| library | fallback rate | fallback keystrokes | fts keystrokes |
|---|---|---|---|
| 200 | 31% | mean 13.4, p95 27.6 ms | mean 13.4, p95 36.2 ms |
| 1000 | 24% | mean 63.0, p95 103.8, max 123 ms | mean 46.9, p95 131.1, **max 253** ms |
| 3000 | 23% | **mean 188.8, p95 298.0, max 358 ms** | mean 62.0, p95 150.1, max 261 ms |

Fallback rate peaks at 3–5-char prefixes (33–54%) — i.e. *while the operator is mid-word*, on every query, not just typos. The `hits.length >= 30` gate (`songsRepo.ts:144`) does it: a partial word simply doesn't clear 30 hits yet.

### Title mode's second search is ~90% of the keystroke

`run1.log` §E — `SongsMode.tsx:190-199` (title) + `SongsMode.tsx:206-218` (lyric hint):

| library | query | title | lyric hint | hint share |
|---|---|---|---|---|
| 1000 | `reckless love` | 4.7 ms | 58.3 ms | **93%** |
| 3000 | `reckless love` | 7.5 ms | 82.0 ms | **92%** |
| 3000 | `holy` | 6.1 ms | 44.8 ms | 88% |

Title mode is *cheap* (`songScore.ts:68` scores only title words); the hint pays full lyric cost. Not "doubling" — a 12x multiplier on Title mode.

## 2. Ranked improvement opportunities

### 1. Precompute per-song normalized token docs — **5x, highest single win**
**Where:** `songScore.ts:58-71` (`norm(song.title)`, `norm(title+author)`, `norm(section.lines.join(' '))` per candidate per keystroke), `songScore.ts:38` (snippet re-norms every line), `songsRepo.ts:64`/`:146` (`JSON.parse(sections_json)` per candidate per keystroke).
**Measured** (`run2.log` §J/§K, 3000 songs, full library as candidates): `rankSongs` 97.15 ms → prototype **32.34 ms**; `norm()` alone is 25.96 ms (27%) of it. End-to-end 4.1–6.0x at 1000/3000/10000. Doc build for the whole library is a **one-off 101.6 ms** at 3000. JSON.parse is another 9.5 ms (3000) / 35.8 ms (10000) removed.
**Fidelity: top-9 identical on 24/24 (query, field) pairs** once the prototype's comparator matched `compareRelevance` in full (`run3.log`).
**Risk: MEDIUM.** `rankSongs` has exactly one production importer (`songsRepo.ts:6`) — blast radius contained; `scoreSong` is test/spike-only. Real risk is **cache staleness**: a doc that drifts from `songs` silently returns wrong results. Mitigate by building/invalidating the doc in the same three places `song_fts` is synced (`songsRepo.ts:61`, `:113`, `:118-121`).
**Disturbs:** nothing in `songScore.test.ts`/`songSearchRanking.test.ts` if the doc path is a new function and `scoreSong`/`rankSongs` keep signatures.

### 2. Kill the Title-mode second search — **~12x on Title-mode keystrokes, trivial**
**Where:** `SongsMode.tsx:206-218`.
The hint is thrown away whenever `results.length >= SECONDARY_TITLE_MAX` (`secondaryLyric.ts:12`, `SongsMode.tsx:561-562`) — today it is computed unconditionally anyway. Gating the effect on `results.length < SECONDARY_TITLE_MAX` removes it on the common case at zero behavioral cost.
**Risk: LOW.** Adds `results` to the dep array, so in the thin case the hint lands one round-trip later — acceptable for a subordinate hint. Better still: return the hint from the one existing IPC call so the candidate fetch is shared.
**Disturbs:** `SongsMode.test.tsx` never asserts a lyric-hint call count (only search-count pins are `:250` and `:257`). `secondaryLyric.test.ts` tests the pure function, unaffected. `SongSearchRail.test.tsx:152` passes `secondaryRows` as a prop.

### 3. Debounce / coalesce the keystroke search — **~70–85% of searches removed**
**Where:** `SongsMode.tsx:190-199` (and `:206-218`).
13 keystrokes for `amazing grace` today; a 100–120 ms trailing debounce at normal typing speed collapses that to 2–4. Does not lower the *worst* keystroke (needs #1/#4) but removes the pile-up and main-process saturation.
**Risk: LOW — the "once per keystroke" contract is weaker than it looks.** `SongsMode.test.tsx:250` is `await waitFor(() => expect(search).toHaveBeenCalledTimes(1))` after a *single* `fireEvent.change`. **No fake timers anywhere in that file** (grepped `useFakeTimers`/`advanceTimers` — zero hits), so `waitFor` polls real timers up to 1000 ms: a trailing debounce ≤ ~200 ms still satisfies it, as do `:776` and `:781`. *(Reasoned from test source, not executed — confirm with a run.)*
**Watch:** `onImportCompleted` (`SongsMode.tsx:175-186`) calls `search` directly and `:257` pins exactly 2 total calls — that path must stay un-debounced. Prior art for a trailing debounce: `src/main/index.ts:87-93`.

### 4. Replace the full-library fallback with vocabulary expansion — **2.3x avg, up to 11x on typos**
**Where:** `songsRepo.ts:144-147`. Bible search **already ships this pattern**: `verse_vocab` (`schema.ts:38`, `fts5vocab`) + `expandToken` (`biblesRepo.ts:79-90`) — "expand to the NEAREST tier of terms within edit tolerance". Transplant to songs: fuzzy pass runs once against the library's distinct-term list instead of every word of every song.
**Measured** (`run4.log` §O, realistic corpus):

| | 1000 songs | 3000 songs |
|---|---|---|
| distinct terms | 1621 (load 1.25 ms, cached) | 3621 (load 3.49 ms, cached) |
| avg over labeled set | 66.68 → **41.46 ms** (1.6x) | 138.58 → **61.47 ms** (2.3x) |
| `blesed assurance` | 92.9 → 12.2 ms | 266.6 → **23.2 ms** (11.5x) |
| `how geat thou art` | 91.4 → 17.1 ms | 261.2 → **33.2 ms** (7.9x) |

**Quality: rank-1 unchanged on 43/46 (3000) and 44/46 (1000).** One diff is an *improvement* (`faithfullness` now returns the labeled target). **One regression to flag: `"10000"` breaks** — `10,000 Reasons` tokenizes as `10`/`000`, no vocab term prefixes `10000`, so expansion fuzzes it away, whereas the full scan let `matchDist`'s digit-prefix rule (`fuzzy.ts:47`) rescue it. Any implementation must exempt all-digit tokens.
**Risk: MEDIUM.** Synthetic corpus vocabulary is unnaturally small (180 lyric words); a real 3000-song library is plausibly 8–15k terms, making the linear `expandToken` scan ~12 ms rather than ~3. Still an order of magnitude under the 189 ms it replaces; re-measure on a real library.
**Disturbs:** `songsRepo.test.ts:27-33` (the #13 per-token-gate rescue: 30 decoys + 1 fuzzy-only target) is exactly the behavior this replaces — needs rewriting against the new mechanism; it is the regression guard that matters most here.

### 5. Banded / early-exit Levenshtein — 3.7x on `lev`, folded into #1
**Where:** `fuzzy.ts:18-28`, called from `matchDist` (`fuzzy.ts:48`).
**Measured** (`run1.log` §G): full DP **0.834 µs/call** → banded with early bail **0.225 µs/call**.
**Risk: LOW-MEDIUM, but do not touch `lev` itself.** `fuzzy.test.ts` pins `lev()` directly and pins `textSignals().dist` per tier; a banded version returning `tol+1` instead of the true distance breaks those. Add `levWithin(a, b, tol)` used only from `matchDist`, leaving `lev` exported and exact. `fuzzy.ts` is shared with `messageScore.ts`, `verseScore.ts`, `passages.ts`, `highlight.ts`, `biblesRepo.ts` — a `matchDist` change is felt everywhere (should be an improvement everywhere, but it is a shared surface).

### 6. Short-circuit 1–2 character queries
**Where:** `songsRepo.ts:124-126`. Precedent with measured justification: `biblesRepo.ts:157-160` (*"that unfiltered scan cost ~60 ms on the main process, on the keystroke that produced it"*).
**Measured:** `"a"` costs 29.6 ms at 3000 and 37.5 ms at 10000, scoring 1000 candidates.
**Caveat, unlike verses:** a 1–2 char song query *can* legitimately score via the exact-title and `title.includes(q)` bands (`songScore.ts:77`) — it just cannot score via fuzzy/partial (`songScore.ts:81` requires `strong > 0`, ≥3 chars). Correct short-circuit is "skip the fuzzy pass, answer from title substring only", not "return empty". **Risk: MEDIUM** — needs its own test; gets most value free if #3 lands.

### 7. Merge the two SQL queries — cleanup, small win
`songsRepo.ts:136` already `JOIN songs s`; `songsRepo.ts:146` re-selects the same rows via `rowid IN (?,?,…)`. Selecting `s.*` in the first query removes a round trip, the 1000-parameter binding, **and the entire reason `FTS_CANDIDATE_LIMIT` exists** (comment at `ftsQuery.ts:6-8`). Worth ~2.4 ms; worth more as simplification. **Risk: LOW.**

### 8. Cache the prepared statements
`songsRepo.ts:128` re-prepares the `tokenHasHit` probe **per token per keystroke**; `songsRepo.ts:136` re-prepares the main query per search. Three pre-built statements (one per `SearchField`) plus one probe statement, hoisted next to `songsRepo.ts:47-53`. Measured 0.05–2.05 ms. Free, tiny. **Risk: LOW.**

### 9. Move search off the main process — only if 1–4 don't land
`worker_threads` / Electron `utilityProcess` with its own SQLite connection. Unblocks `presTake`/`presGoLive` regardless of search cost. **Risk: HIGH** (second DB connection, WAL, invalidation on write). Projected worst keystroke after #1+#2+#4 is ~15–25 ms at 3000 songs, so this should be unnecessary.

## 3. Not worth it — do not chase

- **FTS5 `prefix=` index** (`schema.ts:20-22`). Measured (`run2.log` §N, 3000 songs): only the degenerate 1-char MATCH improves, 2.64 → 1.44 ms; `"amaz"* OR "grac"*` is 0.92 → 0.80 ms. SQL is 1–5% of a keystroke. Zero perceptible gain, and fts5 options can't be `ALTER`ed — needs a full index rebuild migration on every existing DB.
- **Prefix-extension candidate reuse** ("re-score last keystroke's survivors"). Measured (`run1.log` §H): only **36% (94/258)** of keystrokes produce a result set that is a subset of the previous one. Unsound in principle: bands aren't monotone in query length — a song scoring 0 at `"am"` scores 360 at `"amaz"` once a token crosses the 3-char `strong` threshold (`songScore.ts:81`). Would silently drop results. Debounce gets the same win soundly.
- **Lowering `FTS_CANDIDATE_LIMIT`** as the primary lever. Measured (`run4.log` §Q, 3000 songs): 1000 → 126.6 ms, 400 → 101.9, 150 → 89.1, 60 → 82.9. Only 1.5x span — the average is dominated by the fallback path (cap doesn't touch it) and long multi-token queries. Quality holds to 150 (46/46), breaks at 60 (45/46). Worth a modest songs-specific cap *after* the real fixes — note the constant is shared with `messagesRepo.ts:126` and `biblesRepo.ts:59`, and `biblesRepo.ts:173` uses it as a "was the list truncated" sentinel — don't change the shared value.
- **Reducing the 50→9 snippet gap.** `rankSongs(..., 50)` computes 50 snippets; UI renders 9+3. Measured cost of all 50 snippets at 3000 songs: **0.82 ms**. Noise.
- **Moving ranking into SQL.** bm25 is already there as a prior; the JS scorer adds precisely the fuzzy/phrase/coverage/tie-break signals SQL can't express — the ones that fixed #53 and BUG-002, pinned by `songSearchRanking.test.ts`. Rewriting in SQL forfeits that work for a stage that is 1–5% of the budget.
- **Swapping in MiniSearch/Orama/FlexSearch** (spike recommendation A6). The measured problem is not the algorithm — it's re-deriving per-song data on every keystroke. Fixing that is 5x for ~100 lines with 24/24 ranking fidelity; a library swap re-opens every ranking decision settled by #53/PR-70/BUG-002.
- **`highlight.ts` for song snippets.** Unused by songs (`SongSearchRail.tsx:137` renders a plain string) — adding it would *add* cost. Out of scope; don't let it sneak in with a perf change.

## Suggested order

**#2 (title double) → #3 (debounce) → #1 (precomputed docs) → #4 (vocab expansion)**, then re-measure. #2 and #3 are hours of work with near-zero risk and together remove most of the *volume*; #1 removes most of the *per-search* cost with proven ranking fidelity; #4 removes the remaining tail (p95 298 ms → ~30 ms at 3000) but carries the most test churn. #5/#7/#8 ride along cheaply. Whatever lands, the committed spike harness needs its filler made realistic (`scratch/search-spike/corpus.ts:145-152`) before its latency numbers can be trusted as a guard.
