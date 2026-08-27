# SONG Search Algorithm — Technical Breakdown (Helm)

Scope: song search only. Message/quote and Bible-verse search are noted only where they share code (primarily `src/shared/search/fuzzy.ts`, and `highlight.ts`/`verseScore.ts`).

---

## 0. File Inventory (verified)

| File | Role |
|---|---|
| `src/main/ftsQuery.ts` | Shared FTS5 MATCH-string builders (songs, quotes, verses) |
| `src/main/songsRepo.ts` | Song CRUD + `search()` — FTS candidate gate → JS rank |
| `src/main/schema.ts` | SQLite DDL, incl. `song_fts` virtual table |
| `src/main/db.ts` | Production DB open (WAL pragma, schema exec, ad-hoc migration) |
| `src/main/testDb.ts` | `node:sqlite`-backed test DB (ABI-safe substitute for better-sqlite3) |
| `src/main/ipc.ts` | `registerIpc()` — exposes `songs:search` etc. over Electron IPC |
| `src/preload/index.ts` | `window.helm.songs.search(q, field)` bridge |
| `src/shared/types.ts` | `CH` channel map, `SearchField`, `SongSearchResult` types |
| `src/shared/search/songScore.ts` | In-memory ranker (`scoreSong`, `rankSongs`) |
| `src/shared/search/fuzzy.ts` | `norm`, `lev`, `matchTol`, `matchDist`, `bestMatch`, `textSignals` — shared with message/verse search |
| `src/shared/search/highlight.ts` | Token highlighter — **used by verse search only, NOT songs** (see §8) |
| `src/shared/songs/lyrics.ts` | `lyricsOfSections`/`lyricsOf` — flattens sections into the FTS `lyrics` column text |
| `src/shared/songs/secondaryLyric.ts` | `secondaryLyricRows` — "Also in lyrics" hint logic |
| `src/shared/songs/splitToSlides.ts` | Parses pasted raw text into `SongSection[]` (blank-line-delimited blocks) |
| `src/renderer/operator/SongSearchRail.tsx` | Presentational search rail (input, field tabs, rows) |
| `src/renderer/operator/SongsMode.tsx` | Owns query state, fires IPC search, wires results into the rail |
| `src/main/songsRepo.test.ts`, `src/main/songSearchRanking.test.ts`, `src/main/ftsQuery.test.ts` | Repo/FTS-level tests |
| `src/shared/search/songScore.test.ts`, `fuzzy.test.ts` | Scorer/fuzzy unit tests |
| `src/renderer/operator/SongSearchRail.test.tsx`, `SongsMode.test.tsx` | UI-level tests |
| `scratch/search-spike/*` | Throwaway measurement harness (pre-fix "findings" doc, now used partly as a regression guard) |

**Not actually part of the song search path** (verified irrelevant/misleading):
- `src/renderer/operator/QuickAdd.tsx` — calls `window.helm.songSources.search` (a *web song-source lookup*, separate feature/IPC channel); never calls `window.helm.songs.search`. Song **creation** UI, not a search UI.
- `src/renderer/operator/SchedulePanel.tsx` — no song references at all. Not part of this flow.

---

## 1. End-to-end data flow

**Keystroke → debounce (none) → IPC → SQL (FTS5) → JS scoring → ranking → render.**

1. Operator types in the input rendered by `SongSearchRail` (`src/renderer/operator/SongSearchRail.tsx:292-299`), whose `onChange` calls `setQ(e.target.value)` — a prop supplied by `SongsMode`, backed by `useState('')` at `SongsMode.tsx:104`.
2. **No debouncing anywhere in the song path.** `SongsMode.tsx:190-199` runs a `useEffect` keyed on `[q, field]` that fires on **every** state update:
   ```
   useEffect(() => {
     if (!q.trim()) return;
     let live = true;
     void window.helm.songs.search(q, field).then((r) => { if (live) setResults(r); }).catch(console.error);
     return () => { live = false; };
   }, [q, field]);
   ```
   The cleanup (`live = false`) guards against a stale response from a superseded keystroke overwriting a newer one — a race-guard, not a debounce. Pinned by `SongsMode.test.tsx:249-250` (`search` called exactly once per keystroke, no timer).
