# Live Song Control Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a song is live, the operator's center and the leader display stay locked to it; clicking another song arms it (Enter commits the switch, take-down converts the arm to the selection); Escape backs out progressively; `\` focuses song search.

**Architecture:** All changes are renderer-side. SongsMode gains one piece of state (`armedNextId`) and routes `selectSong` by a lock condition (`output === 'live'` and `liveKey` parses as a song); commit uses the existing `goLive` IPC; take-down conversion and cross-kind disarm are effects watching presentation state. LeaderView's shown key becomes live-first. The hotkey registry gains a second default binding.

**Tech Stack:** Electron + React 19 (inline styles), vitest + @testing-library/react (jsdom pragma on line 1 of component tests).

**Spec:** `docs/superpowers/specs/2026-08-07-live-song-control-flow-design.md`

## Global Constraints

- Commit messages: concise conventional-commit subject, no `Co-Authored-By`/`Claude-Session` trailers (CLAUDE.md).
- `npm test` full suite green before each commit. Baseline: 81 files / 801 tests.
- Lock condition, verbatim from the spec: `output === 'live' && parseSongKey(liveKey) !== null`.
- Arming never cues and never touches the screen (no `presentation.*` calls on arm).
- Take-down conversion fires only when `output` transitions FROM `'live'` (to black/logo) with a song armed; a cross-kind takeover (lock false while output still `'live'`) is a plain disarm.
- Escape order: modal → disarm → blur text field → take down (`setOutput('black')`) → unhandled.
- The Switch button label is `⇄ Switch to <title>`; while armed, `■ Take down` stays visible beside it.

---

### Task 1: LeaderView shows the live song first

**Files:**
- Modify: `src/renderer/output/LeaderView.tsx:19` (shownKey derivation + comment)
- Test: `src/renderer/output/LeaderView.test.tsx`

**Interfaces:**
- Consumes: `PresentationState.cuedKey`/`liveKey`/`output` (existing).
- Produces: shown-key rule `output === 'live' && liveKey ? liveKey : (cuedKey ?? liveKey)`. Chip logic unchanged (`isLive = output === 'live' && liveKey === shownKey`).

- [ ] **Step 1: Rework the cue-following tests.** In `LeaderView.test.tsx`:

The existing test `follows the cued section immediately, without go-live, and shows CUED` currently uses `output: 'live'` with a cue on a *different* section — under the new rule that must show the LIVE section. Replace it with these two (keep the fixtures/helpers already in the file):

```tsx
it('stays locked to the live section while a different section is cued (browsing cannot move it)', async () => {
  const st: PresentationState = {
    output: 'live',
    liveKey: 'song:s1:0',
    liveSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines },
    cuedKey: 'song:s1:1',
    cuedSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Verse 2', lines: SONG.sections[1].lines }
  }
  installHelmStub(st)
  const r = render(<LeaderView payload={payload(st)} />)
  await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
  // Hero shows the LIVE section (Verse 1), not the cued one.
  expect(r.getByTestId('leader-section-0').dataset.live).toBe('true')
  expect(r.getByTestId('leader-section-1').dataset.live).toBe('false')
  expect(r.getByText('LIVE')).toBeTruthy()
  expect(r.queryByText('CUED')).toBeNull()
})
it('follows the cued selection while output is down (prep view)', async () => {
  const st: PresentationState = {
    output: 'black',
    liveKey: 'song:s1:0',
    liveSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines },
    cuedKey: 'song:s1:1',
    cuedSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Verse 2', lines: SONG.sections[1].lines }
  }
  installHelmStub(st)
  const r = render(<LeaderView payload={payload(st)} />)
  await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
  expect(r.getByTestId('leader-section-1').dataset.live).toBe('true')
  expect(r.getByText('CUED')).toBeTruthy()
  expect(r.getByText('BLACK')).toBeTruthy()
})
```

Audit the file's other tests: any test that relied on cue-over-live while `output: 'live'` needs its state literals aligned (most already set `cuedKey`/`cuedSnap` mirroring live, which behaves identically under both rules). The `shows LIVE when the displayed section is what the congregation sees` and LOGO-chip tests are unaffected.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/renderer/output/LeaderView.test.tsx`. Expected: the new "stays locked" test FAILS (hero currently follows the cue).

- [ ] **Step 3: Implement** — in `LeaderView.tsx`, replace the shownKey line and its comment:

```tsx
  // Live-first: while output is live the leader is locked to the live song — the
  // congregation is singing it, and no amount of operator browsing/arming may move this
  // display. When output is down, follow the cue instead (prep view between songs).
  const shownKey = st.output === 'live' && st.liveKey ? st.liveKey : (st.cuedKey ?? st.liveKey)
```

- [ ] **Step 4: Run** — `npx vitest run src/renderer/output/LeaderView.test.tsx src/renderer/output/OutputApp.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/output && git commit -m "feat(leader): lock to the live song while live; follow the cue only when down"
```

---

### Task 2: Armed switching + center lock (SongsMode)

**Files:**
- Modify: `src/renderer/operator/SongsMode.tsx`
- Modify: `src/renderer/operator/SongSearchRail.tsx` (SongRow.isArmed + NEXT treatment)
- Test: `src/renderer/operator/SongsMode.test.tsx`

**Interfaces:**
- Consumes: `parseSongKey`, `keyForSong`, `slideFor` (in-file), `presentation.goLive/cue/setOutput`.
- Produces: `armedNextId: string | null` state; `locked` boolean; `commitSwitch()`; `SongRow.isArmed: boolean`. Task 3 (Escape) reads `armedNextId` via the same component; Task 5 verifies live.

- [ ] **Step 1: Extend the test stub.** In `SongsMode.test.tsx`, replace `installHelmStubWith` with a version that also exposes `cue`, `setOutput`, `add`, and a `pushState` seam (existing callers destructure `{ goLive }`, which keeps working):

```tsx
// Like installHelmStub but with configurable songs + live state, spies on every
// presentation call, and a pushState seam to drive onState mid-test.
function installHelmStubWith(
  songs: Song[],
  state: PresentationState
): {
  goLive: ReturnType<typeof vi.fn>;
  cue: ReturnType<typeof vi.fn>;
  setOutput: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
  pushState: (s: PresentationState) => void;
} {
  const goLive = vi.fn();
  const cue = vi.fn();
  const setOutput = vi.fn();
  const add = vi.fn();
  let stateCb: (s: PresentationState) => void = () => {};
  (window as unknown as { helm: unknown }).helm = {
    songs: { list: () => Promise.resolve(songs), search: vi.fn(() => Promise.resolve([])), add },
    presentation: {
      get: () => Promise.resolve(state),
      onState: (cb: (s: PresentationState) => void) => {
        stateCb = cb;
        return () => {};
      },
      cue,
      goLive,
      setOutput
    },
    songImport: {
      sources: () => Promise.resolve([]),
      scan: vi.fn(),
      commit: vi.fn(),
      onProgress: () => () => {}
    }
  };
  return { goLive, cue, setOutput, add, pushState: (s) => stateCb(s) };
}
```

- [ ] **Step 2: Write the failing tests** (append a new `describe('SongsMode armed switching', ...)` block). Fixtures: reuse `CHORUS_SONG` (id `s2`) and add:

```tsx
const NEXT_SONG: Song = {
  id: 's3',
  title: 'Blessed Assurance',
  author: 'Fanny Crosby',
  sections: [{ label: 'Verse 1', lines: ['Blessed assurance'] }],
  source: 'manual',
  createdAt: 1
};
const LIVE_ON_S2: PresentationState = {
  output: 'live', liveKey: 'song:s2:0',
  liveSnap: { kind: 'lyrics', label: 'With Chorus · Verse 1', lines: ['v1'] },
  cuedKey: 'song:s2:0', cuedSnap: null
};
```

