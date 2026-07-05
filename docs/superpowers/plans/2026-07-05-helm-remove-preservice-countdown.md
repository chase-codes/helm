# Remove the pre-service live countdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully remove the pre-service live "Service begins in M:SS" countdown — the `countdown` card type and slide kind, the engine clock, the `+1 min / Pause / Reset` controls and their IPC/preload wiring, and the SlideCanvas countdown render — while keeping the rest of the pre-service loop (rotation, dwell, card editor) untouched. Add a one-time wipe-and-reseed migration so installed DBs lose their auto-seeded countdown card.

**Architecture:** This is an **atomic type-removal refactor**, not an additive feature. Removing `'countdown'` from the shared union types (`SlideKind`, `PreCardType`) simultaneously invalidates its producers (`cards.ts`, `SEED`) and consumers (`SlideCanvas`, `PreServiceMode`, engine, IPC, preload). There is **no ordering that keeps the whole `npm test` + `typecheck` suite green between sub-commits** without artificial scaffolding, so the work lands as **one commit**: the tasks below are ordered edit-groups by layer, and the final task runs the complete gate once and commits everything (code + README + progress log) together. This matches the repo's "one commit per slice, nothing committed until the gate is green" pattern.

**Tech Stack:** TypeScript, Electron (main/preload/renderer split), React, better-sqlite3, Vitest.

## Global Constraints

- **Seed set after removal** (order matters — asserted in tests): `['message', 'verse', 'list', 'list', 'logo']` (length **5**). The first card (`message`, "Welcome") is enabled; `logo` is disabled.
- **Logo fallback slide** (exact shape): `{ kind: 'logo', title: 'HELM' }`.
- **No commit until the full gate is green.** Gate = `npm run typecheck` clean, `npm test` all pass, `npx eslint .` → **0 errors** (the ~3200 pre-existing prettier *warnings* are acceptable; introduce 0 new errors).
- **better-sqlite3 ABI dance for `npm test`:** the native module is built for the Electron ABI, so Vitest fails with a `NODE_MODULE_VERSION` mismatch. Run `npm rebuild better-sqlite3` **before** `npm test`, then `npm run postinstall` **after** to restore the Electron ABI so the app still launches. Leave it restored.
- Do **not** describe or reintroduce a countdown anywhere (code, tests, or README). This also drops the Slice 5b "absolute countdown target" roadmap item — do not re-add it.

---

### Task 1: Repo seed + wipe-and-reseed migration (TDD)

The one piece with genuinely new behavior. Test-drive it. Because the seed set changes here, this task also updates the repo test's seed expectations.

**Files:**
- Modify: `src/main/preCardsRepo.ts:8-15` (SEED), `src/main/preCardsRepo.ts:43-50` (seed guard → migration + guard)
- Test: `src/main/preCardsRepo.test.ts`

**Interfaces:**
- Consumes: `createPreCardsRepo(db: Database.Database): PreCardsRepo`, `SCHEMA` from `./db`.
- Produces: unchanged `PreCardsRepo` surface (`list`, `save`, `remove`, `setEnabled`). New behavior only: construction wipes-and-reseeds a DB containing any `type = 'countdown'` row.

- [ ] **Step 1: Update the repo tests first (they will fail against the current seed)**

In `src/main/preCardsRepo.test.ts`, replace the first two tests and add two migration tests. Change the `'seeds the default loop'` expectation and the `'does not re-seed'` length, then append the migration cases:

```ts
  it('seeds the default loop on first construction', () => {
    const repo = freshRepo();
    const cards = repo.list();
    expect(cards.map((c) => c.type)).toEqual(['message', 'verse', 'list', 'list', 'logo']);
    expect(cards.find((c) => c.type === 'logo')?.enabled).toBe(false);
    expect(cards.find((c) => c.type === 'verse')?.ref).toBe('Psalm 122:1');
  });
  it('does not re-seed when rows already exist', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA);
    createPreCardsRepo(db);
    const second = createPreCardsRepo(db);
    expect(second.list()).toHaveLength(5);
  });
  it('wipes and re-seeds a DB that still has a legacy countdown card', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA);
    const ins = db.prepare('INSERT INTO pre_cards (id, type, title, payload_json, enabled, position) VALUES (?,?,?,?,?,?)');
    ins.run('cd', 'countdown', 'Countdown', '{}', 1, 0);
    ins.run('m', 'message', 'Edited Welcome', '{}', 1, 1);
    const repo = createPreCardsRepo(db);
    const cards = repo.list();
    expect(cards.some((c) => c.type === 'countdown')).toBe(false);
    expect(cards.map((c) => c.type)).toEqual(['message', 'verse', 'list', 'list', 'logo']);
  });
  it('leaves a countdown-free populated DB untouched (migration does not re-fire)', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA);
    db.prepare('INSERT INTO pre_cards (id, type, title, payload_json, enabled, position) VALUES (?,?,?,?,?,?)')
      .run('only', 'message', 'Custom', '{}', 1, 0);
    const repo = createPreCardsRepo(db);
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0].title).toBe('Custom');
  });
```