3. In **Title** mode only, a second parallel effect (`SongsMode.tsx:206-218`) fires `window.helm.songs.search(q, 'lyric')` to populate `lyricHint`, feeding the "Also in lyrics" hint. This literally doubles the IPC/SQL/scoring work per keystroke while in Title mode (flagged as GAP/latency concern in the spike doc, unresolved — `C4`).
4. `window.helm.songs.search` is the preload bridge (`src/preload/index.ts:11`): `search: (q, field) => ipcRenderer.invoke(CH.songsSearch, q, field)`, where `CH.songsSearch = 'songs:search'` (`src/shared/types.ts:179`).
5. Main process handler (`src/main/ipc.ts:58`): `ipcMain.handle(CH.songsSearch, (_e, q, field) => repo.search(q, field))` — `field` arrives untyped over IPC and is explicitly **not** trusted to build SQL text (see §3/§4 whitelist).
6. `SongsRepo.search(q, field)` (`src/main/songsRepo.ts:124-149`):
   - `norm(q)` → tokens.
   - Empty tokens → `rankSongs('', list(), field)` (browse-all path, no scoring).
   - Builds FTS MATCH string via `orPrefixMatch(tokens)` (`ftsQuery.ts:17-19`).
   - Runs one SQL query against `song_fts` JOIN `songs`, ordered by `-bm25(...)`, `LIMIT 1000` (`FTS_CANDIDATE_LIMIT`).
   - Per-token "did this token get any FTS hit at all" probe (`tokenHasHit`) decides whether to use the FTS candidate set or fall back to the entire library (`list()`).
   - Calls `rankSongs(q, candidates, field, rel, 50)` — the JS-side scorer/ranker, capped at 50 results.
7. `rankSongs` (`src/shared/search/songScore.ts:112-122`) scores every candidate via `scoreSignals`, filters `score > 0`, sorts by `compareRelevance`, slices to `limit`, and attaches a best-window snippet per surviving row via `bestSnippet`.
8. Result (`SongSearchResult[]` = `{ song, score, snippet }`) returns over IPC to `SongsMode`, lands in `setResults(r)` (`SongsMode.tsx:183`/`194`).
9. `SongsMode.tsx:557-559` builds `displayedRows` by slicing `results` to the **first 9** and mapping each to a `SongRow` via `toRow` (`SongsMode.tsx:85`) — UI shows only top 9 of the ≤50 returned.
10. `secondaryLyricRows` (`secondaryLyric.ts:6-15`) computes the "Also in lyrics" rows, only in Title mode, only when title results are "thin" (`< SECONDARY_TITLE_MAX = 3`), capped at `SECONDARY_LIMIT = 3` (`SongsMode.tsx:61-62, 561-563`).
11. `SongSearchRail` renders `rows` and `secondaryRows` (pure presentational, no scoring/matching logic of its own).
12. `Enter` in the search input (`onInputKeyDown`, `SongsMode.tsx:565-577`) calls `selectSong(displayedRows[0].id)` — i.e. **the top-ranked row is cued/selected blindly on Enter**, which is the workflow fact the tie-break design decision (§4) exists to protect.

---

## 2. FTS5 schema

