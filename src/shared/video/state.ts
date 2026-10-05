import type { VideoError, VideoErrorReport, VideoStateWire } from '../types';

export interface VideoStateInternal {
  key: string | null;
  src: string | null;
  playing: boolean;
  anchorMs: number;   // playback position at anchorAt
  anchorAt: number;   // wall-clock ms when the anchor was set
  durationMs: number; // 0 until the operator's element reports it
  volume: number;     // 0..1
  muted: boolean;
  error: VideoError | null; // set by a fatal element report; see reportVideo
}

export function initialVideo(): VideoStateInternal {
  return { key: null, src: null, playing: false, anchorMs: 0, anchorAt: 0, durationMs: 0, volume: 1, muted: false, error: null };
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
  if (!Number.isFinite(ms)) return st; // guard against NaN/Infinity arriving over IPC
  return { ...st, anchorMs: clampMs(ms, st.durationMs), anchorAt: now };
}

export function setVolume(st: VideoStateInternal, volume: number): VideoStateInternal {
  if (!Number.isFinite(volume)) return st; // guard against NaN/Infinity arriving over IPC
  return { ...st, volume: Math.max(0, Math.min(1, volume)) };
}

export function setMuted(st: VideoStateInternal, muted: boolean): VideoStateInternal {
  return { ...st, muted };
}

export function setDuration(st: VideoStateInternal, durationMs: number): VideoStateInternal {
  if (!Number.isFinite(durationMs)) return st; // guard against NaN/Infinity arriving over IPC
  const d = Math.max(0, durationMs);
  return { ...st, durationMs: d, anchorMs: clampMs(st.anchorMs, d) };
}

export function isFatalReport(r: VideoErrorReport): boolean {
  return r.kind === 'error' || (r.kind === 'play-rejected' && r.name !== 'AbortError');
}

// An element's report about itself. Only reports for the LOADED src count (a stale
// element still showing the previous clip must not fail the new one). A fatal report
// pauses and records the error so every window agrees; 'playing' proves the element
// really started, which is the only thing that clears it (a play *command* does not —
// a retry of a broken file would otherwise blink the message off and on). Everything
// else returns the same reference, so the caller can skip the broadcast.
export function reportVideo(st: VideoStateInternal, r: VideoErrorReport, now: number): VideoStateInternal {
  if (!st.src || r.src !== st.src) return st;
  if (isFatalReport(r)) {
    const error: VideoError = { kind: r.kind as VideoError['kind'] };
    if (r.name !== undefined) error.name = r.name;
    if (r.code !== undefined) error.code = r.code;
    if (r.message !== undefined) error.message = r.message;
    const e = st.error; // the same failure from a second window/retry: nothing new to say
    if (!st.playing && e && e.kind === error.kind && e.name === error.name && e.code === error.code && e.message === error.message) return st;
    return { ...pauseVideo(st, now), error };
  }
  if (r.kind === 'playing' && st.error) return { ...st, error: null };
  return st;
}

export function toWire(st: VideoStateInternal, now: number): VideoStateWire {
  return {
    key: st.key, src: st.src, playing: st.playing,
    positionMs: effectiveMs(st, now), durationMs: st.durationMs,
    volume: st.volume, muted: st.muted, error: st.error
  };
}