Also update the two remaining length assertions in the file:
- `'save inserts a new card at the end'`: `expect(after).toHaveLength(7)` → `toHaveLength(6)`.
- `'save updates an existing card by id'`: `expect(after).toHaveLength(6)` → `toHaveLength(5)`.

- [ ] **Step 2: Run the repo tests to verify they fail**

```
npm rebuild better-sqlite3
npx vitest run src/main/preCardsRepo.test.ts
```
Expected: FAIL — current seed still starts with `countdown`, lengths are 6/7, migration not implemented.

- [ ] **Step 3: Remove the countdown seed and add the migration**

In `src/main/preCardsRepo.ts`, remove the first SEED entry (line 9, `{ type: 'countdown', title: 'Countdown', enabled: true },`) so SEED begins with the `message` "Welcome" card.

Then replace the seed guard block (currently lines 43-50):

```ts
  const list = (): PreCard[] => (selectAll.all() as Row[]).map(toCard);

  const seed = (): void => {
    const seedTx = db.transaction(() => {
      SEED.forEach((c, i) => insert.run(randomUUID(), c.type, c.title, payloadOf(c), c.enabled ? 1 : 0, i));
    });
    seedTx();
  };

  // One-time migration: older installs auto-seeded a now-removed 'countdown' card.
  // Wipe the whole loop so the count==0 guard below re-seeds the countdown-free
  // defaults. Self-limiting — after re-seed no countdown row remains, so it never
  // fires again. Must run BEFORE the count==0 guard, or a populated countdown-bearing
  // DB would slip through untouched. Acceptable wipe: pre-cards are still auto-seeded
  // defaults at this stage, so any operator edits are discarded.
  const hasCountdown = db.prepare("SELECT COUNT(*) AS n FROM pre_cards WHERE type = 'countdown'");
  if ((hasCountdown.get() as { n: number }).n > 0) {
    db.prepare('DELETE FROM pre_cards').run();
  }

  if ((count.get() as { n: number }).n === 0) {
    seed();
  }
```

- [ ] **Step 4: Run the repo tests to verify they pass**

```
npx vitest run src/main/preCardsRepo.test.ts
```
Expected: PASS (all 6 tests). *(Do not run `npm run postinstall` yet — later tasks also run Vitest. Restore the ABI once at the final gate.)*

---

### Task 2: Shared types + pre-slide logic

**Files:**
- Modify: `src/shared/types.ts` (SlideKind, Slide, PreCardType, PreState, CH, HelmApi)
- Modify: `src/shared/preservice/cards.ts`
- Test: `src/shared/preservice/cards.test.ts`

**Interfaces:**
- Produces: `preSlideFor(card: PreCard): Slide` (loses its `countdownText` string parameter). `PreState` = `{ engaged, loopOn, idx, dwellS, cards }`. `SlideKind` and `PreCardType` no longer include `'countdown'`. `Slide` drops `message?` and `countdownText?`. `CH` drops `preserviceAddMinute` / `preserviceReset` / `preserviceTogglePause`. `HelmApi.preservice` drops `addMinute` / `resetCountdown` / `togglePause`.
- Consumed by: Tasks 3, 4, 5.

- [ ] **Step 1: Rewrite `cards.test.ts` (drop countdown, add logo-fallback)**

Replace the file body so it imports only the two surviving exports, calls `preSlideFor` with one argument, drops the countdown/`fmtCountdown`/`remainingMs` cases, and asserts the default-branch logo fallback:

