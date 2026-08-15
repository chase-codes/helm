# Double-Click To Go Live — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-clicking any card on any of the eight operator surfaces puts it on screen, and double-clicking a card that is already live does nothing.

**Architecture:** A new presentation verb, `takeLive`, is added to `src/shared/presentation/core.ts` and exposed as `window.helm.presentation.take(key, slide)`. It is `goLive` minus the toggle-to-black branch, so the "never black the projector" guarantee is decided once in the main process rather than re-proved on each surface. Each presentational rail then gains an `onActivate` prop mirroring its existing `onSelect`, wired to `onDoubleClick`; the owning mode decides what to take.

**Tech Stack:** Electron + React 18 + TypeScript, Vitest + React Testing Library (jsdom), `vi.fn()` stubs on `window.helm`.

**Spec:** `docs/superpowers/specs/2026-08-14-double-click-go-live-design.md`

## Global Constraints

- Commit messages: concise conventional-commit subject (`feat(songs): …`). No `Co-Authored-By` or `Claude-Session` trailers. Body only when it genuinely adds clarity.
- Never call `window.helm.presentation.goLive` from a double-click path. `goLive` blacks the output on the already-live key (`src/shared/presentation/core.ts:51`). Double-click paths use `take` exclusively.
- Single-click behavior must be unchanged on every surface, including `ChapterRail`'s shift-click range building.
- Existing hand-rolled guards — `SermonMode.goLiveFromBuilder`, `SongsMode.jumpSection`, `preserviceEngine.pushLive` — are **not** to be converted to the new verb. Out of scope; converting them changes their fetch/IPC behavior.
- Every rail row that gains a double-click handler also gains `userSelect: 'none'` in its row style (Task 10 sweeps for any missed).
- Run `npm run typecheck` before each commit. Run `npm test` before each commit.

---

### Task 1: The `takeLive` verb and its IPC plumbing

**Files:**
- Modify: `src/shared/presentation/core.ts`
- Modify: `src/shared/presentation/core.test.ts`
- Modify: `src/shared/types.ts` (the `CH` block ~line 173; `HelmApi.presentation` ~line 272)
- Modify: `src/preload/index.ts:17-24`
- Modify: `src/main/ipc.ts:66`
- Modify: `src/main/stateStore.ts:24-29`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `takeLive(st: PresentationState, key: string, slide: Slide): PresentationState` from `src/shared/presentation/core.ts`
  - `CH.presTake === 'presentation:take'`
  - `window.helm.presentation.take(key: string, slide: Slide): void` — every later task calls this and nothing else.

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/presentation/core.test.ts` (it already imports from `./core` and has a local `slide()` helper — reuse them, and add `takeLive` to the existing import list):

```ts
test('takeLive takes the screen from black', () => {
  const st = takeLive(initialPresentation(), 'song:a:0', slide('V1'))
  expect(st.output).toBe('live')
  expect(st.liveKey).toBe('song:a:0')
  expect(st.cuedKey).toBe('song:a:0')
})

test('takeLive on the already-live key is a no-op, never a take-down', () => {
  const live = takeLive(initialPresentation(), 'song:a:0', slide('V1'))
  const again = takeLive(live, 'song:a:0', slide('V1'))
  expect(again.output).toBe('live')
  expect(again).toBe(live) // identity, so stateStore can skip the broadcast
})

test('takeLive crosses kinds — a card takes the screen from another flow', () => {
  const live = takeLive(initialPresentation(), 'song:a:0', slide('V1'))
  const st = takeLive(live, 'scr:Genesis:1:1', slide('In the beginning'))
  expect(st.liveKey).toBe('scr:Genesis:1:1')
})

