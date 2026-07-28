# Song search — performance / live-cue hot-path spike (findings)

**Date:** 2026-07-06 · **Type:** time-boxed, read-only performance spike (no `src/` changes) · **Status:** findings, not a build.

Deliverable is this document. A throwaway measurement harness lives under `scratch/perf-spike/` (payload + within-search breakdown), reusing the corpus/tokenizer of `scratch/search-spike/`. No production code was modified. Any implementation is a separate brainstorm.

Reproduce:
```
npx vitest run -c scratch/perf-spike/vitest.config.ts --disableConsoleIntercept      # payload + breakdown
npx vitest run -c scratch/search-spike/vitest.config.ts --disableConsoleIntercept    # baseline latency sweep
```

---

## TL;DR — gating verdict

**Not a problem at the library sizes real congregations reach today. Revisit at N ≈ 1,000 songs.**

The workflow-relevant metric is **per-keystroke latency** (Songs mode re-queries the whole pipeline on every keystroke, `SongsMode.tsx:88`). I set an explicit budget (below): **≤16 ms/keystroke** is imperceptible and safe for the live-cue bus; **>50 ms** is laggy.

The **deciding number:** the *worst realistic query* — a single-token typo, which the hurried keyboard-first operator is most likely to produce — takes **~4 ms at 200 songs and ~6–7 ms at the assumed ~350-song corpus**, comfortably under the 16 ms frame budget. It crosses 16 ms somewhere around **~900–1,000 songs** (measured **19 ms @1,000**) and becomes clearly laggy by **~3,000 songs** (**60 ms**, and **120 ms** for a long lyric-line search). So today's search is fine; the risk is entirely a function of library size, which is **UNCONFIRMED (open question #1, carried over from the quality spike)**.

**The pre-identified IPC-payload hypothesis is verified but is *not* a hotspot** (see §3): the full-Song payload is real dead weight (20 KB, 59% reducible), but shipping it costs only **~67 µs/keystroke** — **≤1.6 %** of even the cheapest search, and a rounding error at scale. It's the safest change on the board but delivers no meaningful latency win. Do it as hygiene, not as a perf fix.

When latency *does* matter (large libraries), the cost is almost entirely the **in-memory fuzzy scorer** (88.5 % of a search), specifically the **whole-library Levenshtein fallback scan** — and it's triggered by exactly the query the feature exists to rescue.

---

## 1. Latency budget (stated explicitly)

Songs mode fires `window.helm.songs.search` on **every keystroke** with **no debounce** (`SongsMode.tsx:88–97`). Crucially, the search runs **synchronously on the Electron main process** (`ipc.ts:42` → `songsRepo.search`, a synchronous better-sqlite3 + JS scan). So per-keystroke cost is not just UI latency — **while the main process is scanning, it cannot service any other IPC, including `presentation.cue` / `presentation.goLive`** (`ipc.ts:47–48`). A slow search can therefore delay a *go-live*.

