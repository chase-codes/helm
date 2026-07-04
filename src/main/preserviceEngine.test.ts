import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from './db';
import { createPreCardsRepo } from './preCardsRepo';
import { createPreserviceEngine, type PresentationSink } from './preserviceEngine';
import type { PresentationState, Slide } from '../shared/types';
import { applyCue, goLive, initialPresentation } from '../shared/presentation/core';

// The fake sink models REAL presentation-state semantics (goLive's toggle-to-black
// on same-key, applyCue's same-flow hot-update) by delegating to the actual reducer
// functions from ../shared/presentation/core, instead of just recording calls. This
// lets tests assert on the resulting output/liveKey STATE, which is what actually
// matters to the audience screen — a call log can look fine while the state goes black.
function harness() {
  const db = new Database(':memory:'); db.exec(SCHEMA);
  const repo = createPreCardsRepo(db);
  let pres: PresentationState = initialPresentation();
  const calls: { m: string; key: string; slide: Slide }[] = [];
  const sink: PresentationSink = {
    cue: (key, slide) => { calls.push({ m: 'cue', key, slide }); pres = applyCue(pres, key, slide); },
    goLive: (key, slide) => { calls.push({ m: 'goLive', key, slide }); pres = goLive(pres, key, slide); },
    liveKey: () => pres.liveKey,
    isLive: (key) => pres.output === 'live' && pres.liveKey === key
  };
  const engine = createPreserviceEngine(repo, sink, { defaultDurationS: 600, nowFn: () => 0 });
  return {
    engine, sink, calls, repo,
    presentation: () => pres,
    // Simulates another flow (e.g. a song) taking the live key, independent of the
    // engine — used to test that preservice yields when it's no longer showing.
    setLive: (k: string | null) => { pres = { ...pres, liveKey: k }; }
  };
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

  describe('goLive toggle-to-black regression', () => {
    it('re-engaging after disengage keeps the output live, not black', () => {
      const { engine, presentation } = harness();
      engine.engage();
      engine.tick(1000);
      engine.disengage();
      // disengage() doesn't touch presentation output/liveKey at all: it leaves
      // output 'live' + liveKey 'pre:X' exactly as the audience screen last saw it.
      expect(presentation().output).toBe('live');
      const liveKeyBefore = presentation().liveKey;

      engine.engage(); // must NOT toggle to black via goLive's same-key semantics
      expect(presentation().output).toBe('live');
      expect(presentation().liveKey).toBe(liveKeyBefore);
    });

    it('rotating with only one enabled card never flips output to black', () => {
      const { engine, repo, presentation } = harness();
      const cards = repo.list();
      const keepId = cards[0].id; // seeded countdown card, enabled
      for (const c of cards) if (c.id !== keepId && c.enabled) engine.toggleEnabled(c.id);

      engine.setDwell(-100); // clamp to min dwell
      engine.engage();
      expect(presentation().output).toBe('live');

      const dwell = engine.getState().dwellS;
      for (let t = 1; t <= dwell * 3; t++) {
        engine.tick(t * 1000);
        expect(presentation().output).toBe('live');
      }
    });

    it('showCard on the currently-live card keeps the output live, not black', () => {
      const { engine, presentation } = harness();
      engine.engage();
      const idx = engine.getState().idx;
      engine.showCard(idx); // tapping the on-screen card's ● ON SCREEN badge
      expect(presentation().output).toBe('live');
    });

    it('step() onto the same idx (single enabled card) keeps the output live', () => {
      const { engine, repo, presentation } = harness();
      const cards = repo.list();
      const keepId = cards[0].id;
      for (const c of cards) if (c.id !== keepId && c.enabled) engine.toggleEnabled(c.id);

      engine.engage();
      expect(presentation().output).toBe('live');
      engine.step(1); // only one enabled card: nextEnabledIdx returns the same idx
      expect(presentation().output).toBe('live');
    });
  });
});
