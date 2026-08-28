import { CH, type VideoStateWire } from '../shared/types';
import {
  initialVideo, loadVideo, playVideo, pauseVideo, seekVideo,
  setVolume, setMuted, setDuration, toWire, type VideoStateInternal
} from '../shared/video/state';
import { broadcastAll } from './broadcast';

let state: VideoStateInternal = initialVideo();

// Broadcast the wire snapshot to every window (operator + outputs). No timer: we only
// broadcast on operator actions; each VideoCanvas fetches video.get() on mount,
// which covers a late-joining output window without touching registerOutput.
const sendVideoState = broadcastAll(CH.videoState);
function broadcast(): void {
  sendVideoState(toWire(state, Date.now()));
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