test('takeLive takes the screen back from black on the same key', () => {
  const live = takeLive(initialPresentation(), 'song:a:0', slide('V1'))
  const blacked = setOutput(live, 'black')
  const st = takeLive(blacked, 'song:a:0', slide('V1'))
  expect(st.output).toBe('live')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/presentation/core.test.ts`
Expected: FAIL — `takeLive is not a function` / `No test found` style error at import.

- [ ] **Step 3: Add the verb**

In `src/shared/presentation/core.ts`, immediately after `goLive` (line 53), add:

```ts
/** Double-click's route to the screen: deliberate takeover that is IDEMPOTENT. `goLive`
 * minus the toggle branch — the fourth and last verb in this file's vocabulary, which now
 * reads: `applyCue` never touches the screen, `showLive` follows but never starts,
 * `takeLive` starts but never stops, `goLive` (the button) does both.
 *
 * Double-clicking a card must mean "put this on screen" and nothing else. Routed through
 * `goLive`, an impatient extra click on the card already showing would black the
 * projector — the operator's most destructive accident (#58).
 *
 * Returns `st` BY IDENTITY when the key is already live, so `stateStore.take` can skip the
 * broadcast: every broadcast re-sends `outputSlide` to every output window, and a no-op
 * double-click on a live deck slide must not re-push a `{kind:'video'}` payload at a
 * <video> element that is mid-playback. */
export function takeLive(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output === 'live' && st.liveKey === key) return st
  return { ...st, output: 'live', liveKey: key, liveSnap: slide, cuedKey: key, cuedSnap: slide }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/presentation/core.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the IPC channel**

In `src/shared/types.ts`, in the `CH` block, change the `presGoLive` line to include the new channel:

```ts
  presGoLive: 'presentation:goLive', presShow: 'presentation:show',
  presTake: 'presentation:take',
```

In the same file, in `HelmApi.presentation`, add `take` directly after `show`:

```ts
    show(key: string, slide: Slide): void;
    /** Idempotent take-the-screen (double-click). Never blacks the output — see takeLive. */
    take(key: string, slide: Slide): void;
```

- [ ] **Step 6: Wire preload, ipc, and the store**

In `src/preload/index.ts`, after the `show:` line in `presentation`:

```ts
    take: (key, slide) => ipcRenderer.send(CH.presTake, key, slide),
```

In `src/main/ipc.ts`, after the `CH.presShow` line:

```ts
  ipcMain.on(CH.presTake, (_e, key: string, slide: Slide) => presentation.take(key, slide));
```

In `src/main/stateStore.ts`, add `takeLive` to the import from `../shared/presentation/core`, and add to the `presentation` object after `show`:

```ts
  // No broadcast when takeLive hands back the state it was given (already live on this
  // key): re-sending an identical outputSlide would disturb a playing video for nothing.
  take: (key: string, slide: Slide) => { const next = takeLive(state, key, slide); if (next === state) return; state = next; broadcast(); },
```

- [ ] **Step 7: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS both.

- [ ] **Step 8: Commit**

```bash
git add src/shared/presentation/core.ts src/shared/presentation/core.test.ts src/shared/types.ts src/preload/index.ts src/main/ipc.ts src/main/stateStore.ts
git commit -m "feat(presentation): add takeLive — idempotent take-the-screen verb"
```

---

### Task 2: ChapterRail verse rows (scripture)

**Files:**
- Modify: `src/renderer/operator/ChapterRail.tsx` (props ~line 16, row `<button>` ~line 210)
- Modify: `src/renderer/operator/ChapterRail.test.tsx`
- Modify: `src/renderer/operator/SermonMode.tsx` (near `goLiveWithChapter` ~line 435, `<ChapterRail>` render ~line 800)
- Modify: `src/renderer/operator/SermonMode.test.tsx`

**Interfaces:**
- Consumes: `window.helm.presentation.take` (Task 1).
- Produces: the `onActivate` prop convention every later rail task copies —
  `onActivate: (v: number, shift: boolean) => void` on `ChapterRailProps`.

- [ ] **Step 1: Write the failing rail test**

Append to `src/renderer/operator/ChapterRail.test.tsx` (`baseProps` at line ~25 needs `onActivate: vi.fn()` added alongside `onSelectVerse: vi.fn()`):

```ts
it('fires onActivate with the shift flag on double-click', () => {
  const onActivate = vi.fn()
  render(<ChapterRail {...baseProps} onActivate={onActivate} />)
  fireEvent.doubleClick(screen.getByText('Verse 3'), { shiftKey: true })
  expect(onActivate).toHaveBeenCalledWith(3, true)
})

it('leaves single-click reporting untouched', () => {
  const onSelectVerse = vi.fn()
  const onActivate = vi.fn()
  render(<ChapterRail {...baseProps} onSelectVerse={onSelectVerse} onActivate={onActivate} />)
  fireEvent.click(screen.getByText('Verse 3'))
  expect(onSelectVerse).toHaveBeenCalledWith(3, false)
  expect(onActivate).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/operator/ChapterRail.test.tsx`
Expected: FAIL — `onActivate` never called (no handler wired).

- [ ] **Step 3: Add the prop and the handler**

In `src/renderer/operator/ChapterRail.tsx`, add to `ChapterRailProps` after `onSelectVerse`:

```ts
  /** Double-click: put this verse on screen (#58). Reported separately from
   * `onSelectVerse` so the rail keeps deciding nothing — SermonMode reads it as an
   * idempotent take. The shift flag rides along because a shift-double-click must
   * build the same range a shift-click would before taking it. */
  onActivate: (v: number, shift: boolean) => void
```

Add `onActivate` to the destructured parameter list, then on the row `<button>` (line ~215):

```tsx
              onClick={(e) => onSelectVerse(v, e.shiftKey)}
              onDoubleClick={(e) => onActivate(v, e.shiftKey)}
```

And add `userSelect: 'none'` to `rowStyle`'s returned object (after `cursor: 'pointer'`).

- [ ] **Step 4: Run the rail test to verify it passes**

Run: `npx vitest run src/renderer/operator/ChapterRail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing SermonMode test**

In `src/renderer/operator/SermonMode.test.tsx`, add `take: vi.fn()` to the `presentation` stub inside `installHelmStub` and return it alongside `goLive`. Then add:

```tsx
describe('SermonMode — double-click a verse goes live (#58)', () => {
  it('takes the verse on double-click', async () => {
    const { resolveChapter, take } = installHelmStub(NOTHING_LIVE, [])
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    fireEvent.doubleClick(screen.getByText('Verse 2'))
    await waitFor(() => expect(take).toHaveBeenCalledWith('scr:Genesis:1:2', expect.anything()))
  })

  it('never blacks the screen when the verse is already live', async () => {
    const LIVE_1_1: PresentationState = {
      output: 'live', liveKey: 'scr:Genesis:1:1', liveSnap: null, cuedKey: null, cuedSnap: null
    }
    const { resolveChapter, take, goLive, setOutput } = installHelmStub(LIVE_1_1, [])
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    fireEvent.doubleClick(screen.getByText('Verse 1'))
    await waitFor(() => expect(take).toHaveBeenCalled())
    expect(goLive).not.toHaveBeenCalled()
    expect(setOutput).not.toHaveBeenCalledWith('black')
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx -t "double-click a verse"`
Expected: FAIL — `take` never called.

- [ ] **Step 7: Wire SermonMode**

In `src/renderer/operator/SermonMode.tsx`, add next to `goLiveWithChapter` (~line 448):

```ts
  // Double-click a verse card (#58). `take` is idempotent, so double-clicking the verse
  // already on screen is a no-op rather than the take-down `goLive` would perform. The
  // click that precedes it has already moved the cursor via `onSelectVerse`, so the rail,
  // the hero, and the projector agree by the time this fires.
  const takeVerseLive = (book: string, ch: number, v: number, c: ChapterData): void => {
    const cols = verseCols(c.verses[v] ?? {}, versions, abbrOf);
    const slide = buildScriptureSlide(
      formatRef({ book, ch, from: v, to: v }),
      cols.length ? cols : [{ version: '', text: INSTALL_HINT }]
    );
    window.helm.presentation.take(keyForScripture(book, ch, v), slide);
  };

  // A shift-double-click builds the range (both clicks run railSelect, which is idempotent
  // on a repeated shift-click) and then takes its START verse — the same single-verse slide
  // Shift+Enter produces via goLiveWithChapter, so the on-screen ref matches the hero.
  const activateVerse = (v: number, shift: boolean): void => {
    const book = previewBook, ch = previewCh;
    const target = shift ? Math.min(selectedRange?.from ?? v, v) : v;
    if (previewChapter && previewChapter.book === book && previewChapter.chapter === ch) {
      takeVerseLive(book, ch, target, previewChapter);
      return;
    }
    window.helm.bibles
      .getChapter(book, ch)
      .then((c) => takeVerseLive(book, ch, target, c))
      .catch(console.error);
  };
```

On the `<ChapterRail>` element, add `onActivate={activateVerse}`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx src/renderer/operator/ChapterRail.test.tsx`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/renderer/operator/ChapterRail.tsx src/renderer/operator/ChapterRail.test.tsx src/renderer/operator/SermonMode.tsx src/renderer/operator/SermonMode.test.tsx
git commit -m "feat(scripture): double-click a verse card to go live"
```

---

### Task 3: SectionRail song sections

**Files:**
- Modify: `src/renderer/operator/SectionRail.tsx` (props line 13-25, row `<button>` ~line 196)
- Modify: `src/renderer/operator/SongsMode.tsx` (near `jumpSection` ~line 460, `<SectionRail>` ~line 705)
- Modify: `src/renderer/operator/SongsMode.test.tsx`

**Interfaces:**
- Consumes: `window.helm.presentation.take` (Task 1); the `onActivate` convention (Task 2).
- Produces: `takeSectionLive(song: Song, idx: number): void` inside `SongsMode` — reused by Task 4.

- [ ] **Step 1: Write the failing test**

In `src/renderer/operator/SongsMode.test.tsx`, add `take: vi.fn()` to the `presentation` stub in `installHelmStubWith` and return it from the helper (alongside `goLive`). Then add:

```tsx
describe('double-click to go live (#58)', () => {
  it('takes a section on double-click', async () => {
    const { take } = installHelmStubWith([CHORUS_SONG], NOTHING_LIVE);
    renderMode({ current: null });
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.doubleClick(screen.getAllByText('Chorus')[0]);
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith('song:s2:1', expect.objectContaining({ kind: 'lyrics' }))
    );
  });

  it('never blacks the screen when that section is already live', async () => {
    const live: PresentationState = { output: 'live', liveKey: 'song:s2:0', liveSnap: null, cuedKey: null, cuedSnap: null };
    const { take, goLive, setOutput } = installHelmStubWith([CHORUS_SONG], live);
    renderMode({ current: null });
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.doubleClick(screen.getAllByText('Verse 1')[0]);
    await waitFor(() => expect(take).toHaveBeenCalledWith('song:s2:0', expect.anything()));
    expect(goLive).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalledWith('black');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx -t "double-click to go live"`
Expected: FAIL — `take` never called.

- [ ] **Step 3: Add the rail prop**

In `src/renderer/operator/SectionRail.tsx`, add to `SectionRailProps` after `onSelect`:

```ts
  /** Double-click: put this section on screen (#58), idempotently — see takeLive. */
  onActivate: (i: number) => void;
```

Destructure `onActivate`, then on the row `<button>` (~line 200):

```tsx
              onClick={() => onSelect(i)}
              onDoubleClick={() => onActivate(i)}
```

Add `userSelect: 'none'` to `secRowStyle`'s returned object.

- [ ] **Step 4: Wire SongsMode**

In `src/renderer/operator/SongsMode.tsx`, add after `jumpSection`:

```ts
  // Double-click a section card (#58). Unlike `jumpSection` — which only follows a
  // projector already showing THIS song — a double-click is a deliberate takeover and
  // starts projecting from black or from another flow. `take` is idempotent, so
  // double-clicking the section already on screen is a no-op, not a take-down.
  const takeSectionLive = (song: Song, idx: number): void => {
    const target = song.sections[idx];
    if (!target) return;
    setActiveSongId(song.id);
    setSection(idx);
    setArmedNextId(null);
    window.helm.presentation.take(keyForSong(song.id, idx), slideFor(song, target));
  };

  const activateSection = (i: number): void => {
    if (activeSong) takeSectionLive(activeSong, i);
  };
```

On the `<SectionRail>` element add `onActivate={activateSection}`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/renderer/operator/SectionRail.tsx src/renderer/operator/SongsMode.tsx src/renderer/operator/SongsMode.test.tsx
git commit -m "feat(songs): double-click a section card to go live"
```

---

### Task 4: SongSearchRail results

**Files:**
- Modify: `src/renderer/operator/SongSearchRail.tsx` (props ~line 22-38; both row maps ~line 194 and ~line 234)
- Modify: `src/renderer/operator/SongSearchRail.test.tsx`
- Modify: `src/renderer/operator/SongsMode.tsx` (`<SongSearchRail>` ~line 644)
- Modify: `src/renderer/operator/SongsMode.test.tsx`

**Interfaces:**
- Consumes: `takeSectionLive(song, idx)` (Task 3); `window.helm.presentation.take` (Task 1).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

`src/renderer/operator/SongSearchRail.test.tsx` has a module-level `baseProps` object and a `rows` fixture whose single row is `{ id: 's1', title: 'Amazing Grace' }`. Add `onActivate: vi.fn()` to `baseProps`, then append to the existing `describe('SongSearchRail')`:

```tsx
it('fires onActivate on double-click and leaves onSelect for single-click', () => {
  const onSelect = vi.fn()
  const onActivate = vi.fn()
  render(<SongSearchRail {...baseProps} onSelect={onSelect} onActivate={onActivate} />)
  const row = screen.getByText('Amazing Grace').closest('button') as HTMLButtonElement
  fireEvent.doubleClick(row)
  expect(onActivate).toHaveBeenCalledWith('s1')
  fireEvent.click(row)
  expect(onSelect).toHaveBeenCalledWith('s1')
})
```

In `src/renderer/operator/SongsMode.test.tsx`, inside the `describe('double-click to go live (#58)')` block from Task 3. `CHORUS_SONG` is `s2`; a live `s1` makes the double-clicked row a *different* song from the live one, which is exactly the case where `selectSong` would arm rather than take:

```tsx
it('takes a search result live at section 0 instead of arming it', async () => {
  const live: PresentationState = { output: 'live', liveKey: 'song:s1:0', liveSnap: null, cuedKey: null, cuedSnap: null };
  const { take } = installHelmStubWith([...SONGS, CHORUS_SONG], live);
  renderMode({ current: null });
  const row = (await screen.findAllByText('With Chorus'))[0];
  fireEvent.doubleClick(row);
  await waitFor(() => expect(take).toHaveBeenCalledWith('song:s2:0', expect.anything()));
  expect(screen.queryByText('NEXT')).toBeNull(); // took it, did not merely arm it
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/renderer/operator/SongSearchRail.test.tsx src/renderer/operator/SongsMode.test.tsx -t "onActivate"`
Expected: FAIL.

- [ ] **Step 3: Add the rail prop**

In `src/renderer/operator/SongSearchRail.tsx`, add to `SongSearchRailProps` after `onSelect`:

```ts
  /** Double-click: take this song live at section 0 (#58). Distinct from `onSelect`,
   * which arms rather than takes while another song holds the screen. */
  onActivate: (id: string) => void;
```

Destructure it, and add to **both** row `<button>`s (the primary `rows` map and the `secondaryRows` map):

```tsx
            onDoubleClick={() => onActivate(r.id)}
```

Add `userSelect: 'none'` to `rowStyle`'s returned object.

- [ ] **Step 4: Wire SongsMode**

In `src/renderer/operator/SongsMode.tsx`, add next to `selectSong`:

```ts
  // Double-click a search result (#58). `selectSong` ARMS when another song is live —
  // the operator's usual "queue this next" gesture. A double-click says take it now, so
  // it bypasses arming entirely and commits section 0. Resolves out of `library` (the
  // full Song list loaded at mount); the `songs.get` fallback covers a result whose song
  // is somehow not in it, so a double-click is never silently dropped.
  const activateSong = (id: string): void => {
    const known = library.find((s) => s.id === id);
    if (known) {
      takeSectionLive(known, 0);
      return;
    }
    void window.helm.songs
      .get(id)
      .then((s) => {
        if (s && mountedRef.current) takeSectionLive(s, 0);
      })
      .catch(console.error);
  };
```

On the `<SongSearchRail>` element add `onActivate={activateSong}`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SongSearchRail.test.tsx src/renderer/operator/SongsMode.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/renderer/operator/SongSearchRail.tsx src/renderer/operator/SongSearchRail.test.tsx src/renderer/operator/SongsMode.tsx src/renderer/operator/SongsMode.test.tsx
git commit -m "feat(songs): double-click a search result to take it live"
```

---

### Task 5: ParagraphRail message paragraphs

**Files:**
- Modify: `src/renderer/operator/ParagraphRail.tsx` (props line 5-16, row `<button>` line 111)
- Modify: `src/renderer/operator/MessageMode.tsx` (near `goLive` ~line 228, `<ParagraphRail>` render)
- Modify: `src/renderer/operator/SermonMode.test.tsx`

There is no `MessageMode.test.tsx` — the message track is covered through `SermonMode.test.tsx`, which mounts it via `clickTab('Message')` and feeds it the `TAPE` fixture (`src/renderer/operator/SermonMode.test.tsx:914` — id `m1`, paragraphs at ords 0/1/2 labelled `1`/`2`/`3`, texts `First paragraph` / `Second paragraph` / `Third paragraph`). Add the test there.

**Interfaces:**
- Consumes: `window.helm.presentation.take` (Task 1); the `onActivate` convention (Task 2).
- Produces: `takeParagraphLive(msg: Message, ord: number): void` inside `MessageMode` — reused by Task 6.

- [ ] **Step 1: Write the failing test**

`installHelmStub` in `SermonMode.test.tsx` must already have `take: vi.fn()` added to its `presentation` stub and returned (done in Task 2). Add:

```tsx
it('double-clicking a paragraph takes it live', async () => {
  const { resolveChapter, take } = installHelmStub(NOTHING_LIVE, [], { tape: TAPE })
  render(<Harness />)
  resolveChapter()
  await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
  clickTab('Message')
  await waitFor(() => expect(screen.getByText('Second paragraph')).toBeTruthy())
  fireEvent.doubleClick(screen.getByText('Second paragraph'))
  await waitFor(() => expect(take).toHaveBeenCalledWith('msg:m1:1', expect.anything()))
})
```

If `keyForMessageQuote` does not produce `msg:m1:1`, read `src/shared/message/slides.ts:5` and use its actual format — do not change the key format to match the test.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx -t "paragraph takes it live"`
Expected: FAIL — `take` never called.

- [ ] **Step 3: Add the rail prop**

In `src/renderer/operator/ParagraphRail.tsx`, add to `ParagraphRailProps` after `onSelect`:

```ts
  /** Double-click: put this paragraph's quote on screen (#58), idempotently. */
  onActivate: (ord: number) => void;
```

Destructure it, then on the row `<button>` (line 111):

```tsx
            <button key={p.ord} style={rowStyle(live, cued, planned)} onClick={() => onSelect(p.ord)} onDoubleClick={() => onActivate(p.ord)}>
```

Add `userSelect: 'none'` to `rowStyle`'s returned object.

- [ ] **Step 4: Wire MessageMode**

In `src/renderer/operator/MessageMode.tsx`, add after `goLive`:

```ts
  // Double-click a paragraph card (#58). Takes the quote slide — the same slide `goLive`
  // builds — but idempotently, so a double-click on the paragraph already on screen is a
  // no-op rather than the take-down `goLive` would perform.
  const takeParagraphLive = (m: Message, ord: number): void => {
    window.helm.presentation.take(keyForMessageQuote(m.id, ord), buildQuoteSlide(m, ord));
  };

  const activateParagraph = (ord: number): void => {
    if (!liveMsg) return;
    setMsgIdx(ord);
    takeParagraphLive(liveMsg, ord);
  };
```

On the `<ParagraphRail>` element add `onActivate={activateParagraph}`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/renderer/operator/ParagraphRail.tsx src/renderer/operator/MessageMode.tsx src/renderer/operator/SermonMode.test.tsx
git commit -m "feat(message): double-click a paragraph card to go live"
```

---

### Task 6: MessageSearchRail tape, quote, and schedule rows

**Files:**
- Modify: `src/renderer/operator/MessageSearchRail.tsx` (row types lines 5-23; row `<button>`s lines 168, 182, 196)
- Modify: `src/renderer/operator/MessageMode.tsx` (row builders lines 345-368)
- Create: `src/renderer/operator/MessageSearchRail.test.tsx`
- Modify: `src/renderer/operator/SermonMode.test.tsx`

**Interfaces:**
- Consumes: `takeParagraphLive(msg, ord)` (Task 5).
- Produces: nothing later tasks depend on.

The row types here already carry their own `onClick: () => void`, so the double-click handler rides along the same way rather than as a separate rail-level prop.

Coverage is split deliberately. `MessageSearchRail` has no test file, and its quote/tape rows only render behind a live search — `installHelmStub` in `SermonMode.test.tsx` has no `message.search` stub. So: a new presentational test covers all three row kinds directly, and one integration test covers the schedule row, which renders in the idle view with no search needed.

- [ ] **Step 1: Write the failing presentational test**

Create `src/renderer/operator/MessageSearchRail.test.tsx`, modelled on `SongSearchRail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageSearchRail } from './MessageSearchRail'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

const baseProps = {
  theme: themeFor('classic', 'dark'),
  q: '',
  onQChange: vi.fn(),
  scopeLabel: null,
  onClearScope: vi.fn(),
  tapeRows: [],
  quoteRows: [],
  scheduleRows: [],
  tapePlayer: null
}

describe('MessageSearchRail — double-click to go live (#58)', () => {
  it('fires onDoubleClick on a tape row', () => {
    const onDoubleClick = vi.fn()
    const tapeRows = [{ id: 'm1', title: 'Faith', meta: 'Tape 47-0412', onClick: vi.fn(), onDoubleClick }]
    render(<MessageSearchRail {...baseProps} q="faith" tapeRows={tapeRows} />)
    fireEvent.doubleClick(screen.getByText('Faith').closest('button') as HTMLButtonElement)
    expect(onDoubleClick).toHaveBeenCalled()
  })

  it('fires onDoubleClick on a quote row', () => {
    const onDoubleClick = vi.fn()
    const quoteRows = [{ id: 'm1:1', title: '¶2', preview: 'Second paragraph', onClick: vi.fn(), onDoubleClick }]
    render(<MessageSearchRail {...baseProps} q="faith" quoteRows={quoteRows} />)
    fireEvent.doubleClick(screen.getByText('¶2').closest('button') as HTMLButtonElement)
    expect(onDoubleClick).toHaveBeenCalled()
  })

  it('fires onDoubleClick on a schedule row', () => {
    const onDoubleClick = vi.fn()
    const scheduleRows = [{ id: 'q1', title: 'Faith', meta: '¶2 · Tape 47-0412', isCurrent: false, onClick: vi.fn(), onDoubleClick }]
    render(<MessageSearchRail {...baseProps} scheduleRows={scheduleRows} />)
    fireEvent.doubleClick(screen.getByText('Faith').closest('button') as HTMLButtonElement)
    expect(onDoubleClick).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Write the failing integration test**

In `src/renderer/operator/SermonMode.test.tsx`, extend `installHelmStub`'s options to `{ media?: MediaItem[]; tape?: Message; quoteSchedule?: QuoteScheduleItem[] }` and change the `quoteSchedule` stub from `list: () => Promise.resolve([])` to `list: () => Promise.resolve(opts.quoteSchedule ?? [])`. Then:

```tsx
it('double-clicking a quote-schedule row takes that quote live', async () => {
  const QS: QuoteScheduleItem[] = [
    { id: 'q1', msgId: 'm1', ord: 1, label: '2', tapeNo: '47-0412', title: 'Faith Is The Substance' }
  ]
  const { resolveChapter, take } = installHelmStub(NOTHING_LIVE, [], { tape: TAPE, quoteSchedule: QS })
  render(<Harness />)
  resolveChapter()
  await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
  clickTab('Message')
  const row = await screen.findByText('¶2 · Tape 47-0412')
  fireEvent.doubleClick(row.closest('button') as HTMLButtonElement)
  await waitFor(() => expect(take).toHaveBeenCalledWith('msg:m1:1', expect.anything()))
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/renderer/operator/MessageSearchRail.test.tsx src/renderer/operator/SermonMode.test.tsx -t "#58"`
Expected: FAIL — the row types have no `onDoubleClick`.

- [ ] **Step 4: Add `onDoubleClick` to the row types**

In `src/renderer/operator/MessageSearchRail.tsx`, add to each of `MsgScheduleRow`, `MsgTapeRow`, and `MsgQuoteRow`:

```ts
  /** Double-click: take this row's quote live (#58). */
  onDoubleClick: () => void;
```

Then on each of the three row `<button>`s (lines 168, 182, 196) add:

```tsx
                onDoubleClick={r.onDoubleClick}
```

(the tape map's variable is `t`, so use `onDoubleClick={t.onDoubleClick}` there).

Add `userSelect: 'none'` to `tapeRowStyle`, `quoteRowStyle`, and `scheduleRowStyle`.

- [ ] **Step 5: Wire the row builders**

In `src/renderer/operator/MessageMode.tsx`, add above the row builders:

```ts
  // Double-click a search/schedule row (#58). The row may name a tape other than the one
  // loaded in `liveMsg`, and paragraphs only arrive with the message — so resolve it
  // first, then take. Reuses the already-loaded message when the ids match to spare the
  // round trip. `mountedRef` is not available here; `msgIdRef`-free correctness comes from
  // taking the slide built off the RESOLVED message, which cannot be the wrong tape.
  const activateQuote = (id: string, ord: number): void => {
    selectQuote(id, ord);
    if (liveMsg && liveMsg.id === id) {
      takeParagraphLive(liveMsg, ord);
      return;
    }
    void window.helm.message
      .get(id)
      .then((m) => {
        if (m) takeParagraphLive(m, ord);
      })
      .catch(console.error);
  };
```

Then add `onDoubleClick` to each row builder:

- `tapeRows`: `onDoubleClick: () => { scopeToTape(t.id); activateQuote(t.id, 0); }`
- `quoteRows`: `onDoubleClick: () => activateQuote(r.msgId, r.ord)`
- `scheduleRows`: `onDoubleClick: () => activateQuote(it.msgId, it.ord)`

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/operator/MessageSearchRail.test.tsx src/renderer/operator/SermonMode.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/renderer/operator/MessageSearchRail.tsx src/renderer/operator/MessageSearchRail.test.tsx src/renderer/operator/MessageMode.tsx src/renderer/operator/SermonMode.test.tsx
git commit -m "feat(message): double-click a tape, quote, or schedule row to go live"
```

---

### Task 7: SlidesTrack media rows and deck slide rows

**Files:**
- Modify: `src/renderer/operator/SlidesTrack.tsx` (`goLive` ~line 251; media row ~line 551; deck row ~line 612)
- Modify: `src/renderer/operator/SlidesTrack.test.tsx`

**Interfaces:**
- Consumes: `window.helm.presentation.take` (Task 1).
- Produces: nothing later tasks depend on.

Both rows live inside `SlidesTrack` itself (no separate presentational rail), so there is no `onActivate` prop here — the handlers go straight on the buttons.

- [ ] **Step 1: Make the stub able to express a live state**

`src/renderer/operator/SlidesTrack.test.tsx` has `baseHelm()` (line ~36) with a hardcoded black `state`, `makeHelm()`, and `installHelmStub()` returning `{ goLive, cue }`. Its `items` fixture is `deck1` (`▤ Sermon.pptx`, 2 slides), `img1` (`▣ Welcome.jpg`), `vid1` (`Promo.mp4`). Rendering is via `renderTrack()`.

Give `baseHelm` and `installHelmStub` an optional presentation state and add `take` and `setOutput` to what the stub returns:

```tsx
function baseHelm(pres?: PresentationState): StubHelm {
  const state: PresentationState = pres ?? { output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null }
  // …unchanged body, plus `take: vi.fn(),` in the presentation object…
}
```

Add `take: ReturnType<typeof vi.fn>` to the `StubHelm['presentation']` type, thread the optional `pres` through `makeHelm(pres?)`, and return `{ goLive: helm.presentation.goLive, cue: helm.presentation.cue, take: helm.presentation.take, setOutput: helm.presentation.setOutput }` from `installHelmStub(pres?)`.

- [ ] **Step 2: Write the failing tests**

```tsx
describe('SlidesTrack — double-click to go live (#58)', () => {
  it('double-clicking a media row takes its first slide live', async () => {
    const { take } = installHelmStub()
    renderTrack()
    fireEvent.doubleClick((await screen.findByText('▤ Sermon.pptx')).closest('button') as HTMLButtonElement)
    await waitFor(() => expect(take).toHaveBeenCalledWith('pres:deck1:0', expect.anything()))
  })

  it('double-clicking a deck slide row takes that slide live', async () => {
    const { take } = installHelmStub()
    renderTrack()
    fireEvent.click((await screen.findByText('▤ Sermon.pptx')).closest('button') as HTMLButtonElement)
    fireEvent.doubleClick((await screen.findByText('2')).closest('button') as HTMLButtonElement)
    await waitFor(() => expect(take).toHaveBeenCalledWith('pres:deck1:1', expect.anything()))
  })

  it('never blacks the screen when that slide is already live', async () => {
    const live: PresentationState = { output: 'live', liveKey: 'pres:deck1:0', liveSnap: null, cuedKey: null, cuedSnap: null }
    const { take, goLive, setOutput } = installHelmStub(live)
    renderTrack()
    fireEvent.doubleClick((await screen.findByText('▤ Sermon.pptx')).closest('button') as HTMLButtonElement)
    await waitFor(() => expect(take).toHaveBeenCalledWith('pres:deck1:0', expect.anything()))
    expect(goLive).not.toHaveBeenCalled()
    expect(setOutput).not.toHaveBeenCalledWith('black')
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/renderer/operator/SlidesTrack.test.tsx -t "#58"`
Expected: FAIL.

- [ ] **Step 4: Add the take path**

In `src/renderer/operator/SlidesTrack.tsx`, add after `goLive`:

```ts
  // Double-click a library row or a deck slide (#58). Idempotent, so a double-click on the
  // slide already showing is a no-op — which also means `takeLive` returns the state
  // unchanged and the store skips the broadcast, so a playing video is never re-pushed.
  //
  // Mirrors goLive's video rule: a video lands PAUSED, never auto-playing audio into the
  // room. Skipped when this key is already live, exactly as goLive skips it for a takedown.
  const takeSlideLive = (item: MediaItem, idx: number): void => {
    const itemSlides = slidesOf(item);
    const sl = itemSlides[idx];
    if (!sl) return;
    const key = keyForMedia(item.id, idx);
    const alreadyLive = output === 'live' && liveKey === key;
    if (item.type === 'video' && !alreadyLive) {
      if (vstate.key !== key) window.helm.video.load(key, sl.src ?? '');
      window.helm.video.pause();
    }
    window.helm.presentation.take(key, sl);
  };
```

On the media row `<button>` (~line 551):

```tsx
              onDoubleClick={() => { selectItem(item); takeSlideLive(item, 0); }}
```

On the deck slide row `<button>` (~line 612):

```tsx
                <button key={i} style={deckRowStyle} onClick={() => setSlideIdx(i)} onDoubleClick={() => { setSlideIdx(i); takeSlideLive(selected, i); }}>
```

Add `userSelect: 'none'` to `rowStyle` and `deckRowStyle`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SlidesTrack.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/renderer/operator/SlidesTrack.tsx src/renderer/operator/SlidesTrack.test.tsx
git commit -m "feat(slides): double-click a media or deck row to go live"
```

---

### Task 8: SchedulePanel reading rows

**Files:**
- Modify: `src/renderer/operator/SchedulePanel.tsx` (`ScheduleRow` lines 13-21; row `<button>` ~line 186)
- Modify: `src/renderer/operator/SchedulePanel.test.tsx`
- Modify: `src/renderer/operator/SermonMode.tsx` (`scheduleRows` ~line 612)
- Modify: `src/renderer/operator/SermonMode.test.tsx`

**Interfaces:**
- Consumes: `takeVerseLive(book, ch, v, c)` and `jumpToReading(r)` (Task 2, `SermonMode.tsx`).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

In `src/renderer/operator/SermonMode.test.tsx`, inside the `#58` describe from Task 2:

```tsx
it('double-clicking a schedule reading takes its first verse live', async () => {
  const { resolveChapter, take } = installHelmStub(NOTHING_LIVE, SCHEDULE)
  render(<Harness />)
  resolveChapter()
  await waitFor(() => expect(screen.getAllByText('Genesis 1:1').length).toBeGreaterThan(0))
  fireEvent.doubleClick(screen.getAllByText('Genesis 1:3')[0])
  await waitFor(() => expect(take).toHaveBeenCalledWith('scr:Genesis:1:3', expect.anything()))
})
```

Use the same `SCHEDULE` fixture the existing reading-hotkey tests in that file use, and match its second reading's reference.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx -t "schedule reading takes its first verse"`
Expected: FAIL.

- [ ] **Step 3: Add the row field**

In `src/renderer/operator/SchedulePanel.tsx`, add to `ScheduleRow` after `onClick`:

```ts
  /** Double-click: take this reading's first verse live (#58). */
  onDoubleClick: () => void;
```

On the row `<button>` (~line 186) add `onDoubleClick={r.onDoubleClick}`, and add `userSelect: 'none'` to `rowStyle`.

Update `SchedulePanel.test.tsx`'s row fixtures to include `onDoubleClick: vi.fn()`, and add:

```tsx
it('fires a row onDoubleClick', () => {
  const onDoubleClick = vi.fn()
  render(<SchedulePanel {...baseProps} rows={[{ ...baseRow, onDoubleClick }]} />)
  fireEvent.doubleClick(screen.getByText(baseRow.title))
  expect(onDoubleClick).toHaveBeenCalled()
})
```

- [ ] **Step 4: Wire SermonMode**

In `src/renderer/operator/SermonMode.tsx`, add next to `jumpToReading`:

```ts
  // Double-click a schedule row (#58): move the cursor there exactly as a click does, then
  // take that reading's `from` verse. Resolves the chapter first when the row names a
  // different book/chapter than the one cached, so the live slide never shows stale text.
  const activateReading = (r: ScriptureReading): void => {
    jumpToReading(r);
    if (chapter && chapter.book === r.book && chapter.chapter === r.ch) {
      takeVerseLive(r.book, r.ch, r.from, chapter);
      return;
    }
    window.helm.bibles
      .getChapter(r.book, r.ch)
      .then((c) => {
        setChapter(c);
        takeVerseLive(r.book, r.ch, r.from, c);
      })
      .catch(console.error);
  };
```

In the `scheduleRows` builder (~line 612) add alongside `onClick`:

```ts
      onDoubleClick: () => activateReading(r),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx src/renderer/operator/SchedulePanel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/renderer/operator/SchedulePanel.tsx src/renderer/operator/SchedulePanel.test.tsx src/renderer/operator/SermonMode.tsx src/renderer/operator/SermonMode.test.tsx
git commit -m "feat(scripture): double-click a schedule reading to go live"
```

---

### Task 9: Pre-service cards

**Files:**
- Modify: `src/main/preserviceEngine.ts` (`PreserviceEngine` interface lines 13-23; returned object ~line 90)
- Modify: `src/main/preserviceEngine.test.ts`
- Modify: `src/shared/types.ts` (`CH` preservice block; `HelmApi.preservice`)
- Modify: `src/preload/index.ts:68-81`
- Modify: `src/main/ipc.ts:113-117`
- Modify: `src/renderer/operator/PreServiceMode.tsx:272`
- Modify: `src/renderer/operator/PreServiceMode.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (this surface routes through the pre-service engine, not `presentation.take`).
- Produces: `window.helm.preservice.takeCard(idx: number): void`.

This is the only surface whose double-click is not renderer-only. `showCard` is navigate-only (`pushShow`, which refuses to start projecting from a dark screen — BUG-018). Double-click needs the deliberate-takeover path, which is `pushLive`, at an explicit index.

- [ ] **Step 1: Write the failing engine test**

In `src/main/preserviceEngine.test.ts`, alongside the existing `goLive toggle-to-black regression` describe:

The file's factory is `harness()` (line ~13). It returns `{ engine, sink, calls, repo, presentation, setLive, takeDown, songGoesLive }`, where `presentation()` returns the real `PresentationState` produced by running the actual `core.ts` verbs — so assert on state, not just the call log.

```ts
describe('takeCard (#58)', () => {
  it('starts projecting from a dark screen, unlike showCard', () => {
    const { engine, presentation } = harness();
    engine.takeCard(1);
    expect(presentation().output).toBe('live');
  });

  it('does not toggle to black when that card is already live', () => {
    const { engine, presentation } = harness();
    engine.takeCard(0);
    engine.takeCard(0);
    expect(presentation().output).toBe('live');
  });

  it('stops the loop, like showNow', () => {
    const { engine } = harness();
    engine.engage();
    engine.takeCard(1);
    expect(engine.getState().engaged).toBe(false);
  });
});
```

The second test is the one that matters: `pushLive` reaches `goLive` on a repeat, and `goLive` blacks the already-live key. `pushLive`'s existing `sink.isLive` branch is what saves it — this test pins that behavior down for `takeCard`'s new caller.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/preserviceEngine.test.ts -t "takeCard"`
Expected: FAIL — `engine.takeCard is not a function`.

- [ ] **Step 3: Add the engine method**

In `src/main/preserviceEngine.ts`, add to the `PreserviceEngine` interface next to `showCard`:

```ts
  takeCard(idx: number): void;
```

And to the returned object, directly after `showCard`:

```ts
    // Double-click a card (#58). showCard is navigate-only — pushShow refuses to start
    // projecting from a dark screen (BUG-018), which is right for a single tap. A
    // double-click is the deliberate control that may take the screen, so it routes
    // through pushLive, and stops the loop for showNow's reason: the card the operator
    // asked to hold must not rotate away at the next dwell boundary.
    takeCard(i) { if (i >= 0 && i < cards.length) { engaged = false; loopT = 0; stopTimer(); idx = i; pushLive(); emit(); } },
```

- [ ] **Step 4: Run the engine test to verify it passes**

Run: `npx vitest run src/main/preserviceEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Plumb it to the renderer**

In `src/shared/types.ts`, add `preserviceTake: 'preservice:takeCard',` to the `CH` block next to the other `preservice*` channels, and `takeCard(idx: number): void;` to `HelmApi.preservice` next to `showCard`.

In `src/preload/index.ts`, after the `showCard` line:

```ts
    takeCard: (idx) => ipcRenderer.send(CH.preserviceTake, idx),
```

In `src/main/ipc.ts`, after the `CH.preserviceShow` line:

```ts
  ipcMain.on(CH.preserviceTake, (_e, idx: number) => preserviceEngine.takeCard(idx));
```

- [ ] **Step 6: Write the failing renderer test and wire the row**

`src/renderer/operator/PreServiceMode.test.tsx` has `installHelmStub(state: PreState, pres?: PresentationState)` returning `{ showCard, showNow }`, a `baseState` with two `cards` (`a` titled `Greeting`, `b` titled `Psalm 122:1`), and the `NOTHING_LIVE` / `SONG_LIVE` / `cardLive(id)` state fixtures. Add `takeCard` to the stub's `preservice` object and to what it returns, then:

```tsx
it('double-clicking a card takes it live', async () => {
  const { takeCard, showCard } = installHelmStub(baseState)
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <PreServiceMode />
    </ThemeCtx.Provider>
  )
  fireEvent.doubleClick((await screen.findByText('Psalm 122:1')).closest('button') as HTMLButtonElement)
  expect(takeCard).toHaveBeenCalledWith(1)
  expect(showCard).toHaveBeenCalledWith(1) // the first click still cues, unchanged
})
```

Match the render call to how the other tests in that file mount `PreServiceMode` — copy their wrapper and props rather than the sketch above.

Then in `src/renderer/operator/PreServiceMode.tsx:272`:

```tsx
              <button key={card.id} style={rowStyle} onClick={() => window.helm.preservice.showCard(i)} onDoubleClick={() => window.helm.preservice.takeCard(i)}>
```

Add `userSelect: 'none'` to `rowStyle`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/main/preserviceEngine.test.ts src/renderer/operator/PreServiceMode.test.tsx`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/main/preserviceEngine.ts src/main/preserviceEngine.test.ts src/shared/types.ts src/preload/index.ts src/main/ipc.ts src/renderer/operator/PreServiceMode.tsx src/renderer/operator/PreServiceMode.test.tsx
git commit -m "feat(preservice): double-click a card to take it live"
```

---

### Task 10: Consistency sweep and real-app verification

**Files:**
- Modify: any row style missed by Tasks 2-9.
- Modify: `docs/superpowers/specs/2026-08-14-double-click-go-live-design.md` (only if verification contradicts it)

**Interfaces:**
- Consumes: every surface from Tasks 2-9.
- Produces: nothing.

- [ ] **Step 1: Confirm no double-click path routes through `goLive`**

Run: `grep -rn "onDoubleClick" src/renderer/ | grep -i "golive"`
Expected: no output. If any line matches, it is a bug — `goLive` blacks the already-live key. Convert it to `take`.

- [ ] **Step 2: Confirm every listed surface has a handler**

Run: `grep -rln "onDoubleClick\|onActivate" src/renderer/operator/`
Expected: at minimum `ChapterRail.tsx`, `SectionRail.tsx`, `ParagraphRail.tsx`, `SlidesTrack.tsx`, `SchedulePanel.tsx`, `PreServiceMode.tsx`, `SongSearchRail.tsx`, `MessageSearchRail.tsx`, plus the modes that wire them.

- [ ] **Step 3: Confirm `userSelect: 'none'` on every card row style**

Run: `grep -rn "userSelect" src/renderer/operator/`
Expected: present in each of the eight row styles. Double-clicking a `<button>` otherwise selects its label text.

- [ ] **Step 4: Full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Verify in the real app**

Use the `run` skill to launch the app. jsdom cannot settle these — `fireEvent.doubleClick` synthesizes `dblclick` directly, so a passing test says nothing about real delivery. Check, and record the result:

1. **`blurOnPointerClick` does not swallow `dblclick`.** It is registered on `document` and calls `btn.blur()` on every pointer click (`src/renderer/operator/blurOnPointerClick.ts:15`). Double-click a verse card and confirm it goes live.
2. **No text selection.** Double-click a card and confirm its label is not highlighted.
3. **The destructive case.** With a card live, double-click that same card several times fast. The projector must not black out. This is the issue's headline acceptance criterion.
4. **Video.** With a video slide live and playing, double-click its row. Playback must not restart or stutter (this is what the identity-return in `takeLive` protects).

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix(operator): consistency sweep for double-click go-live"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 The verb (`takeLive` + plumbing) | Task 1 |
| §2 Delivery (`onActivate`, `userSelect: none`) | Tasks 2-9, swept in 10 |
| §3 ChapterRail verse | Task 2 |
| §3 SectionRail section | Task 3 |
| §3 SongSearchRail result | Task 4 |
| §3 ParagraphRail paragraph | Task 5 |
| §3 MessageSearchRail tape/quote | Task 6 |
| §3 SlidesTrack media/deck row | Task 7 |
| §3 SchedulePanel reading | Task 8 |
| §3 PreServiceMode card | Task 9 |
| §4 Already live → no-op | Task 1 (verb), asserted in Tasks 2, 3, 7 |
| §4 Songs armed → double-clicked wins | Task 3 (`setArmedNextId(null)`), asserted in Task 4 |
| §4 Shift-double-click | Task 2 (`activateVerse`) |
| §4 First click still fires | No code — no debounce is the decision |
| §4 `blurOnPointerClick` | Task 10, Step 5 |
| §5 Testing | Per-task tests + Task 10 |

**Placeholder scan:** clean. Every test-helper name in this plan was read from the file it belongs to — `harness()` (`preserviceEngine.test.ts:13`), `installHelmStub()` (`SlidesTrack.test.tsx:68`, `PreServiceMode.test.tsx:42`, `SermonMode.test.tsx:39`), `installHelmStubWith()` + `renderMode()` (`SongsMode.test.tsx:90`/`:67`), `renderTrack()` (`SlidesTrack.test.tsx:76`), `clickTab()` (`SermonMode.test.tsx:173`), and the `baseProps`/`rows` fixtures in `SongSearchRail.test.tsx` and `SchedulePanel.test.tsx`. Fixture ids and titles used in assertions (`deck1`, `s1`/`s2`, `m1`, `TAPE`, `GENESIS_1`) are likewise the real ones.

**Type consistency:** `takeLive` / `presentation.take` / `CH.presTake` / `takeCard` are spelled identically everywhere they appear. `onActivate` is the rail prop name in Tasks 2-5; Tasks 6 and 8 use `onDoubleClick` **on the row object** instead, because `MsgTapeRow`/`MsgQuoteRow`/`MsgScheduleRow`/`ScheduleRow` already carry their own `onClick` rather than receiving a rail-level callback. That asymmetry is deliberate and matches each file's existing shape.

**Known deviation from the spec:** the spec's §1 code block was updated during planning to add the identity return (`if (st.output === 'live' && st.liveKey === key) return st`) so `stateStore.take` can skip the broadcast. Without it, a no-op double-click on a live video slide re-pushes an identical `outputSlide` payload at a mid-playback `<video>`.
