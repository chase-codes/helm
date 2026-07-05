# Slice 5b — Native Video Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship native video playback in Helm's output/preview windows — a real `video` slide plus cross-window play/pause/seek/volume sync driven from main — replacing the Slice 5b placeholder.

**Architecture:** A small main-owned `videoState` (companion to `presentation`) tracks playback as arithmetic over a wall-clock anchor (never decoding), and broadcasts a wire snapshot to every window. Output windows and the operator hero render a `<video>` via a new `VideoCanvas` that reconciles to that broadcast — followers, never masters. Which video is on screen still rides the existing presentation `Slide` broadcast; only playback state uses the new side-channel.

**Tech Stack:** Electron (main + preload IPC), React (renderer), TypeScript, Vitest + Testing Library, `helm-media://` custom protocol.

## Global Constraints

- **Worktree:** all work happens in `../helm-5b-video` on branch `slice-5b-video`. Single local repo, no remote.
- **Do NOT touch** (countdown agent owns them): `src/main/preserviceEngine.ts`, `src/main/preCardsRepo.ts`, `src/shared/preservice/cards.ts`, `src/renderer/operator/PreServiceMode.tsx`. Add nothing countdown-related.
- **Shared-file discipline:** edits to `src/shared/types.ts`, `src/renderer/shared/SlideCanvas.tsx`, `src/main/ipc.ts`, `src/preload/index.ts` must be **additive and localized**. Append new `CH` channels / `HelmApi` methods at the END of their blocks. The one expected merge conflict is the `SlideKind` union line — keep both `'video'` and the countdown removal.
- **No `any` in `src/shared`.**
- **TDD:** write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- **Test ABI dance:** `npm rebuild better-sqlite3` before `npm test`; `npm run postinstall` after, to restore the Electron ABI (target 39.8.10). Leave the tree on the Electron ABI. (The video reducer/component tests don't touch SQLite, but the full-suite gate does.)
- **eslint gate:** `npx eslint .` must add **0 new errors** (~3200 pre-existing prettier warnings are fine).
- **Commit message footer** (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01M7t7rDaDTjeGn5NWdi1yNV
  ```
- **All commands run from the worktree:** prefix with `cd /Users/lem/repos/helm-5b-video &&` (the shell cwd can reset to the main tree between calls).

---

### Task 1: `'video'` SlideKind + real `slidesOf` video slide

**Files:**
- Modify: `src/shared/types.ts:13-15` (SlideKind union)
- Modify: `src/shared/media/slides.ts` (replace placeholder with real slide)
- Test: `src/shared/media/slides.test.ts` (update video expectations)

**Interfaces:**
- Produces: `SlideKind` now includes `'video'`; `buildVideoSlide(src: string): Slide` returning `{ kind:'video', src }`; `slidesOf(videoItem)` returns `[{ kind:'video', src }]`.
- `buildVideoPlaceholderSlide` is **removed**.

- [ ] **Step 1: Update the failing test** — in `src/shared/media/slides.test.ts`, (a) change the import on line 4-10 to drop `buildVideoPlaceholderSlide` and add `buildVideoSlide`, (b) delete the `describe('buildVideoPlaceholderSlide', …)` block (lines 38-47), (c) add a `buildVideoSlide` describe, (d) rewrite the video `slidesOf` test.

Replace the import block with:
```ts
import {
  keyForMedia,
  mediaSrc,
  buildImageSlide,
  buildVideoSlide,
  slidesOf
} from './slides';
```

Replace the `describe('buildVideoPlaceholderSlide', …)` block with:
```ts
describe('buildVideoSlide', () => {
  it('builds a video slide with the given src', () => {
    expect(buildVideoSlide('helm-media://videos/clip.mp4')).toEqual({
      kind: 'video',
      src: 'helm-media://videos/clip.mp4'
    });
  });
});
```

Replace the `it('returns a single video placeholder slide for a video item', …)` test with:
```ts
  it('returns a single video slide for a video item', () => {
    const item: MediaItem = {
      id: 'v1',
      type: 'video',
      title: 'Announcement Clip',
      filePath: 'videos/clip.mp4',
      slides: [],
      createdAt: 0
    };
    expect(slidesOf(item)).toEqual([{ kind: 'video', src: 'helm-media://videos/clip.mp4' }]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/lem/repos/helm-5b-video && npx vitest run src/shared/media/slides.test.ts`
Expected: FAIL — `buildVideoSlide` is not exported / video slide shape mismatch.

- [ ] **Step 3: Update the SlideKind union** — `src/shared/types.ts`, replace lines 13-15:
```ts
export type SlideKind =
  | 'lyrics' | 'scripture' | 'quote' | 'title' | 'sermon'
  | 'logo' | 'black' | 'blank' | 'reading' | 'image' | 'video';
```

- [ ] **Step 4: Replace the placeholder in `slides.ts`** — `src/shared/media/slides.ts`, delete `buildVideoPlaceholderSlide` (lines 15-17) and add `buildVideoSlide`; update `slidesOf`'s final branch. The file becomes:
```ts
import type { MediaItem, Slide } from '../types';

export function keyForMedia(itemId: string, slideIdx: number): string {
  return `pres:${itemId}:${slideIdx}`;
}

export function mediaSrc(relPath: string): string {
  return `helm-media://${relPath}`;
}

export function buildImageSlide(src: string, label?: string): Slide {
  return label === undefined ? { kind: 'image', src } : { kind: 'image', src, label };
}

export function buildVideoSlide(src: string): Slide {
  return { kind: 'video', src };
}

export function slidesOf(item: MediaItem): Slide[] {
  if (item.type === 'deck') {
    if (item.slides.length === 0) return [{ kind: 'logo', title: 'HELM' }];
    return item.slides.map((relPath) => buildImageSlide(mediaSrc(relPath)));
  }
  if (item.type === 'image') {
    return [buildImageSlide(item.filePath ? mediaSrc(item.filePath) : '')];
  }
  return [buildVideoSlide(item.filePath ? mediaSrc(item.filePath) : '')];
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/lem/repos/helm-5b-video && npx vitest run src/shared/media/slides.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `cd /Users/lem/repos/helm-5b-video && npm run typecheck`
Expected: PASS (no new errors).

- [ ] **Step 7: Commit**

```bash
cd /Users/lem/repos/helm-5b-video && git add src/shared/types.ts src/shared/media/slides.ts src/shared/media/slides.test.ts && git commit -m "feat(video): add 'video' SlideKind and real video slide

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M7t7rDaDTjeGn5NWdi1yNV"
```

---

### Task 2: `SlideCanvas` static video poster branch

**Files:**
- Modify: `src/renderer/shared/SlideCanvas.tsx` (add `isVideo` + render branch)
- Test: `src/renderer/shared/SlideCanvas.sanity.test.tsx`

**Interfaces:**
- Consumes: `'video'` SlideKind (Task 1).
- Produces: `SlideCanvas` renders a `<video>` poster (`muted`, `preload="metadata"`, `object-fit:contain`) for `kind:'video'`. It never plays — safe for every thumbnail context.

- [ ] **Step 1: Write the failing test** — append to `src/renderer/shared/SlideCanvas.sanity.test.tsx`:
```tsx
test('renders a video slide as a <video> poster with the given src', () => {
  const { container } = render(
    <SlideCanvas slide={{ kind: 'video', src: 'helm-media://videos/clip.mp4' }} fill />
  );
  const video = container.querySelector('video');
  expect(video).not.toBeNull();
  expect(video?.getAttribute('src')).toBe('helm-media://videos/clip.mp4');
  expect(video?.getAttribute('preload')).toBe('metadata');
  expect(video?.style.objectFit).toBe('contain');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/lem/repos/helm-5b-video && npx vitest run src/renderer/shared/SlideCanvas.sanity.test.tsx`
Expected: FAIL — no `<video>` element rendered.

- [ ] **Step 3: Add the render branch** — `src/renderer/shared/SlideCanvas.tsx`. After the `const isImage = active && kind === 'image';` line (currently line 321), add:
```tsx
  const isVideo = active && kind === 'video';
```
Then, immediately after the `{isImage && ( … )}` JSX block (currently lines 387-393), add:
```tsx
      {isVideo && (
        <video
          src={s.src || ''}
          muted
          preload="metadata"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', zIndex: 1 }}
        />
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/lem/repos/helm-5b-video && npx vitest run src/renderer/shared/SlideCanvas.sanity.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd /Users/lem/repos/helm-5b-video && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/lem/repos/helm-5b-video && git add src/renderer/shared/SlideCanvas.tsx src/renderer/shared/SlideCanvas.sanity.test.tsx && git commit -m "feat(video): render static video poster in SlideCanvas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M7t7rDaDTjeGn5NWdi1yNV"
```

---

### Task 3: Pure video-state reducer + `VideoStateWire` type

**Files:**
- Modify: `src/shared/types.ts` (add `VideoStateWire` interface — after `PresentationState`, before `OutputVariant`, i.e. a localized addition near the other presentation types)
- Create: `src/shared/video/state.ts`
- Test: `src/shared/video/state.test.ts`

**Interfaces:**
- Produces (in `src/shared/types.ts`):
```ts
export interface VideoStateWire {
  key: string | null; src: string | null;
  playing: boolean; positionMs: number; durationMs: number;
  volume: number; muted: boolean;
}
```
- Produces (in `src/shared/video/state.ts`): `VideoStateInternal`, `initialVideo()`, `effectiveMs(st, now)`, `loadVideo(st, key, src, now)`, `playVideo(st, now)`, `pauseVideo(st, now)`, `seekVideo(st, ms, now)`, `setVolume(st, v)`, `setMuted(st, m)`, `setDuration(st, ms)`, `toWire(st, now): VideoStateWire`. All pure; `now` injected.

- [ ] **Step 1: Add the `VideoStateWire` type** — `src/shared/types.ts`, immediately after the `PresentationState` interface (currently lines 45-47), add:
```ts
export interface VideoStateWire {
  key: string | null; src: string | null;
  playing: boolean; positionMs: number; durationMs: number;
  volume: number; muted: boolean;
}
```

- [ ] **Step 2: Write the failing test** — create `src/shared/video/state.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  initialVideo, effectiveMs, loadVideo, playVideo, pauseVideo,
  seekVideo, setVolume, setMuted, setDuration, toWire
} from './state';

describe('initialVideo', () => {
  it('starts paused at 0 with no video, full volume, unmuted', () => {
    expect(initialVideo()).toEqual({
      key: null, src: null, playing: false, anchorMs: 0, anchorAt: 0,
      durationMs: 0, volume: 1, muted: false
    });
  });
});

describe('loadVideo', () => {
  it('sets a new active video reset to paused@0, preserving volume/muted', () => {
    const st = setMuted(setVolume(initialVideo(), 0.4), true);
    const loaded = loadVideo(st, 'pres:a:0', 'helm-media://video/a.mp4', 1000);
    expect(loaded.key).toBe('pres:a:0');
    expect(loaded.src).toBe('helm-media://video/a.mp4');
    expect(loaded.playing).toBe(false);
    expect(loaded.anchorMs).toBe(0);
    expect(loaded.volume).toBe(0.4);
    expect(loaded.muted).toBe(true);
  });

  it('is idempotent on the same key — keeps position and playing state', () => {
    const loaded = loadVideo(initialVideo(), 'pres:a:0', 'helm-media://video/a.mp4', 0);
    const playing = playVideo(loaded, 0);
    const again = loadVideo(playing, 'pres:a:0', 'helm-media://video/a.mp4', 5000);
    expect(again).toBe(playing);
  });
});

describe('effectiveMs', () => {
  it('returns the frozen anchor when paused', () => {
    const st = { ...initialVideo(), anchorMs: 3000, anchorAt: 1000, durationMs: 10000 };
    expect(effectiveMs(st, 999999)).toBe(3000);
  });

  it('advances by wall-clock elapsed when playing', () => {
    const st = { ...initialVideo(), playing: true, anchorMs: 3000, anchorAt: 1000, durationMs: 10000 };
    expect(effectiveMs(st, 2500)).toBe(4500); // 3000 + (2500-1000)
  });

  it('clamps to durationMs while playing', () => {
    const st = { ...initialVideo(), playing: true, anchorMs: 9000, anchorAt: 0, durationMs: 10000 };
    expect(effectiveMs(st, 999999)).toBe(10000);
  });
});

describe('playVideo / pauseVideo', () => {
  it('play then pause freezes the elapsed position', () => {
    let st = loadVideo(initialVideo(), 'pres:a:0', 'x', 0);
    st = playVideo(st, 1000);
    st = pauseVideo(st, 4000); // 3000ms elapsed
    expect(st.playing).toBe(false);
    expect(st.anchorMs).toBe(3000);
    expect(effectiveMs(st, 999999)).toBe(3000);
  });

  it('play at/after the end restarts from 0', () => {
    let st = { ...loadVideo(initialVideo(), 'pres:a:0', 'x', 0), durationMs: 5000, anchorMs: 5000 };
    st = playVideo(st, 1000);
    expect(st.anchorMs).toBe(0);
    expect(st.playing).toBe(true);
  });
});

describe('seekVideo', () => {
  it('sets the anchor to the clamped target, preserving playing state', () => {
    let st = { ...loadVideo(initialVideo(), 'pres:a:0', 'x', 0), durationMs: 8000 };
    st = playVideo(st, 0);
    st = seekVideo(st, 12000, 2000); // beyond duration → clamped
    expect(st.anchorMs).toBe(8000);
    expect(st.playing).toBe(true);
  });

  it('clamps negative seeks to 0', () => {
    const st = seekVideo({ ...initialVideo(), durationMs: 8000 }, -500, 0);
    expect(st.anchorMs).toBe(0);
  });
});

describe('setVolume / setMuted / setDuration', () => {
  it('clamps volume to 0..1', () => {
    expect(setVolume(initialVideo(), 2).volume).toBe(1);
    expect(setVolume(initialVideo(), -1).volume).toBe(0);
  });
  it('records duration and clamps a past-end anchor', () => {
    const st = setDuration({ ...initialVideo(), anchorMs: 9999 }, 5000);
    expect(st.durationMs).toBe(5000);
    expect(st.anchorMs).toBe(5000);
  });
});

describe('toWire', () => {
  it('projects the internal state with the effective position', () => {
    const st = { ...initialVideo(), key: 'pres:a:0', src: 'x', playing: true, anchorMs: 1000, anchorAt: 0, durationMs: 9000 };
    expect(toWire(st, 500)).toEqual({
      key: 'pres:a:0', src: 'x', playing: true, positionMs: 1500, durationMs: 9000, volume: 1, muted: false
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /Users/lem/repos/helm-5b-video && npx vitest run src/shared/video/state.test.ts`
Expected: FAIL — `./state` module does not exist.

- [ ] **Step 4: Implement the reducer** — create `src/shared/video/state.ts`:
```ts
import type { VideoStateWire } from '../types';

export interface VideoStateInternal {
  key: string | null;
  src: string | null;
  playing: boolean;
  anchorMs: number;   // playback position at anchorAt
  anchorAt: number;   // wall-clock ms when the anchor was set
  durationMs: number; // 0 until the operator's element reports it
  volume: number;     // 0..1
  muted: boolean;
}

export function initialVideo(): VideoStateInternal {
  return { key: null, src: null, playing: false, anchorMs: 0, anchorAt: 0, durationMs: 0, volume: 1, muted: false };
}

function clampMs(ms: number, durationMs: number): number {
  const lo = Math.max(0, ms);
  return durationMs > 0 ? Math.min(lo, durationMs) : lo;
}

export function effectiveMs(st: VideoStateInternal, now: number): number {
  if (!st.playing) return clampMs(st.anchorMs, st.durationMs);
  return clampMs(st.anchorMs + (now - st.anchorAt), st.durationMs);
}

export function loadVideo(st: VideoStateInternal, key: string, src: string, now: number): VideoStateInternal {
  if (st.key === key) return st; // idempotent: keep the active video's position/playing state
  return { ...initialVideo(), key, src, anchorAt: now, volume: st.volume, muted: st.muted };
}

export function playVideo(st: VideoStateInternal, now: number): VideoStateInternal {
  const pos = effectiveMs(st, now);
  const start = st.durationMs > 0 && pos >= st.durationMs ? 0 : pos; // replay after hold-last-frame
  return { ...st, playing: true, anchorMs: start, anchorAt: now };
}

export function pauseVideo(st: VideoStateInternal, now: number): VideoStateInternal {
  return { ...st, playing: false, anchorMs: effectiveMs(st, now), anchorAt: now };
}

export function seekVideo(st: VideoStateInternal, ms: number, now: number): VideoStateInternal {
  return { ...st, anchorMs: clampMs(ms, st.durationMs), anchorAt: now };
}

export function setVolume(st: VideoStateInternal, volume: number): VideoStateInternal {
  return { ...st, volume: Math.max(0, Math.min(1, volume)) };
}

export function setMuted(st: VideoStateInternal, muted: boolean): VideoStateInternal {
  return { ...st, muted };
}

export function setDuration(st: VideoStateInternal, durationMs: number): VideoStateInternal {
  const d = Math.max(0, durationMs);
  return { ...st, durationMs: d, anchorMs: clampMs(st.anchorMs, d) };
}

export function toWire(st: VideoStateInternal, now: number): VideoStateWire {
  return {
    key: st.key, src: st.src, playing: st.playing,
    positionMs: effectiveMs(st, now), durationMs: st.durationMs,
    volume: st.volume, muted: st.muted
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/lem/repos/helm-5b-video && npx vitest run src/shared/video/state.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `cd /Users/lem/repos/helm-5b-video && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/lem/repos/helm-5b-video && git add src/shared/types.ts src/shared/video/state.ts src/shared/video/state.test.ts && git commit -m "feat(video): pure video-state reducer + VideoStateWire type

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M7t7rDaDTjeGn5NWdi1yNV"
```

---

### Task 4: Main `videoState` singleton + IPC / preload / API wiring

**Files:**
- Create: `src/main/videoState.ts`
- Modify: `src/shared/types.ts` (append `CH` channels; append `video` to `HelmApi`)
- Modify: `src/main/ipc.ts` (import `video`; append handlers)
- Modify: `src/preload/index.ts` (append `video` bindings)

**Interfaces:**
- Consumes: reducer from Task 3; `VideoStateWire` type.
- Produces: `video` module singleton (`get/load/play/pause/seek/setVolume/setMuted/reportDuration`) broadcasting `CH.videoState` to all windows; `window.helm.video.*` in the renderer.

This task is typecheck-gated (IPC plumbing, like the rest of `ipc.ts`, isn't unit-tested — the thin wrapper mirrors `stateStore.ts`, which has no test; correctness lives in Task 3's reducer tests).

- [ ] **Step 1: Append `CH` channels** — `src/shared/types.ts`, inside the `CH` object, immediately after the `mediaRemove: 'media:remove',` line (currently line 83) and before `} as const;`:
```ts
  videoGetState: 'video:getState', videoState: 'video:state',   // main → all windows
  videoLoad: 'video:load', videoPlay: 'video:play', videoPause: 'video:pause',
  videoSeek: 'video:seek', videoSetVolume: 'video:setVolume',
  videoSetMuted: 'video:setMuted', videoReportDuration: 'video:reportDuration',
```

- [ ] **Step 2: Append the `video` API namespace** — `src/shared/types.ts`, inside `HelmApi`, after the `media: { … };` block (currently lines 194-200) and before the closing `}`:
```ts
  video: {
    get(): Promise<VideoStateWire>;
    onState(cb: (s: VideoStateWire) => void): () => void;
    load(key: string, src: string): void;
    play(): void; pause(): void;
    seek(ms: number): void;
    setVolume(v: number): void; setMuted(m: boolean): void;
    reportDuration(ms: number): void;
  };
```

- [ ] **Step 3: Create the main singleton** — `src/main/videoState.ts`:
```ts
import { BrowserWindow } from 'electron';
import { CH, type VideoStateWire } from '../shared/types';
import {
  initialVideo, loadVideo, playVideo, pauseVideo, seekVideo,
  setVolume, setMuted, setDuration, toWire, type VideoStateInternal
} from '../shared/video/state';

let state: VideoStateInternal = initialVideo();

// Broadcast the wire snapshot to every window (operator + outputs) — the same
// all-windows fan-out preserviceState / biblesProgress use. No timer: we only
// broadcast on operator actions; each VideoCanvas fetches video.get() on mount,
// which covers a late-joining output window without touching registerOutput.
function broadcast(): void {
  const wire = toWire(state, Date.now());
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.videoState, wire);
}

export const video = {
  get: (): VideoStateWire => toWire(state, Date.now()),
  load(key: string, src: string): void { state = loadVideo(state, key, src, Date.now()); broadcast(); },
  play(): void { state = playVideo(state, Date.now()); broadcast(); },
  pause(): void { state = pauseVideo(state, Date.now()); broadcast(); },
  seek(ms: number): void { state = seekVideo(state, ms, Date.now()); broadcast(); },
  setVolume(v: number): void { state = setVolume(state, v); broadcast(); },
  setMuted(m: boolean): void { state = setMuted(state, m); broadcast(); },
  reportDuration(ms: number): void { state = setDuration(state, ms); broadcast(); }
};
```

- [ ] **Step 4: Wire the IPC handlers** — `src/main/ipc.ts`. Add the import after the existing `import { presentation } from './stateStore';` (line 24):
```ts
import { video } from './videoState';
```
Then append, immediately after the `ipcMain.handle(CH.mediaRemove, …)` line (currently line 104) and before the closing `}` of `registerIpc`:
```ts
  ipcMain.handle(CH.videoGetState, () => video.get());
  ipcMain.on(CH.videoLoad, (_e, key: string, src: string) => video.load(key, src));
  ipcMain.on(CH.videoPlay, () => video.play());
  ipcMain.on(CH.videoPause, () => video.pause());
  ipcMain.on(CH.videoSeek, (_e, ms: number) => video.seek(ms));
  ipcMain.on(CH.videoSetVolume, (_e, v: number) => video.setVolume(v));
  ipcMain.on(CH.videoSetMuted, (_e, m: boolean) => video.setMuted(m));
  ipcMain.on(CH.videoReportDuration, (_e, ms: number) => video.reportDuration(ms));
```

- [ ] **Step 5: Wire the preload bindings** — `src/preload/index.ts`. Append, inside the `api` object after the `media: { … },` block (currently lines 74-80) and before the closing `}`:
```ts
  video: {
    get: () => ipcRenderer.invoke(CH.videoGetState),
    onState: sub(CH.videoState),
    load: (key, src) => ipcRenderer.send(CH.videoLoad, key, src),
    play: () => ipcRenderer.send(CH.videoPlay),
    pause: () => ipcRenderer.send(CH.videoPause),
    seek: (ms) => ipcRenderer.send(CH.videoSeek, ms),
    setVolume: (v) => ipcRenderer.send(CH.videoSetVolume, v),
    setMuted: (m) => ipcRenderer.send(CH.videoSetMuted, m),
    reportDuration: (ms) => ipcRenderer.send(CH.videoReportDuration, ms)
  },
```

- [ ] **Step 6: Typecheck**

Run: `cd /Users/lem/repos/helm-5b-video && npm run typecheck`
Expected: PASS — the preload `api` object satisfies `HelmApi` (proves the namespace, channels, and bindings all line up).

- [ ] **Step 7: Lint the touched files**

Run: `cd /Users/lem/repos/helm-5b-video && npx eslint src/main/videoState.ts src/main/ipc.ts src/preload/index.ts src/shared/types.ts`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/lem/repos/helm-5b-video && git add src/main/videoState.ts src/main/ipc.ts src/preload/index.ts src/shared/types.ts && git commit -m "feat(video): main video-state singleton + IPC/preload/API wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M7t7rDaDTjeGn5NWdi1yNV"
```

---

### Task 5: `VideoCanvas` follower + output routing + autoplay policy

**Files:**
- Create: `src/renderer/shared/VideoCanvas.tsx`
- Test: `src/renderer/shared/VideoCanvas.test.tsx`
- Modify: `src/renderer/output/OutputApp.tsx` (route `video` kind)
- Modify: `src/main/index.ts:48-53` and `src/main/displays.ts:19` (autoplay policy)

**Interfaces:**
- Consumes: `window.helm.video.get()/onState()` (Task 4); `VideoStateWire`.
- Produces: `VideoCanvas({ slide, forceMuted?, onTime?, onDuration?, onEnded?, fill? })` — renders a `<video>` and reconciles it to broadcast state, obeying only states whose `src` matches its own slide.

- [ ] **Step 1: Write the failing test** — create `src/renderer/shared/VideoCanvas.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import { VideoCanvas } from './VideoCanvas';
import type { VideoStateWire } from '../../shared/types';

const idle: VideoStateWire = { key: null, src: null, playing: false, positionMs: 0, durationMs: 0, volume: 1, muted: false };

beforeEach(() => {
  (window as unknown as { helm: unknown }).helm = {
    video: {
      get: vi.fn().mockResolvedValue(idle),
      onState: vi.fn().mockReturnValue(() => {})
    }
  };
});

test('renders a <video> with the slide src and subscribes to video state', () => {
  const { container } = render(
    <VideoCanvas slide={{ kind: 'video', src: 'helm-media://videos/clip.mp4' }} fill />
  );
  const video = container.querySelector('video');
  expect(video).not.toBeNull();
  expect(video?.getAttribute('src')).toBe('helm-media://videos/clip.mp4');
  const helm = (window as unknown as { helm: { video: { get: () => void; onState: () => void } } }).helm;
  expect(helm.video.get).toHaveBeenCalled();
  expect(helm.video.onState).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/lem/repos/helm-5b-video && npx vitest run src/renderer/shared/VideoCanvas.test.tsx`
Expected: FAIL — `./VideoCanvas` does not exist.

- [ ] **Step 3: Implement `VideoCanvas`** — create `src/renderer/shared/VideoCanvas.tsx`:
```tsx
import { useEffect, useRef, type CSSProperties, type JSX } from 'react';
import type { Slide, VideoStateWire } from '../../shared/types';

export interface VideoCanvasProps {
  slide: Slide;                       // must be kind:'video' with a src
  forceMuted?: boolean;               // operator hero passes true (monitors visually)
  onTime?: (ms: number) => void;      // timeupdate → operator time display
  onDuration?: (ms: number) => void;  // loadedmetadata → reported to main
  onEnded?: () => void;               // → operator sends pause() (hold last frame)
  fill?: boolean;
}

const DRIFT_MS = 250;

export function VideoCanvas({
  slide, forceMuted = false, onTime, onDuration, onEnded, fill = false
}: VideoCanvasProps): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  const last = useRef<VideoStateWire | null>(null);
  const src = slide.src ?? '';

  // Reconcile the element to a broadcast state — but only for the video WE show
  // (src gate). This is what lets a live clip keep playing untouched if the
  // operator cues a different video: single-active-video safety.
  const apply = (s: VideoStateWire): void => {
    last.current = s;
    const el = ref.current;
    if (!el || !src || s.src !== src) return;
    el.muted = forceMuted || s.muted;
    el.volume = forceMuted ? 0 : s.volume;
    const target = s.positionMs / 1000;
    const driftMs = Math.abs(el.currentTime - target) * 1000;
    if (s.playing ? driftMs > DRIFT_MS : driftMs > 1) el.currentTime = target;
    if (s.playing && el.paused) void el.play().catch(() => {});
    if (!s.playing && !el.paused) el.pause();
  };

  useEffect(() => {
    let live = true;
    void window.helm.video.get().then((s) => { if (live) apply(s); });
    const off = window.helm.video.onState(apply);
    return () => { live = false; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, forceMuted]);

  // Once metadata is ready, re-apply the latest state so a mid-play go-live seeks
  // correctly (setting currentTime before metadata loads is a no-op).
  const reapply = (): void => { if (last.current) apply(last.current); };

  const rootStyle: CSSProperties = fill
    ? { position: 'absolute', inset: 0, background: '#000' }
    : { position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', overflow: 'hidden' };

  return (
    <div style={rootStyle}>
      <video
        ref={ref}
        src={src}
        playsInline
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
        onLoadedMetadata={(e) => { onDuration?.(Math.round(e.currentTarget.duration * 1000)); reapply(); }}
        onTimeUpdate={(e) => onTime?.(Math.round(e.currentTarget.currentTime * 1000))}
        onEnded={() => onEnded?.()}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/lem/repos/helm-5b-video && npx vitest run src/renderer/shared/VideoCanvas.test.tsx`
Expected: PASS.

- [ ] **Step 5: Route the `video` kind in the output window** — `src/renderer/output/OutputApp.tsx`. Add the import after the `ReadingCanvas` import (line 4):
```tsx
import { VideoCanvas } from '../shared/VideoCanvas'
```
Replace the returned JSX (lines 13-21) with:
```tsx
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {payload.slide.kind === 'reading' ? (
        <ReadingCanvas slide={payload.slide} fill />
      ) : payload.slide.kind === 'video' ? (
        <VideoCanvas slide={payload.slide} fill />
      ) : (
        <SlideCanvas slide={payload.slide} variant={payload.variant} fill />
      )}
    </div>
  )
```

- [ ] **Step 6: Allow programmatic autoplay of unmuted audio** — so `play()` of the audience (unmuted) video isn't blocked.
  - `src/main/index.ts`, in `createWindow`'s `webPreferences` (lines 48-53), add `autoplayPolicy: 'no-user-gesture-required'`:
```ts
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
```
  - `src/main/displays.ts`, in `createOutputWindow`'s `webPreferences` (line 19), add the same key:
```ts
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, autoplayPolicy: 'no-user-gesture-required' },
```

- [ ] **Step 7: Typecheck + lint**

Run: `cd /Users/lem/repos/helm-5b-video && npm run typecheck && npx eslint src/renderer/shared/VideoCanvas.tsx src/renderer/output/OutputApp.tsx src/main/index.ts src/main/displays.ts`
Expected: typecheck PASS; eslint 0 errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/lem/repos/helm-5b-video && git add src/renderer/shared/VideoCanvas.tsx src/renderer/shared/VideoCanvas.test.tsx src/renderer/output/OutputApp.tsx src/main/index.ts src/main/displays.ts && git commit -m "feat(video): VideoCanvas follower, output routing, autoplay policy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M7t7rDaDTjeGn5NWdi1yNV"
```

---

### Task 6: `helm-media://` byte-range support (seekable video)

**Files:**
- Modify: `src/main/library.ts` (add `parseRangeHeader` + range branch in `registerMediaProtocol`)
- Test: `src/main/library.test.ts` (append `parseRangeHeader` cases)

**Interfaces:**
- Produces: `parseRangeHeader(header: string | null, size: number): { start: number; end: number } | null`. `registerMediaProtocol` serves `206 Partial Content` (streamed byte slice, correct `Content-Range`/`Accept-Ranges`) for requests carrying a `Range` header; non-range requests keep the existing `net.fetch` path unchanged (images unaffected).

Why proactive rather than "verify then maybe add": Chromium's media element issues a `Range: bytes=0-` request for `<video>` and needs `206` responses to treat the source as seekable. Adding range handling deterministically de-risks seeking; gating it behind `Range` leaves the image path byte-for-byte identical.

- [ ] **Step 1: Write the failing test** — append to `src/main/library.test.ts`:
```ts
describe('parseRangeHeader', () => {
  it('returns null when there is no Range header', () => {
    expect(parseRangeHeader(null, 1000)).toBeNull();
  });
  it('parses a closed range', () => {
    expect(parseRangeHeader('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
  });
  it('parses an open-ended range to the last byte', () => {
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  });
  it('parses a suffix range (last N bytes)', () => {
    expect(parseRangeHeader('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
  });
  it('clamps an end past EOF', () => {
    expect(parseRangeHeader('bytes=0-99999', 1000)).toEqual({ start: 0, end: 999 });
  });
  it('rejects a start past EOF', () => {
    expect(parseRangeHeader('bytes=2000-', 1000)).toBeNull();
  });
  it('rejects a malformed header', () => {
    expect(parseRangeHeader('kilobytes=0-1', 1000)).toBeNull();
  });
});
```
If `src/main/library.test.ts` does not yet import from `./library`, ensure the top of the file has:
```ts
import { resolveMediaPath, parseRangeHeader } from './library';
```
(Adjust the existing import line to include `parseRangeHeader` — do not duplicate the import.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/lem/repos/helm-5b-video && npx vitest run src/main/library.test.ts`
Expected: FAIL — `parseRangeHeader` is not exported.

- [ ] **Step 3: Implement range parsing + streaming** — `src/main/library.ts`. Update the imports at the top:
```ts
import { app, protocol, net } from 'electron';
import { join, normalize, sep, isAbsolute, extname } from 'path';
import { mkdirSync, statSync, createReadStream } from 'fs';
import { Readable } from 'stream';
import { pathToFileURL } from 'url';
```
Add, after `resolveMediaPath` (currently ends line 23):
```ts
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo'
};
function mimeFor(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';
}

// Pure: parse an HTTP Range header against a known file size. Returns an
// inclusive byte interval, or null for absent/malformed/unsatisfiable ranges.
export function parseRangeHeader(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, s, e] = m;
  let start: number;
  let end: number;
  if (s === '') {
    const n = parseInt(e, 10);
    if (Number.isNaN(n)) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(s, 10);
    end = e === '' ? size - 1 : parseInt(e, 10);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}
```
Replace `registerMediaProtocol` (currently lines 25-32) with:
```ts
export function registerMediaProtocol(root: string): void {
  protocol.handle(MEDIA_SCHEME, (req) => {
    const { host, pathname } = new URL(req.url); // helm-media://images/a.jpg -> host=images, pathname=/a.jpg
    const abs = resolveMediaPath(root, host + pathname);
    if (!abs) return new Response('forbidden', { status: 403 });

    // Range request (video seeking, and Chromium's initial media probe): serve a
    // streamed 206 so the element treats the source as seekable. Everything else
    // (images) keeps the original net.fetch path untouched.
    const rangeHeader = req.headers.get('Range');
    if (rangeHeader) {
      let size: number;
      try {
        size = statSync(abs).size;
      } catch {
        return new Response('not found', { status: 404 });
      }
      const range = parseRangeHeader(rangeHeader, size);
      if (range) {
        const stream = createReadStream(abs, { start: range.start, end: range.end });
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': mimeFor(abs),
            'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(range.end - range.start + 1)
          }
        });
      }
    }
    return net.fetch(pathToFileURL(abs).toString());
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/lem/repos/helm-5b-video && npx vitest run src/main/library.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `cd /Users/lem/repos/helm-5b-video && npm run typecheck && npx eslint src/main/library.ts`
Expected: typecheck PASS; eslint 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/lem/repos/helm-5b-video && git add src/main/library.ts src/main/library.test.ts && git commit -m "feat(video): serve helm-media:// byte ranges for seekable video

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M7t7rDaDTjeGn5NWdi1yNV"
```

---

### Task 7: Operator transport — `useVideoState`, hero player, transport panel + full gate

**Files:**
- Modify: `src/renderer/operator/useHelm.ts` (add `useVideoState`)
- Modify: `src/renderer/operator/SermonCenter.tsx` (optional `heroMedia` slot)
- Modify: `src/renderer/operator/SlidesTrack.tsx` (load-on-select, hero `VideoCanvas`, transport panel)
- Test: `src/renderer/operator/SlidesTrack.test.tsx` (extend the `window.helm` mock; add video tests)

**Interfaces:**
- Consumes: `VideoCanvas` (Task 5); `window.helm.video.*` (Task 4); `useVideoState` returns `VideoStateWire`.
- Produces: selecting a video item `load`s it; the hero previews it (force-muted); a transport panel drives play/pause/seek/volume/mute.

- [ ] **Step 1: Add the `useVideoState` hook** — `src/renderer/operator/useHelm.ts`. Extend the type import on line 2 to add `VideoStateWire`:
```ts
import type { DisplayStatus, PresentationState, PreState, VideoStateWire } from '../../shared/types';
```
Append at the end of the file:
```ts
export function useVideoState(): VideoStateWire {
  const [s, setS] = useState<VideoStateWire>({ key: null, src: null, playing: false, positionMs: 0, durationMs: 0, volume: 1, muted: false });
  useEffect(() => {
    let live = true;
    void window.helm.video.get().then((v) => { if (live) setS(v); });
    const off = window.helm.video.onState(setS);
    return () => { live = false; off(); };
  }, []);
  return s;
}
```

- [ ] **Step 2: Add the `heroMedia` slot to `SermonCenter`** — `src/renderer/operator/SermonCenter.tsx`. In `SermonCenterProps`, after the `slide?: Slide;` field (line 39), add:
```ts
  /** slide-only: when provided, replaces the hero's SlideCanvas — used to mount a
   * synced <video> (VideoCanvas) for video items instead of a static poster. */
  heroMedia?: JSX.Element;
```
Add `heroMedia` to the destructured params (after `slide,` on line 61):
```ts
  slide,
  heroMedia,
```
In the slide-variant hero (the `) : (` branch, currently lines 223-237), replace the inner `<SlideCanvas … />` with:
```tsx
              {heroMedia ?? <SlideCanvas slide={slide ?? { kind: 'logo', title: 'HELM' }} variant="audience" fill />}
```

- [ ] **Step 3: Write the failing tests** — `src/renderer/operator/SlidesTrack.test.tsx`. Make three concrete edits, then add two tests.

Edit A — add `waitFor` to the testing-library import (line 2):
```ts
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
```

Edit B — append a video item to the `items` fixture (after line 16):
```ts
  { id: 'vid1', type: 'video', title: 'Promo.mp4', filePath: 'video/promo.mp4', slides: [], createdAt: 3 }
```

Edit C — add a `video` namespace to the `window.helm` stub inside `installHelmStub` (alongside `media`/`presentation`):
```ts
    video: {
      get: () => Promise.resolve({ key: null, src: null, playing: false, positionMs: 0, durationMs: 0, volume: 1, muted: false }),
      onState: () => () => {},
      load: vi.fn(), play: vi.fn(), pause: vi.fn(),
      seek: vi.fn(), setVolume: vi.fn(), setMuted: vi.fn(), reportDuration: vi.fn()
    },
```

Add these two tests inside the `describe('SlidesTrack', …)` block:
```ts
  it('selecting a video item loads it into the shared video state', async () => {
    installHelmStub()
    renderTrack()
    const vidRow = (await screen.findByText('▶ Promo.mp4')).closest('button') as HTMLButtonElement
    fireEvent.click(vidRow)
    await waitFor(() =>
      expect(window.helm.video.load).toHaveBeenCalledWith('pres:vid1:0', 'helm-media://video/promo.mp4')
    )
  })

  it('a selected video item renders a <video> preview in the hero', async () => {
    installHelmStub()
    renderTrack()
    const vidRow = (await screen.findByText('▶ Promo.mp4')).closest('button') as HTMLButtonElement
    fireEvent.click(vidRow)
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
  })
```
(The default selection is `items[0]` — the deck — so the load-on-select effect does not fire until the video row is clicked; existing tests are unaffected by the extra fixture row.)

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd /Users/lem/repos/helm-5b-video && npx vitest run src/renderer/operator/SlidesTrack.test.tsx`
Expected: FAIL — `video.load` not called / no `<video>` in the hero.

- [ ] **Step 5: Wire the operator track** — `src/renderer/operator/SlidesTrack.tsx`.

Add imports (extend the existing lines):
```ts
import { VideoCanvas } from '../shared/VideoCanvas';
import { usePresentationState, useVideoState } from './useHelm';
```
(Replace the existing `import { usePresentationState } from './useHelm';` line — do not duplicate.)

Inside the component, after `const { output, liveKey } = usePresentationState();` (line 53), add:
```ts
  const vstate = useVideoState();
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState(0);
```
Add a `mm:ss` helper near the other module-scope helpers (after `metaFor`, line 42):
```ts
function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
```
Add a load-on-select effect (place it right after the existing cue effect, after line 101):
```ts
  // Video items are backed by the shared main-owned video state: arm the selected
  // clip so the operator hero previews it (muted) and Go Live can mirror it. Uses
  // slidesOf's src so the key/src match what SlideCanvas/VideoCanvas render.
  useEffect(() => {
    const sel = items.find((i) => i.id === selId);
    if (!sel || sel.type !== 'video') return;
    const vsl = slidesOf(sel)[0];
    window.helm.video.load(keyForMedia(sel.id, 0), vsl.src ?? '');
  }, [items, selId]);
```
Build the hero media element and pass it to `SermonCenter`. Before the `return (`, add:
```ts
  const heroMedia =
    selected && selected.type === 'video' ? (
      <VideoCanvas
        slide={curSlide}
        forceMuted
        fill
        onTime={setPosMs}
        onDuration={(ms) => { setDurMs(ms); window.helm.video.reportDuration(ms); }}
        onEnded={() => window.helm.video.pause()}
      />
    ) : undefined;
```
Add `heroMedia={heroMedia}` to the `<SermonCenter … />` props (right after `slide={curSlide}`, line 366):
```tsx
        slide={curSlide}
        heroMedia={heroMedia}
```
Add the transport panel — a right-side panel mirroring the deck rail, rendered for video items. Add these styles near the other style consts (e.g. after `deckRowStyle`, line 277):
```ts
  const transportBtnStyle: CSSProperties = {
    height: '34px', padding: '0 14px', borderRadius: '9px', background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`, fontSize: '13px', fontWeight: 600, color: T.dim,
    display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap'
  };
  const transportTimeStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace", fontSize: '12px', color: T.dim, fontVariantNumeric: 'tabular-nums'
  };
