import { describe, it, expect } from 'vitest';
import { openTestDb } from './testDb';
import { createPreCardsRepo } from './preCardsRepo';
import { createPreserviceEngine, type PresentationSink } from './preserviceEngine';
import type { PresentationState, Slide } from '../shared/types';
import { applyCue, goLive, initialPresentation, setOutput } from '../shared/presentation/core';

// The fake sink models REAL presentation-state semantics (goLive's toggle-to-black
// on same-key, applyCue's same-flow hot-update) by delegating to the actual reducer
// functions from ../shared/presentation/core, instead of just recording calls. This
// lets tests assert on the resulting output/liveKey STATE, which is what actually
// matters to the audience screen — a call log can look fine while the state goes black.
function harness(): {
  engine: ReturnType<typeof createPreserviceEngine>;
  sink: PresentationSink;
  calls: { m: string; key: string; slide: Slide }[];
  repo: ReturnType<typeof createPreCardsRepo>;
  presentation: () => PresentationState;
  setLive: (k: string | null) => void;
  takeDown: () => void;
  songGoesLive: () => void;
} {
  const db = openTestDb();
  const repo = createPreCardsRepo(db);
  let pres: PresentationState = initialPresentation();
  const calls: { m: string; key: string; slide: Slide }[] = [];
  const sink: PresentationSink = {
    cue: (key, slide) => { calls.push({ m: 'cue', key, slide }); pres = applyCue(pres, key, slide); },
    goLive: (key, slide) => { calls.push({ m: 'goLive', key, slide }); pres = goLive(pres, key, slide); },
    liveKey: () => pres.liveKey,
    isLive: (key) => pres.output === 'live' && pres.liveKey === key,
    outputMode: () => pres.output
  };
  const engine = createPreserviceEngine(repo, sink);
  return {
    engine, sink, calls, repo,
    presentation: () => pres,
    // Simulates another flow (e.g. a song) taking the live key, independent of the
    // engine — used to test that preservice yields when it's no longer showing.
    setLive: (k: string | null) => { pres = { ...pres, liveKey: k }; },
    // Simulates the operator's ✕ TAKE DOWN control (Header.tsx → setOutput('black')):
    // the screen goes black but liveKey stays on the pre card.
    takeDown: () => { pres = setOutput(pres, 'black'); },
    // Simulates a song genuinely owning the audience screen (output live + a song key),
    // which is what makes an implicit pre-service takeover an interruption.
    songGoesLive: () => { pres = goLive(pres, 'song:abc:0', { kind: 'lyrics', label: 'Amazing Grace', lines: ['x'] }); }
  };
}