`src/main/schema.ts:20-22`:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS song_fts USING fts5(
  title, author, lyrics, tokenize='unicode61 remove_diacritics 2'
);
```
- **Columns indexed:** `title`, `author`, `lyrics` — all three ordinary (indexed) FTS5 columns; none `UNINDEXED` (contrast with `verse_fts`, which marks `version_id/book/chapter/verse` `UNINDEXED` and only indexes `text`).
- **Column order is load-bearing**: `SONG_FTS_COLUMNS = ['title', 'author', 'lyrics'] as const` (`schema.ts:6`) is the single source of truth, reused positionally by `songsRepo.ts`'s `bm25()` weight builder (`bm25For`) so DDL and weight args can't drift.
- **Tokenizer:** `unicode61 remove_diacritics 2` — folds accented characters to base ASCII during tokenization (e.g., `é`→`e`). Matched by JS-side `norm()` (§5).
- **No `content=` clause**: `song_fts` is a **standalone (non-external-content) FTS5 table**. Explicit and load-bearing per the `remove()` doc comment (`songsRepo.ts:20-23`): a `songs` delete alone would leave an orphan row that keeps matching searches and then mis-attributes itself to whatever song later reuses that rowid.
- **No triggers.** Sync is **manual and explicit** in `songsRepo.ts`:
  - Insert: `insertFts.run(song.id, song.title, song.author, lyricsOf(song))` (`songsRepo.ts:61`), correlated subquery resolves `rowid` from `songs.id` (`songsRepo.ts:48`).
  - Update: `updateFts.run(title, author, lyricsOfSections(sections), id)` (`songsRepo.ts:113`).
  - Delete: `deleteFts.run(id)` runs **before** `deleteSong.run(id)` in the same transaction (`songsRepo.ts:118-121`) because the FTS delete's subquery needs `songs` to still hold the rowid.
  - Any future code path that touches `songs` without going through `SongsRepo` prepared statements silently desyncs the index. No DB-level safety net.
- **No prefix index** (`prefix=` FTS5 option). Prefix queries (`"tok"*`) use the default full-token index plus native prefix-query support — an available future lever, not measured as a bottleneck up to 3,000 songs.
- **Schema migration path:** `music_key` added imperatively in `db.ts:9-11` (prod only); **not** part of `song_fts`.

---

## 3. Query construction — raw input → FTS MATCH expression

Centralized in `src/main/ftsQuery.ts`, shared across songs, quotes, verses "so the three repos cannot drift on quoting or the candidate cap" (`ftsQuery.ts:1-3`).

1. **Tokenization**: `const tokens = norm(q).split(' ').filter(Boolean)` (`songsRepo.ts:125`). `norm()` (fuzzy.ts, §5) lowercases, NFD-normalizes, strips combining marks, folds non-decomposing letters (`ß, ø, đ, ł, æ, œ, þ`), strips apostrophes, replaces everything outside `[a-z0-9 ]` with a space, collapses whitespace. Single normalization function for the whole pipeline (also the segment tokenizer inside the scorer).
2. **Escaping**: `ftsTerm(t, prefix)` (`ftsQuery.ts:11-13`) wraps each token in double quotes and doubles embedded `"` — valid FTS5 quoted string literal. Defends against FTS5 syntax injection.
3. **Prefix operator**: `ftsTerm(t, true)` appends `*` — so `"wonder"*` matches `wonderful`.
4. **Multi-term logic (song candidate gate)**: `orPrefixMatch(tokens)` (`ftsQuery.ts:17-19`) joins every token as **OR**'d prefix terms: `"amaz"* OR "grace"*`. Deliberately **any-token-matches** at the SQL layer — FTS is a **broad recall gate / candidate generator with a bm25 relevance prior**; the "all-tokens" AND-like requirement and fuzzy tolerance live in `songScore.ts`.
5. **Phrase handling**: **no FTS phrase-query syntax** used in the song path. Phrase/adjacency is a purely JS-side signal (`textSignals`, §4/§5) computed over fetched candidates — it never influences which rows FTS returns, only ranking.
6. **`andGroupsMatch`** (`ftsQuery.ts:24-28`) is the **verse** candidate-gate shape; not used by `songsRepo.ts` (imports only `orPrefixMatch, ftsTerm, FTS_CANDIDATE_LIMIT`, `songsRepo.ts:9`).
7. **Candidate cap**: `FTS_CANDIDATE_LIMIT = 1000` (`ftsQuery.ts:8`) → `LIMIT 1000` (`songsRepo.ts:136`), to stay under SQLite's bound-variable cap for the subsequent `IN (...)` query.
8. **Field whitelisting**: `songsRepo.ts:135`: `const bm25 = Object.hasOwn(BM25, field) ? BM25[field] : BM25.all;` — the `bm25(...)` expression is always one of three pre-built literal strings. Pinned by `songSearchRanking.test.ts:130-132` (`field: 'constructor' as never` must not throw).

---

## 4. Ranking — the formula

Two layers: **(a)** SQL-side `bm25()` used only as a tie-break signal and as the FTS `ORDER BY` for which 1000 candidates survive; **(b)** JS-side `scoreSong`/`rankSongs` in `songScore.ts`, which owns pass/fail and the primary sort.

### 4a. bm25 (SQL layer)

