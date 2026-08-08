import type { PreCard, PreState, Slide } from '../shared/types';
import type { PreCardsRepo } from './preCardsRepo';
import { preSlideFor, nextEnabledIdx } from '../shared/preservice/cards';

export interface PresentationSink {
  cue(key: string, slide: Slide): void;
  goLive(key: string, slide: Slide): void;
  show(key: string, slide: Slide): void;
  isLive(key: string): boolean;
}
export type { PreState };
export interface PreserviceEngine {
  getState(): PreState;
  onChange(cb: (s: PreState) => void): () => void;
  engage(): void; disengage(): void;
  showCard(idx: number): void; step(dir: 1 | -1): void;
  showNow(): void;
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

  // Deliberate takeover: starts projecting from any state. Only `engage()` (Start loop) and
  // `showNow()` (Show this card) may use it — see `pushShow` for why.
  const pushLive = (): void => {
    const c = cards[idx]; if (!c) return;
    const key = preKey(c.id);
    // Already live and showing this exact key: hot-update via cue so goLive's
    // same-key toggle-to-black semantics never fire on us (re-engage, single
    // enabled card rotation, tapping the on-screen card, step onto same idx).
    if (sink.isLive(key)) sink.cue(key, slideFor(idx));
    else sink.goLive(key, slideFor(idx));
  };

  // Navigation's route to the screen — taps, steps, the loop's own rotation. Switching what
  // is ALREADY on screen is free; STARTING to project is not, because that is the change the
  // room notices and it must come from a control the operator meant to press. `showLive`
  // encodes exactly that: it returns the state untouched unless output is already live, then
  // updates freely within the same kind of content. See BUG-018.
  //
  // This subsumes the `ownsScreen()` test it replaced (BUG-008): that gate asked who last
  // owned `liveKey` so a blackout mid-song would keep taps in arm-only mode, but it still let
  // a tap start projecting from a cold screen — the ordinary pre-service state, and the whole
  // of BUG-018. `showLive`'s `output !== 'live'` guard refuses a dark screen outright, and its
  // `sameKind` guard refuses another flow's screen, so both cases fall out of one rule.
  const pushShow = (): void => {
    const c = cards[idx]; if (!c) return;
    sink.show(preKey(c.id), slideFor(idx));
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
    if (loopT >= dwellS) { idx = nextEnabledIdx(cards, idx, 1); loopT = 0; pushShow(); emit(); }
  }

  return {
    getState: state,
    onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
    engage() { engaged = true; loopT = 0; clampIdx(); pushLive(); startTimer(); emit(); },
    disengage() { engaged = false; loopT = 0; stopTimer(); emit(); },
    showCard(i) { if (i >= 0 && i < cards.length) { idx = i; loopT = 0; pushShow(); emit(); } },
    step(dir) { idx = nextEnabledIdx(cards, idx, dir); loopT = 0; pushShow(); emit(); },
    // Deliberate takeover for a single card. Stops the loop rather than merely leaving it
    // alone: the button is reachable while `engaged` is still true (take down the screen and
    // the engine stays engaged until the next tick yields), and without this the card the
    // operator asked to hold would rotate away at the next dwell boundary.
    showNow() { engaged = false; loopT = 0; stopTimer(); pushLive(); emit(); },
    toggleLoop() { loopOn = !loopOn; loopT = 0; emit(); },
    setDwell(delta) { dwellS = Math.max(DWELL_MIN, Math.min(DWELL_MAX, dwellS + delta)); loopT = 0; emit(); },
    toggleEnabled(cardId) { const c = cards.find((x) => x.id === cardId); if (c) cards = repo.setEnabled(cardId, !c.enabled); clampIdx(); emit(); },
    saveCard(c) {
      cards = repo.save(c);
      // A card can now be live with no rotation behind it (showNow, or disengage while
      // still projecting), so nothing else would ever re-push it: editing the card the
      // congregation is reading has to refresh the screen itself.
      const i = c.id === undefined ? -1 : cards.findIndex((x) => x.id === c.id);
      if (i >= 0 && sink.isLive(preKey(cards[i].id))) { idx = i; pushLive(); }
      emit();
    },
    // Routed through pushShow, not `engaged`: a delete during the engaged-but-yielded window
    // must not yank the audience off whatever actually holds the screen, and deleting a card
    // must never be the thing that starts projecting.
    //
    // ⚠️ Two measured defects remain here, both pre-existing and both logged rather than
    // fixed in the BUG-018 change: `clampIdx` only handles overflow, so deleting a card
    // BEFORE the live one shifts the audience onto an untouched card (BUG-019); and deleting
    // the LAST card leaves it projected with a dangling liveKey, since pushShow early-returns
    // when there is no card to show (BUG-020). Do not read this line as guaranteeing that a
    // deleted card leaves the screen — it does not.
    removeCard(id) { cards = repo.remove(id); clampIdx(); pushShow(); emit(); },
    tick, dispose() { stopTimer(); subs.clear(); }
  };
}
