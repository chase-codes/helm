# Helm — Licensed (Streaming) Bible Source Design

**Date:** 2026-07-03
**Status:** Draft — awaiting user review (two decisions flagged below were made on best-judgment defaults while the user was away; confirm or redirect)
**Builds on:** slice 3 (scripture) — merged. Extends `bible_versions`/`verses`, `bibleSource.ts`, the installer, and Settings → Bibles.

## Decisions made as defaults (confirm before planning)

1. **Source: API.Bible** (`scripture.api.bible`). One integration unlocks ESV, NKJV, NASB, CSB, NLT, The Message, and more. Free non-commercial "church" tier: choose 3 copyrighted versions + all public-domain, 5,000 fetches/month. **NIV is not licensable for third-party apps and is out of scope.** Crossway's ESV-only API is documented in §10 as a future second adapter but not built now.
2. **Service-time model: prefetch + live fetch (robust superset).** Helm fetches verses live as you cue them *and* lets you pre-load the service's planned readings into the cache beforehand, so a dropped connection mid-service never blanks scripture. This covers both "reliable internet" and "iffy internet" churches. If your console usually has *no* internet, this feature has limited value — say so and we'll reconsider.

## 1. The core constraint (why this isn't "just another translation")

Licensed modern translations **cannot be bundled or stored offline** like the public-domain set. Both major licenses prohibit retaining the full text locally — Crossway's ESV API caps local storage at 500 verses; API.Bible's publisher agreements are fetch-on-demand. So a licensed version in Helm is fundamentally **streaming**: an API key, verses fetched over the internet as needed, a small bounded cache (never the whole Bible), an on-screen copyright notice, and rate limits.

For *live presentation* this is workable — a service shows a few dozen verses, not whole books — but the behavior differs from KJV and the design must make that difference safe and visible, never surprising the operator mid-service.

## 2. Success criteria

- Operator enters a free API.Bible key once in Settings; the licensed versions their key can access appear as installable, grouped separately from the offline downloads.
- Installing a licensed version registers it for streaming (no bulk download). It then works in the Scripture track exactly like KJV to *cue and project* — same reference parsing, same compare, same chapter rail — as long as the verse is cached or reachable.
- "Prepare for service" pre-fetches every planned reading for the selected licensed versions, so cued verses are already local and survive a connection drop.
- A licensed verse that isn't cached and can't be fetched **degrades calmly** — falls back to an installed offline version if one is in the compare set, else a clear on-screen-safe hint — and **never crashes, blanks the projector, or hangs the console**.
- The required copyright/attribution line shows on screen whenever a licensed version is projected.
- The API key is never committed, never logged, never shown on the projector; it lives only in local settings.

## 3. Architecture — offline vs streaming sources

Today every version is an **offline source**: bulk-download JSON → store all verses in `verses` → serve locally forever. This design adds a second kind, **streaming source**, behind a common seam so the Scripture UI doesn't branch on source type.

```
BibleSource (concept, two implementations)
├─ OfflineSource  (getbible + bundled KJV)  → download once, permanent local verses
└─ StreamingSource (apibible)               → register + key; fetch chapter on demand, bounded cache
```

The Scripture track already reads chapters through one call — `window.helm.bibles.getChapter(book, chapter)` returning `ChapterData`. That stays the single read path. The main-process `getChapter` becomes source-aware: for offline versions it reads `verses` (unchanged); for streaming versions it reads the cache, and on a miss triggers a fetch. Streaming fetches for the *operator's* live cue must be non-blocking and cancellable so the console never freezes on a slow network.

## 4. Data model changes

```sql
-- extend bible_versions
ALTER-equivalent (fresh CREATE, IF NOT EXISTS additive):
  source       TEXT NOT NULL DEFAULT 'getbible'   -- 'getbible' | 'bundled' | 'apibible'
  streaming    INTEGER NOT NULL DEFAULT 0          -- 1 for apibible
  remote_id    TEXT                                -- API.Bible bibleId, e.g. '9879dbb7cfe39e4d-04'
  license_note TEXT                                -- on-screen copyright line, publisher-supplied

-- bounded cache for streamed verses (NOT permanent storage)
CREATE TABLE verse_cache (
  version_id TEXT NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL, text TEXT NOT NULL, fetched_at INTEGER NOT NULL,
  PRIMARY KEY (version_id, book, chapter, verse)
);
```

