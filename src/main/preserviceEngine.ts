import type { PreCard, PreState, Slide } from '../shared/types';
import type { PreCardsRepo } from './preCardsRepo';
import { preSlideFor, nextEnabledIdx } from '../shared/preservice/cards';

export interface PresentationSink {
  cue(key: string, slide: Slide): void;
  goLive(key: string, slide: Slide): void;
  liveKey(): string | null;
  isLive(key: string): boolean;
}
export type { PreState };
export interface PreserviceEngine {
  getState(): PreState;
  onChange(cb: (s: PreState) => void): () => void;
  engage(): void; disengage(): void;
  showCard(idx: number): void; step(dir: 1 | -1): void;
  toggleLoop(): void; setDwell(delta: number): void;
  toggleEnabled(cardId: string): void;
  saveCard(c: Omit<PreCard, 'id'> & { id?: string }): void; removeCard(id: string): void;
  tick(): void; dispose(): void;
}
const DWELL_MIN = 5, DWELL_MAX = 60;
const preKey = (id: string): string => 'pre:' + id;

export function createPreserviceEngine(repo: PreCardsRepo, sink: PresentationSink): PreserviceEngine {
  let cards = repo.list();
  let engaged = false, loopOn = true, idx = 0, dwellS = 12, loopT = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const subs = new Set<(s: PreState) => void>();

  const state = (): PreState => ({ engaged, loopOn, idx, dwellS, cards });
  const emit = (): void => { const s = state(); subs.forEach((cb) => cb(s)); };
  const slideFor = (i: number): Slide => preSlideFor(cards[i] ?? cards[0]);
  const clampIdx = (): void => { if (idx >= cards.length) idx = Math.max(0, cards.length - 1); };

  const pushLive = (): void => {
    const c = cards[idx]; if (!c) return;
    const key = preKey(c.id);
    // Already live and showing this exact key: hot-update via cue so goLive's
    // same-key toggle-to-black semantics never fire on us (re-engage, single
    // enabled card rotation, tapping the on-screen card, step onto same idx).
    if (sink.isLive(key)) sink.cue(key, slideFor(idx));
    else sink.goLive(key, slideFor(idx));
  };

  const startTimer = (): void => { if (!timer) timer = setInterval(() => tick(), 1000); };
  const stopTimer = (): void => { if (timer) { clearInterval(timer); timer = null; } };

  function tick(): void {
    if (!engaged) return;
    // Yield whenever the engine is no longer the thing actually on the audience screen.
    // This covers BOTH another flow taking the live key (liveKey changes) AND the operator
    // clearing the screen with ✕ Take down / Logo (output leaves 'live' while liveKey stays
    // a stale 'pre:' key). Checking only liveKey missed the latter, so the loop resurrected
    // itself at the next dwell boundary. `isLive` is true only when output==='live' AND the
    // live key is this exact card, so both cases fall through to disengage.
    const c = cards[idx];
    if (!c || !sink.isLive(preKey(c.id))) { engaged = false; loopT = 0; stopTimer(); emit(); return; }
    if (!loopOn) return;
    loopT += 1;
    if (loopT >= dwellS) { idx = nextEnabledIdx(cards, idx, 1); loopT = 0; pushLive(); emit(); }
  }

  return {
    getState: state,
    onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
    engage() { engaged = true; loopT = 0; clampIdx(); pushLive(); startTimer(); emit(); },
    disengage() { engaged = false; loopT = 0; stopTimer(); emit(); },
    showCard(i) { if (i >= 0 && i < cards.length) { idx = i; loopT = 0; if (engaged) pushLive(); emit(); } },
    step(dir) { idx = nextEnabledIdx(cards, idx, dir); loopT = 0; if (engaged) pushLive(); emit(); },
    toggleLoop() { loopOn = !loopOn; loopT = 0; emit(); },
    setDwell(delta) { dwellS = Math.max(DWELL_MIN, Math.min(DWELL_MAX, dwellS + delta)); loopT = 0; emit(); },
    toggleEnabled(cardId) { const c = cards.find((x) => x.id === cardId); if (c) cards = repo.setEnabled(cardId, !c.enabled); clampIdx(); emit(); },
    saveCard(c) { cards = repo.save(c); emit(); },
    removeCard(id) { cards = repo.remove(id); clampIdx(); if (engaged) pushLive(); emit(); },
    tick, dispose() { stopTimer(); subs.clear(); }
  };
}
