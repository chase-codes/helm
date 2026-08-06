# Helm — Sermon panel resizing + pulpit view modes

**Date:** 2026-08-05
**Delivers:** the resizable-rails treatment for the Sermon page, and the deferred
Settings → Displays surface (slice 6b's core) grown into a per-screen **view mode**
system that replaces OS-level screen mirroring on the pulpit monitor.

---

## Why

Two operator-reported needs from live use:

1. **Sermon rails are fixed-width.** The Songs pane's rails drag-resize (with the widths
   persisted), but the Sermon page's three tracks — Scripture, Message, Slides — are locked
   at 270px left / 330px right. The same ergonomic need exists there.

2. **The pulpit monitor is OS-mirrored from the operator's screen.** The mirror shows
   everything: search panels, the mouse, the whole console shrunk onto a small pulpit
   screen. The pastor *wants* that when he leads songs — he likes watching the search.
   The song leader finds it distracting and hard to read, and wants only the current song.
   Switching between those today means OS display settings mid-service. Helm doesn't manage
   that screen at all; its output windows know only roles (`audience`/`stage`/`livestream`)
   and every output shows the identical slide.

## What we're building

1. Shared drag-divider machinery, applied to the Sermon page: **one persisted width pair
   for the whole page**, shared across its three tracks. Songs keeps its own existing pair.