| Tier | Per-keystroke budget | Rationale |
|------|----------------------|-----------|
| **Imperceptible / target** | **≤ 16 ms** | One 60 Hz frame. Input feels instant; the main-thread block is too short to stall the cue bus or back up queued keystrokes. |
| **Tolerable ceiling** | ≤ 50 ms | Noticeable but usable for a single action (RAIL's 100 ms "responsive" bound, halved because searches fire *continuously* while typing and compound). |
| **Laggy** | > 50 ms | Visible input lag; fast typing queues searches on the single-threaded main process and a go-live can wait behind an in-flight scan. |

**Measurement boundary (declared):** the `scratch/search-spike` harness measures **pure algorithm** (repo + scorer, no IPC). `scratch/perf-spike` adds the **IPC serialize/clone microbenchmark** (the gap the algorithm harness can't see). Neither crosses a real Electron process boundary, so absolute IPC numbers are lower bounds — but the *relative* full-vs-slim delta and the algorithm costs (which dominate) are faithful.

---

## 2. Baseline & the cost surface (measured, real pipeline)

Median ms per `repo.search`, driving the real `createSongsRepo` / FTS5 / `rankSongs` over `node:sqlite` (`scratch/perf-spike/breakdown.test.ts`):

| Query shape | Field | FTS hits @1k | Path | 200 | 1,000 | 3,000 |
|-------------|-------|-------------:|------|----:|------:|------:|
| clean 1-token, common (`praise`) | all | 780 | FTS-cand | 1.2 | 8.5 | 26.3 |
| clean 1-token, rare (`oceans`) | all | 1 | **FULL-SCAN** | 3.6 | 19.4 | 59.8 |
| **typo 1-token** (`cornerstoen`) | all | 0 | **FULL-SCAN** | 2.4 | 13.3 | 41.0 |
| **typo 1-token, common** (`praiez`) | all | 0 | **FULL-SCAN** | 3.6 | 19.6 | 60.4 |
| multi-token clean (`how great is our god`) | all | 291 | FTS-cand | 2.3 | 8.8 | 28.6 |
| **long lyric line** (`amazing grace how sweet the sound`) | lyric | 855 | FTS-cand | **7.8** | **40.5** | **120.8** |

(Baseline avg over the labeled query set, `search-spike`: **4.1 / 19.3 / 59.6 ms** @200/1k/3k — consistent.)

**Cost model:** search cost ≈ `candidates × query_tokens × blob_words × (length-window check + maybe lev)`. It grows with all three factors:
- **candidate count** — the `<30`-hits **fallback scans the *entire* library** (`songsRepo.ts:46`); even the `≥30` FTS-candidate branch scores *hundreds* for a common word.
- **query token count** — a long lyric line (6 tokens) multiplies the scan 6×; hence the 120 ms worst case.
- **library size** — linear in candidates, so linear in library size on the full-scan path.

**The trap (confirms BUG-006 / GAP 5):** the *cheapest query to mistype* — a single-token typo — yields **0 FTS hits → full-library scan → the most expensive path**. The hurried operator's most likely input is the worst case.

---

## 3. Pre-identified hypothesis — IPC ships lyrics the UI discards

**Claim (verified, link by link):**
- `ipc.ts:42` returns `repo.search(...)` verbatim → up to **50 × `{ song, score, snippet }`**, `song` being the full `Song` incl. `sections[].lines` (`songsRepo.ts:47` caps at 50). ✅
- `toRow` (`SongsMode.tsx:42`) — the only consumer — reads only `id`, `title`, `author`, `sections.length`. The lyric lines are never read. ✅
- Selection (`selectSong`, `SongsMode.tsx:136`) sets `activeSongId`; the cued song is looked up from `library` (loaded once via `songs.list()`, `SongsMode.tsx:73`), **not** from the search payload. So the payload's lyrics are dead weight. ✅

**Measured (`scratch/perf-spike/payload.test.ts`, V8 serialize + deserialize round trip):**

| Payload | Wire size | Round-trip serialize | Slim-DTO saving |
|---------|----------:|---------------------:|----------------:|
| **Current** (50 full Songs) | 20.0 KB (~361 B/result) | **67 µs** | — |
| **Slim DTO** `{id,title,author,sectionCount,score,snippet}` | 8.1 KB (~165 B/result) | 22 µs | **~45 µs** |
| Worst-case ceiling (50 full multi-verse hymns) | 173 KB (~3.5 KB/result) | 281 µs | 260 µs |

**Does it matter? No — it's independent of library size (capped at 50), so it's a *disproportionate* slice only where the search is cheapest, and even there it's tiny:**

| Library | Full-payload serialize | …as % of search | Slim-DTO saving as % |
|---------|-----------------------:|----------------:|---------------------:|
| 200 | 0.067 ms | **1.6 %** | 1.1 % |
| 1,000 | 0.067 ms | 0.3 % | 0.2 % |
| 3,000 | 0.067 ms | 0.1 % | 0.1 % |

Even the 173 KB worst case saves only **0.26 ms** vs a 4.1 ms search. GC churn: the per-keystroke garbage is the 20 KB payload — short-lived gen-0, collected cheaply; not a jank source at this size.

**Verdict:** hypothesis **confirmed as fact, refuted as a hotspot.** The slim DTO is the *cheapest, safest, most localized* change (no refetch-on-select needed — select already reads from `library`), but it buys ~45 µs. Ship it as hygiene / to shrink the structured-clone surface, **not** as the latency fix.

---

## 4. Severity-ranked hotspots

Severity = contribution to per-keystroke latency **at scale**, weighted by how likely the triggering query is for a keyboard-first operator mid-service. All are negligible at a few-hundred-song library.

### HOT-1 — Whole-library Levenshtein fallback scan · **SEV 1 (at scale)**
`songsRepo.ts:46` — when FTS returns `<30` hits, `candidates = list()` (the **entire** library), each scored with per-token Levenshtein. **Attribution @3,000, `cornerstoen` (full-scan):** total 40.5 ms → FTS query **0.012 ms (0 %)**, sort **0.31 ms (0.8 %)**, **scorer 35.9 ms (88.5 %)**. Within the scorer: **lev scan 41 %** (25,258 `lev()` calls for *one* keystroke), **per-song normalization 19.5 %** (see HOT-3), remainder is the length-window inner loop over every blob word. Triggered by the single-token typo — the operator's most likely mistake. **Scales linearly with library size** → this is the crossover driver (16 ms ≈ 900–1,000 songs; 50 ms ≈ 2,500).
*Responsible lines:* `songsRepo.ts:43,46`; `songScore.ts:9–16,40–42`.

### HOT-2 — Title-mode parallel lyric search doubles every keystroke · **SEV 2 (at scale)**
`SongsMode.tsx:104–116` fires a **second** full search (`field:'lyric'`) on every keystroke whenever field is Title — and the lyric pass is the *more expensive* half (@1,000, `how great`: title **0.67 ms** + lyric **1.80 ms** = Title-mode **2.47 ms/keystroke**). The second search feeds the "Also in lyrics" hint, which is only *shown* when title hits are thin (`< 3`, `secondaryLyricRows`) — yet it runs unconditionally. On a full-scan typo at 3,000 songs this ~doubles a 60 ms search to ~120 ms.
*Responsible lines:* `SongsMode.tsx:104–116,151–152`.

### HOT-3 — Per-keystroke re-normalization of every song · **SEV 2 (at scale)**
`songScore.ts:37` rebuilds and `norm()`s the blob (`title + author + lyrics`) and `split(' ')`s it **for every candidate on every keystroke** — **7.9 ms (19.5 %)** of the 40.5 ms full-scan search @3,000, and it's **100 % precomputable** (song text changes only on add/edit). A per-song cached `{titleWords, blobWords}` computed at load/add would erase this slice on every path, not just the fallback.
*Responsible lines:* `songScore.ts:5,33,37,40`; shared `norm` at `fuzzy.ts:1`.

### HOT-4 — No debounce; keystrokes queue on the single-threaded main process · **SEV 3**
`SongsMode.tsx:88` dispatches a search per keystroke with no debounce/coalescing. Because search is synchronous on the main process, fast typing at a large library **queues** searches and **the cue bus (`presentation.cue`/`goLive`) waits behind them** (`ipc.ts:42,47,48`). Cheap to fix (a ~120 ms debounce, or drop the in-flight search on a newer keystroke) and it caps the damage of HOT-1/2 regardless of library size.
*Responsible lines:* `SongsMode.tsx:88–97,104–116`.

### HOT-5 — FTS-candidate branch still scores hundreds of candidates · **SEV 3 (at scale)**
Even the "good" `≥30` path (`songsRepo.ts:44`) hands *all* matching rowids to the scorer (780 for `praise`, 855 for a common lyric word). With a many-token query (long lyric line) this is the measured **120 ms @3,000** — the single worst cell in §2. FTS5-native ranking (bm25) or capping candidates before the fuzzy pass would bound it.
*Responsible lines:* `songsRepo.ts:41,44,47`.

### HOT-6 — IPC ships full lyrics the UI discards (the slim-DTO hypothesis) · **SEV 5 (hygiene)**
As measured in §3: real dead weight, but ~45 µs/keystroke. Lowest-priority *latency* item; highest-priority *safety/simplicity* item.
*Responsible lines:* `ipc.ts:42`; `songsRepo.ts:47`; `SongsMode.tsx:42–51`.

**Non-hotspots (measured, so we don't chase them):** FTS MATCH query (**0 %**), result sort (**0.8 %**), IPC serialize (**≤1.6 %**), `list()` full-library serialize (once at load/add, *not* per keystroke — confirmed, not re-chased).

---

## 5. Candidate optimizations (tied to hotspot, effort, risk)

**These are options to brainstorm, not a committed plan. Do nothing until open question #1 (library size) is answered — at a few-hundred-song library none of these is worth the risk.**

| # | Change | Fixes | Effort | Risk / blast radius |
|---|--------|-------|--------|---------------------|
| **P1** | **Debounce / coalesce keystroke searches** (~120 ms trailing, or abandon the in-flight search when a newer keystroke arrives). | HOT-4 (+ caps HOT-1/2) | **S** | Very low, renderer-only (`SongsMode.tsx`). Protects the cue bus regardless of library size — do this first if *anything* is done. |
| **P2** | **Precompute per-song normalized token blobs** (`{titleWords, blobWords}`) at load/add; scorer reads them instead of `norm()`-ing every keystroke. | HOT-3 | **M** | Medium. Touches `songScore` signature + a cache in `songsRepo`. `norm` itself unchanged (no shared-code blast). ~20 % off every scan. |
| **P3** | **Bound the fuzzy scan:** length pre-filter is already there; add **early-exit / banded Levenshtein** (stop once edit distance exceeds `matchTol`) and skip lev entirely when the length window can't satisfy the tolerance. | HOT-1, HOT-5 | **M** | ⚠️ **`lev` is shared** with message search (`messageScore.ts:12`) and via `fuzzyTok`. A banded/early-exit `lev` is a pure speedup (same results) but **must be validated against message + scripture** flows. Extend the harness pattern there before shipping. |
| **P4** | **Kill / gate the Title-mode double search** — only run the parallel lyric pass when title hits are actually thin (`< 3`), or fold it into one smart "All" pass. | HOT-2 | **S** | Low; renderer-only. Pairs with the quality spike's C1 (collapse the All/Title/Lyric tabs). |
| **P5** | **Avoid the full-library fallback:** union FTS candidates with a *targeted* fuzzy pass (gate on "did a token fail to prefix-match?") instead of scanning everything when hits are sparse. | HOT-1 | **M** | Medium. Also closes quality **BUG-004** (the `≥30` cliff) — same code, `songsRepo.ts:43`. Best combined fix. |
| **P6** | **Slim result DTO** `{id,title,author,sectionCount,score,snippet}` from `search`; select already reads `library`, so no refetch. | HOT-6 | **S** | Lowest risk on the board. ~45 µs win — do for simplicity/clone-surface, not latency. |
| **P7** | **FTS5-native ranking (bm25)** and/or an in-process index (MiniSearch/Orama) instead of the hand-rolled full scan. | HOT-1, HOT-5 | **L** | High. Replaces a small, offline, well-understood module with a dependency + re-tuning. **Only if P1–P5 don't hold the budget at the real library size.** (Mirrors quality-spike A6.) |

**Shared-code flag (`src/shared/search/fuzzy.ts`):** `lev` → song + message scorers (`songScore.ts:13`, `messageScore.ts:12`, `fuzzyTok`); `norm` → song + message + scripture (`messagesRepo.ts:3`, `scripture/refs.ts:1`, `scripture/books.ts:1`). **P3 is the only perf option that touches shared `lev`** — validate against message/scripture search before shipping. P2/P6 do not touch shared code.

---

## 6. Open questions (for the team — not guessed)

1. **Real library size? (UNCONFIRMED — #1.)** This is the whole verdict. Fine to ~800 songs; the single-token-typo path crosses the 16 ms frame budget at ~900–1,000 and is laggy (>50 ms) by ~2,500–3,000. If real libraries stay in the low hundreds, **do nothing but P1 (debounce) as cheap insurance.** If they reach thousands, P2/P3/P5 become worth it.
2. **How fast do operators type, and do they type mid-audible?** The main-thread-stall / queueing risk (HOT-4) scales with typing speed × library size. A debounce (P1) neutralizes it cheaply regardless.
3. **Is the Title-mode "Also in lyrics" hint actually used?** If rarely, P4 (gate/kill the double search) is free latency. Ties into the quality spike's open question #4 (title vs lyric usage).
4. **Would search ever move off the main thread** (worker/util process), or is keeping the cue bus and search on one process acceptable given the budget? Relevant only if the library grows past ~1,000 and P1–P3 aren't enough.

---

## Appendix — reproducing the measurements

```
scratch/perf-spike/
  payload.test.ts     # IPC hypothesis: full-Song vs slim-DTO serialize cost, size, GC churn, worst-case ceiling
  breakdown.test.ts   # path × field × query-shape × size sweep; within-search attribution (FTS/scorer/lev/norm/sort); lev throughput
  vitest.config.ts    # include glob for scratch/perf-spike (root config is src/-only)

npx vitest run -c scratch/perf-spike/vitest.config.ts --disableConsoleIntercept
```

All numbers are from the real `songsRepo`/`rankSongs`/FTS pipeline via `node:sqlite` (same `unicode61 remove_diacritics 2` tokenizer as the app), reusing `scratch/search-spike/corpus.ts`. IPC costs use V8 serialize/deserialize + `structuredClone` as a lower-bound proxy for the Electron structured-clone hop. Both `scratch/` harnesses are throwaway — delete when the findings are consumed. This spike modified no `src/`.
