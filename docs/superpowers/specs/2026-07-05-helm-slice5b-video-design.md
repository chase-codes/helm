# Helm — Slice 5b: Native video output

**Date:** 2026-07-05
**Status:** Draft — awaiting user review
**Master spec:** `docs/superpowers/specs/2026-07-03-helm-design.md` (§7 "Decks & media", §12 out-of-scope: live video input/NDI)
**Parent spec:** `docs/superpowers/specs/2026-07-04-helm-slice5-design.md` (§2 "Deferred to Slice 5b" — the boundary this slice fills)

> **Scope-locking decisions confirmed with the user at kickoff:**
> 1. **Go-live start:** a video sent live lands **paused on frame 0** — no autoplay, no surprise audio the instant you go live.
> 2. **End of clip:** **hold the last frame** (paused), operator decides the next move. No loop, no auto-black in v1.
> 3. **Preview before live:** **yes** — the operator can play/scrub the *cued* video (previewed muted on the operator hero); the audience mirrors current position/state only once the video is live. One active video at a time — juggling two live clips is out for v1.

---

## 1. Purpose

Fill the one remaining Slice 5 placeholder: **native video playback in the output windows.** Today video files already import and store (`library/video/<uuid>.ext`, `media_items(type:'video')`, served by the `helm-media://` protocol) and appear in the Slides track with a ▶ icon — but `slidesOf` returns `buildVideoPlaceholderSlide()` ("Video plays in Slice 5b") instead of a real slide.

This slice ships:
- A real `video` `SlideKind` rendered as a `<video>` in the output window and the operator preview.
- Cross-window **play / pause / seek / volume** sync driven from main via IPC (the operator drives; output windows mirror), consistent with the existing presentation-state broadcast pattern.
- Retirement of `buildVideoPlaceholderSlide`.
- Video files served via the existing `helm-media://` protocol (already in place; range support verified/added as needed).

**Out (per master spec §12, unchanged):** live video input / NDI, the livestream/alpha-key video variant, in-app clip editing.

---

## 2. Architecture at a glance

The app already owns presentation state in main and broadcasts a single `Slide` to output windows (`stateStore.ts` + `shared/presentation/core.ts`), with a `sameFlow` cue/live model. The pre-service engine is the precedent for "main owns ephemeral runtime state, drift-free via a wall-clock anchor, broadcasts to all windows."

Video output reuses both patterns:

- **A separate, small main-owned `videoState`** (companion to `presentation`, not part of it) holds playback state and broadcasts it to every window. It does **not** decode video — it tracks playback as arithmetic over a wall-clock anchor, exactly like the countdown target-timestamp.
- **Output windows and the operator hero render a `<video>` and reconcile it to the broadcast** — followers, never masters. Between broadcasts they native-play; they only correct on user actions or drift.
- **The `Slide` still carries the `src`** (via `slidesOf`), so which video is on screen rides the existing presentation broadcast; only the *playback* state (playing/position/volume) needs the new side-channel.

```
operator transport ──IPC──▶ main videoState (anchor arithmetic) ──broadcast──▶ all windows
                                                                                   │
   presentation.goLive(key, videoSlide) ──▶ output window shows the video ◀────────┘
```

---

## 3. Slide model & rendering

### 3.1 `video` SlideKind

Add `'video'` to the `SlideKind` union (`src/shared/types.ts`). The existing `Slide.src?: string` field (added in Slice 5 for images) carries the `helm-media://` URL — no new `Slide` field. `slidesOf` (`src/shared/media/slides.ts`) returns, for a video item:

```ts
{ kind: 'video', src: mediaSrc(item.filePath) }
```

`buildVideoPlaceholderSlide` is **deleted** and all usage removed. (Grep confirms usage is confined to `slidesOf`; the only tests referencing the placeholder text are updated to assert the `video` kind + `src`.)

### 3.2 `SlideCanvas` — static poster branch