```ts
import { describe, it, expect } from 'vitest';
import { preSlideFor, nextEnabledIdx } from './cards';
import type { PreCard } from '../types';

const base = { id: 'x', title: 't', enabled: true };

describe('preSlideFor', () => {
  it('message → title slide', () => {
    expect(preSlideFor({ ...base, type: 'message', headline: 'Welcome', subtitle: 'Glad you are here' } as PreCard))
      .toEqual({ kind: 'title', accent: '#e0a341', title: 'Welcome', subtitle: 'Glad you are here' });
  });
  it('verse → scripture slide (KJV single column)', () => {
    expect(preSlideFor({ ...base, type: 'verse', ref: 'Psalm 122:1', text: 'I was glad…' } as PreCard))
      .toEqual({ kind: 'scripture', accent: '#6f9cf0', ref: 'Psalm 122:1', label: 'Psalm 122:1', columns: [{ version: 'KJV', text: 'I was glad…' }] });
  });
  it('list → title slide with points', () => {
    expect(preSlideFor({ ...base, type: 'list', title: 'Announcements', points: ['a', 'b'] } as PreCard))
      .toEqual({ kind: 'title', accent: '#e0a341', title: 'Announcements', points: ['a', 'b'] });
  });
  it('logo → logo slide', () => {
    expect(preSlideFor({ ...base, type: 'logo' } as PreCard)).toEqual({ kind: 'logo', title: 'HELM' });
  });
  it('image → image slide', () => {
    expect(preSlideFor({ ...base, type: 'image', src: 'helm-media://images/a.jpg' } as PreCard))
      .toEqual({ kind: 'image', src: 'helm-media://images/a.jpg' });
  });
  it('unknown/default type → logo fallback slide', () => {
    expect(preSlideFor({ ...base, type: 'bogus' } as unknown as PreCard)).toEqual({ kind: 'logo', title: 'HELM' });
  });
});

const cards = (flags: boolean[]): PreCard[] =>
  flags.map((enabled, i) => ({ id: String(i), type: 'logo' as const, title: 't', enabled }));

describe('nextEnabledIdx', () => {
  it('skips disabled and wraps forward', () => {
    expect(nextEnabledIdx(cards([true, false, true]), 0, 1)).toBe(2);
    expect(nextEnabledIdx(cards([true, false, true]), 2, 1)).toBe(0);
  });
  it('steps backward', () => {
    expect(nextEnabledIdx(cards([true, true, false]), 1, -1)).toBe(0);
  });
  it('returns from when nothing enabled', () => {
    expect(nextEnabledIdx(cards([false, false]), 1, 1)).toBe(1);
  });
});
```

- [ ] **Step 2: Rewrite `cards.ts`**

Drop the `countdownText` parameter, make the `default:` branch a logo fallback (no longer shared with a `countdown` case), and delete `remainingMs` + `fmtCountdown`:

```ts
import type { PreCard, Slide } from '../types';

const AMBER = '#e0a341';

export function preSlideFor(card: PreCard): Slide {
  switch (card.type) {
    case 'message':
      return { kind: 'title', accent: AMBER, title: card.headline || 'Welcome', subtitle: card.subtitle ?? '' };
    case 'verse':
      return { kind: 'scripture', accent: '#6f9cf0', ref: card.ref || '', label: card.ref || '', columns: [{ version: 'KJV', text: card.text || '' }] };
    case 'list':
      return { kind: 'title', accent: AMBER, title: card.title, points: card.points || [] };
    case 'image':
      return { kind: 'image', src: card.src || '' };
    case 'logo':
    default:
      return { kind: 'logo', title: 'HELM' };
  }
}

export function nextEnabledIdx(cards: PreCard[], from: number, dir: 1 | -1): number {
  const n = cards.length;
  if (n === 0) return from;
  let i = from;
  for (let k = 0; k < n; k++) {
    i = (i + dir + n) % n;
    if (cards[i].enabled) return i;
  }
  return from;
}
```

- [ ] **Step 3: Edit `src/shared/types.ts`**

Make these exact removals:
- **SlideKind (line 14):** remove `'countdown'` → `| 'lyrics' | 'scripture' | 'quote' | 'title' | 'sermon'` / `| 'logo' | 'black' | 'blank' | 'reading' | 'image';`
- **Slide (line 21):** remove `message?: string; countdownText?: string;` → the line becomes `bg?: string; src?: string;` preceded by the `paras?`/`activeOrd?` line unchanged. Concretely, replace `message?: string; countdownText?: string; bg?: string; src?: string;` with `bg?: string; src?: string;`
- **PreCardType (line 25):** remove `'countdown' | ` → `export type PreCardType = 'message' | 'verse' | 'list' | 'logo' | 'image';`
- **PreState (lines 123-126):** remove `countdownText: string; paused: boolean;` →
  ```ts
  export interface PreState {
    engaged: boolean; loopOn: boolean; idx: number; dwellS: number; cards: PreCard[];
  }
  ```
