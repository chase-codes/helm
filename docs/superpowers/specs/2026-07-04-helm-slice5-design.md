# Helm — Slice 5: Pre-service loop + Slides/media

**Date:** 2026-07-04
**Status:** Draft — awaiting user review
**Master spec:** `docs/superpowers/specs/2026-07-03-helm-design.md` (§7 "Decks & media", §4 schema, §11 build order line 5)
**Design source:** claude.ai/design project `055c865b` — `Lectern.dc.html` (pre-service block L343–452, card model L582–880; Slides track L324–337, media model L744–753). `SlideCanvas.dc.html`.

> **Decisions made on the user's behalf while they were away (all reversible at this review gate):**
> 1. **v1 boundary** = pre-service loop + still images + PPTX-as-images. **Native video deferred to Slice 5b.** (Matches the kickoff lean; decks ride cheaply on the image pipeline, video is the only piece needing new *dynamic-output* plumbing.)
> 2. **Pre-service loop runs as a main-process engine**, not a renderer timer — because the Pre-service tab unmounts on switch and the loop must keep rotating on the audience screen while the operator preps songs.
> 3. **Countdown is a target-timestamp under the hood** (drift-free), with the design's duration-style controls (+1 min / reset / pause). Absolute "service starts at 10:30" entry is noted as a deferred nicety.

---

## 1. Purpose

Fill the two remaining placeholders and complete the operator's content set:

- **Pre-service loop** — the rotating countdown/welcome/announcements/prayer/verse cards every service opens with. Today `App.tsx:137` renders `<Placeholder title="Pre-service" />`.
- **Slides / media track** — the third track in Sermon mode (`SermonMode.tsx:553` shows *"Coming in slice 5"*): still images, and PPTX decks imported as per-slide images.

These are **two independent features** sharing one new concept (a media/library folder) and one new slide kind (`image`). They can be built and shipped in either order.

## 2. Scope

**In (Slice 5):**
- Pre-service mode: card list, rotation engine, countdown, card editor, live output.
- `image` SlideKind rendered by SlideCanvas (full-bleed, `contain`).
- Slides track: media library list, single-image items, deck (multi-image) items, deck-slide rail — all porting the design chrome character-exact.
- Media import: pick image files → copy into the app-data `library/`; served to output/operator via a custom protocol.
- PPTX import → per-slide PNGs via LibreOffice (`soffice`) when present; graceful "LibreOffice not installed" instructions when absent.

**Deferred to Slice 5b (fast-follow):**
- Native video playback in the output windows (needs a `<video>` element in the output path, cross-window play/seek/volume sync, codec/packaging, and the livestream/alpha variant). The library import UI **will accept video files and store them**, but a video item shows a "Video plays in 5b" placeholder slide for now — so no schema churn later.

**Out (v1, per master spec §12):** live video input/NDI, editing deck content in-app.

---

## 3. Data model

Two new tables, wired into `src/main/db.ts` `SCHEMA` (CREATE TABLE IF NOT EXISTS), each with a focused repo + test following the `scheduleRepo` pattern (prepared statements, `DEFAULT_SERVICE_ID` where a service scope applies).

```sql
CREATE TABLE IF NOT EXISTS pre_cards (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- 'countdown' | 'message' | 'verse' | 'list' | 'logo' | 'image'
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,    -- type-specific fields (see §4.1)
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- 'image' | 'deck' | 'video'
  title TEXT NOT NULL,
  file_path TEXT,               -- relative path within library/ for single-file items (image, video)
  slides_json TEXT,             -- for decks: JSON array of relative image paths, one per slide
  created_at INTEGER NOT NULL
);
```

**Library folder.** A `library/` folder in the app-data dir (sibling of the profile DB), with subfolders `images/`, `decks/<deckId>/`, `video/`. The DB stores **relative** paths; the main process resolves them against the library root. This keeps a profile backup (DB + `library/` zip, per master spec §8 Backup) self-contained.

**Serving files to renderers.** Register a custom scheme `helm-media://` in main (`protocol.handle`) that maps `helm-media://<relpath>` → `library/<relpath>` (path-normalized, refuses `..` escapes). Renderers reference `helm-media://images/foo.jpg` — no `file://` and no `webSecurity` relaxation, so `contextIsolation` stays on.

### 3.1 Pre-service default seed

On first run, `preCardsRepo` seeds the design's starter loop (`Lectern.dc.html` L584–590) so a fresh install opens to a working pre-service: Countdown, Welcome, Psalm 122:1, Announcements, Prayer requests, Logo (disabled). Seeding is idempotent (skip if the table is non-empty), matching how `scheduleRepo` seeds its default service.

---

## 4. Pre-service loop

### 4.1 Card model (pure, shared)

`src/shared/preservice/cards.ts` — a `PreCard` union and a pure `preSlideFor(card, ctx)` porting `Lectern.dc.html` L873–880. **Every card composes to an existing SlideKind** — no new output plumbing for pre-service:

| Card type   | payload fields                    | → Slide                                                        |
|-------------|-----------------------------------|---------------------------------------------------------------|
| `countdown` | —                                 | `{ kind:'countdown', message:'Service begins in', countdownText }` |
| `message`   | `headline`, `subtitle`            | `{ kind:'title', title:headline, subtitle }`                  |
| `verse`     | `ref`, `text`                     | `{ kind:'scripture', ref, columns:[{version:'KJV', text}] }`   |
| `list`      | `heading`, `points[]`             | `{ kind:'title', title:heading, points }`                     |
| `logo`      | —                                 | `{ kind:'logo', title:'HELM' }`                                |
| `image`     | `mediaId` (→ media_items image)   | `{ kind:'image', src:'helm-media://…' }`                       |

`ctx` carries only the current `countdownText` (formatted from the engine's clock). Verse text is stored **inline** on the card (per the design) — no bible-table coupling at tick time. (Enhancement, deferred: let a verse card pull live from an installed bible.)

The `image` card type is a small **addition** beyond the design's five (it lets the pre-service loop show a still, e.g. a "welcome" graphic) — cheap once the `image` SlideKind exists. If the user prefers strict design parity, drop it; the other five are exact ports.

### 4.2 Engine (main process)

`src/main/preserviceEngine.ts` — owns *runtime* loop state (the persisted cards live in `pre_cards`; the engine holds only what the design keeps in ephemeral state):

```
{ engaged, loopOn, idx, dwellS, loopT, countdownTargetMs, paused }
```

- **Tick:** a single `setInterval(1s)` runs **only while engaged**. Each tick recomputes `countdownText = fmt(max(0, countdownTargetMs - Date.now()))`, advances rotation when `loopT ≥ dwellS` (`nextLoopIdx` skips disabled cards — port of L847), then composes the current card → Slide and pushes it as the live output.
- **Output path:** the engine drives the **existing** presentation broadcast. Going engaged = `goLive('pre:<cardId>', slide)`; each rotation/countdown update = a hot `cue` on the same `pre:` flow (so `sameFlow` keeps it live without a black flash — see `presentation/core.ts` L16). The engine calls into `stateStore` directly (it's in main).
- **Engage / yield (single source of truth):** while engaged the engine owns the live output. If the operator goes live with any **non-`pre:`** flow (a song, scripture, message), the engine observes `liveKey` moved away and **disengages** (stops its interval). Re-entering Pre-service and pressing **Start loop** re-engages. This prevents two owners fighting over the screen.
- **Controls** (IPC from operator): `showCard(idx)`, `step(±1)`, `toggleLoop`, `setDwell(±)`, `toggleEnabled(cardId)`, and countdown: `addMinute`, `reset`, `togglePause`. Ports of L843–852.
- **Countdown model:** `countdownTargetMs` is absolute epoch; `addMinute` bumps it +60 000, `reset` sets `now + defaultDurationS`, pause freezes remaining by storing `pausedRemainingMs`. Drift-free and matches the design's UX exactly.

Runtime state is ephemeral (like presentation state) — the app is safe to force-quit; on relaunch pre-service starts disengaged with a fresh countdown.

### 4.3 UI (renderer)

New `PreServiceMode.tsx`, replacing the placeholder at `App.tsx:137`. **Must become keep-alive** like Songs/Sermon? — No: because the engine lives in main, the component can unmount freely; on remount it reads current runtime state via `preservice.get()` and subscribes to `preservice.onState`. (This is *better* than the keep-alive workaround.) Character-exact port of `Lectern.dc.html` L343–397:

- **Left rail:** "PRE-SERVICE LOOP" header + count tag; card rows with label, "● ON SCREEN" badge, edit chip (✎), include/skip chip; "+ Add a card" button. Tap a row = `showCard`.
- **Center:** "PREVIEW — CURRENT CARD" + projection chip; 16/9 SlideCanvas preview; controls row (‹ / Start-Stop loop / ›, dwell −/+, and when the current card is countdown: +1 min / pause / reset).
- **Card editor modal** (L403–452): type tabs (verse / list / message — image added), name field, per-type fields; Remove / Cancel / Save. Persists via `preservice.saveCard` / `removeCard`.

Styling tokens (rail width, chip styles, hairlines, `preBtn*`) come straight from the design's computed style bindings — ported character-exact.

---

## 5. Slides / media track

### 5.1 `image` SlideKind

Add `'image'` to `SlideKind` and a `src?: string` field to `Slide` (`src/shared/types.ts`). SlideCanvas renders an image slide as a full-bleed `<img src>` with `object-fit:contain` on the slide background (letterboxed on the slide's dark bg), participating in the same `variant`/label/stage-chrome/livestream logic as other kinds. The livestream variant shows the lower-third bar over the image; the image itself is not keyed out in v1.

### 5.2 Track UI (SermonMode)

Replace the `Coming in slice 5` branch (`SermonMode.tsx:553`) with the Slides track, porting `Lectern.dc.html` L324–337 + media model L744–753:

- **Left rail:** "PRESENTATIONS & MEDIA" library list — each row a thumbnail (SlideCanvas of the item's first/only slide), icon (▤ deck / ▣ image / ▶ video), title, meta ("PowerPoint · N slides" / "Image" / "Video clip"). Selecting an item cues its first slide.
- **Deck-slide rail:** when the selected item is a deck, the numbered slide thumbnails (`deckSlideRows`, L330–336); click to cue a slide; ← / → step within the deck (a `pres:<itemId>:<idx>` flow, so `sameFlow` hot-updates the live output within a deck).
- **On-deck / hero:** reuse `SermonCenter` (the shared hero the Scripture/Message tracks already use) with the current slide + next-slide preview.
- **Import button** → §5.3.

### 5.3 Import

- **Images:** native file picker (`dialog.showOpenDialog`, image filters) → copy into `library/images/` → insert `media_items(type:'image')` → refresh list.
- **PPTX decks:** pick a `.pptx` → main runs `soffice --headless --convert-to png --outdir library/decks/<id>/ <file>` (LibreOffice). On success, the per-page PNGs become the deck's `slides_json`. **If `soffice` is not found** (probe `PATH` + common install locations), surface a calm modal: "Install LibreOffice to import PowerPoint decks, or export your slides as images and add them individually" — never a crash (master spec §9). Detection result cached in settings.
- **Video:** accepted by the picker and stored (`type:'video'`, `file_path`), but renders a placeholder slide (`{kind:'title', title:'▶ <name>', subtitle:'Video plays in Slice 5b'}`) until 5b.

PPTX conversion runs off the main thread's critical path (async spawn) with a progress/failure status; failures never block the console.

---

## 6. IPC & API surface

New `CH` channels (names only from `CH` in `src/shared/types.ts`), preload bindings, and `HelmApi` namespaces:

```
preservice: get, onState, showCard, step, toggleLoop, setDwell,
            toggleEnabled, addMinute, resetCountdown, togglePause,
            listCards, saveCard, removeCard, engage, disengage
media:      list, importImages, importDeck, importVideo, remove,
            onProgress            // deck-conversion progress
```

`preservice.onState` broadcasts the engine's runtime state (`engaged`, `idx`, `loopOn`, `dwellS`, `countdownText`, per-card enabled) to the operator so the rail/preview mirror the live output by construction — same pattern as `presentation.onState`. Types (`PreCard`, `PreState`, `MediaItem`) added to `src/shared/types.ts`; no `any` in `src/shared`.

---

## 7. Testing

- **Unit (vitest):** `preSlideFor` for every card type; `nextLoopIdx` (skips disabled, wraps, all-disabled no-op); countdown fmt + target math (addMinute / reset / pause-resume); PPTX-output path parsing; `helm-media://` path resolver (rejects `..` escapes).
- **Repo (in-memory SQLite):** `preCardsRepo` (seed idempotency, CRUD, position/enabled toggles); `mediaRepo` (image/deck/video rows, slides_json round-trip).
- **Engine:** `preserviceEngine` with a fake clock + a stubbed stateStore — engage drives goLive; rotation hot-cues same flow; going live with a non-`pre:` flow disengages.
- **Component (RTL):** SlideCanvas `image` kind renders `<img>` with the resolved src (extends `SlideCanvas.sanity.test.tsx`).
- **Manual:** LibreOffice present vs absent; multi-display image/deck output; loop keeps rotating after switching to Songs mode and back.

Before `npm test`: `npm rebuild better-sqlite3` (Node ABI). Before `npm run dev`: rebuild for Electron ABI (target 39.8.10) per project rules. End on the ABI matching whatever runs last.

---

## 8. Build order (sub-slices, each shippable)

1. **Library plumbing** — `library/` folder resolution, `helm-media://` protocol, `image` SlideKind + SlideCanvas render + test.
2. **Pre-service** — `pre_cards` table + repo + seed; `cards.ts` (`preSlideFor`, `nextLoopIdx`); `preserviceEngine` + IPC; `PreServiceMode.tsx` + card editor. *(First visible win — every service opens here.)*
3. **Slides track** — `media_items` table + repo; image import; Slides track UI in SermonMode; deck-slide flow.
4. **PPTX decks** — `soffice` convert + detection/fallback; deck import wired into the track.

Video (Slice 5b) is a separate spec.

## 9. Open questions for review

- **v1 boundary** — confirm pre-service + images + PPTX decks now, native video as 5b (decision #1 above).
- **`image` pre-service card** — keep the one addition beyond the design's five card types, or strict parity?
- **Countdown entry** — duration controls only (design-exact) for v1, or also allow setting an absolute start time?
