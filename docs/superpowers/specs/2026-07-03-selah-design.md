# Selah — Church Presentation App (EasyWorship replacement)

**Date:** 2026-07-03
**Status:** Draft — awaiting user review
**Design source:** claude.ai/design project `055c865b-b0d9-4bce-b212-2a2902af7dfd` (`Lectern.dc.html` + `SlideCanvas.dc.html`). The prototype's operator flows are the UI spec; this document covers everything the prototype stubs out (storage, ingestion, multi-display, settings).

## 1. Purpose

A Mac + Windows desktop app for running a church service: pre-service loop, congregational songs, scripture, Message (tape) quotes, and slide decks — with all content stored locally, first-class mid-service search, and rock-solid output to multiple physical displays over HDMI.

Working name: **Selah** (the pause marker in the Psalms). Pending user confirmation; the name appears only in package metadata, the logo slide, and the repo name, so renaming later is cheap. Alternatives considered: Herald, Doxa, Evenlight.

## 2. Success criteria

- Operator can find and project *anything* (song by half-remembered lyric with typos, verse by reference, quote by phrase) in under ~5 seconds mid-service.
- Plugging in / power-cycling an HDMI display mid-service auto-reattaches the output full-screen at native resolution with correctly scaled text — no manual fiddling.
- Works fully offline once content is installed. Network is only needed to download bibles, songs, and Message content.
- The operator flows match the approved prototype (three modes, cue/live semantics, keyboard control).

## 3. Architecture

**Stack:** Electron + TypeScript + React + Vite. SQLite via `better-sqlite3` with FTS5 for search. `electron-builder` for Mac (dmg/zip) and Windows (nsis) packaging.

Rationale: Electron's `screen` API gives mature multi-monitor management (display-added/removed/metrics-changed events), which is the highest-risk requirement. Tauri was considered and rejected for weaker display APIs.

### Process layout

- **Main process** — owns the SQLite database, display manager, content downloaders/importers, and the single source of truth for *presentation state* (what is live, what is cued). All mutations flow through typed IPC channels.
- **Operator window** (renderer) — the console from the prototype: header, three modes, modals, settings card.
- **Output windows** (renderer, one per attached display role) — frameless, fullscreen-on-target-display windows that render the live slide via the SlideCanvas component. They are pure functions of broadcast state: `(slide, variant, clock, next) → pixels`. No local state, so they can be destroyed/recreated freely when displays come and go.

### Presentation state model (from the prototype, kept exactly)

- `output ∈ live | logo | black`, `liveKey`, `liveSnap` (snapshot of content taken at go-live).
- Cueing navigates freely without touching the screen; **Go live** snapshots the cued content; `applyCue` hot-updates the live snapshot only when the new cue is in the *same flow* (same song / same chapter / same deck) — matching the prototype's `sameFlow` logic.
- Keyboard: arrows advance within the active flow, Enter/Space toggles go-live, Escape closes modals. Global "✕ TAKE DOWN" always available in the header.
- Main process holds this state; operator and output windows both subscribe. Operator's "live preview" and physical outputs render from the identical broadcast payload — mirroring is guaranteed by construction.

## 4. Data model (SQLite, one file per profile in the app-data dir)

```
songs(id, title, author, sections_json, source, created_at)
song_fts        FTS5(title, author, lyrics)          -- contentless, synced by triggers

bible_versions(id, abbr, name, language, installed_at)
verses(version_id, book, chapter, verse, text)
verse_fts       FTS5(text) + (version_id, book, chapter, verse)

messages(id, tape_no, title, date, duration_s, audio_path, source)
paragraphs(message_id, n, text)
paragraph_fts   FTS5(text) + (message_id, n)

media_items(id, type deck|video|image, title, file_path, slides_json)
services(id, title, date)                            -- a service plan
service_items(service_id, kind, ref_json, position)  -- scripture readings, quote schedule, media order
pre_cards(id, type, payload_json, enabled, position) -- pre-service loop
settings(key, value_json)
```

Media files (tape audio, videos, images, imported decks) live in an app-data `library/` folder; the DB stores paths. Everything needed on Sunday is local.

## 5. Search (the first-class requirement)

Two layers, matching the prototype's behavior:

1. **FTS5 prefix search** for instant candidate retrieval across songs / verses / paragraphs (`unicode61 remove_diacritics`, prefix indexes for as-you-type speed).
2. **Fuzzy re-rank** on the candidate set, porting the prototype's scorer: normalized tokens, Levenshtein tolerance scaled by token length (≤4 chars → 1 edit, else 2), exact-title boost, matched-line snippet extraction. This is what makes "amazin grace" and "only beleive" work.

Field-scoped search (All / Title / Lyric) and tape-scoped Message search ("search within this tape") come straight from the prototype. Scripture reference parsing (`gen 1:1-10`, book-name autocomplete on space) is ported as a pure function with unit tests.

Budget: keyboard-to-results under 50 ms on a ~2,000-song / 1,200-tape library. FTS5 makes this comfortable.

## 6. Multi-display engine