```tsx
describe('SongsMode armed switching', () => {
  it('clicking another song while live arms it: center stays, no cue, Switch button appears', async () => {
    const { cue, goLive } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    cue.mockClear(); // drop the initial-selection cue of s2:0

    fireEvent.click(screen.getByText('Blessed Assurance'));
    // Center unchanged: hero still shows the live song.
    expect(screen.getByText('With Chorus')).toBeTruthy();
    expect(screen.getByText(/⇄ Switch to Blessed Assurance/)).toBeTruthy();
    expect(screen.getByText('NEXT')).toBeTruthy();
    // Arming is silent: no cue, no goLive.
    expect(cue).not.toHaveBeenCalled();
    expect(goLive).not.toHaveBeenCalled();
  });

  it('the Switch button commits: armed song goes live at section 0 and becomes the selection', async () => {
    const { goLive } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    fireEvent.click(screen.getByText(/⇄ Switch to Blessed Assurance/));
    expect(goLive).toHaveBeenCalledWith('song:s3:0', expect.objectContaining({ label: 'Blessed Assurance · Verse 1' }));
    // Selection followed the commit; arm cleared.
    await waitFor(() => expect(screen.getAllByText('Blessed Assurance').length).toBeGreaterThan(1)); // rail row + hero header
    expect(screen.queryByText(/⇄ Switch to/)).toBeNull();
  });

  it('Enter (onGoLive) commits the switch while armed', async () => {
    const { goLive } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    act(() => keyHandlerRef.current?.onGoLive());
    expect(goLive).toHaveBeenCalledWith('song:s3:0', expect.anything());
  });

  it('clicking the armed row again, or the live row, disarms', async () => {
    installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    expect(screen.getByText('NEXT')).toBeTruthy();
    fireEvent.click(screen.getByText('Blessed Assurance')); // armed row toggles off
    expect(screen.queryByText('NEXT')).toBeNull();
    fireEvent.click(screen.getByText('Blessed Assurance')); // re-arm
    fireEvent.click(screen.getByText(/With Chorus · 4 stanzas|With Chorus/)); // live row disarms
    expect(screen.queryByText('NEXT')).toBeNull();
  });

  it('both Take down and Switch render while armed; Take down sends output black', async () => {
    const { setOutput } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    expect(screen.getByText('■ Take down')).toBeTruthy();
    expect(screen.getByText(/⇄ Switch to Blessed Assurance/)).toBeTruthy();
    fireEvent.click(screen.getByText('■ Take down'));
    expect(setOutput).toHaveBeenCalledWith('black');
  });

  it('take-down while armed converts the arm to the selection', async () => {
    const { pushState, cue } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    cue.mockClear();
    act(() => pushState({ ...LIVE_ON_S2, output: 'black' }));
    // Hero transitions to the armed song, the arm clears, and the cue effect stages it.
    await waitFor(() => expect(screen.getByText('Fanny Crosby')).toBeTruthy());
    expect(screen.queryByText(/⇄ Switch to/)).toBeNull();
    await waitFor(() => expect(cue).toHaveBeenCalledWith('song:s3:0', expect.anything()));
  });

  it('a cross-kind takeover (scripture live) plain-disarms without moving the selection', async () => {
    const { pushState } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    act(() => pushState({ ...LIVE_ON_S2, liveKey: 'scr:kjv:John:3', liveSnap: { kind: 'scripture' } }));
    await waitFor(() => expect(screen.queryByText(/⇄ Switch to/)).toBeNull());
    expect(screen.getByText('With Chorus')).toBeTruthy(); // selection untouched
  });

  it('clicks while output is down select exactly as before (no arming)', async () => {
    const { cue } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], NOTHING_LIVE);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    await waitFor(() => expect(screen.getByText('Fanny Crosby')).toBeTruthy());
    expect(screen.queryByText(/⇄ Switch to/)).toBeNull();
    await waitFor(() => expect(cue).toHaveBeenCalledWith('song:s3:0', expect.anything()));
  });

  it('QuickAdd save while live arms the new song instead of selecting it', async () => {
    const { add } = installHelmStubWith([CHORUS_SONG], LIVE_ON_S2);
    add.mockResolvedValue(NEXT_SONG);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('+ Add a song'));
    fireEvent.change(await screen.findByPlaceholderText(/Paste lyrics here/), { target: { value: 'Blessed assurance' } });
    fireEvent.click(screen.getByText('Add to library'));
    // The new song lands armed; the center never left the live song.
    await waitFor(() => expect(screen.getByText(/⇄ Switch to Blessed Assurance/)).toBeTruthy());
    expect(screen.getByText('With Chorus')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run src/renderer/operator/SongsMode.test.tsx`. Expected: every new test FAILS (no Switch button, clicks always select).

- [ ] **Step 4: Implement SongsMode.** All edits in `src/renderer/operator/SongsMode.tsx`:

(a) State + derivations (after the `section` state, and replace `jumpSection`'s local `parseSongKey` use with the hoisted value):

```tsx
const [armedNextId, setArmedNextId] = useState<string | null>(null);
```

After `const currentSectionObj = ...` (line ~161):

```tsx
// Live lock (spec §1): while a song is live, the center is bound to it and list clicks
// arm instead of selecting. parseSongKey is null for scripture/media keys, so a
// cross-kind live screen leaves the Songs list in its normal select-to-cue behavior.
const liveParsed = parseSongKey(liveKey);
const locked = output === 'live' && liveParsed !== null;
const armed = locked && armedNextId ? (library.find((s) => s.id === armedNextId) ?? null) : null;
```

(b) `selectSong` routing:

```tsx
const selectSong = (id: string): void => {
  if (locked && liveParsed) {
    if (id === liveParsed.songId) {
      // Clicking the live song's row: back to base — disarm and make sure the center
      // really is on the live song (it always should be; belt and suspenders).
      setArmedNextId(null);
      if (activeSongId !== id) {
        setActiveSongId(id);
        setSection(liveParsed.section);
      }
      return;
    }
    // Toggle off on the armed row, arm on any other row. Arming is silent: no selection
    // change, no cue, no screen traffic — Enter or the Switch button commits.
    setArmedNextId((cur) => (cur === id ? null : id));
    return;
  }
  setActiveSongId(id);
  setSection(0);
};
```

(c) Commit, with the reconcile latch ref (place near `goLive`):

```tsx
// Set when a switch commits, cleared once the broadcast confirms the new live key —
// the reconciling effect below must not snap the selection back to the OLD live song
// in the gap between our goLive() send and the state broadcast returning.
const pendingSwitchRef = useRef<string | null>(null);

const commitSwitch = (): void => {
  if (!armed || !armed.sections.length) {
    setArmedNextId(null);
    return;
  }
  pendingSwitchRef.current = armed.id;
  window.helm.presentation.goLive(keyForSong(armed.id, 0), slideFor(armed, armed.sections[0]));
  setActiveSongId(armed.id);
  setSection(0);
  setArmedNextId(null);
};

const takeDown = (): void => {
  window.helm.presentation.setOutput('black');
};
```

(d) Effects (after the cue effect):

```tsx
// Center lock reconciliation (spec §1): while locked, the selection must equal the live
// song. Divergence is either the commit transient (latched above — skip until the
// broadcast catches up) or an external live change; reselect the live song for the
// latter. A live song missing from the library (deleted while live) falls back to
// unlocked behavior untouched.
useEffect(() => {
  if (!locked || !liveParsed) {
    pendingSwitchRef.current = null;
    return;
  }
  if (pendingSwitchRef.current) {
    if (liveParsed.songId === pendingSwitchRef.current) pendingSwitchRef.current = null;
    return;
  }
  if (activeSongId === liveParsed.songId) return;
  if (!library.some((s) => s.id === liveParsed.songId)) return;
  setActiveSongId(liveParsed.songId);
  setSection(liveParsed.section);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [locked, liveParsed?.songId, liveParsed?.section, activeSongId, library]);

// Take-down converts the arm to the selection (spec §1): arm mid-song, take down at the
// song's end, and the next song is staged in the hero — and, via the cue effect, on the
// leader (which follows the cue while output is down). Watches the output transition so
// every take-down path (button, Escape, logo toggle) converts identically.
const prevOutputRef = useRef(output);
useEffect(() => {
  const was = prevOutputRef.current;
  prevOutputRef.current = output;
  if (was !== 'live' || output === 'live' || !armedNextId) return;
  const armedSongNow = library.find((s) => s.id === armedNextId) ?? null;
  setArmedNextId(null);
  if (armedSongNow) {
    setActiveSongId(armedSongNow.id);
    setSection(0);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [output]);

// Cross-kind takeover (scripture/media grabs the screen while a song was live): the song
// flow the arm was staged for is over — plain disarm, selection untouched (spec §1).
useEffect(() => {
  if (!locked && output === 'live') setArmedNextId(null);
}, [locked, output]);
```

(e) `onGoLive` in the key handler registration becomes `onGoLive: armed ? commitSwitch : goLive,`.

(f) Button row (replace the current single go-live button):

```tsx
{armed && (
  <button style={{ ...goLiveStyle, background: T.live }} onClick={takeDown}>
    ■ Take down
  </button>
)}
<button style={goLiveStyle} onClick={armed ? commitSwitch : goLive}>
  {armed ? `⇄ Switch to ${armed.title}` : cuedIsLive ? '■ Take down' : '● Go live'}
</button>
```

And `goLiveStyle`'s background becomes armed-aware (the Switch action is a "go" action — green — even though the live section is on screen):

```tsx
background: !armed && cuedIsLive ? T.live : '#2f9e5b',
```

(g) `toRow` carries the armed id:

```tsx
function toRow(song: Song, snippet: string, activeSongId: string | null, armedId: string | null = null): SongRow {
  return {
    id: song.id,
    title: song.title,
    author: `${song.author} · ${stanzaLabel(song.sections.length)}`,
    snippet,
    hasSnippet: !!snippet,
    isActive: song.id === activeSongId,
    isArmed: song.id === armedId
  };
}
```

`displayedRows` passes `armed?.id ?? null` as the fourth argument (both branches); `secondaryRows` passes nothing (hint rows never show the badge).

(h) `jumpSection` (line ~232) reuses the hoisted value — replace `const liveSong = parseSongKey(liveKey);` with `const liveSong = liveParsed;` (or use `liveParsed` directly).

- [ ] **Step 5: Implement SongSearchRail.** In `src/renderer/operator/SongSearchRail.tsx`:

`SongRow` gains `isArmed: boolean;`. In the primary rows map (line ~191), the row button style and title row get the armed treatment:

```tsx
<button
  key={r.id}
  style={{ ...rowStyle(r.isActive), ...(r.isArmed ? { boxShadow: `inset 0 0 0 2px ${T.accent}` } : {}) }}
  onClick={() => onSelect(r.id)}
  onContextMenu={(e) => onRowContextMenu?.(r.id, e)}
>
```

And next to the active `●` badge (line ~216):

```tsx
{r.isArmed && (
  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '9px', letterSpacing: '0.08em', fontWeight: 700, color: T.accent, flexShrink: 0, marginTop: '4px' }}>
    NEXT
  </div>
)}
{r.isActive && <div style={activeBadgeStyle}>●</div>}
```

The secondary-rows map (line ~225) also spreads `SongRow`s — its `toRow` calls never set `isArmed` true, so no change there beyond the type being satisfied.

- [ ] **Step 6: Run** — `npx vitest run src/renderer/operator/SongsMode.test.tsx src/renderer/operator/SongSearchRail.test.tsx`. Expected: PASS (fix `SongSearchRail.test.tsx` fixtures if `SongRow` literals now miss `isArmed` — add `isArmed: false`). Then `npm test` full suite green.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/operator && git commit -m "feat(songs): armed switching — center locks to live song, click arms, Enter commits"
```

---

### Task 3: Escape chain

**Files:**
- Modify: `src/renderer/operator/SongsMode.tsx:272-289` (onEscape)
- Test: `src/renderer/operator/SongsMode.test.tsx`

**Interfaces:**
- Consumes: `armedNextId`/`setArmedNextId` (Task 2), `output`, `presentation.setOutput`.
- Produces: onEscape contract: modal → disarm → blur → take-down → false.

- [ ] **Step 1: Write the failing tests** (same new describe block or a fresh one):

```tsx
describe('SongsMode escape chain', () => {
  it('Escape disarms first, then takes the screen down on a second press', async () => {
    const { setOutput } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));

    let handled: boolean | undefined;
    act(() => { handled = keyHandlerRef.current?.onEscape(); });
    expect(handled).toBe(true);
    expect(screen.queryByText(/⇄ Switch to/)).toBeNull();
    expect(setOutput).not.toHaveBeenCalled();

    act(() => { handled = keyHandlerRef.current?.onEscape(); });
    expect(handled).toBe(true);
    expect(setOutput).toHaveBeenCalledWith('black');
  });

  it('Escape while typing blurs the field and never takes the screen down', async () => {
    const { setOutput } = installHelmStubWith([CHORUS_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    const input = screen.getByPlaceholderText(/Title or a lyric line/) as HTMLInputElement;
    input.focus();
    let handled: boolean | undefined;
    act(() => { handled = keyHandlerRef.current?.onEscape(); });
    expect(handled).toBe(true);
    expect(document.activeElement).not.toBe(input);
    expect(setOutput).not.toHaveBeenCalled();
  });

  it('Escape with output down and nothing armed stays unhandled (App fallthrough)', async () => {
    installHelmStubWith([CHORUS_SONG], NOTHING_LIVE);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    expect(keyHandlerRef.current?.onEscape()).toBe(false);
  });
});
```

Note: the pre-existing test `does not report a modal open, and onEscape is a no-op, when neither modal is up` uses `installHelmStub()` (output black, nothing armed, nothing focused) — it still passes; leave it.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/renderer/operator/SongsMode.test.tsx`. Expected: the first two new tests FAIL.

- [ ] **Step 3: Implement** — replace the `return false;` tail of `onEscape` (keep the modal branches exactly as they are):

```tsx
        // Progressive back-out (spec §3): after modals, undo the most recent intent
        // first (an armed switch), then leave a text field, and only then touch the
        // screen. Order matters: a typing operator must never black the screen with a
        // stray Escape, and disarming before blur means "undo my arm" always wins.
        if (armedNextId) {
          setArmedNextId(null);
          return true;
        }
        const el = document.activeElement as HTMLElement | null;
        const tag = el?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
          el?.blur();
          return true;
        }
        if (output === 'live') {
          window.helm.presentation.setOutput('black');
          return true;
        }
        return false;
```

- [ ] **Step 4: Run** — `npx vitest run src/renderer/operator/SongsMode.test.tsx`. Expected: PASS. Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/SongsMode.tsx src/renderer/operator/SongsMode.test.tsx && git commit -m "feat(songs): Escape backs out progressively — disarm, blur, take down"
```

---

### Task 4: `\` focuses search

**Files:**
- Modify: `src/shared/hotkeys/actions.ts` (focus.search defaults)
- Test: `src/shared/hotkeys/actions.test.ts`

**Interfaces:**
- Produces: `focus.search` defaults `['/', '\\']`. Routing is already wired (SongsMode `onAction` → `searchInputRef.focus()`); the dispatcher's typing guard already suppresses unmodified keys while typing.

- [ ] **Step 1: Write the failing test** — in `src/shared/hotkeys/actions.test.ts` (match the file's existing style):

```ts
test('focus.search ships both / and \\ as default bindings', () => {
  const action = HOTKEY_ACTIONS.find((a) => a.id === 'focus.search')!
  expect(action.defaults).toEqual(['/', '\\'])
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/shared/hotkeys/actions.test.ts`. Expected: FAIL (`['/']`).

- [ ] **Step 3: Implement** — in `actions.ts`:

```ts
  { id: 'focus.search', label: 'Focus search / entry', scope: 'global', defaults: ['/', '\\'] },
```

- [ ] **Step 4: Run** — `npx vitest run src/shared/hotkeys/actions.test.ts src/shared/hotkeys/match.test.ts`. Expected: PASS. Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/hotkeys && git commit -m "feat(hotkeys): backslash focuses song search"
```

---

### Task 5: Full suite + live verification

**Files:**
- Reuse/extend: `scratch/verify-display-views.mjs` pattern (new throwaway driver `scratch/verify-live-flow.mjs`, not committed)

**Interfaces:** none — verification only.

- [ ] **Step 1:** `npm test` — full suite green (expect baseline 801 + new tests).
- [ ] **Step 2:** Live driver (model on `scratch/verify-display-views.mjs` — read it first; same launch/user-data-dir/openTest seam). Drive and screenshot into `scratch/live-flow-shots/`:
  1. Go live on song A. Open a leader test window: shows A.
  2. Search for and click song B → operator hero still shows A; B's row shows NEXT; buttons read `■ Take down` + `⇄ Switch to B`; leader unmoved.
  3. Press Enter → B live at Verse 1; hero and leader follow; arm cleared.
  4. Arm C, click `■ Take down` → output black; hero transitions to C; leader (following the cue while down) shows C.
  5. Escape chain: arm B, Escape → disarmed; Escape again → screen black. Focus search, type, Escape → field blurs, screen untouched.
  6. Press `\` with focus elsewhere → search input focused.
- [ ] **Step 3:** Note deviations honestly; commit any product fixes the driver reveals as separate conventional commits.

---

## Self-review notes

- Spec coverage: §1 → Task 2 (lock, arming, commit, conversion, dual buttons, QuickAdd-arms — QuickAdd needs no code change: `onQuickAddSaved` calls `selectSong`, which under lock arms; the Edit stub likewise routes through `selectSong`, satisfying the lock invariant — the spec's "plain selection" for Edit is honored in the not-locked case and safely arms in the locked case); §2 → Task 1; §3 → Task 3; §4 → Task 4; error-handling rows → Task 2 (armed-missing commit no-op via the `!armed` guard + conversion's `armedSongNow` null path; live-song-deleted via the reconcile library check).
- Type consistency: `armedNextId`, `locked`, `liveParsed`, `armed`, `commitSwitch`, `takeDown`, `pendingSwitchRef`, `SongRow.isArmed`, stub returns `{ goLive, cue, setOutput, add, pushState }` — used consistently across Tasks 2–3.
- Known nuance for the implementer: the take-down conversion effect intentionally depends only on `[output]` (with refs/lookups inside) to fire exactly once per output transition; do not "fix" the deps array — the eslint-disable is load-bearing, same pattern as the existing cue effect.
