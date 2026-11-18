import { beforeEach, describe, expect, test, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openTestDb } from './testDb';
import { createSongsRepo, type SongsRepo } from './songsRepo';
import { createSongUsageRecorder, nextUsage, sameLocalDay } from './songUsage';
import { applyCue, goLive, initialPresentation, keyForSong, setOutput, takeLive } from '../shared/presentation/core';
import type { PresentationState, Slide } from '../shared/types';

const slide: Slide = { kind: 'lyrics', lines: ['x'] };
// Local-time constructors, so "same day" means the machine's calendar day whatever its zone.
const SUN_9 = new Date(2026, 10, 15, 9, 0).getTime();
const SUN_11 = new Date(2026, 10, 15, 11, 45).getTime();
const SUN_LATE = new Date(2026, 10, 15, 23, 59).getTime();
const MON_EARLY = new Date(2026, 10, 16, 0, 1).getTime();
const NEXT_SUN = new Date(2026, 10, 22, 10, 0).getTime();

describe('nextUsage', () => {
  test('the first go-live is day one', () => {
    expect(nextUsage({ lastLiveAt: null, liveDays: 0 }, SUN_9)).toEqual({ lastLiveAt: SUN_9, liveDays: 1 });
  });
  test('later the same local day moves last_live_at but not live_days', () => {
    expect(nextUsage({ lastLiveAt: SUN_9, liveDays: 1 }, SUN_LATE)).toEqual({ lastLiveAt: SUN_LATE, liveDays: 1 });
  });
  test('a minute past midnight is another day', () => {
    expect(sameLocalDay(SUN_LATE, MON_EARLY)).toBe(false);
    expect(nextUsage({ lastLiveAt: SUN_LATE, liveDays: 4 }, MON_EARLY)).toEqual({ lastLiveAt: MON_EARLY, liveDays: 5 });
  });
});

describe('song usage capture', () => {
  let db: Database.Database;
  let repo: SongsRepo;
  let clock: number;
  let st: PresentationState;
  let record: (s: PresentationState) => void;
  let recordLive: ReturnType<typeof vi.fn<(id: string, now: number) => void>>;
  const usage = (id: string): { last_live_at: number | null; live_days: number } =>
    db.prepare('SELECT last_live_at, live_days FROM songs WHERE id = ?').get(id) as { last_live_at: number | null; live_days: number };
  // Every transition goes through the real presentation kernel, then the recorder, the way
  // stateStore's broadcast hands it each new state.
  const step = (next: PresentationState): void => {
    st = next;
    record(st);
  };

  beforeEach(() => {
    db = openTestDb();
    repo = createSongsRepo(db);
    clock = SUN_9;
    st = initialPresentation();
    recordLive = vi.fn((id: string, now: number) => repo.recordLive(id, now));
    record = createSongUsageRecorder({ recordLive, now: () => clock });
  });

  test('the same song live twice on one day is one day; going live again the next week adds one', () => {
    const a = repo.add({ title: 'A', text: 'Verse 1\na\n\nVerse 2\nb' });
    step(goLive(st, keyForSong(a.id, 0), slide));
    expect(usage(a.id)).toEqual({ last_live_at: SUN_9, live_days: 1 });

    // Between services the screen goes black and something else is live, then A again.
    step(setOutput(st, 'black'));
    step(goLive(st, 'scr:43:3:16', slide));
    clock = SUN_11;
    step(goLive(st, keyForSong(a.id, 0), slide));
    // The black screen reset the recorder, so A counts again: same day, so still one day.
    expect(usage(a.id)).toEqual({ last_live_at: SUN_11, live_days: 1 });

    const b = repo.add({ title: 'B', text: 'Verse 1\nb' });
    step(goLive(st, keyForSong(b.id, 0), slide));
    clock = SUN_LATE;
    step(goLive(st, keyForSong(a.id, 1), slide));
    expect(usage(a.id)).toEqual({ last_live_at: SUN_LATE, live_days: 1 });

    step(goLive(st, keyForSong(b.id, 0), slide));
    clock = NEXT_SUN;
    step(takeLive(st, keyForSong(a.id, 0), slide));
    expect(usage(a.id)).toEqual({ last_live_at: NEXT_SUN, live_days: 2 });
  });

  test('a different song going live updates that song', () => {
    const a = repo.add({ title: 'A', text: 'Verse 1\na' });
    const b = repo.add({ title: 'B', text: 'Verse 1\nb' });
    step(goLive(st, keyForSong(a.id, 0), slide));
    clock = SUN_11;
    step(goLive(st, keyForSong(b.id, 0), slide));
    expect(usage(a.id)).toEqual({ last_live_at: SUN_9, live_days: 1 });
    expect(usage(b.id)).toEqual({ last_live_at: SUN_11, live_days: 1 });
  });

  test('cueing records nothing: not a cued song, and not a section step within the live song', () => {
    const a = repo.add({ title: 'A', text: 'Verse 1\na\n\nVerse 2\nb\n\nVerse 3\nc' });
    const b = repo.add({ title: 'B', text: 'Verse 1\nb' });
    step(applyCue(st, keyForSong(a.id, 0), slide)); // nothing live
    expect(recordLive).not.toHaveBeenCalled();

    step(goLive(st, keyForSong(a.id, 0), slide));
    expect(recordLive).toHaveBeenCalledTimes(1);
    // Stepping sections follows the screen (same flow), and a cue of B queues behind A.
    step(applyCue(st, keyForSong(a.id, 1), slide));
    step(applyCue(st, keyForSong(a.id, 2), slide));
    step(applyCue(st, keyForSong(b.id, 0), slide));
    expect(recordLive).toHaveBeenCalledTimes(1);
    expect(usage(b.id)).toEqual({ last_live_at: null, live_days: 0 });
  });

  test('a song key on a black or logo screen is not live', () => {
    const a = repo.add({ title: 'A', text: 'Verse 1\na' });
    step(goLive(st, 'scr:1:1:1', slide));
    step({ ...st, output: 'logo', liveKey: keyForSong(a.id, 0) });
    step({ ...st, output: 'black' });
    expect(recordLive).not.toHaveBeenCalled();
  });

  test('a failing write is logged and never throws into the live path', () => {
    const onError = vi.fn();
    const failing = createSongUsageRecorder({
      recordLive: () => { throw new Error('disk full'); },
      now: () => clock,
      onError,
    });
    expect(() => failing(goLive(initialPresentation(), 'song:x:0', slide))).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }));
  });

  test('a song deleted while live is ignored', () => {
    expect(() => step(goLive(st, 'song:gone:0', slide))).not.toThrow();
    expect(recordLive).toHaveBeenCalledWith('gone', SUN_9);
  });
});