- **CH (lines 80-81):** remove the three channels. `preserviceRemoveCard: 'preservice:removeCard', preserviceAddMinute: 'preservice:addMinute',` and `preserviceReset: 'preservice:reset', preserviceTogglePause: 'preservice:togglePause',` become just `preserviceRemoveCard: 'preservice:removeCard',`
- **HelmApi.preservice (line 195):** delete the line `addMinute(): void; resetCountdown(): void; togglePause(): void;`

*(No verification step here in isolation — whole-project typecheck goes green only after Task 5. Task 2's own unit test was verified in Step 1's rewrite; run it if desired: `npx vitest run src/shared/preservice/cards.test.ts`.)*

---

### Task 3: Engine

**Files:**
- Modify: `src/main/preserviceEngine.ts`
- Test: `src/main/preserviceEngine.test.ts`

**Interfaces:**
- Consumes: `preSlideFor(card)` (1-arg, from Task 2), `nextEnabledIdx`, `PreState` (no countdown fields).
- Produces: `PreserviceEngine` with `tick(): void` (no `nowMs` arg), no `addMinute`/`resetCountdown`/`togglePause`; `createPreserviceEngine(repo, sink)` (no `opts`).

- [ ] **Step 1: Rewrite `preserviceEngine.ts`**

```ts
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
    const lk = sink.liveKey();
    if (lk && !lk.startsWith('pre:')) { engaged = false; loopT = 0; stopTimer(); emit(); return; }
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
```

Note the deliberate removals vs. the original: `now`/`defaultDurationS`/`opts`, `paused`/`targetMs`/`pausedRemaining`, `curRemaining`/`countdownText`, `pushCue` (was only used by the removed countdown methods), `addMinute`/`resetCountdown`/`togglePause`, and the per-second re-cue in `tick`. The 1-second timer stays but only drives dwell rotation.

- [ ] **Step 2: Update `preserviceEngine.test.ts`**

The harness constructs the engine with countdown-only opts and several tests assert countdown behavior or the old seed order. Make these edits:

- **Harness line 32:** `const engine = createPreserviceEngine(repo, sink, { defaultDurationS: 600, nowFn: () => 0 });` → `const engine = createPreserviceEngine(repo, sink);`
- **`'engage goes live with the first enabled card'`:** `expect(calls[0].slide.kind).toBe('countdown');` → `expect(calls[0].slide.kind).toBe('title');` (first enabled card is now `message` → title slide).
- **`'rotates to the next enabled card after dwell seconds'`:** replace `for (let t = 1; t <= dwell; t++) engine.tick(t * 1000);` with `for (let t = 1; t <= dwell; t++) engine.tick();`. Change `expect(last.slide.kind).toBe('title');` → `expect(last.slide.kind).toBe('scripture');` and the comment `// Welcome card` → `// verse card`. (Seed is now `[message, verse, …]`; engage lands on `message`/title, rotates to `verse`/scripture.)
- **Delete the `'countdown text counts down on same-flow cue'` test** (was lines 61-67) entirely.
- **`'yields when another flow takes the screen'`:** `engine.tick(1000);` → `engine.tick();`
- **Delete the `'addMinute and reset adjust the countdown target'` test** (was lines 75-84) entirely.
- **`'re-engaging after disengage keeps the output live'`:** `engine.tick(1000);` → `engine.tick();`
- **`'rotating with only one enabled card never flips output to black'`:** change the comment `// seeded countdown card, enabled` → `// first seeded card (message), enabled`, and replace `engine.tick(t * 1000);` → `engine.tick();`.

- [ ] **Step 3: Run the engine tests**

```
npx vitest run src/main/preserviceEngine.test.ts
```
Expected: PASS. *(Requires `npm rebuild better-sqlite3` already done in Task 1.)*

---

### Task 4: IPC + preload + renderer hook default

**Files:**
- Modify: `src/main/ipc.ts:99-101`
- Modify: `src/preload/index.ts:73-75`
- Modify: `src/renderer/operator/useHelm.ts:15`