`SlideCanvas` is shared across many contexts (rail thumbnails, deck rail, on-deck preview, and the real output). It must **never** spin up a playing decoder. Its `video` branch renders a **static poster**:

```tsx
{isVideo && (
  <video
    src={s.src || ''}
    muted
    preload="metadata"
    style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'contain', zIndex:1 }}
  />
)}
```

`preload="metadata"` shows the first frame without continuous decode — cheap even with many video items in the rail. This branch sits alongside the existing `image` branch; no other kinds are touched. In the livestream variant the video (like the image) is not keyed out — it renders as the back plate with the lower-third bar over it, consistent with §5.1 of the parent spec. (Livestream is not a target surface for 5b but the branch must not crash under it.)

### 3.3 `VideoCanvas` — the live synced player

New `src/renderer/shared/VideoCanvas.tsx`. Renders the `<video>` and owns all sync. Used in **exactly two** places: the output window and the operator hero. Props:

```ts
interface VideoCanvasProps {
  slide: Slide;                 // must be kind:'video' with a src
  forceMuted?: boolean;         // operator hero passes true (monitors visually)
  onTime?: (ms: number) => void;      // timeupdate → operator time display
  onDuration?: (ms: number) => void;  // loadedmetadata → operator reports to main
  onEnded?: () => void;               // operator sends pause() → hold last frame
  fill?: boolean;
}
```

On mount it fetches `window.helm.video.get()` for the initial state, then subscribes to `onState`. Reconcile on every state (see §5).

---

## 4. Main video state

### 4.1 Pure reducer — `src/shared/video/state.ts`

Mirrors `shared/presentation/core.ts`: pure, `now` injected, fully unit-testable without fake timers.

```ts
export interface VideoStateInternal {
  key: string | null;      // e.g. 'pres:<itemId>:0' — the active video flow
  src: string | null;      // helm-media:// URL
  playing: boolean;
  anchorMs: number;        // playback position at anchorAt
  anchorAt: number;        // Date.now() when the anchor was set
  durationMs: number;      // reported by the operator's element; 0 until known
  volume: number;          // 0..1
  muted: boolean;
}
export interface VideoStateWire {          // what renderers see
  key: string | null; src: string | null;
  playing: boolean; positionMs: number; durationMs: number;
  volume: number; muted: boolean;
}

export function initialVideo(): VideoStateInternal;
export function effectiveMs(st, now): number;   // playing ? clamp(anchorMs + (now-anchorAt), 0, dur) : anchorMs
export function loadVideo(st, key, src, now): VideoStateInternal;   // idempotent on same key
export function playVideo(st, now): VideoStateInternal;             // re-anchor, playing=true (restart if at end)
export function pauseVideo(st, now): VideoStateInternal;            // re-anchor at effectiveMs, playing=false
export function seekVideo(st, ms, now): VideoStateInternal;         // anchorMs=clamp(ms), keep playing state
export function setVolume(st, v): VideoStateInternal;
export function setMuted(st, m): VideoStateInternal;
export function setDuration(st, ms): VideoStateInternal;            // clamp anchorMs to new duration
export function toWire(st, now): VideoStateWire;                    // positionMs = effectiveMs(st, now)
```

Key semantics:
- **`loadVideo` is idempotent on the same key** — re-selecting the active video keeps its scrub position and playing state; a *different* key resets to `{ playing:false, anchorMs:0, durationMs:0 }` (volume/muted preserved).
- **`effectiveMs` clamps to `durationMs`** (when known) so a playing anchor never overshoots the end — this is what a late-joining window would seek to.
- **`playVideo` restarts from 0 if invoked at/after the end** (natural "play again" after hold-last-frame).

### 4.2 Stateful wrapper — `src/main/videoState.ts`

Module-singleton `video`, mirroring `stateStore.ts`'s `presentation`:

```ts
export const video = {
  get(): VideoStateWire,                 // toWire(state, Date.now())
  load(key, src): void, play(): void, pause(): void,
  seek(ms): void, setVolume(v): void, setMuted(m): void, reportDuration(ms): void,
};
```

