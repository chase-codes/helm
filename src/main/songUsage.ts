import { parseSongKey } from '../shared/presentation/core';
import type { PresentationState } from '../shared/types';

// Song usage capture (song keys spec, Phase 1c). Helm records when each song goes live so
// the Song keys window can rank No key by what the church actually sings. Going live counts;
// cueing does not, and nor does stepping through the sections of the song already live.

export interface SongUsage {
  lastLiveAt: number | null;
  liveDays: number;
}

/** Same local calendar day: a 9am and an 11am service are one day of use, not two. */
export function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** The usage after a song goes live at `now`: `last_live_at` moves to now, and `live_days`
 * grows by one when the previous go-live was on another local day (or never). */
export function nextUsage(prev: SongUsage, now: number): SongUsage {
  const newDay = prev.lastLiveAt === null || !sameLocalDay(prev.lastLiveAt, now);
  return { lastLiveAt: now, liveDays: prev.liveDays + (newDay ? 1 : 0) };
}

export interface SongUsageDeps {
  /** Writes one go-live for the song (songsRepo.recordLive). */
  recordLive: (songId: string, now: number) => void;
  now?: () => number;
  onError?: (err: unknown) => void;
}

/**
 * Watches presentation states and records a go-live when the audience output is live on a
 * song slide whose song differs from the last song that went live. One write per song
 * change, never one per slide advance, and nothing at all for a cue: a cue only moves
 * `liveKey` within the song already on screen (applyCue's same-flow follow).
 *
 * Never throws: it runs on the live path (stateStore's broadcast), where a database error
 * must cost a usage row, not the screen.
 */
export function createSongUsageRecorder(deps: SongUsageDeps): (st: Pick<PresentationState, 'output' | 'liveKey'>) => void {
  const now = deps.now ?? Date.now;
  const onError = deps.onError ?? ((err: unknown) => console.error('song usage:', err));
  let lastSongId: string | null = null;
  return (st) => {
    try {
      // Off air resets the memory, so the same song going live again after a take-down
      // (next Sunday, with Helm left running) still counts; a same-day repeat is one day.
      if (st.output !== 'live') {
        lastSongId = null;
        return;
      }
      const parsed = parseSongKey(st.liveKey);
      if (!parsed || parsed.songId === lastSongId) return;
      lastSongId = parsed.songId;
      deps.recordLive(parsed.songId, now());
    } catch (err) {
      onError(err);
    }
  };
}
