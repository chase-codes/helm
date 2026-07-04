import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from './db';
import { createPreCardsRepo } from './preCardsRepo';
import { createPreserviceEngine, type PresentationSink } from './preserviceEngine';
import type { Slide } from '../shared/types';

function harness() {
  const db = new Database(':memory:'); db.exec(SCHEMA);
  const repo = createPreCardsRepo(db);
  let live: string | null = null;
  const calls: { m: string; key: string; slide: Slide }[] = [];
  const sink: PresentationSink = {
    cue: (key, slide) => { live = key; calls.push({ m: 'cue', key, slide }); },
    goLive: (key, slide) => { live = key; calls.push({ m: 'goLive', key, slide }); },
    liveKey: () => live
  };
  const engine = createPreserviceEngine(repo, sink, { defaultDurationS: 600, nowFn: () => 0 });
  return { engine, sink, calls, setLive: (k: string | null) => { live = k; } };
}

describe('preserviceEngine', () => {
  it('engage goes live with the first enabled card', () => {
    const { engine, calls } = harness();
    engine.engage();
    expect(engine.getState().engaged).toBe(true);
    expect(calls[0].m).toBe('goLive');
    expect(calls[0].key).toMatch(/^pre:/);
    expect(calls[0].slide.kind).toBe('countdown');
  });
  it('rotates to the next enabled card after dwell seconds', () => {
    const { engine, calls } = harness();
    engine.setDwell(-100); // clamps to min
    engine.engage();
    const dwell = engine.getState().dwellS;
    for (let t = 1; t <= dwell; t++) engine.tick(t * 1000);
    const last = calls[calls.length - 1];
    expect(last.m).toBe('goLive');            // advanced to a new flow
    expect(last.slide.kind).toBe('title');     // Welcome card
  });
  it('countdown text counts down on same-flow cue', () => {
    const { engine, calls } = harness();
    engine.engage();               // t=0, 10:00
    engine.tick(1000);             // still on countdown card
    const cd = [...calls].reverse().find((c) => c.slide.kind === 'countdown')!;
    expect(cd.slide.countdownText).toBe('9:59');
  });
  it('yields when another flow takes the screen', () => {
    const { engine, setLive } = harness();
    engine.engage();
    setLive('song:abc:0');
    engine.tick(1000);
    expect(engine.getState().engaged).toBe(false);
  });
  it('addMinute and reset adjust the countdown target', () => {
    const { engine } = harness();
    engine.engage();
    engine.addMinute();
    engine.tick(0);
    expect(engine.getState().countdownText).toBe('11:00');
    engine.resetCountdown();
    engine.tick(0);
    expect(engine.getState().countdownText).toBe('10:00');
  });
});
