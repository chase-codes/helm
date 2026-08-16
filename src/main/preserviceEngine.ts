import type { OutputMode, PreCard, PreState, Slide } from '../shared/types';
import type { PreCardsRepo } from './preCardsRepo';
import { preSlideFor, nextEnabledIdx } from '../shared/preservice/cards';

export interface PresentationSink {
  cue(key: string, slide: Slide): void;
  goLive(key: string, slide: Slide): void;
  show(key: string, slide: Slide): void;
  isLive(key: string): boolean;
  setOutput(mode: OutputMode): void;
}
export type { PreState };
export interface PreserviceEngine {
  getState(): PreState;
  onChange(cb: (s: PreState) => void): () => void;
  engage(): void; disengage(): void;
  showCard(idx: number): void; step(dir: 1 | -1): void;
  showNow(): void;
  takeCard(idx: number): void;
  toggleLoop(): void; setDwell(delta: number): void;
  toggleEnabled(cardId: string): void;
  saveCard(c: Omit<PreCard, 'id'> & { id?: string }): void; removeCard(id: string): void;
  restoreCard(card: PreCard, index: number): void;
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
    // Double-click a card (#58). showCard is navigate-only — pushShow refuses to start
    // projecting from a dark screen (BUG-018), which is right for a single tap. A
    // double-click is the deliberate control that may take the screen, so it routes
    // through pushLive.
    //
    // The loop halt is UNCONDITIONAL, the same halt showNow performs, and for the same
    // reason: the operator asked to hold THIS card, so it must not rotate away at the next
    // dwell boundary. The spec's "a double-click on the card already live does nothing" is
    // about never BLACKING the projector — halting a rotation is not blacking, and the
    // rotation is restarted by the same Loop control that started it.
    //
    // It cannot be derived from `sink.isLive` either. A real double-click delivers
    // click, click, dblclick, so the renderer sends showCard(i), showCard(i), takeCard(i)
    // in that order — and while the loop is engaged and projecting, showCard's pushShow has
    // ALREADY made card i live by the time this runs. An `alreadyLive` test therefore reads
    // true for the ordinary case and would never stop anything.
    takeCard(i) {
      if (i < 0 || i >= cards.length) return;
      idx = i;
      engaged = false; loopT = 0; stopTimer();
      pushLive();
      emit();
    },
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
    // The selection is remembered by card *id*, not position: deleting a card before the
    // selected one shifts the list under `idx`, and a positional clamp alone would move the
    // audience onto a card nobody chose (BUG-019). Positional fallback applies only when the
    // selected card itself is the one deleted.
    //
    // Deleting the LAST card while it holds the screen takes the output down (BUG-020):
    // pushShow has nothing to replace it with, and leaving it up would strand the audience
    // on a card that no longer exists with an empty rail — no tap could ever clear it.
    // Guarded by isLive so emptying the rail never touches a screen another flow owns —
    // and equally skips the call when pre-service's own screen was already taken down
    // (output black with a stale pre: key), where blacking again would claim an action
    // the operator didn't take.
    removeCard(id) {
      const selectedId = cards[idx]?.id;
      const deletedWasLive = sink.isLive(preKey(id));
      cards = repo.remove(id);
      if (selectedId !== undefined && selectedId !== id) {
        const i = cards.findIndex((c) => c.id === selectedId);
        if (i >= 0) idx = i;
      }
      clampIdx();
      if (cards.length === 0) { if (deletedWasLive) sink.setOutput('black'); }
      else pushShow();
      emit();
    },
    // The undo half of removeCard (#86). Deliberately touches NO screen call, not even
    // pushShow: a restore repopulates the rail, and the audience is already looking at
    // whatever removeCard left them on — the neighbour it pushed up, another flow's slide,
    // or black. Putting the restored card back on air would be a takeover nobody asked
    // for, which is exactly the BUG-018 rule removeCard is written to respect.
    //
    // The selection is re-pinned by card id for the same reason removeCard does it
    // (BUG-019): inserting a card at or before `idx` shifts every later index, so a
    // positional `idx` alone would slide the preview onto a card nobody chose. Falls back
    // to a clamp when there was no selection to keep — restoring into an emptied rail.
    restoreCard(card, index) {
      const selectedId = cards[idx]?.id;
      cards = repo.restore(card, index);
      const i = selectedId === undefined ? -1 : cards.findIndex((c) => c.id === selectedId);
      idx = i >= 0 ? i : 0;
      clampIdx();
      emit();
    },
    tick, dispose() { stopTimer(); subs.clear(); }
  };
}