**Interfaces:**
- Consumes: `PreserviceEngine` (Task 3, no countdown methods), `CH` (Task 2, no countdown channels), `PreState` (Task 2).

- [ ] **Step 1: `src/main/ipc.ts`** — delete the three handler lines (99-101):
```ts
  ipcMain.on(CH.preserviceAddMinute, () => preserviceEngine.addMinute());
  ipcMain.on(CH.preserviceReset, () => preserviceEngine.resetCountdown());
  ipcMain.on(CH.preserviceTogglePause, () => preserviceEngine.togglePause());
```
The handler above them (`preserviceRemoveCard`, line 98) stays.

- [ ] **Step 2: `src/preload/index.ts`** — delete the three bindings (73-75):
```ts
    addMinute: () => ipcRenderer.send(CH.preserviceAddMinute),
    resetCountdown: () => ipcRenderer.send(CH.preserviceReset),
    togglePause: () => ipcRenderer.send(CH.preserviceTogglePause),
```
Ensure the preceding `removeCard` line keeps its trailing comma and the object closes cleanly.

- [ ] **Step 3: `src/renderer/operator/useHelm.ts:15`** — drop the countdown fields from the default `PreState`:
```ts
  const [s, setS] = useState<PreState>({ engaged: false, loopOn: true, idx: 0, dwellS: 12, cards: [] });
```

---

### Task 5: Renderer — SlideCanvas + PreServiceMode

**Files:**
- Modify: `src/renderer/shared/SlideCanvas.tsx`
- Test: `src/renderer/shared/SlideCanvas.sanity.test.tsx`
- Modify: `src/renderer/operator/PreServiceMode.tsx`
- Test: `src/renderer/operator/PreServiceMode.test.tsx`

**Interfaces:**
- Consumes: `Slide` (no `message`/`countdownText`), `preSlideFor(card)` (1-arg), `PreState` (no countdown fields), `PreCardType` (no `countdown`).
- Note: `PreCardEditor.tsx` needs **no change** — its type picker already offers only `verse`/`list`/`message`, and `asEditableType(t)` falls back to `verse` for anything else, which stays valid after `countdown` leaves `PreCardType`.

- [ ] **Step 1: `SlideCanvas.tsx` — remove the countdown render path**

Make these edits (line numbers are pre-edit references):
- **Background (line 29):** delete `if (kind === 'countdown') bg = 'radial-gradient(135% 135% at 50% 32%, #1d2330 0%, #07080b 74%)';` and promote the following `else if` to lead the chain:
  ```ts
    if (kind === 'quote') bg = 'radial-gradient(135% 135% at 50% 0%, #1c1925 0%, #08070b 72%)';
    else if (kind === 'title' || kind === 'sermon')
      bg = 'radial-gradient(140% 130% at 0% 0%, #20283a 0%, #08090d 70%)';
    else bg = 'radial-gradient(135% 125% at 50% -10%, #181d28 0%, #08090c 74%)';
  ```
- **Styles (lines 185-199):** delete the `countdownStyle` and `countdownMsgStyle` const blocks entirely.
- **showLabel (line 260):** remove `&& kind !== 'countdown'` → `(isStage || isMain) && !!s.label && kind !== 'blank' && kind !== 'logo' && kind !== 'black';`
- **isCountdown (line 338):** delete the line `const isCountdown = active && kind === 'countdown';`
- **isLowerThird (line 343):** remove `&& kind !== 'countdown'` → `const isLowerThird = isLT && kind !== 'blank' && kind !== 'black' && kind !== 'logo';`
- **Derived text (lines 349-350):** delete both `const countdownText = s.countdownText || '10:00';` and `const messageText = s.message || 'Service begins in';`
- **Render branch (lines 405-410):** delete the entire `{isCountdown && ( … )}` block.

- [ ] **Step 2: `SlideCanvas.sanity.test.tsx`** — delete the countdown test (lines 22-26):
```ts
test('countdown renders message and countdown text', () => {
  const { container } = render(<SlideCanvas slide={{ kind: 'countdown', countdownText: '05:00' }} />);
  expect(container.textContent).toContain('05:00');
  expect(container.textContent).toContain('Service begins in');
});
```

- [ ] **Step 3: `PreServiceMode.tsx` — remove countdown snippet, controls, and derivations**

