import { describe, it, expect } from 'vitest';
import { openTestDb } from './testDb';
import { createPreCardsRepo } from './preCardsRepo';
import { createPreserviceEngine, type PresentationSink } from './preserviceEngine';
import type { PresentationState, Slide } from '../shared/types';
import { applyCue, goLive, initialPresentation, setOutput, showLive } from '../shared/presentation/core';

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
    show: (key, slide) => { calls.push({ m: 'show', key, slide }); pres = showLive(pres, key, slide); },
    isLive: (key) => pres.output === 'live' && pres.liveKey === key
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
    const { engine, presentation } = harness();
    engine.setDwell(-100); // clamps to min
    engine.engage();
    const first = presentation().liveKey;
    const dwell = engine.getState().dwellS;
    for (let t = 1; t <= dwell; t++) engine.tick();
    // Asserted as resulting STATE rather than as which sink method was called: the rotation
    // routes through `show` since BUG-018, and what matters to the audience is that the next
    // card actually reached the screen without the output dropping.
    expect(presentation().output).toBe('live');
    expect(presentation().liveKey).not.toBe(first); // advanced to a new card
    expect(presentation().liveSnap?.kind).toBe('scripture'); // verse card
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
    // BUG-018. Switching what is already on screen is free; STARTING to project is not.
    // A tap is navigation — the operator clicks a row to read a card, check a name or fix
    // a typo before it goes up — so it must never be the thing that first puts pre-service
    // in front of the congregation. Start loop and Show this card are the deliberate verbs.
    it('showCard only selects when nothing is live — it never starts projecting', () => {
      const { engine, presentation } = harness();
      engine.showCard(2);
      expect(presentation().output).toBe('black');
      expect(presentation().liveKey).toBe(null);
      expect(engine.getState().idx).toBe(2); // the selection (and so the preview) still moves
    });

    it('step only selects when nothing is live', () => {
      const { engine, presentation } = harness();
      engine.step(1);
      expect(presentation().output).toBe('black');
      expect(presentation().liveKey).toBe(null);
    });

    it('Show this card is how a tapped card reaches the screen from nothing live', () => {
      const { engine, presentation, repo } = harness();
      engine.showCard(2);
      engine.showNow();
      expect(presentation().output).toBe('live');
      expect(presentation().liveKey).toBe('pre:' + repo.list()[2].id);
      expect(presentation().liveSnap?.title).toBe('Announcements');
    });

    it('deleting a card never starts projecting when nothing is live', () => {
      const { engine, presentation, repo } = harness();
      engine.removeCard(repo.list()[0].id);
      expect(presentation().output).toBe('black');
      expect(presentation().liveKey).toBe(null);
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

    it('showNow stops a still-engaged loop so the held card cannot rotate away', () => {
      const { engine, presentation, takeDown } = harness();
      engine.setDwell(-100); // clamp to min dwell
      engine.engage();
      takeDown();          // engine stays engaged until the next tick yields
      engine.showNow();    // reachable in exactly that window
      expect(engine.getState().engaged).toBe(false);
      const held = presentation().liveKey;
      const dwell = engine.getState().dwellS;
      for (let t = 1; t <= dwell + 1; t++) engine.tick();
      expect(presentation().liveKey).toBe(held); // never rotated
    });

    it('editing the card on the audience screen refreshes it', () => {
      const { engine, presentation, repo } = harness();
      engine.showNow();
      const live = repo.list()[0];
      engine.saveCard({ ...live, headline: 'CHANGED' });
      expect(presentation().liveSnap?.title).toBe('CHANGED');
    });

    it('editing a card that is not on screen leaves the screen alone', () => {
      const { engine, presentation, repo } = harness();
      engine.showNow();
      const other = repo.list()[2];
      engine.saveCard({ ...other, title: 'CHANGED' });
      expect(presentation().liveSnap?.title).toBe('Welcome'); // still the live card
    });

    it('deleting the card that is on screen replaces it', () => {
      const { engine, presentation, repo } = harness();
      engine.showNow();
      const live = repo.list()[0];
      engine.removeCard(live.id);
      expect(presentation().liveKey).not.toBe('pre:' + live.id);
      expect(presentation().liveKey).toMatch(/^pre:/);
    });

    it('deleting a card never yanks the audience off a live song', () => {
      const { engine, presentation, repo, songGoesLive } = harness();
      engine.engage();
      songGoesLive();  // song takes the screen; tick has not yielded yet
      engine.removeCard(repo.list()[3].id);
      expect(presentation().liveKey).toBe('song:abc:0');
    });

    // BUG-018 tightened this: a screen pre-service itself took down is still a screen the
    // room is looking at (the logo, or black), and bringing it back up is starting to
    // project. `showLive`'s `output !== 'live'` guard refuses outright, which is a stricter
    // and simpler rule than reasoning about who last owned the key.
    it('a tap does not resurrect a screen pre-service took down', () => {
      const { engine, presentation, takeDown } = harness();
      engine.engage();
      takeDown();
      expect(presentation().output).toBe('black');
      engine.showCard(2);
      expect(presentation().output).toBe('black'); // stays down until asked deliberately
      expect(engine.getState().idx).toBe(2);
    });

    it('Show this card brings the screen back after a take-down', () => {
      const { engine, presentation, takeDown, repo } = harness();
      engine.engage();
      takeDown();
      engine.showCard(2);
      engine.showNow();
      expect(presentation().output).toBe('live');
      expect(presentation().liveKey).toBe('pre:' + repo.list()[2].id);
    });

    // A blackout is not free real estate: mid-sermon the operator blanks the screen and
    // browses pre-service, and a row click is the only way to select a card.
    it('a screen blacked out from a song stays owned — tapping only arms', () => {
      const { engine, presentation, takeDown, songGoesLive } = harness();
      songGoesLive();
      takeDown();
      expect(presentation().output).toBe('black');
      engine.showCard(2);
      expect(presentation().output).toBe('black');       // congregation sees nothing new
      expect(presentation().liveKey).toBe('song:abc:0'); // the song still holds the screen
      expect(engine.getState().idx).toBe(2);             // selection moved, as the preview shows
    });

    it('Show this card is still the way out of that state', () => {
      const { engine, presentation, takeDown, songGoesLive, repo } = harness();
      songGoesLive();
      takeDown();
      engine.showCard(2);
      engine.showNow();
      expect(presentation().output).toBe('live');
      expect(presentation().liveKey).toBe('pre:' + repo.list()[2].id);
    });
  });
});
