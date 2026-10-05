import { CH, type VideoErrorReport, type VideoStateWire } from '../shared/types';
import {
  initialVideo, loadVideo, playVideo, pauseVideo, seekVideo,
  setVolume, setMuted, setDuration, reportVideo, isFatalReport, toWire, type VideoStateInternal
} from '../shared/video/state';
import { broadcastAll } from './broadcast';
import { mediaLog } from './mediaLog';

let state: VideoStateInternal = initialVideo();

// Broadcast the wire snapshot to every window (operator + outputs). No timer: we only
// broadcast on operator actions; each VideoCanvas fetches video.get() on mount,
// which covers a late-joining output window without touching registerOutput.
const sendVideoState = broadcastAll(CH.videoState);
function broadcast(): void {
  sendVideoState(toWire(state, Date.now()));
}

// Every transition is logged with the state it RESULTED in. On a machine we cannot reach
// this is what tells "play never arrived" (no video.play line) from "play arrived, then
// something paused it 20ms later" (video.play, video.pause) from "the element failed"
// (video.report kind:error). Volume/mute are left out — a slider drag is dozens of ticks.
function log(event: string, extra?: Record<string, unknown>): void {
  const w = toWire(state, Date.now());
  mediaLog(`video.${event}`, {
    ...extra, key: w.key, playing: w.playing, positionMs: w.positionMs, durationMs: w.durationMs,
    ...(w.error ? { error: w.error } : {})
  });
}

export const video = {
  get: (): VideoStateWire => toWire(state, Date.now()),
  load(key: string, src: string): void {
    const before = state;
    state = loadVideo(state, key, src, Date.now());
    if (state !== before) log('load', { src }); // idempotent re-loads (track re-reveal) are noise
    broadcast();
  },
  play(): void { state = playVideo(state, Date.now()); log('play'); broadcast(); },
  pause(): void { state = pauseVideo(state, Date.now()); log('pause'); broadcast(); },
  seek(ms: number): void { state = seekVideo(state, ms, Date.now()); log('seek', { toMs: ms }); broadcast(); },
  setVolume(v: number): void { state = setVolume(state, v); broadcast(); },
  setMuted(m: boolean): void { state = setMuted(state, m); broadcast(); },
  reportDuration(ms: number): void { state = setDuration(state, ms); log('reportDuration', { reportedMs: ms }); broadcast(); },
  // A <video> element reporting on itself (see VideoErrorReport). Always logged; only a
  // fatal report for the loaded src — or the 'playing' that clears one — changes state.
  report(r: VideoErrorReport, senderId?: number): void {
    const before = state;
    state = reportVideo(state, r, Date.now());
    mediaLog('video.report', {
      ...r, senderId, loadedSrc: before.src === r.src, wasPlaying: before.playing, changedState: state !== before
    }, isFatalReport(r) ? 'error' : 'info');
    if (state !== before) broadcast();
  }
};