`songsRepo.ts:29-40`:
```ts
const bm25For = (w: Record<FtsColumn, number>): string =>
  `bm25(song_fts, ${SONG_FTS_COLUMNS.map((c) => w[c].toFixed(1)).join(', ')})`;
const BM25: Record<SearchField, string> = {
  all:   bm25For({ title: 8, author: 2, lyrics: 1 }),
  title: bm25For({ title: 1, author: 0, lyrics: 0 }),
  lyric: bm25For({ title: 0, author: 0, lyrics: 1 }),
};
```
- FTS5's `bm25()` returns lower = more relevant; the query negates it — `SELECT ... -${bm25} AS rel ... ORDER BY rel DESC` (`songsRepo.ts:136`).
- Weight args are hardcoded literals in the SQL text (FTS5 aux-function args must be constant in some builds).
- `title` field mode zeroes author/lyrics **weights** but does **not** narrow the MATCH scope — the JS scorer's field-gated `segs` is what enforces title-only scoring.
- `rel` per song is captured into a `Map<songId, number>` (`songsRepo.ts:138`) and passed to `rankSongs(..., rel, 50)`; defaults to 0 for full-library-fallback candidates.

### 4b. JS scorer (`src/shared/search/songScore.ts`)

**Primary score** (`scoreSignals`, `songScore.ts:57-94`) — flat bands, by design (PR #70: "Keep the flat buckets but break ties by real signals"):

| Condition | Score |
|---|---|
| `title === q` (normalized exact) | **1200** |
| else `title.includes(q)` (substring) | `1000 - title.indexOf(q)` |
| all query tokens matched anywhere (fuzzy/prefix/exact), `matched === qts.length` | `max(current, 380 + matched * 12)` |
| ≥1 "strong" (≥3 char) matched token, field ≠ `'title'` | `max(current, 360)` |
| otherwise | `0` (excluded — `rankSongs` filters `score > 0`) |

Notes:
- Title bands (1200 / 1000−idx) only when `field !== 'lyric'` (`songScore.ts:77`).
- Partial band excludes `field === 'title'` (`songScore.ts:81`) and requires `strong > 0` — stopword-only matches never qualify (`songScore.test.ts:144-149`).
- Field-scoped `segs` (`songScore.ts:67-72`): `title` field scores only title words; otherwise one segment for `title + author` (skipped when `field === 'lyric'`) plus one segment **per song section**, with phrase adjacency blocked at section boundaries but transparent across line breaks within a section (`songScore.ts:64-66`, `songScore.test.ts:92-99`).

**Tie-break sub-signals** (computed unconditionally alongside `score`; only order within a band):

```
titleCoverage   — # query tokens fuzzy-matching a title word (higher wins)
titleCloseness  — total edit distance of those title matches (lower wins)
covWeight       — Σ character length of matched query tokens (higher wins)
phrase          — longest run of consecutive query tokens found consecutively in text (higher wins)
coverage        — # query tokens matched anywhere in the blob (higher wins)
rel             — the -bm25 FTS relevance prior (higher wins)
tf              — total exact occurrences of query tokens (higher wins)
titleStartsWith — boolean, title begins with the whole normalized query (true wins)
titleLen        — shorter title wins
title           — final lexicographic tiebreak
```

**Comparator** (`compareRelevance`, `songScore.ts:98-110`), exact order:
```
1. score  2. titleCoverage  3. titleCloseness  4. covWeight  5. phrase
6. coverage  7. rel (bm25 prior)  8. tf  9. titleStartsWith  10. titleLen  11. title
```

**"bm25 tie-break prior by design"** (PR #70 / commit `69d4ef0`, merged `c3364a2`, 2026-08-14): bm25 is deliberately not blended additively into the primary score and sits at position 7 — flat bands separate relevance *classes*; bm25 arbitrates *within* a class. Regression-pinned by `songScore.test.ts:123-130`.

**Snippet** (`bestSnippet`, `songScore.ts:29-49`): computed separately from scoring, never feeds back into `score`. Picks the single line or two-consecutive-line window with the most distinct fuzzy query-token matches (whole-word only). `rankSongs` computes snippets only for returned rows (post-filter/sort/slice, `songScore.ts:121`) — cost scales with output size, not candidate size.

**Historical**: `compareRelevance` exists to fix "BUG-002" (rank-1 decided by insertion order) — commit `00340da`, then #53/PR-70 added bm25/phrase/tf on top (2026-08-14). The spike findings doc predates the fixes.

---

## 5. Fuzzy matching (`src/shared/search/fuzzy.ts`)

**When it kicks in:** baked into every token comparison the scorer makes (via `matchDist`/`bestMatch`/`textSignals`), for every search. The separate repo-level fallback (§6) decides whether the scorer sees the whole library vs. the FTS subset.

- `norm(s)` (`fuzzy.ts:7-17`): NFD normalize → strip combining marks → lowercase → fold `ß→ss, ø→o, đ→d, ł→l, æ→ae, œ→oe, þ→th` → strip apostrophes → non-`[a-z0-9 ]` → space → collapse. Ties to FTS `remove_diacritics 2` and bug #12 fix (commit `b475006`, 2026-08-23).
- `lev(a, b)` (`fuzzy.ts:18-28`): classic full Levenshtein, O(m×n) DP, no early termination/banding.
- `matchTol(tokLen)` (`fuzzy.ts:32-34`): length ≤4 → 1 edit; longer → 2 edits. Single source of truth shared by song/message/verse.
- `matchDist(t, w)` (`fuzzy.ts:45-49`), three tiers:
  1. Exact → **0**.
  2. Anchored prefix (`w.startsWith(t)`, `w` longer) → **1**, only if `t.length >= 3` or `t` all-digits.
  3. Else if `|w.length - t.length| <= 2`: `lev(t, w)`; else **99** (skip DP — main practical cost guard).
- `bestMatch(t, words)` (`fuzzy.ts:53-61`): scans word list, early-exits on 0, returns 99 if best exceeds `matchTol`.
- `fuzzyTok(tok, words)` (`fuzzy.ts:35-38`): boolean variant used by message scorer.
- `textSignals(segs, qts)` (`fuzzy.ts:84-122`) — shared relevance pass:
  - `Map<word, count>` over all segment words (fuzzy pass runs over UNIQUE words).
  - Per unique word: bitmask (one bit per query-token index, capped `PHRASE_MAX_TOKENS = 30`) of tokens it satisfies within tolerance; tracks per-token best distance.
  - Derives `matched`, `strong` (≥3 chars), `covWeight`, `tf` (exact occurrence counts), `dist`.
  - `phrase`: longest contiguous run of query tokens as consecutive words in a segment; rolling DP array per segment, O(words × tokens), no extra Levenshtein calls (reuses `wordMask`). Fuzzy/prefix matches count toward phrase runs.
- **Cost model**: worst case O(unique-words × query-tokens × lev(token,word)) per candidate song × #candidates (≤1000 FTS set, or **entire library** on fallback). `lev` unbounded/unbanded; the ±2-length prefilter is the guard.

---

## 6. Result limits, pagination, caching/memoization

- **FTS candidate cap**: `FTS_CANDIDATE_LIMIT = 1000`, applied on the bm25-ordered FTS query — best-ranked hits survive.
- **≥30-hit fallback gate** (`songsRepo.ts:140-147`): use FTS candidate set only if hit count `>= 30` **and** every token independently has ≥1 FTS hit (`tokenHasHit`, one `SELECT 1 ... LIMIT 1` probe per token). Otherwise fall back to `list()` (entire library) — "typo likely." Per-token check fixes bug #13 (pinned `songsRepo.test.ts:27-33`).
- **Final result cap**: `rankSongs(..., 50)` — hard cap of 50 (`songsRepo.ts:148`).
- **UI slicing**: `results.slice(0, 9)` primary rows (`SongsMode.tsx:558`); "Also in lyrics" capped at 3. No pagination anywhere.
- **No caching or memoization anywhere in the chain**: every keystroke re-runs `norm()`, FTS query, `tokenHasHit` probes, fetch, and full `rankSongs` pass. Only the stale-response race guard exists (discards, doesn't reuse).
- **Empty-query path**: `rankSongs('', list(), field)` returns entire library, unscored (`score: 1` sentinel), in `SELECT rowid, * FROM songs ORDER BY created_at, title` order (`songsRepo.ts:64`) — browse mode.

---

## 7. Test coverage

| Test file | What it pins |
|---|---|
| `songScore.test.ts` | Score bands, snippet selection, 4 BUG-002 tie-break scenarios, phrase adjacency (line-break-transparent, section-blocked), whole-word-only matching, stopword-only exclusion, covWeight beats raw coverage, bm25 tie-break ahead of title length, mid-word prefix type-ahead, tf tie-break |
| `fuzzy.test.ts` | `norm()` punctuation/apostrophe/diacritics (#12), `lev()`, `matchTol()` boundaries, `fuzzyTok()` tolerance, `textSignals().dist` per-tier cost |
| `songsRepo.test.ts` | CRUD + FTS reindex on update/delete/re-add (no orphan resurrection), typo'd lyric via full-scan fallback, #13 per-token gate rescue (30 decoys + 1 fuzzy-only target), accented round-trip (#12), `addBatch` savepoint isolation, empty-query-lists-everything, `music_key` round-trip |
| `songSearchRanking.test.ts` | Real-pipeline (FTS5+bm25) ranking fixtures for #53: stopword-heavy phrase beats scattered matches, cross-line phrase + snippet, section-boundary blocking, tf tie-break, typo-in-lyric with snippet, mid-word type-ahead band membership, stopword-only-query honest-empty, out-of-range `field` safety, substring-inside-word exclusion |
| `ftsQuery.test.ts` | `ftsTerm` quoting/escaping/prefix, `orPrefixMatch` shape, `andGroupsMatch` shape (verse-only), `FTS_CANDIDATE_LIMIT` pin (1000) |
| `secondaryLyric.test.ts` | Thin-title threshold gating, dedup by song id, cap, empty passthrough |
| `SongSearchRail.test.tsx` | Rail rendering + #89 hover-forecast interaction — UI-only |
| `SongsMode.test.tsx` | Search fires once per keystroke (no debounce), re-runs active search after import with same `(query, field)`, arm/live/escape-chain/quick-edit coverage |

**No gold/fixture corpus in `src/`.** `songSearchRanking.test.ts` builds 9 songs inline. The labeled 348-song/46-query corpus lives in `scratch/search-spike/` only.

### `scratch/search-spike/` — measurement harness

- Spike dated 2026-07-06; doc: `docs/superpowers/specs/2026-07-06-song-search-spike-findings.md` (STALE — narrates pre-fix numbers).
- `corpus.ts` — `buildCorpus(n)`: 48 curated real worship songs (5 accented) + `n` synthetic filler with colliding leading words.
- `queries.ts` — 46 labeled queries tagged by operator intent (`known-title-pressure`, `audible-partial`, `forgot-title-lyric`, `misspelled-title`, `wrong-word-order`, `inflected-form`, `accented-text`), each with expected target + realistic field tab, plus `INTENT_WEIGHT`.
- `eval.test.ts` — computes p@1/p@3/recall@50/MRR per intent and intent-weighted; failure localization probes (FTS-side vs scorer-side; fallback exclusion); insertion-order experiment (now ASSERTS `p1After === uHit1` and `flips === 0` — it's a passing regression guard for the tie-break fix); latency at 200/1,000/3,000-song sizes.
- **Run**: `npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept`
- Doc says "throwaway; delete when consumed" but it was later committed as the BUG-002 guard (`cfb8760`) — role migrated to semi-permanent regression harness.

---

## 8. Surprising / dead / inconsistent findings

1. **`highlight.ts` unused by song search** — `highlightTokens` used only by `ScriptureSearchResults.tsx`. `SongSearchRail.tsx:137` renders the snippet as a plain string; no bolding of matched tokens, unlike verse results.
2. **Spike findings doc is stale** — its headline numbers (91%→83% p@1 drop on reorder; diacritics scoring 0) describe pre-fix state; GAP 1 and GAP 2 appear resolved in code; GAP 3 (fallback excludes reachable typo) has the per-token gate aimed at it + regression test, but no fresh spike re-run confirmed the numeric resolution.
3. **`field='title'` doesn't restrict MATCH scope, only bm25 weighting** — SQL layer can surface lyric-only matches as candidates; the JS scorer's field-gated `segs` is the only enforcement. Functionally correct but broader SQL work than the field name implies.
4. **`field` flows untyped through IPC** — deliberately whitelisted at runtime (`Object.hasOwn(BM25, field)`).
5. **No triggers / no `content=` on `song_fts`** — deliberate but structurally fragile: raw-SQL writes to `songs` would silently desync the index.
6. **`andGroupsMatch` is dead code from the songs repo's perspective** (verse-only).
7. **Two IPC round-trips per keystroke in Title mode, no debounce on either** (`SongsMode.tsx:190-199`, `206-218`) — spike doc `C4`, still unaddressed.
8. **`QuickAdd.tsx` and `SchedulePanel.tsx` are not search call sites** (songSources web lookup / nothing).