```
Add the panel JSX immediately after the deck panel block (after its closing `)}`, currently line 404):
```tsx
      {selected && selected.type === 'video' && (
        <div style={comingPanelStyle}>
          <div style={{ padding: '14px 15px 10px', flexShrink: 0 }}>
            <div style={{ fontSize: '11px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600 }}>VIDEO</div>
            <div style={{ fontSize: '11.5px', color: T.faint, marginTop: '6px', lineHeight: 1.45 }}>
              Preview plays here muted; the audience hears it once it&rsquo;s live.
            </div>
          </div>
          <div style={{ padding: '0 15px 15px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                style={transportBtnStyle}
                onClick={() => (vstate.playing ? window.helm.video.pause() : window.helm.video.play())}
              >
                {vstate.playing ? '❙❙ Pause' : '▶ Play'}
              </button>
              <div style={transportTimeStyle}>
                {fmtClock(posMs)} / {fmtClock(durMs)}
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(1, durMs)}
              value={Math.min(posMs, durMs || 0)}
              onInput={(e) => setPosMs(Number((e.target as HTMLInputElement).value))}
              onChange={(e) => window.helm.video.seek(Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button style={transportBtnStyle} onClick={() => window.helm.video.setMuted(!vstate.muted)}>
                {vstate.muted ? 'Muted' : 'Mute'}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(vstate.volume * 100)}
                onChange={(e) => window.helm.video.setVolume(Number(e.target.value) / 100)}
                style={{ flex: 1 }}
              />
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /Users/lem/repos/helm-5b-video && npx vitest run src/renderer/operator/SlidesTrack.test.tsx src/renderer/operator/useHelm.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint the touched files**

Run: `cd /Users/lem/repos/helm-5b-video && npm run typecheck && npx eslint src/renderer/operator/SlidesTrack.tsx src/renderer/operator/SermonCenter.tsx src/renderer/operator/useHelm.ts`
Expected: typecheck PASS; eslint 0 errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/lem/repos/helm-5b-video && git add src/renderer/operator/useHelm.ts src/renderer/operator/SermonCenter.tsx src/renderer/operator/SlidesTrack.tsx src/renderer/operator/SlidesTrack.test.tsx && git commit -m "feat(video): operator transport — hero preview + play/seek/volume controls

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M7t7rDaDTjeGn5NWdi1yNV"
```

- [ ] **Step 9: Full gate — typecheck + full test suite (ABI dance) + eslint**

```bash
cd /Users/lem/repos/helm-5b-video && npm run typecheck
cd /Users/lem/repos/helm-5b-video && npm rebuild better-sqlite3 && npm test ; npm run postinstall
cd /Users/lem/repos/helm-5b-video && npx eslint .
```
Expected: typecheck PASS; full vitest suite green (Node ABI for tests, restored to Electron ABI after); eslint 0 errors (pre-existing prettier warnings OK). The tree must end on the Electron ABI.

- [ ] **Step 10: Drive the real app (use the `/run` or `verify` skill)**

```bash
cd /Users/lem/repos/helm-5b-video && npm run dev
```
Verify end-to-end (open a Test Output window via the View menu if single-display):
  1. Slides track → Import → Video → pick an `.mp4`. The rail row shows a real first-frame poster.
  2. Select the video → the operator hero previews it (muted); press **Play** → it plays on the hero, elapsed time advances; scrub → it jumps; the transport shows correct total time.
  3. **Go Live** → the output window shows the video at the operator's current position and **audio plays** in the room.
  4. Pause / seek / volume / mute from the operator → the output window stays in sync.
  5. Let the clip reach the end → it **holds the last frame** (paused) everywhere.
  6. With the video playing live, open a second output (Open Test Output) → it **joins mid-play** near the right spot.
  7. Confirm images and decks still render and cue exactly as before (range-support change didn't regress them).

---

## Post-implementation: rebase & handoff (do NOT merge)

Per the dispatch's merge protocol — the countdown removal lands on master first:

- [ ] From the worktree, rebase onto the updated master: `cd /Users/lem/repos/helm-5b-video && git rebase master`
- [ ] Resolve the one expected conflict on the `SlideKind` union line — keep **both** the countdown removal and the `'video'` addition.
- [ ] Re-run the full gate (Step 9) after rebasing.
- [ ] Stop and report. A human does the final merge to master.
</content>