Each mutator applies the pure reducer with `Date.now()`, then **broadcasts the wire state** to every window (`BrowserWindow.getAllWindows()` — operator + outputs), the same broadcast shape used by `preserviceState` / `biblesProgress`. No continuous timer: broadcasts happen only on operator actions, and each `VideoCanvas` fetches `get()` on mount (covers late-joining output windows without touching `registerOutput`).

`reportDuration` is how main learns the true duration (it can't decode): the operator hero's `loadedmetadata` reports it, main clamps + rebroadcasts so late-joiners and the operator's total-time display are correct.

---

## 5. Cross-window sync

### 5.1 Follower reconcile (in `VideoCanvas`)

On each received `VideoStateWire` (and once on mount):

1. **Key gate:** if `state.key !== keyForThisSlide` → **do nothing** (free-run). This is what keeps a live clip playing untouched if the operator cues a second video (single-active-video safety; juggling out of scope).
2. If `state.src` differs from the element's current src → set src (loads).
3. `video.muted = forceMuted || state.muted`; `video.volume = forceMuted ? 0 : state.volume`.
4. `target = state.positionMs`. IPC latency (~ms) is ignored — after seek+play, native playback continues from there.
   - If **paused**: set `currentTime = target/1000` exactly.
   - If **playing**: seek only when `|currentTime*1000 - target| > 250ms` (avoid stutter).
5. Match transport: `state.playing && video.paused → video.play().catch(noop)`; `!state.playing && !video.paused → video.pause()`.

No cross-process clock sync: the wire carries `positionMs` computed by main at broadcast time, and native rate-1.0 playback keeps windows aligned to their own start between broadcasts. Long-run drift between monitor and audience is re-corrected on the next operator action; a periodic reconcile is a deferred nicety, not v1.

### 5.2 Audio & autoplay

- **Operator hero:** `forceMuted` — the operator monitors visually; the audience system carries audio. Prevents double audio in the room.
- **Audience output:** obeys `state.volume` / `state.muted`; default `volume:1, muted:false`, so the room hears the clip when live.
- `autoplayPolicy: 'no-user-gesture-required'` is set in both window factories (`createWindow` in `main/index.ts`, `createOutputWindow` in `main/displays.ts`) so programmatic `play()` of **unmuted** audience audio isn't blocked by Chromium's autoplay policy.

### 5.3 End of clip

The operator hero's `<video>` fires `ended` → `onEnded` → `window.helm.video.pause()`. `pauseVideo` clamps the anchor to `durationMs`, broadcast holds the last frame on every window. (The elements are already paused at the last frame natively; the state just reflects it so a late-joiner and the operator UI show paused-at-end.)

### 5.4 Output mode vs the video clock (accepted behavior)

Setting output to `black`/`logo` sends a `black`/`logo` slide, so the audience `VideoCanvas` unmounts and its audio stops — but main's `videoState` is **not** paused: if `playing`, the anchor keeps advancing by wall-clock. On return to `live`, the freshly-mounted audience video seeks to the now-advanced position, i.e. the clip plays on as if it had never been hidden. This is **intended**: the operator hero keeps playing during black too, so operator and audience stay at the *same* position — the video behaves as a continuous timeline that a cut-to-black merely hides, never a pause. (Pausing the clock on black would instead desync the still-playing operator hero from a frozen audience, and couple `videoState` to presentation output mode.) An operator who wants the clip to hold uses the transport **Pause**, which is the actual pause control.

---

## 6. Operator UI (`SlidesTrack.tsx`)

- **On selecting a video item:** an effect calls `window.helm.video.load(keyForMedia(id,0), src)`. Selecting a non-video item does nothing to video-state (a lingering active video is harmless). Re-selecting the active video is idempotent (keeps position).
- **Hero:** for a video item the hero renders `VideoCanvas` (force-muted, wired to `onTime`/`onDuration`/`onEnded`) instead of the static `SlideCanvas`. This is delivered via a new **optional `heroMedia?: JSX.Element` prop** on `SermonCenter` — when provided (slide variant only), it replaces the `SlideCanvas` in the hero card. Purely additive; verse/quote variants and existing callers are untouched.
- **Transport row** (shown only for video items, below the on-deck panel or in place of it): play/pause toggle · scrubber (`<input type=range>`, `onInput` for a smooth thumb, `onChange` → `video.seek`) · elapsed / total (`mm:ss`) · volume slider + mute toggle. All drive `window.helm.video.*`.
- **Go Live** flips presentation visibility (`presentation.goLive(key, slide)`) and, for a video going live (not a takedown), **lands it paused**: it arms the clip if the active key differs (`video.load` → paused@0) and then `video.pause()`s so the audience never gets surprise audio the instant it goes live (scope decision #1). Because `pause()` freezes at the current anchor, a *previewed/scrubbed* position is preserved (scope decision #3) — go-live is "paused at wherever the operator parked it," which is frame 0 for an untouched clip. The operator then presses **Play**. Takedown of an already-live video and non-video items are unchanged.
- Styling tokens (buttons, scrubber, hairlines) are drawn from the existing `SlidesTrack` / `SermonCenter` chrome — no invented visual language. There is no design mock for video transport (video was deferred at design time), so the transport is built consistent with the app's existing control character.

New `useVideoState()` hook in `src/renderer/operator/useHelm.ts` (subscribe + initial `get()`), mirroring `usePresentationState`.

---

## 7. Output window (`OutputApp.tsx`)

Route by kind, alongside the existing `reading` special-case:

```tsx
payload.slide.kind === 'reading'  ? <ReadingCanvas slide={payload.slide} fill />
: payload.slide.kind === 'video'  ? <VideoCanvas slide={payload.slide} fill />
:                                   <SlideCanvas slide={payload.slide} variant={payload.variant} fill />
```

The output `VideoCanvas` is not force-muted and takes no callbacks — it is a pure follower.

---

## 8. IPC & API surface

All additions **appended at the end** of their blocks (shared-file discipline; the only expected merge conflict with the countdown agent is the single `SlideKind` union line).

New `CH` channels:
```
videoGetState: 'video:getState', videoState: 'video:state',   // main → all windows
videoLoad: 'video:load', videoPlay: 'video:play', videoPause: 'video:pause',
videoSeek: 'video:seek', videoSetVolume: 'video:setVolume',
videoSetMuted: 'video:setMuted', videoReportDuration: 'video:reportDuration',
```

New `HelmApi.video` namespace:
```ts
video: {
  get(): Promise<VideoStateWire>;
  onState(cb: (s: VideoStateWire) => void): () => void;
  load(key: string, src: string): void;
  play(): void; pause(): void;
  seek(ms: number): void;
  setVolume(v: number): void; setMuted(m: boolean): void;
  reportDuration(ms: number): void;
}
```

`VideoStateWire` is added to `src/shared/types.ts` (no `any` in `src/shared`). `ipc.ts` appends the handlers (`invoke` for `get`, `on` for the fire-and-forget commands); `preload/index.ts` appends the bindings. `registerIpc` gains a `video` import from `./videoState` (module singleton, like `presentation`) — no new constructor argument needed.

---

## 9. `helm-media://` range support

`<video>` seeking requires the server to honor `Range` and return `206 Partial Content`. The scheme is already registered privileged with `stream:true` + `supportFetchAPI:true`, and the handler does `net.fetch(pathToFileURL(abs))`.

**Verification item (Task in plan):** confirm seeking works over `helm-media://` in the running app. If `net.fetch` on a `file://` URL does not propagate the request's `Range` header / 206 response, add explicit range handling in `registerMediaProtocol` (`src/main/library.ts` — not countdown-owned): read `req.headers` `Range`, stream the sliced byte range with `Content-Range` / `Accept-Ranges: bytes` / `206`. The pure `resolveMediaPath` (already unit-tested for `..` escapes) is unchanged.

---

## 10. Testing

- **Pure reducer (vitest) — the core of the sync correctness:** `shared/video/state.test.ts` covering `load` (new key resets, same key idempotent, preserves volume/muted), `play`/`pause`/`effectiveMs` advancing & freezing against an injected `now`, `seek` + clamp, `setDuration` clamping the anchor, `play` at end restarting, `toWire` `positionMs`.
- **Component (RTL):** extend `SlideCanvas.sanity.test.tsx` — a `video` slide renders a `<video>` with the resolved `src`, `muted`, `preload="metadata"`, and is not playing. A thin `VideoCanvas` test asserts it renders a `<video src>` and calls `video.get()` on mount (jsdom's `<video>` doesn't implement `play()`/`currentTime` meaningfully, so reconcile behavior is proven by the pure reducer, not the DOM).
- **`slidesOf`:** update the existing test to assert the `video` kind + `src` (was placeholder title).
- **Manual / drive-the-app (gate):** import a video; select it → hero previews (muted); play/pause/scrub on the operator; Go Live → audience output plays at the operator's position with audio; pause/seek/volume stay in sync across operator + output; clip end holds the last frame; a second output window (Open Test Output) joins mid-play at the right spot.

Before `npm test`: `npm rebuild better-sqlite3`; after, `npm run postinstall` to restore the Electron ABI. End on the ABI matching whatever runs last (Electron, for `npm run dev`).

---

## 11. Files touched

**New:**
- `src/shared/video/state.ts` + `src/shared/video/state.test.ts`
- `src/main/videoState.ts`
- `src/renderer/shared/VideoCanvas.tsx`

**Modified (additive/localized):**
- `src/shared/types.ts` — `'video'` in `SlideKind`; `VideoStateWire`; appended `CH` channels; appended `video` API namespace. *(Expected merge conflict: the `SlideKind` line only.)*
- `src/shared/media/slides.ts` — real video slide; delete `buildVideoPlaceholderSlide`.
- `src/main/ipc.ts` — appended video handlers + `video` import.
- `src/preload/index.ts` — appended video bindings.
- `src/renderer/shared/SlideCanvas.tsx` — video poster branch.
- `src/renderer/output/OutputApp.tsx` — route `video` → `VideoCanvas`.
- `src/renderer/operator/SlidesTrack.tsx` — load-on-select, hero `VideoCanvas`, transport row.
- `src/renderer/operator/SermonCenter.tsx` — optional `heroMedia` slot.
- `src/renderer/operator/useHelm.ts` — `useVideoState()`.
- `src/main/index.ts` + `src/main/displays.ts` — `autoplayPolicy` on window factories.
- `src/main/library.ts` — range handling **only if** §9 verification shows it's needed.
- `src/renderer/shared/SlideCanvas.sanity.test.tsx` — video poster assertion.

**Do NOT touch** (countdown agent owns; live-verse-card work deferred): `src/main/preserviceEngine.ts`, `src/main/preCardsRepo.ts`, `src/shared/preservice/cards.ts`, `src/renderer/operator/PreServiceMode.tsx`.

---

## 12. Build order (sub-slices, each shippable/green)

1. **Slide + poster** — `'video'` in `SlideKind`; real `slidesOf` video slide (delete placeholder); `SlideCanvas` poster branch; update `slidesOf`/sanity tests. *(Rail + thumbnails show real video posters; nothing plays yet.)*
2. **Main video-state + IPC** — pure reducer + tests; `videoState.ts`; `CH` channels; `ipc.ts`; `preload`; `video` API + `VideoStateWire` type.
3. **Followers** — `VideoCanvas`; wire into `OutputApp`; `autoplayPolicy` on window factories; `helm-media://` range verification (§9).
4. **Operator transport** — `useVideoState`; `SermonCenter` `heroMedia` slot; `SlidesTrack` load-on-select + hero `VideoCanvas` + transport row. *(Full drive-the-app verification.)*
</content>
</invoke>