**Cache bound (license compliance + hygiene):** the cache is evicted by chapter, LRU on `fetched_at`, kept under a conservative global cap (default 400 verses total across all streaming versions — safely under ESV's 500 even though we're targeting API.Bible, so the same code is safe if the ESV adapter lands later). Eviction is per-chapter (never a partial chapter). The cache is explicitly a *cache*, cleared on uninstall and on a "Clear cached text" settings action; it is never presented as owned local text.

Migration is additive and non-destructive (`CREATE TABLE IF NOT EXISTS`, and existing rows default `source='getbible'`, `streaming=0`), so existing `helm.db` files open unchanged — consistent with how slice 3 appended tables.

## 5. The API.Bible adapter (`src/main/apiBibleSource.ts`)

A `StreamingSource` with these operations, all behind a typed interface so tests inject a fake HTTP client (no network in unit tests):

- `listBibles(key): Promise<LicensedBible[]>` — `GET https://rest.api.bible/v1/bibles`, header `api-key: <key>`; returns id (`remote_id`), abbreviation, name, language, and the copyright/`license_note`. Filtered to English (and whatever else the key grants).
- `fetchChapter(key, remoteId, book, chapter): Promise<{n:number,text:string}[]>` — `GET /v1/bibles/{remoteId}/chapters/{osis}.{chapter}?content-type=text&include-verse-numbers=false&include-notes=false&include-titles=false`, where `{osis}` is the USFM/OSIS 3-letter code for the book (GEN, EXO, PSA, JHN, REV…). Parse the returned per-verse text into `{n, text}` (the endpoint can return the chapter as verse spans; if only whole-chapter text is available, request per-verse via the verses endpoint `/verses/{osis}.{ch}.{v}` — the adapter picks whichever the API reliably provides; verified at implementation, same discipline as the getbible endpoint verification in slice 3).
- Book-code map: a new `OSIS: Record<CanonicalBookName, string>` table in `src/shared/scripture/osis.ts` (pure, unit-tested against all 66 canonical names).

Auth/errors surface as typed results: `invalid-key` (401), `quota` (429/plan limit), `not-available` (403 for a version the key lost access to), `offline` (network error/timeout), `not-found` (bad ref). None throw to the projector; all render calmly in Settings or as a scripture-slide fallback.

Timeouts: `AbortSignal.timeout` (short for live cue, e.g. 6 s; longer for prefetch batch). Live-cue fetches are also cancelled if the operator cues past them.

## 6. Reading path — `getChapter` becomes source-aware

`biblesRepo.getChapter(book, chapter)` today reads `verses`. New behavior:

- Build `ChapterData.verses[n][versionId]` by unioning **all installed versions** (as now). For each version: offline → read `verses`; streaming → read `verse_cache`.
- A streaming version with an uncached chapter contributes nothing yet (its column is simply absent — `verseCols` already skips missing text, so the hero/output show whatever *is* available). The renderer/main then kicks a background `fetchChapter`; on success it writes the cache and emits a `bibles:chapterUpdated` broadcast so the Scripture track re-reads and the column fills in. This is the same "converges when data lands" pattern slice 3 used for first-run KJV install.
- If the streaming fetch fails while that version is the *only* selected one, the scripture slide shows the calm fallback (§7).

This keeps SermonMode's cue→goLive→output pipeline unchanged: it still calls `getChapter` and builds slides from whatever columns exist, with the `liveChapter` guard already preventing stale cross-chapter frames.

## 7. Degrade-calmly rules (the safety core)

- **Compare with a mix:** KJV + ESV selected, ESV not yet fetched → project KJV alone now; ESV column appears when it lands. Never hold the screen waiting.
- **Licensed-only, cache miss, offline:** scripture slide shows `[ ESV needs internet — showing <fallback> ]` where `<fallback>` is the operator's primary *offline* installed version if any exists, rendered in full; only if there is no offline version at all does it show the plain install/connect hint. Goal: something correct is always projectable.
- **Quota exhausted / key invalid:** a persistent status chip in the operator header and a red banner in Settings → Bibles; live behavior falls back exactly as the offline case. The projector never shows an error string.
- All fallbacks are chosen so the *worst case on Sunday morning* is "the licensed version quietly isn't there and KJV is showing," never a blank or a crash.

## 8. UI — Settings → Bibles, two groups

Settings → Bibles gains a **"Licensed translations (online)"** section below the existing **"Downloaded (offline)"** list:

- If no key is set: a short explainer ("Licensed versions like ESV stream from API.Bible and need a free key and internet"), a masked key input, a **Connect** button, and a link to sign up (opened in the external browser via `shell.openExternal`).
- Once connected: list the versions the key grants (from `listBibles`), each with abbr, name, publisher/copyright line, and **Install** (= register for streaming) / **Installed ✓ + Remove**. A subtle "online" glyph distinguishes streaming versions everywhere they appear.
- A **"Prepare for service"** button: pre-fetches every scripture-schedule reading for all installed streaming versions into the cache, with progress and a per-reading result; safe to re-run. Also surfaced near the schedule in Sermon mode.
- A **"Clear cached text"** action and a small cache-usage readout (n verses cached).
- Key handling: stored in `settings` (`apiBibleKey`), masked in the field, never sent to any window's log or the output windows, never committed. A one-line note that the key is personal and shouldn't be shared (license terms).

VersionPicker (compare popover) shows streaming versions with the online glyph and, if a key/quota problem exists, a dimmed "unavailable — check Settings" state instead of silently failing.

## 9. On-screen attribution

The scripture `Slide` gains an optional `credit?: string`. When any projected column is a licensed version, the audience slide renders a small, unobtrusive credit line (the publisher-required notice, e.g. "Scripture quotations from the ESV® Bible, © Crossway"). SlideCanvas renders it in the existing faint-footnote style; it's suppressed for public-domain-only slides. This satisfies the attribution clause without cluttering the main text.

## 10. Out of scope (this slice)

- **NIV** — not licensable for third-party apps; excluded.
- **Crossway ESV-only API** as a second source — the `StreamingSource` seam is designed to accept it later (its 500-verse cap is already why the cache bound is 400), but only the API.Bible adapter is built now. Adding it later is a new adapter + a second key field, no architecture change.
- Whole-book or export views of licensed text (would violate storage limits by design — we only ever fetch what's cued/planned).
- Commercial licensing / Pro tier — the church non-commercial tier is assumed.

## 11. Testing

- **Unit (pure/injected, no network):** OSIS code map (all 66 names); API.Bible response parser (chapter→`{n,text}[]`, verse-number stripping, HTML-vs-text handling) against captured fixture payloads; cache bound + LRU eviction (never partial chapters, stays under cap); `getChapter` union across one offline + one streaming version with cache hit/miss; degrade-calmly slide selection (mix, licensed-only-offline, quota) as a pure function; typed error mapping (401/403/429/network → union).
- **Integration:** biblesRepo streaming register/uninstall (cache cleared on uninstall); settings key round-trip; `bibles:chapterUpdated` broadcast wiring.
- **Manual/CDP:** enter a real key, list, install ESV, cue a verse (fills in), compare KJV+ESV side by side, prefetch the schedule then simulate offline (disable network) and confirm cued readings still project and an *un*-prefetched chapter degrades to KJV; credit line renders; remove clears cache.
- **Never tested against the live paid API in CI** — fixtures only; the real-key path is a documented manual smoke, like the packaging smoke in prior slices.

## 12. Build order (single slice, ~8–9 tasks)

1. OSIS map + API.Bible response parser (pure, TDD).
2. Data-model changes + `verse_cache` + cache-bound/eviction (TDD).
3. API.Bible adapter (injected HTTP client, typed errors, TDD on parser/error mapping).
4. Source-aware `getChapter` + `chapterUpdated` broadcast + degrade-calmly pure logic (TDD).
5. Installer/IPC surface: key set/connect, listBibles, register-streaming install, prefetch, clear-cache, quota/key status.
6. Settings → Bibles two-group UI + key entry + Prepare-for-service.
7. VersionPicker streaming states + on-screen credit line (Slide.credit + SlideCanvas).
8. Degrade-calmly wiring in SermonMode (fallback selection, background-fetch convergence).
9. Final gate + README (licensed-bibles quickstart, key setup, offline behavior).

## Open questions for the user (from the flagged defaults)

- Confirm **API.Bible** as the source (vs ESV-only, vs both).
- Confirm the **prefetch + live** service model fits your internet situation — or tell me if the console is usually offline (which would change the value calculus).
- Which specific licensed versions do you most want (the free tier lets you pick 3 copyrighted)? Likely candidates: **NKJV, ESV, NASB, CSB, NLT**. This doesn't change the build, only what you'll select in Settings — but it's worth knowing you *can't* get NIV before you invest.