describe('preserviceEngine', () => {
  it('engage goes live with the first enabled card', () => {
    const { engine, calls } = harness();
    engine.engage();
    expect(engine.getState().engaged).toBe(true);
    expect(calls[0].m).toBe('goLive');
    expect(calls[0].key).toMatch(/^pre:/);
    expect(calls[0].slide.kind).toBe('title');
  });
  it('rotates to the next enabled card after dwell seconds', () => {
    const { engine, calls } = harness();
    engine.setDwell(-100); // clamps to min
    engine.engage();
    const dwell = engine.getState().dwellS;
    for (let t = 1; t <= dwell; t++) engine.tick();
    const last = calls[calls.length - 1];
    expect(last.m).toBe('goLive');            // advanced to a new flow
    expect(last.slide.kind).toBe('scripture'); // verse card
  });
  it('yields when another flow takes the screen', () => {
    const { engine, setLive } = harness();
    engine.engage();
    setLive('song:abc:0');
    engine.tick();
    expect(engine.getState().engaged).toBe(false);
  });
  it('yields and does not resurrect after the screen is taken down', () => {
    const { engine, presentation, takeDown } = harness();
    engine.setDwell(-100); // clamp to min dwell so ticks reach a rotation boundary quickly
    engine.engage();
    expect(presentation().output).toBe('live');
    takeDown(); // operator hits ✕ TAKE DOWN
    expect(presentation().output).toBe('black');
    const dwell = engine.getState().dwellS;
    for (let t = 1; t <= dwell + 1; t++) engine.tick(); // tick past a dwell boundary
    expect(presentation().output).toBe('black');       // stays down — no resurrection
    expect(engine.getState().engaged).toBe(false);     // loop disengaged
  });

  describe('goLive toggle-to-black regression', () => {
    it('re-engaging after disengage keeps the output live, not black', () => {
      const { engine, presentation } = harness();
      engine.engage();
      engine.tick();
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
      const keepId = cards[0].id; // first seeded card (message), enabled
      for (const c of cards) if (c.id !== keepId && c.enabled) engine.toggleEnabled(c.id);

      engine.setDwell(-100); // clamp to min dwell
      engine.engage();
      expect(presentation().output).toBe('live');

      const dwell = engine.getState().dwellS;
      for (let t = 1; t <= dwell * 3; t++) {
        engine.tick();
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

  // BUG-008. Tapping a card / stepping used to be gated on `engaged`, so with a song
  // live the tap silently did nothing to the audience screen while the view's own hint
  // text promised "Tap any card to show it immediately". Selection now takes the screen
  // whenever nothing else owns it, and `showNow()` is the explicit, deliberate takeover.
  describe('taking the audience screen', () => {
    it('showCard puts the card up immediately when nothing is live', () => {
      const { engine, presentation, repo } = harness();
      engine.showCard(2);
      expect(presentation().output).toBe('live');
      expect(presentation().liveKey).toBe('pre:' + repo.list()[2].id);
      expect(presentation().liveSnap?.title).toBe('Announcements');
    });

    it('step puts the card up immediately when nothing is live', () => {
      const { engine, presentation } = harness();
      engine.step(1);
      expect(presentation().output).toBe('live');
      expect(presentation().liveKey).toMatch(/^pre:/);
    });

    it('showCard does NOT interrupt a live song — it only selects', () => {
      const { engine, presentation, songGoesLive } = harness();
      songGoesLive();
      engine.showCard(2);
      expect(presentation().liveKey).toBe('song:abc:0');       // song keeps the screen
      expect(presentation().liveSnap?.label).toBe('Amazing Grace');
      expect(engine.getState().idx).toBe(2);                    // but the selection moved
    });

    it('step does NOT interrupt a live song', () => {
      const { engine, presentation, songGoesLive } = harness();
      songGoesLive();
      engine.step(1);
      expect(presentation().liveKey).toBe('song:abc:0');
    });

    it('showNow takes the screen from a live song', () => {
      const { engine, presentation, songGoesLive, repo } = harness();
      songGoesLive();
      engine.showCard(2);
      engine.showNow();
      expect(presentation().output).toBe('live');
      expect(presentation().liveKey).toBe('pre:' + repo.list()[2].id);
      expect(presentation().liveSnap?.title).toBe('Announcements');
    });

    it('showNow shows a single card without starting the rotation', () => {
      const { engine, presentation } = harness();
      engine.setDwell(-100); // clamp to min dwell
      engine.showNow();
      expect(engine.getState().engaged).toBe(false);
      const keyBefore = presentation().liveKey;
      const dwell = engine.getState().dwellS;
      for (let t = 1; t <= dwell + 1; t++) engine.tick();
      expect(presentation().liveKey).toBe(keyBefore); // never rotated
    });

    it('showNow on the already-live card keeps the output live, not black', () => {
      const { engine, presentation } = harness();
      engine.showNow();
      expect(presentation().output).toBe('live');
      engine.showNow(); // same key again — must not hit goLive's toggle-to-black
      expect(presentation().output).toBe('live');
    });

    it('showCard still updates the screen once pre-service owns it', () => {
      const { engine, presentation, repo } = harness();
      engine.engage();
      engine.showCard(2);
      expect(presentation().liveKey).toBe('pre:' + repo.list()[2].id);
    });

    it('a taken-down screen counts as unowned — tapping brings the card back up', () => {
      const { engine, presentation, takeDown, repo } = harness();
      engine.engage();
      takeDown();
      expect(presentation().output).toBe('black');
      engine.showCard(2);
      expect(presentation().output).toBe('live');
      expect(presentation().liveKey).toBe('pre:' + repo.list()[2].id);
    });
  });
});
