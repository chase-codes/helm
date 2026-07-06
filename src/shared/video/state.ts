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

export function toWire(st: VideoStateInternal, now: number): VideoStateWire {
  return {
    key: st.key, src: st.src, playing: st.playing,
    positionMs: effectiveMs(st, now), durationMs: st.durationMs,
    volume: st.volume, muted: st.muted
  };
}