2. A per-display **view mode** — `slides` (today's behavior), `leader` (distraction-free
   song view), `mirror` (live video mirror of the operator's screen) — persisted per display
   fingerprint, switchable instantly from a header popover and managed in a new
   Settings → Displays pane. The pulpit monitor becomes a Helm output; OS mirroring is
   retired.

Runs on macOS and Windows; platform differences are confined to the mirror view (§6).

---

## Design

### 1. Panel resizing — extract, then reuse

`SongsMode.tsx:287-326` owns the only drag-divider implementation: window-level
mousemove/mouseup, min/max clamp, `col-resize` cursor, `localStorage` persistence
(`helmSongListW`, `helmSectionPanelW`). Extract it:

- `usePanelWidth(storageKey, { def, min, max })` — returns `[width, startDrag]`;
  loads/clamps from `localStorage`, persists on release.
- `PanelDivider` — the divider element with hover affordance and tooltip.

Both live in `src/renderer/operator/`. `SongsMode` is refactored onto them — same keys,
same behavior, pure refactor.

The Sermon page stores **one pair for all tracks**: `helmSermonLeftW`, `helmSermonRightW`.
State lives in `SermonMode` and flows down, so switching tracks keeps the widths live:

| Track | Left rail (shared width) | Right rail (shared width) |
| --- | --- | --- |
| Scripture | `SchedulePanel` | `ChapterRail` |
| Message | search rail (`RAIL_W`) | `ParagraphRail` (`RIGHT_PANEL_W`) |
| Slides | media rail | deck/coming panel |

All three tracks already share defaults (270/330), so one pair fits naturally. Bounds
start at 200–420 left, 240–520 right, tuned at implementation against the narrowest
sensible operator window. `MessageMode` and `SlidesTrack` take `leftW`/`rightW` (+ drag
handlers) as props instead of their module constants.

### 2. View mode — the model

```ts
// src/shared/types.ts
export type OutputViewMode = 'slides' | 'leader' | 'mirror';
```

- **Persistence:** settings key `displays:views` → `Record<fingerprint, OutputViewMode>`,
  exactly parallel to `displays:roles`. Missing entry ⇒ `'slides'` — existing setups are
  untouched until a screen is opted in.
- **Live state:** `stateStore` keeps a view per registered output window alongside its
  variant. `setOutputView(win, view)` re-tags and re-broadcasts — the `setOutputVariant`
  pattern (`stateStore.ts:26-30`): no window respawn, instant switch.
- **Wiring:** `displays.ts` gains `setDisplayView(fingerprint, view)` — persist, re-tag
  matching windows, refresh `lastDisplays`, `broadcastStatus()` — mirroring
  `setDisplayRole` (`displays.ts:126-141`). New IPC `displays:setView` →
  `window.helm.displays.setView(fp, view)`.
- **Surface types:** `DisplayInfo` gains `view: OutputViewMode | null` (null for the
  operator display); `OutputPayload` gains `view` so the output renderer knows what to
  render. `sync()` reads saved views when creating/reconciling windows.

`OutputApp` branches on `payload.view`:

- `'slides'` → today's render, byte-for-byte (`SlideCanvas`/`ReadingCanvas`/`VideoCanvas`).
- `'leader'` → `LeaderView` (§3).
- `'mirror'` → `MirrorView` (§4).

The slide payload keeps flowing in every mode, so switching back is seamless and
`LeaderView` can fall back to it.

### 3. `LeaderView` — the distraction-free song view

New component in `src/renderer/output/`. Output windows load the full preload, so it has
the whole `HelmApi`. It subscribes to `presentation.onState` (already broadcast to all
windows) and branches on `liveKey`:

**A song is live** (`liveKey` = `song:<id>:<section>`): fetch the song via `songs:get`
(cached by id; re-fetch only when the id changes) and render:

- **Hero (main area):** the live section's lines, sized with `useFitText` and a dedicated
  band — container-relative like the projector, so it fills a 1024×600 pulpit screen as
  correctly as anything else. Song title + section label above, small.
- **Right rail:** every section — label plus first-line snippet — live section highlighted.
  This is what the leader scans to call the next verse. Fixed width tuned for the pulpit
  screen; no interaction (nobody has a mouse there; the OS cursor is already hidden).
- **No search, no library, no cursor.**

**Projector on logo/black while a song is live:** keep showing the song — that's the point
of a confidence view — plus a small chip ("LOGO" / "BLACK") so the leader knows the
congregation isn't seeing lyrics.

**Anything else live** (scripture, quote, reading, video, pre-service): render exactly the
`'slides'` branch. Same code path — video behavior, autofit, everything stays identical.
`songs:get` returning null (deleted song) also falls back to `'slides'`.

### 4. `MirrorView` — the operator's screen, streamed

A `<video>` element fed by a live capture of the **operator's screen** — the whole display,
not just the Helm window — pixel-for-pixel what OS mirroring shows today: search, modals,
cursor. Letterboxed with `object-fit: contain` on black.

Mechanics: the renderer calls `navigator.mediaDevices.getDisplayMedia`; the main process
installs `session.setDisplayMediaRequestHandler`, using `desktopCapturer` to pick the
screen source matching `operatorDisplayId()` (`displays.ts:56-60`) — no picker dialog, no
user gesture. Screen sources include the cursor on both platforms.

Lifecycle: acquire on mount; stop all tracks on unmount or view switch; on unexpected
track end, retry with a short backoff. If acquisition fails, show an in-place message —
never a silent black screen (§6 for the platform-specific message).

### 5. UI surfaces

**Header popover (mid-service switching).** The `N OUTPUTS · LIVE` chip
(`Header.tsx:136-138`) becomes a button. Its popover lists each output display — label or
`{width}×{height}` when unlabeled, role — with a three-way segmented control
**Slides / Leader / Mirror**. Selection applies immediately (`displays.setView`) and the
popover closes on selection or Escape. Data comes from `useDisplayStatus`, which already
carries everything needed once `DisplayInfo.view` exists.

**Settings → Displays pane.** Flip the stubbed section on (`SettingsModal.tsx:18`,
`enabled: false` since slice 6a deferred it). Contents: every detected display — label,
resolution + scale (`1920×1080 @2x`), operator marker — with a **role** picker
(audience / stage / livestream; `displays.setRole` has existed unused since 6a) and the
same **view** picker for non-operator displays. The 6b "identify" flash and output test
card stay out of scope.

### 6. Platform notes (macOS + Windows)

The mirror view is the only platform-sensitive piece:

- **macOS:** screen capture requires the Screen Recording permission. First capture
  triggers the system prompt; until granted, `getDisplayMedia` rejects. The in-place
  failure message names the fix ("System Settings → Privacy & Security → Screen
  Recording").
- **Windows:** no permission prompt; capture works out of the box. **Implementation
  checkpoint:** verify on real Windows hardware that Electron's capture path doesn't draw
  the OS's yellow "screen is being shared" border (newer Electron can route through
  Windows Graphics Capture, which does on some builds; known switches avoid it). The
  failure message is generic there.

Everything else — window management, always-on-top outputs, `localStorage`, autofit —
already runs on both platforms unchanged.

### 7. Never blank the projector

Per BUG-009 there is no error boundary anywhere; new code in the output render path must
not be able to take a screen down. The view branch in `OutputApp` is wrapped in an error
boundary whose fallback is the plain `'slides'` render: a bug in `LeaderView` or
`MirrorView` degrades the pulpit to today's behavior, never to a blank window. The
boundary resets when the payload's view changes, so switching away and back retries.

### Out of scope

- Named multi-screen presets ("Song service" / "Preaching"). The per-screen picker covers
  the one screen that varies; presets can layer on top of `displays:views` later without
  rework.
- The 6b "identify" flash tool, output test card, and crash supervision.
- Cued/next-section display in `LeaderView` — `PresentationState` carries no cued key;
  the leader highlights the *live* section only. Growing shared state for cue is a
  separate decision.
- Per-view content divergence beyond these three modes (e.g. preacher notes).

## Testing

**Unit (pure):** `usePanelWidth` clamp/persist logic (extracted so the rule is testable);
view resolution in the payload builder (missing entry → `'slides'`; operator display →
null); `displays:views` round-trip through the settings repo fake.

**Component (jsdom, mocked `window.helm`):**
- `OutputApp` renders the right branch per `payload.view`, and the error boundary falls
  back to the slides render when a view throws.
- `LeaderView`: sections render with the live one highlighted; logo/black chip; null song
  and non-song keys fall back to slides.
- `MirrorView`: rejection path renders the failure message (getDisplayMedia stubbed).
- `SongsMode` regression after the divider refactor: widths load, clamp, persist under the
  existing keys.

**Real app:** `scratch/verify-views.mjs` (playwright `_electron` driver, same pattern as
`verify-autofit.mjs`): open the test output, cycle `slides → leader → mirror` via
`displays.setView`, screenshot each; put a song live and confirm the leader hero + rail;
confirm slides mode is unchanged. Mirror capture on the driver depends on local screen
recording permission — the script tolerates the failure message as a pass on unprivileged
machines, with a note to eyeball it manually once.

## Risks

- **Capture performance.** A continuous screen capture stream costs GPU/CPU on the
  operator machine. One 30fps stream at pulpit resolution is well within what Electron
  handles for screen sharing, but it's the first continuously-running media pipeline in
  Helm — worth watching in rehearsal. If it matters, cap the stream's frame rate/size via
  `getDisplayMedia` constraints.
- **Fingerprint collisions** (pre-existing): two identical unlabeled monitors share a
  fingerprint, hence a view. Acceptable for projector-plus-pulpit rooms; documented
  limitation of the roles system since 6a.
- **`OutputPayload` growth.** Adding `view` touches every payload send; the shape change
  is mechanical but must be synchronized across `stateStore`, preload types, and both
  renderers in one change.