- **`snippetFor` (lines 25-38):** drop the `countdownText` param and the `countdown` case:
  ```tsx
  /** Port of the prototype's per-row snippet logic (Lectern.dc.html ~L1023–1027). */
  function snippetFor(card: PreCard): string {
    switch (card.type) {
      case 'message':
        return (card.headline || 'Welcome') + (card.subtitle ? ` — ${card.subtitle}` : '');
      case 'verse':
        return card.text || '';
      case 'list':
        return (card.points || []).join('  ·  ');
      default:
        return 'Church logo on a dark screen';
    }
  }
  ```
- **Destructure (line 47):** `const { engaged, dwellS, idx, countdownText, paused, cards } = usePreState();` → `const { engaged, dwellS, idx, cards } = usePreState();`
- **isCountdown (line 54):** delete `const isCountdown = current?.type === 'countdown';`
- **cardForSlide (line 165):** `const cardForSlide: PreCard = current ?? { id: '', type: 'countdown', title: '', enabled: true };` → `const cardForSlide: PreCard = current ?? { id: '', type: 'logo', title: '', enabled: true };`
- **canEdit (line 182):** `const canEdit = card.type !== 'countdown' && card.type !== 'logo';` → `const canEdit = card.type !== 'logo';`
- **Snippet call (line 273):** `<div style={snippetStyle}>{snippetFor(card, countdownText)}</div>` → `<div style={snippetStyle}>{snippetFor(card)}</div>`
- **Preview call (line 302):** `<SlideCanvas slide={preSlideFor(cardForSlide, countdownText)} fill />` → `<SlideCanvas slide={preSlideFor(cardForSlide)} fill />`
- **Controls (lines 327-340):** delete the entire `{isCountdown && ( … )}` block containing the `+1 min` / `▶ Resume`/`❚❚ Pause` / `Reset` buttons.

- [ ] **Step 4: `PreServiceMode.test.tsx` — fix fixture + stub**

- **`cards` fixture (lines 14-17):** replace the countdown first card with a message card:
  ```tsx
  const cards: PreCard[] = [
    { id: 'a', type: 'message', title: 'Welcome', headline: 'Welcome', enabled: true },
    { id: 'b', type: 'verse', title: 'Psalm 122:1', ref: 'Psalm 122:1', text: 'I was glad…', enabled: true }
  ]
  ```
- **`baseState` (lines 19-27):** remove `countdownText: '10:00',` and `paused: false,` →
  ```tsx
  const baseState: PreState = {
    engaged: false,
    loopOn: true,
    idx: 0,
    dwellS: 12,
    cards
  }
  ```
- **`installHelmStub` (lines 44-46):** delete `addMinute: vi.fn(),`, `resetCountdown: vi.fn(),`, and `togglePause: vi.fn()` (and ensure the property before them — `removeCard: vi.fn()` — has no dangling trailing comma issue; leave `removeCard: vi.fn()` as the last entry).
- **`'renders the seeded card titles from getState'`:** change `expect(await screen.findByText('Countdown')).toBeTruthy()` → `expect(await screen.findByText('Welcome')).toBeTruthy()`. (The `'clicking a card row'` test clicks `Psalm 122:1` at index 1 — still valid.)

- [ ] **Step 5: Run the renderer tests**

```
npx vitest run src/renderer/shared/SlideCanvas.sanity.test.tsx src/renderer/operator/PreServiceMode.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Confirm no stray countdown references remain in `src/`**

```
grep -rn "countdown\|countdownText\|addMinute\|resetCountdown\|togglePause\|preserviceAddMinute\|preserviceReset\|preserviceTogglePause\|\.paused\b" src
```
Expected: **no matches**. Investigate and remove any that appear.

---

### Task 6: README + full gate + commit

**Files:**
- Modify: `README.md`
- Modify: `.superpowers/sdd/progress.md` (gitignored — do not `git add`)

- [ ] **Step 1: Update the README intro (line 3-4)**

Replace the stale parenthetical (which wrongly calls both sermon quotes *and* the pre-service loop "planned but not yet built" — both now ship):

Find:
```
songs and scripture (sermon quotes and a pre-service loop are planned but not yet built) —
```
Replace with:
```
songs, scripture, sermon quotes, and a rotating pre-service loop —
```

- [ ] **Step 2: Update the README Status paragraph (lines 12-19)**

Add slice 5 to the enumeration and rewrite the final deferral sentence so the pre-service loop reads as built (rotating welcome / verse / announcements / prayer / logo cards on a dwell timer, **no countdown**), leaving multi-display roles deferred:

Find `and slice 4 (the Message track)` → replace with `slice 4 (the Message track), and slice 5 (the pre-service loop)`.

Find:
```
follow-along reading view. The pre-service loop and multi-display roles are deferred to
later slices (spec §11).
```
Replace with:
```
follow-along reading view. Slice 5 adds the pre-service loop — a rotating welcome / verse /
announcements / prayer / logo card set on a dwell timer, engaged and taken live from the
operator's Pre-Service tab. Multi-display roles remain deferred to later slices (spec §11).
```

- [ ] **Step 3: Run the full gate**

```
npm run typecheck
npm rebuild better-sqlite3   # if not already rebuilt this session
npm test
npm run postinstall          # restore Electron ABI — leave it restored
npx eslint .
```
Expected: typecheck clean; `npm test` all pass; eslint **0 errors** (prettier warnings OK). If any fails, fix before committing. Confirm `npm run postinstall` ran last so the app can launch.

- [ ] **Step 4: Commit everything as one atomic change**

```bash
git add -A
git status   # confirm .superpowers/ is NOT staged (gitignored); README + src staged
git commit -m "$(cat <<'EOF'
feat(preservice): remove live countdown card, controls, and engine clock

