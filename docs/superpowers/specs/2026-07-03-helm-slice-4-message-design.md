# Helm — Slice 4: The Message Track (design)

**Date:** 2026-07-03
**Status:** Approved — ready for planning
**Extends:** `2026-07-03-helm-design.md` (§4 data model, §5 search, §7 ingestion, §11 build order item 4)
**Design source:** `docs/design/Lectern.pretty.html` (sermon-mode Message track) + `docs/design/SlideCanvas.dc.html`. Port styles character-exact.

## 1. Purpose & scope

Build the **Message track** for a Message congregation: William Branham sermon "tapes," each a paragraph-numbered text with original audio. It feeds the same cue → goLive → output pipeline as songs and scripture, using the `message` purple accent.

Slice 4 delivers, in **one slice, spike-first**:

- Acquisition of tape **text + audio + sync timing** from the authoritative source (VGR's *The Table*), with **full-text install** for offline search and **on-demand cached audio**.
- Local file import (PDF/TXT) as a **supplement/fallback**.
- First-class **search**: tape search, quote/paragraph search, and search-within-a-tape.
- **Two on-screen experiences** over the same paragraph store: deliberate **quote slides**, and an **automatic follow-along scrolling reading view** that tracks the playing audio.
- A **tape audio player** at the operator station.

## 2. The two experiences

Paragraphs are stored once and rendered two ways. Both draw from the same `paragraphs` rows; neither owns the data.

1. **Quote-snip → slide (deliberate).** The operator searches or picks a paragraph and puts it on screen as a **focused quote slide** with its reference (`Tape 65-1204 — ¶76`, source line). Quotes are **whole-paragraph granularity** this slice, matching the prototype (paragraph rail, arrow-key advance, CUED/LIVE badges, quote hero). Cuts/jumps are intentional here. This is the existing `sermonTrack='message'` cue → goLive path.
2. **Follow-along reading view (automatic).** When the **tape is playing**, the audience display renders the **full sermon as a continuous scrolling column** — the active paragraph highlighted, the view auto-scrolling to keep it centered, **advancing automatically with the audio**. No atomic slide cuts, because the congregation is reading along (paragraph-level highlight is sufficient; word-by-word is not required).

The operator chooses which experience is live: cueing a quote goes live as a `quote` slide; starting playback with the reading view live drives the `reading` render.

## 3. Acquisition (authoritative source only)

**Sourcing rule:** Message text/audio/timing come from Voice of God Recordings' **official** distribution (*The Table*, `table.branham.org` / The Table 4.0 apps) treated as canonical. Community mirrors (LWB, messagehub, en.branham.ru, etc.) are **not** used, even as fallback. Local file import covers gaps.

*The Table* provides 1,206 sermons with sentence-level **Read Along** (text highlighted as spoken) and **Tap & Play** — i.e. text **and** sync timing exist at the authoritative source. Our job is acquisition, not alignment invention.

### 3.1 Spike (plan task 1, blocking the sync path only)

Verify — at implementation, the getbible discipline — that a per-sermon payload of **text + sync map + audio** is fetchable from the authoritative source, and pin its exact format (JSON/SMIL/VTT shape, tape index, audio URL pattern, whether range requests work). All acquisition code sits behind a `MessageSource` adapter so the concrete endpoint is swappable without touching UI or storage.

- **If fetchable (expected/light path):** import text (+ labels) into storage, import the sync map into the `TimingMap`, fetch audio on demand. Automatic sync "for free," fully offline after install/cache.
- **If not fetchable (fallback, heavy):** compute timing locally per tape with **aeneas** forced alignment (DTW + eSpeak TTS, offline, outputs sync maps). Cross-platform (Mac + Windows) bundling of aeneas's Python/C + eSpeak stack is real work and **may spin a slice 4b**; the rest of slice 4 does not depend on it. The `TimingMap` abstraction makes this a provider swap.

The renderer, player, search, quote-snip, and storage do **not** depend on the spike outcome — only which `TimingMap` provider ships does.

### 3.2 Install model

- **Text → full install.** All acquired sermons' text + paragraph labels go into SQLite/FTS once. Search covers exactly what is installed; a partial corpus is fine by construction. Text is tens of MB total.
- **Audio → on-demand, cached.** `messages.audio_path` starts `NULL`. Opening/playing a tape (or an explicit "download") fetches that one file into the app-data `library/` folder and sets `audio_path`. Cached tapes play offline afterward. The operator can pre-fetch the tapes for a service.
- **Timing → imported with text** (light path) or **computed on audio download** (fallback).

### 3.3 Local import (supplement / fallback)

Import TXT and PDF the church already owns. Approach: **best-effort parse + operator review screen** (mirrors the songs quick-add preview).

- Extract **tape number** (`YY-MMDD`, optional trailing letter / M·E morning-evening designation), **title**, **date**, and **numbered paragraphs**.
- Paragraph tokens: line-leading numbers, including letter-prefixed labels (e.g. `E-1`). Store the label verbatim.
- PDF → text via a text extractor; TXT parsed directly. Both flow into the same review screen where the operator confirms/fixes the header and sees parsed paragraphs before saving.
- Import writes into the same tables, so search/player/renderer are agnostic to how a tape arrived. Imported tapes have no sync timing unless the fallback aligner is run on their audio.

## 4. Data model (refines `2026-07-03-helm-design.md` §4)

```
messages(id, tape_no, title, date, duration_s, audio_path NULL, audio_url NULL, source, installed_at)
paragraphs(message_id, ord, label, text)           -- ord = 0-based nav index; label = display string ("76","E-1")
paragraph_fts   FTS5(text)                          -- contentless, synced by triggers; retrieval by rowid → (message_id, ord)
paragraph_timings(message_id, ord, t_start, t_end)  -- seconds; present when a TimingMap exists for the tape
```

- `label` is a **string** (never an int) so citations stay byte-exact and letter-prefixed schemes survive. `ord` is the integer used for navigation, cue keys, and sorting.
- `duration_s` comes from the tape index at **text install** (metadata), so the player renders the total time and progress bar even before the audio is downloaded.
- `audio_path NULL` ⇒ not yet downloaded; drives the player's download-on-play behavior.
- Quote schedule reuses `service_items` with `kind='quote'`, `ref_json = { msgId, ord }` — same pattern as `scheduleRepo` (`kind='scripture'`). A `messagesScheduleRepo` (or an extension of the existing repo) lists/adds quote-schedule rows.

## 5. Search (reuse existing infrastructure)

Mirror the songs path exactly:

- **`messagesRepo`** mirrors `songsRepo`: FTS5 prefix candidates → fuzzy re-rank, with the same sparse-hit-→-full-scan guard.
- **`src/shared/search/messageScore.ts`** reuses `norm` / `lev` / `fuzzyTok` from `fuzzy.ts` and ports the prototype's `searchTapes` (title + tape#) and `searchQuotes` (paragraph text, tape-scoped or global), returning ranked tape rows and quote rows with snippets.
- **Tape scope** = filter the candidate set to a single `message_id` (the prototype's `msgScope`).
- **Tolerance alignment:** resolve the known len-5 divergence (`fuzzyTok` ≥6→2 vs `songScore` ≤4→1) explicitly here — align the message scorer to the `songScore` rule (`≤4 → 1`, else `2`) and note it in code. This is the flagged follow-up from slices 1–3.

Budget: keyboard-to-results well under 50 ms on a ~1,200-tape library; FTS makes this comfortable.

## 6. Reading view + sync engine

- **Broadcast state** gains a `reading` presentation: `{ mode:'reading', msgId, activeOrd }`. Output windows remain pure functions of broadcast state — the reading render is `(msg paragraphs, activeOrd) → scrolled/highlighted column` with CSS-eased auto-scroll to center `activeOrd`. No local output state; still respawnable.
- **`TimingMap`** = `{ ord, tStart, tEnd }[]` for a tape. A `MessageTiming` provider fills it (import from The Table, preferred; aeneas fallback). Storage: `paragraph_timings`.
- **Playback engine** (operator station): the tape audio is an HTML5 `<audio>` in the operator window; on `timeupdate` it looks up the current position in the tape's `TimingMap` → derives `activeOrd` → broadcasts it. Between anchors it holds the current paragraph (no interpolation needed at paragraph granularity). Audio plays through the system default device (the church routes it to the PA); output windows stay silent visual.
- **Coupling:** with the reading view live, playback drives `activeOrd` automatically. Tap & Play (start audio at a chosen paragraph's `tStart`) is available where timing exists.

## 7. Tape player

The prototype's tape card, ported: circular play/pause, title, `MM:SS / MM:SS` (position / duration), a **seekable** progress bar. Behaviors:

- Play a tape whose `audio_path` is `NULL` ⇒ trigger on-demand download first (progress surfaced), then play.
- Seeking updates audio position; with the reading view live, the highlight follows via the `TimingMap`.
- The prototype's mock `tapePos` counter is replaced by real `<audio>` `currentTime`.

## 8. UI (port character-exact)

From `Lectern.pretty.html` Message track: tape-scope search chip (`msgChipStyle`, clear-scope `✕`), `TAPES — SELECT TO SEARCH WITHIN` and `QUOTES` result groups, `QUOTE SCHEDULE` list, the `¶`-labelled paragraph rail with CUED/LIVE badges and planned-quote highlighting, the tape player card, the purple `message` accent (Warm/Cool/Earthen tones from `theme.ts`), and the quote hero (`quoteRef` / `quoteText` / `quoteSource`). Plus the **new reading-view renderer** (a new SlideCanvas-level output kind). Character-exact fidelity per house rule; reviewers check byte-level.

## 9. Pipeline & IPC integration

- New `quote` and `reading` output kinds flow through the existing broadcast/state store and `SlideCanvas` variant machinery. `keyFor` already yields `msg:<msgId>:<ord>` for message quotes; `sameFlow`/live-snapshot logic extends to quotes (same tape = same flow) and to reading (playback updates the live reading snapshot).
- **IPC:** all channels added to `CH` in `src/shared/types.ts` (house rule — no ad-hoc strings). Surface (names finalized in the plan): message search, list/get, install-corpus, import-file (with review payload), download-audio (with progress), timing fetch/compute, quote-schedule list/add. Renderer never touches the DB or network directly; `contextIsolation` stays on; no `any` in `src/shared`.

## 10. Testing

- **Unit (vitest, Node ABI):** paragraph/label parser incl. `E-` and `YY-MMDD` tape numbers; `messageScore` (tape, quote, scoped; typo cases); `TimingMap` → `activeOrd` mapping and boundary/hold behavior; quote-slide + `sameFlow`/live-snapshot logic.
- **Integration:** `messagesRepo` FTS + fuzzy against fixture tapes; on-demand-audio state transitions (`NULL` → downloading → cached); import parser against fixture PDF/TXT.
- **Adapter discipline:** `MessageSource` behind an interface with a fixture-backed test; the live endpoint verified in the spike, not asserted in unit tests.
- `npm test` runs on the Node ABI (revert from any Electron rebuild) so tests stay green.

## 11. Risks & open items

- **The Table acquisition/format** — the spike; blocks only the sync path's provider choice.
- **aeneas cross-platform bundling** — fallback only; may become slice 4b.
- **Audio size** — mitigated by on-demand cache; never a full pre-download.
- **Authoritative respect / ToS** — target official distribution only, no mirrors; behavior is offline devotional use.

## 12. Out of scope (this slice)

- Word-by-word highlight (paragraph/sentence granularity only).
- Sub-paragraph span selection for quotes (quotes are whole-paragraph this slice).
- Routing tape audio to output windows or selecting a specific output device (deferred to the display-hardening slice).
- Bulk pre-download of all audio.
- Editing sermon text in-app.
- Any non-authoritative source.