- **Roles, not monitors:** outputs are configured as roles — `audience` (default), `stage` (clock + NEXT chrome), `livestream` (lower-third on keyable backplate) — using the SlideCanvas variants already designed. The operator assigns roles to physical displays in Settings; assignments persist by display fingerprint (vendor/model/serial from Electron's display object, falling back to size+position).
- **Auto-attach:** on `display-added`, look up the fingerprint → if it has a saved role, spawn the output window fullscreen on it immediately; if unknown and exactly one non-operator display exists, default it to `audience` (covers the common "plug in the projector and it just works" case). On `display-removed`, tear down cleanly and surface a status chip in the operator header (`2 OUTPUTS · LIVE`). On `display-metrics-changed` (resolution/scale change), re-bounds the window.
- **Resolution & scaling:** SlideCanvas already sizes everything in container-query units (`cqmin`) with clamps — text scales correctly at 720p, 1080p, 4K, and any DPI without per-display configuration. Output windows set `bounds = display.bounds` (not maximize) to avoid macOS spaces/fullscreen quirks, hide the cursor, and prevent display sleep.
- **Sanity check tool:** Settings → Displays shows each detected display with its role, resolution, and a "identify" button that flashes a numbered card on that screen.

## 7. Content ingestion

### Bibles (Settings → Bibles)
Curated manifest of public-domain translations (KJV, WEB, ASV, Darby — the four in the prototype's picker, extensible). "Install" downloads the translation as JSON from a pinned static source (getbible/open-bibles mirrors; exact endpoint verified at implementation time behind a `BibleSource` adapter), writes it into `verses`, builds FTS. Installed versions appear in the sermon-mode translation picker; two can be shown side-by-side, exactly as designed. Uninstall = delete rows.

### Songs (quick-add modal, as designed)
- **Paste path (primary):** paste lyrics → split on blank lines → auto-label sections (`Verse n`, `Chorus`, `Bridge`… recognized from the first line) → preview slides → save. Port of the prototype's `splitToSlides`.
- **Online search:** `SongSource` adapter interface; first implementation targets Hymnary.org public-domain texts (the prototype's mock source). Results show title/author/source, full-lyric preview before import, then flow into the same review/split screen. If Hymnary's endpoints prove unusable programmatically, the adapter swaps without UI changes.

### The Message (Settings → Message library)
- **Local import (primary):** import text files (PDF/TXT) and audio (MP3) the church already has. Parser extracts tape number, title, date, and numbered paragraphs (the `¶ 76` structure the prototype displays); imported audio is linked for the tape player.
- **VGR downloads:** built-in fetcher for the freely distributed message text/audio from branham.org, behind a `MessageSource` adapter (same caveat as Hymnary — endpoint details verified at implementation).

### Decks & media
Import PPTX (converted to images per slide via LibreOffice if present, else rendered import instructions), plus images and videos. Stored in the library folder; thumbnails as designed.

## 8. Settings pop-up card

A modal card over the operator console (matching the prototype's modal styling) with sections:

- **General** — theme (dark/light, tone presets from the design: Warm/Cool/Earthen), type scale, density, service title.
- **Displays** — detected displays, role assignment, identify, output test card.
- **Bibles** — installed list + install/uninstall from manifest.
- **Songs** — library stats, import/export (JSON backup), online source config.
- **Message** — library stats, import files, VGR downloader.
- **Backup** — one-click export/import of the whole profile (DB + library folder zip).

## 9. Error handling & resilience

- Downloads are resumable/retryable with clear per-item status; failures never block the operator console.
- The output windows are supervised: if one crashes it is respawned within a second showing the last broadcast state (state lives in main).
- DB writes are transactional; the app is safe to force-quit mid-service.
- Missing content degrades visibly but calmly: a verse with no installed translation shows "[ Install a Bible in Settings ]" rather than crashing (prototype already models this).

## 10. Testing

- **Unit (vitest):** reference parser, book-name matching, lyric splitter, fuzzy scorer (typo cases from the design: "amazin grace", "only beleive"), sameFlow/live-snapshot logic, display fingerprinting.
- **Integration:** DB layer with an in-memory SQLite; ingestion parsers against fixture files.
- **E2E (Playwright + Electron):** operator flows — search→cue→go-live, mode switches, quick-add, settings.
- **Manual checklist:** multi-display matrix (plug/unplug during live, resolution change, sleep/wake, projector power-cycle) — documented in `docs/display-checklist.md`.

## 11. Build order (each slice is shippable)

1. **Scaffold + operator shell** — Electron/React/Vite/TS, header, three empty modes, theme system from the design tokens.
2. **Songs vertical slice** — DB, song library, search, sections rail, cue/live state machine, single output window on a second display. *(First usable Sunday build.)*
3. **Scripture** — bible storage, one bundled translation (KJV), reference parsing, chapter rail, translation compare, Settings→Bibles installer.
4. **Message track** — import + storage + paragraph search + tape player; VGR fetcher.
5. **Pre-service + slides/media** — loop engine, card editor, media import, deck slides.
6. **Display hardening + settings card** — roles, fingerprints, auto-attach matrix, stage/livestream variants, identify tool.
7. **Packaging & branding** — icons, logo slide, installers for Mac + Windows, backup/export.

## 12. Out of scope (v1)

- CCLI/SongSelect integration (no public API; needs church license decision).
- Remote/tablet control, cloud sync, multi-operator.
- Live video input/NDI, alpha-key hardware output (livestream variant renders a keyable backplate only).
- Editing bible text or message text in-app.
