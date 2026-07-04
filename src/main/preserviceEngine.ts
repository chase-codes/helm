import type { PreCard, Slide } from '../shared/types';
import type { PreCardsRepo } from './preCardsRepo';
import { preSlideFor, nextEnabledIdx, fmtCountdown, remainingMs } from '../shared/preservice/cards';

export interface PresentationSink {
  cue(key: string, slide: Slide): void;
  goLive(key: string, slide: Slide): void;
  liveKey(): string | null;
}
export interface PreState {
  engaged: boolean; loopOn: boolean; idx: number; dwellS: number;
  countdownText: string; paused: boolean; cards: PreCard[];
}
export interface PreserviceEngine {
  getState(): PreState;
  onChange(cb: (s: PreState) => void): () => void;
  engage(): void; disengage(): void;
  showCard(idx: number): void; step(dir: 1 | -1): void;
  toggleLoop(): void; setDwell(delta: number): void;
  toggleEnabled(cardId: string): void;
  saveCard(c: Omit<PreCard, 'id'> & { id?: string }): void; removeCard(id: string): void;
  addMinute(): void; resetCountdown(): void; togglePause(): void;
  tick(nowMs: number): void; dispose(): void;
}
const DWELL_MIN = 5, DWELL_MAX = 60;
const preKey = (id: string): string => 'pre:' + id;

export function createPreserviceEngine(
  repo: PreCardsRepo, sink: PresentationSink,
  opts: { defaultDurationS?: number; nowFn?: () => number } = {}
): PreserviceEngine {
  const now = opts.nowFn ?? (() => Date.now());
  const defaultDurationS = opts.defaultDurationS ?? 600;
  let cards = repo.list();
  let engaged = false, loopOn = true, idx = 0, dwellS = 12, loopT = 0, paused = false;
  let targetMs = now() + defaultDurationS * 1000;
  let pausedRemaining = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const subs = new Set<(s: PreState) => void>();

  const curRemaining = (): number => (paused ? pausedRemaining : remainingMs(targetMs, now()));
  const countdownText = (): string => fmtCountdown(curRemaining());
  const state = (): PreState => ({ engaged, loopOn, idx, dwellS, countdownText: countdownText(), paused, cards });
  const emit = (): void => { const s = state(); subs.forEach((cb) => cb(s)); };
  const slideFor = (i: number): Slide => preSlideFor(cards[i] ?? cards[0], countdownText());
  const clampIdx = (): void => { if (idx >= cards.length) idx = Math.max(0, cards.length - 1); };

  const pushLive = (): void => { const c = cards[idx]; if (c) sink.goLive(preKey(c.id), slideFor(idx)); };
  const pushCue = (): void => { const c = cards[idx]; if (c) sink.cue(preKey(c.id), slideFor(idx)); };

  const startTimer = (): void => { if (!timer) timer = setInterval(() => tick(now()), 1000); };
  const stopTimer = (): void => { if (timer) { clearInterval(timer); timer = null; } };

  function tick(nowMs: number): void {
    if (!engaged) return;
    const lk = sink.liveKey();
    if (lk && !lk.startsWith('pre:')) { engaged = false; loopT = 0; stopTimer(); emit(); return; }
    if (loopOn && !paused) {
      loopT += 1;
      if (loopT >= dwellS) { idx = nextEnabledIdx(cards, idx, 1); loopT = 0; pushLive(); emit(); return; }
    }
    // Use nowMs to compute countdown (not now())
    const remaining = paused ? pausedRemaining : remainingMs(targetMs, nowMs);
    const c = cards[idx];
    if (c) sink.cue(preKey(c.id), preSlideFor(c, fmtCountdown(remaining)));
    emit();
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
    addMinute() { if (paused) pausedRemaining += 60000; else targetMs += 60000; if (engaged) pushCue(); emit(); },
    resetCountdown() { targetMs = now() + defaultDurationS * 1000; paused = false; if (engaged) pushCue(); emit(); },
    togglePause() {
      if (paused) { targetMs = now() + pausedRemaining; paused = false; }
      else { pausedRemaining = remainingMs(targetMs, now()); paused = true; }
      emit();
    },
    tick, dispose() { stopTimer(); subs.clear(); }
  };
}
