import { describe, it, expect } from 'vitest';
import type { VideoErrorReport } from '../types';
import {
  initialVideo, effectiveMs, loadVideo, playVideo, pauseVideo,
  seekVideo, setVolume, setMuted, setDuration, toWire, reportVideo, isFatalReport
} from './state';

describe('initialVideo', () => {
  it('starts paused at 0 with no video, full volume, unmuted', () => {
    expect(initialVideo()).toEqual({
      key: null, src: null, playing: false, anchorMs: 0, anchorAt: 0,
      durationMs: 0, volume: 1, muted: false, error: null
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

describe('non-finite IPC input guards', () => {
  it('seekVideo ignores NaN', () => {
    const st = { ...initialVideo(), key: 'pres:a:0', src: 'x', anchorMs: 1000, durationMs: 8000 };
    expect(seekVideo(st, NaN, 5000)).toBe(st);
  });
  it('setDuration ignores Infinity', () => {
    const st = { ...initialVideo(), durationMs: 5000 };
    expect(setDuration(st, Infinity)).toBe(st);
  });
  it('setVolume ignores NaN', () => {
    const st = { ...initialVideo(), volume: 0.5 };
    expect(setVolume(st, NaN)).toBe(st);
  });
});

describe('toWire', () => {
  it('projects the internal state with the effective position', () => {
    const st = { ...initialVideo(), key: 'pres:a:0', src: 'x', playing: true, anchorMs: 1000, anchorAt: 0, durationMs: 9000 };
    expect(toWire(st, 500)).toEqual({
      key: 'pres:a:0', src: 'x', playing: true, positionMs: 1500, durationMs: 9000, volume: 1, muted: false, error: null
    });
  });
});

describe('reportVideo', () => {
  const rep = (over: Partial<VideoErrorReport>): VideoErrorReport =>
    ({ src: 'x', kind: 'error', readyState: 0, networkState: 3, currentTime: 0, ...over });
  const loaded = (): ReturnType<typeof initialVideo> => loadVideo(initialVideo(), 'pres:a:0', 'x', 0);

  it('an element error pauses at the current position and records the error', () => {
    const st = reportVideo(playVideo(loaded(), 1000), rep({ code: 4, message: 'no decoder' }), 1500);
    expect(st.playing).toBe(false);
    expect(st.anchorMs).toBe(500);
    expect(st.error).toEqual({ kind: 'error', code: 4, message: 'no decoder' });
    expect(toWire(st, 9999).error).toEqual({ kind: 'error', code: 4, message: 'no decoder' });
  });

  it('a non-Abort play() rejection is fatal; an AbortError is not', () => {
    const playing = playVideo(loaded(), 0);
    const st = reportVideo(playing, rep({ kind: 'play-rejected', name: 'NotSupportedError' }), 10);
    expect(st.playing).toBe(false);
    expect(st.error).toEqual({ kind: 'play-rejected', name: 'NotSupportedError' });
    expect(reportVideo(playing, rep({ kind: 'play-rejected', name: 'AbortError' }), 10)).toBe(playing);
    expect(isFatalReport(rep({ kind: 'play-rejected', name: 'AbortError' }))).toBe(false);
  });

  it('ignores a report for a src that is not the loaded one', () => {
    const playing = playVideo(loaded(), 0);
    expect(reportVideo(playing, rep({ src: 'other' }), 10)).toBe(playing);
    expect(reportVideo(initialVideo(), rep({ src: 'x' }), 10).error).toBeNull();
  });

  it('stalled / waiting / ended are log-only', () => {
    const playing = playVideo(loaded(), 0);
    for (const kind of ['stalled', 'waiting', 'ended'] as const) {
      expect(reportVideo(playing, rep({ kind }), 10)).toBe(playing);
    }
  });

  it('the same failure reported again changes nothing (no re-broadcast)', () => {
    const failed = reportVideo(loaded(), rep({ code: 4 }), 10);
    expect(reportVideo(failed, rep({ code: 4 }), 20)).toBe(failed);
  });

  it('the error survives a play command and clears only when the element really plays', () => {
    const failed = reportVideo(loaded(), rep({ code: 3 }), 10);
    const retried = playVideo(failed, 20);
    expect(retried.error).toEqual({ kind: 'error', code: 3 });
    const ok = reportVideo(retried, rep({ kind: 'playing' }), 30);
    expect(ok.error).toBeNull();
    expect(ok.playing).toBe(true);
    expect(reportVideo(ok, rep({ kind: 'playing' }), 40)).toBe(ok);
  });

  it('loading a different key clears the error; re-loading the same key keeps it', () => {
    const failed = reportVideo(loaded(), rep({ code: 4 }), 10);
    expect(loadVideo(failed, 'pres:a:0', 'x', 20)).toBe(failed);
    expect(loadVideo(failed, 'pres:b:0', 'y', 20).error).toBeNull();
  });
});