Fully remove the pre-service "Service begins in M:SS" countdown from the
type system down: the countdown card type + slide kind, the engine
target-timestamp clock and +1min/Pause/Reset methods, their IPC channels
and preload bindings, and the SlideCanvas countdown render. Add a one-time
wipe-and-reseed migration to preCardsRepo so installed DBs drop the
auto-seeded countdown card. The rotating loop (welcome/verse/announcements/
prayer/logo on the dwell timer) is unchanged. README brought current.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Append the progress-log entry** (edit `.superpowers/sdd/progress.md`, do not `git add`)

Add one line under the appropriate section, matching the existing style, e.g.:
```
Countdown removal: complete (commit <sha>, gate green: typecheck clean, all tests pass, lint 0 errors). Removed pre-service live countdown end-to-end (type system, engine clock, +1min/Pause/Reset + IPC/preload, SlideCanvas render); added wipe-and-reseed migration for installed DBs (seed now message/verse/list/list/logo). Slide.message + countdownText confirmed countdown-only and removed. Drops the Slice 5b absolute-countdown-target roadmap item.
```

---

## Self-Review

**Spec coverage** (against §4 of the design):
- §4.1 Types — Task 2 Step 3 (SlideKind, Slide.message+countdownText, PreCardType, PreState, CH ×3, HelmApi ×3). ✅ `Slide.message` verified countdown-only before removal.
- §4.2 Shared logic — Task 2 Steps 1-2 (preSlideFor 1-arg, logo default, delete remainingMs/fmtCountdown). ✅
- §4.3 Engine — Task 3 (state/methods/tick/timer, drop nowFn/defaultDurationS/pushCue). ✅
- §4.4 Repo + migration — Task 1 (SEED, wipe-before-count==0-guard). ✅ Ordering verified.
- §4.5 IPC + preload — Task 4 Steps 1-2. ✅
- §4.6 Renderer — Task 5 (SlideCanvas + PreServiceMode; PreCardEditor confirmed no-change). ✅ Plus `useHelm.ts` default state (Task 4 Step 3) — not in §4.6 but forced by the `PreState` change.
- §4.7 Tests — all four test files (Tasks 1,2,3,5) + the extra `PreServiceMode.test` stub/fixture. ✅
- §5 Testing strategy (migration: countdown-bearing→cleaned, fresh→countdown-free, countdown-free-populated→untouched) — Task 1 Step 1. ✅
- README (task instruction, not in spec §4) — Task 6 Steps 1-2. ✅

**Type consistency:** `preSlideFor(card)` is 1-arg everywhere (cards.ts, engine slideFor, PreServiceMode ×2). `PreState` = `{engaged,loopOn,idx,dwellS,cards}` in types.ts, useHelm default, engine state(), and test fixtures. `tick()` is 0-arg in the engine interface, impl, timer, and every test call. Seed `['message','verse','list','list','logo']` (len 5) is consistent across repo, repo tests, and engine-test seed-order assertions. No dangling references to removed symbols (Task 5 Step 6 greps to prove it).

**Placeholder scan:** every code step shows complete code or an exact find/replace with surrounding context; no TBD/TODO/"handle edge cases".
