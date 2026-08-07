# Display Views: Line Integrity, Leader Parity, Song Key — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Song line structure is never re-wrapped on any output view; the leader view matches the operator theme, follows the operator's cued selection, and has a resizable hero/rail split (local drag + remote slider); songs gain an optional musical key shown on the audience view.

**Architecture:** All output text sizing stays geometry-driven: lyric lines get `white-space: nowrap` so the existing `useFitText` width check shrinks the font until the longest line fits. Cue tracking becomes shared state (`cuedKey`/`cuedSnap` on `PresentationState`, recorded by the existing `presentation:cue` IPC). The leader split is a per-display setting persisted in `displays:leaderSplits`, delivered to output windows on the existing `output:slide` payload, writable from the leader window (resolved by sender) or the operator popover (by fingerprint).

**Tech Stack:** Electron + React 19 (inline styles, no CSS files), better-sqlite3, vitest (+ jsdom & @testing-library/react for component tests — those files start with `// @vitest-environment jsdom`).

**Spec:** `docs/superpowers/specs/2026-08-06-display-views-formatting-design.md`

## Global Constraints

- Commit messages: concise conventional-commit subject, no `Co-Authored-By`/`Claude-Session` trailers (CLAUDE.md).
- Run tests with `npm test` (vitest run). Component tests need the `// @vitest-environment jsdom` pragma on line 1.
- No new dependencies.
- All styling is inline `CSSProperties` objects, matching the existing files.
- Types live in `src/shared/types.ts`; IPC channel names in the `CH` const there.

---

### Task 1: Cued state in PresentationState

The operator already fires `presentation.cue(key, slide)` on every song/section selection (`SongsMode.tsx:166`). Record it in shared state so output windows can see it.

**Files:**
- Modify: `src/shared/types.ts:134-136` (PresentationState)
- Modify: `src/shared/presentation/core.ts` (initialPresentation, applyCue, goLive)
- Modify: `src/renderer/operator/useHelm.ts:5` (initial state literal)
- Test: `src/shared/presentation/core.test.ts`

**Interfaces:**
- Consumes: existing `applyCue/goLive/showLive/setOutput` reducers.
- Produces: `PresentationState` with required `cuedKey: string | null` and `cuedSnap: Slide | null`, always set by `applyCue` regardless of live/flow gating. Task 6 reads `st.cuedKey`/`st.cuedSnap`.

- [ ] **Step 1: Write the failing tests** — in `src/shared/presentation/core.test.ts`, update the initial-state test and add two:

```ts
test('initial state is black with no snapshot', () => {
  expect(initialPresentation()).toEqual({
    output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null
  })
})
test('applyCue always records the cue, even while black', () => {
  const st = applyCue(initialPresentation(), 'song:a:0', slide('V1'))
  expect(st.cuedKey).toBe('song:a:0')
  expect(st.cuedSnap?.label).toBe('V1')
  expect(st.liveSnap).toBeNull() // screen untouched
})
test('applyCue records a cross-flow cue without touching the live screen', () => {
  let st = goLive(initialPresentation(), 'song:a:0', slide('V1'))
  st = applyCue(st, 'song:b:0', slide('OTHER'))
  expect(st.liveKey).toBe('song:a:0')
  expect(st.cuedKey).toBe('song:b:0')
  expect(st.cuedSnap?.label).toBe('OTHER')
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/shared/presentation/core.test.ts`. Expected: FAIL (initial-state toEqual mismatch; `cuedKey` undefined).

- [ ] **Step 3: Implement** — in `src/shared/types.ts`:

```ts
export interface PresentationState {
  output: OutputMode; liveKey: string | null; liveSnap: Slide | null;
  cuedKey: string | null; cuedSnap: Slide | null;
}
```

In `src/shared/presentation/core.ts`:

```ts
export function initialPresentation(): PresentationState {
  return { output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null }
}
```

`applyCue` always records the cue; the live-screen gating is unchanged:

```ts
export function applyCue(st: PresentationState, key: string, slide: Slide): PresentationState {
  const cued = { ...st, cuedKey: key, cuedSnap: slide }
  if (st.output === 'live' && sameFlow(st.liveKey, key))
    return { ...cued, liveKey: key, liveSnap: slide }
  return cued
}
```

`goLive`'s fresh-state branch must now spread `st` so the cue survives:

```ts
export function goLive(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output === 'live' && st.liveKey === key) return { ...st, output: 'black' }
  return { ...st, output: 'live', liveKey: key, liveSnap: slide }
}
```

In `src/renderer/operator/useHelm.ts:5` update the initial literal:

```ts
const [st, setSt] = useState<PresentationState>({ output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null });
```

- [ ] **Step 4: Fix other PresentationState literals** — run `grep -rn "liveSnap:" src --include="*.test.tsx" --include="*.test.ts"` and add `cuedKey: ..., cuedSnap: ...` to every object literal typed as `PresentationState` (in `LeaderView.test.tsx` set `cuedKey`/`cuedSnap` to the same values as `liveKey`/`liveSnap` in each state — that keeps those tests meaningful once Task 6 makes LeaderView follow the cue; elsewhere `cuedKey: null, cuedSnap: null` is fine). Literals with an `as PresentationState` cast compile either way but update them too.

- [ ] **Step 5: Run** — `npx vitest run src/shared/presentation/core.test.ts` then `npm test`. Expected: PASS. Also `npx tsc --noEmit -p tsconfig.json 2>/dev/null || npm run typecheck 2>/dev/null || true` — if a typecheck script exists, it must pass.

- [ ] **Step 6: Commit** — `git add -A src && git commit -m "feat(presentation): record cuedKey/cuedSnap in shared state"`

---

### Task 2: Song key field (schema → repo → QuickAdd)

**Files:**
- Modify: `src/main/schema.ts:5-12` (songs table)
- Modify: `src/main/db.ts` (column migration for existing DBs)
- Modify: `src/shared/types.ts:5-11` (Song, NewSongInput)
- Modify: `src/main/songsRepo.ts`
- Modify: `src/renderer/operator/QuickAdd.tsx`
- Test: `src/main/songsRepo.test.ts`, `src/renderer/operator/QuickAdd.test.tsx`

**Interfaces:**
- Produces: `Song.key?: string` (absent when unset, never `''`), `NewSongInput.key?: string`. SQLite column is named `music_key` (`key` is an SQL keyword; don't fight it). Tasks 3 and 6 read `song.key`.

- [ ] **Step 1: Write the failing repo test** — in `src/main/songsRepo.test.ts`:

```ts
test('add persists an optional musical key and round-trips it', () => {
  const withKey = repo.add({ title: 'Blessed Assurance', text: 'Verse 1\nBlessed assurance', key: 'D' });
  expect(repo.get(withKey.id)?.key).toBe('D');
  const without = repo.add({ title: 'No Key', text: 'Verse 1\nx' });
  expect(repo.get(without.id)?.key).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/main/songsRepo.test.ts`. Expected: FAIL (`key` does not exist on NewSongInput / undefined ≠ 'D').

- [ ] **Step 3: Implement** — `src/shared/types.ts`:

```ts
export interface Song {
  id: string; title: string; author: string;
  sections: SongSection[]; source: string; createdAt: number;
  /** Musical key, e.g. "G", "Bb", "F#m". Absent when not set. */
  key?: string;
}
export interface NewSongInput { title: string; author?: string; text: string; source?: string; key?: string }
```

`src/main/schema.ts` — add the column to the CREATE TABLE:

```sql
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  sections_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'local',
  created_at INTEGER NOT NULL,
  music_key TEXT NOT NULL DEFAULT ''
);
```

`src/main/db.ts` — existing DBs were created before the column (CREATE TABLE IF NOT EXISTS won't add it); migrate:

```ts
import Database from 'better-sqlite3';
import { SCHEMA } from './schema';

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  const songCols = db.prepare('PRAGMA table_info(songs)').all() as { name: string }[];
  if (!songCols.some((c) => c.name === 'music_key'))
    db.exec(`ALTER TABLE songs ADD COLUMN music_key TEXT NOT NULL DEFAULT ''`);
  return db;
}
```

`src/main/songsRepo.ts`:

```ts
interface Row { id: string; title: string; author: string; sections_json: string; source: string; created_at: number; music_key: string; rowid: number }
const toSong = (r: Row): Song => ({
  id: r.id, title: r.title, author: r.author, sections: JSON.parse(r.sections_json),
  source: r.source, createdAt: r.created_at, ...(r.music_key ? { key: r.music_key } : {})
});
```

In `createSongsRepo`, the insert statement and `add`:

```ts
const insertSong = db.prepare('INSERT INTO songs (id, title, author, sections_json, source, created_at, music_key) VALUES (?,?,?,?,?,?,?)');
```

```ts
add(input) {
  const sections = splitToSlides(input.text);
  if (!sections.length) throw new Error('Song has no content');
  const key = input.key?.trim();
  const song: Song = { id: randomUUID(), title: input.title.trim() || 'Untitled Song', author: input.author?.trim() ?? '', sections, source: input.source ?? 'local', createdAt: Date.now(), ...(key ? { key } : {}) };
  db.transaction(() => {
    insertSong.run(song.id, song.title, song.author, JSON.stringify(song.sections), song.source, song.createdAt, key ?? '');
    insertFts.run(song.id, song.title, song.author, lyricsOf(song));
  })();
  return song;
},
```

Check `src/main/testDb.ts` applies `SCHEMA` (it does per its header comment) — new test DBs get the column automatically; no change needed there.

- [ ] **Step 4: Run repo tests** — `npx vitest run src/main/songsRepo.test.ts`. Expected: PASS.

- [ ] **Step 5: QuickAdd key input (failing test first)** — read `src/renderer/operator/QuickAdd.test.tsx` and add a test in its existing stub style (reuse that file's `window.helm` stub setup; the assertion below is the contract):

```tsx
it('passes a typed key through to songs.add and omits it when blank', async () => {
  // arrange: stub window.helm.songs.add capturing its input, render <QuickAdd open .../>
  // act: type title + lyrics, type "G" into the input with placeholder "Key",
  //      click "Add to library"
  // assert: captured input.key === 'G'
  // repeat without typing a key: captured input.key is undefined
})
```

Run it, verify it fails (no "Key" input exists yet).

- [ ] **Step 6: Implement QuickAdd field** — in `QuickAdd.tsx` add state near the other fields (`songKey`, not `key`, to avoid React's reserved prop connotations in the file):

```tsx
const [songKey, setSongKey] = useState('');
```

In the paste-tab title/author row (the `<div style={{ display: 'flex', gap: '10px' }}>` around line 247), append after the author input:

```tsx
<input
  style={{ ...titleStyle, width: '90px', flex: 'none', fontWeight: 500 }}
  value={songKey}
  onChange={(e) => setSongKey(e.target.value)}
  placeholder="Key"
  title="Musical key (optional), e.g. G or Bb"
/>
```

In `save()` after the author line:

```tsx
if (songKey.trim()) input.key = songKey.trim();
```

- [ ] **Step 7: Run** — `npx vitest run src/renderer/operator/QuickAdd.test.tsx`. Expected: PASS.

- [ ] **Step 8: Commit** — `git add -A src && git commit -m "feat(songs): optional musical key on songs, editable in QuickAdd"`

---

### Task 3: Lyrics slide carries sectionLabel/songKey; audience shows them

**Files:**
- Modify: `src/shared/types.ts:26-32` (Slide)
- Modify: `src/renderer/operator/SongsMode.tsx:36-43` (slideFor)
- Modify: `src/renderer/shared/SlideCanvas.tsx`
- Test: `src/renderer/shared/SlideCanvas.test.tsx`, `src/renderer/operator/SongsMode.test.tsx`

**Interfaces:**
- Consumes: `Song.key` (Task 2).
- Produces: `Slide.sectionLabel?: string`, `Slide.songKey?: string` on lyrics slides; audience-variant label element with `data-testid="audience-label"`. Task 6's hero title also reads `song.key` directly (not via slide).

- [ ] **Step 1: Write the failing tests** — in `src/renderer/shared/SlideCanvas.test.tsx` (match the file's existing render helpers):

```tsx
it('audience variant shows the section label and key on lyrics slides', () => {
  const r = render(
    <SlideCanvas variant="audience" slide={{ kind: 'lyrics', lines: ['x'], label: 'Song · Verse 1', sectionLabel: 'Verse 1', songKey: 'G' }} />
  )
  expect(r.getByTestId('audience-label').textContent).toBe('Verse 1 · Key G')
})
it('audience label omits the key when unset and hides entirely with no fields', () => {
  const withLabel = render(
    <SlideCanvas variant="audience" slide={{ kind: 'lyrics', lines: ['x'], sectionLabel: 'Chorus' }} />
  )
  expect(withLabel.getByTestId('audience-label').textContent).toBe('Chorus')
  cleanup()
  const bare = render(<SlideCanvas variant="audience" slide={{ kind: 'lyrics', lines: ['x'] }} />)
  expect(bare.queryByTestId('audience-label')).toBeNull()
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/renderer/shared/SlideCanvas.test.tsx`. Expected: FAIL (no `audience-label` testid).

- [ ] **Step 3: Implement** — `src/shared/types.ts`, extend `Slide`:

```ts
export interface Slide {
  kind: SlideKind; accent?: string; label?: string; lines?: string[];
  ref?: string; columns?: SlideColumn[]; text?: string; source?: string;
  title?: string; subtitle?: string; points?: string[];
  bg?: string; src?: string;
  paras?: { label: string; text: string }[]; activeOrd?: number;
  /** Lyrics only: bare section label ("Verse 1") and song key ("G") for view-side chrome.
   *  `label` above stays the pre-baked "Title · Section" string stage/livestream render. */
  sectionLabel?: string; songKey?: string;
}
```

`SongsMode.tsx` `slideFor`:

```tsx
function slideFor(song: Song, section: { label: string; lines: string[] }): Slide {
  return {
    kind: 'lyrics',
    accent: '#e0a341',
    label: `${song.title} · ${section.label}`,
    lines: section.lines,
    sectionLabel: section.label,
    ...(song.key ? { songKey: song.key } : {})
  };
}
```

`SlideCanvas.tsx` — near the `showLabel` block (line ~267), add:

```tsx
const isAudience = variant === 'audience';
const audienceLabelText = [s.sectionLabel, s.songKey ? `Key ${s.songKey}` : '']
  .filter(Boolean)
  .join(' · ');
const showAudienceLabel = isAudience && kind === 'lyrics' && !!audienceLabelText;
const audienceLabelStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: '3.2cqmin',
  zIndex: 5,
  textAlign: 'center',
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: 'clamp(7px,2.2cqmin,14px)',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,.34)'
};
```

And in the JSX next to the existing `{showLabel && ...}` line:

```tsx
{showAudienceLabel && (
  <div style={audienceLabelStyle} data-testid="audience-label">
    {audienceLabelText}
  </div>
)}
```

- [ ] **Step 4: Run** — `npx vitest run src/renderer/shared/SlideCanvas.test.tsx src/renderer/operator/SongsMode.test.tsx`. Expected: PASS (if a SongsMode test asserts the exact `slideFor` shape, update it to include the new fields).

- [ ] **Step 5: Commit** — `git add -A src && git commit -m "feat(slides): lyrics slides carry sectionLabel/songKey; audience shows them"`

---

### Task 4: Lyric lines never wrap (audience + leader)

`useFitText` already tests `content.scrollWidth <= root.clientWidth` (`useFitText.ts:92`); with `nowrap` on each line the fitter shrinks the font until the longest authored line fits on one row. jsdom can't exercise the measurement (zero-size boxes), so the unit test pins the style contract; real behavior is verified in Task 8.

**Files:**
- Modify: `src/renderer/shared/SlideCanvas.tsx:80-88` (lineStyle)
- Modify: `src/renderer/output/LeaderView.tsx:108-113` (lineStyle)
- Test: `src/renderer/shared/SlideCanvas.test.tsx`

**Interfaces:**
- Produces: lyric line divs styled `white-space: nowrap` in both components. Task 6's rewrite must preserve this on the leader hero.

- [ ] **Step 1: Write the failing test** — in `SlideCanvas.test.tsx`:

```tsx
it('lyric lines are nowrap so the fitter, not the box, controls line breaks', () => {
  const r = render(<SlideCanvas variant="audience" slide={{ kind: 'lyrics', lines: ['Blessed assurance, Jesus is mine!'] }} />)
  const line = r.getByText('Blessed assurance, Jesus is mine!')
  expect(line.style.whiteSpace).toBe('nowrap')
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/renderer/shared/SlideCanvas.test.tsx`. Expected: FAIL (`'' !== 'nowrap'`).

- [ ] **Step 3: Implement** — `SlideCanvas.tsx` `lineStyle` gains `whiteSpace: 'nowrap'` (keep `maxWidth: '94%'` — it just provides side margin; overflow past it still registers in `scrollWidth`, which is what the fitter reads). `LeaderView.tsx` `lineStyle` gains `whiteSpace: 'nowrap'` the same way.

- [ ] **Step 4: Run** — `npx vitest run src/renderer/shared/SlideCanvas.test.tsx src/renderer/output/LeaderView.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A src && git commit -m "fix(output): lyric lines never soft-wrap; autofit respects song line structure"`

---

### Task 5: Leader split plumbing (settings → payload → IPC)

**Files:**
- Modify: `src/shared/displays/roles.ts` (constants + clamp/resolve helpers)
- Modify: `src/shared/types.ts` (OutputPayload, DisplayInfo, CH, HelmApi)
- Modify: `src/main/stateStore.ts` (per-window split, payload assembly)
- Modify: `src/main/displays.ts` (persistence, setters, DisplayInfo enrichment)
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`
- Test: `src/shared/displays/roles.test.ts`

**Interfaces:**
- Produces:
  - `roles.ts`: `LEADER_SPLIT_MIN = 220`, `LEADER_SPLIT_MAX = 560`, `DEFAULT_LEADER_SPLIT = 320`, `clampLeaderSplit(v: unknown): number`, `resolveLeaderSplit(saved: Record<string, number>, fingerprint: string): number`.
  - `OutputPayload.leaderSplit?: number` — rail width in px, always clamped; Task 6 reads it.
  - `DisplayInfo.leaderSplit: number | null` (null for the operator display); Task 7 reads it.
  - `window.helm.displays.setLeaderSplit(fingerprint: string | null, px: number): void` — `null` fingerprint means "the display of the window making the call" (used by the leader window itself); a string targets by fingerprint (operator popover).
  - `CH.displaysSetLeaderSplit = 'displays:setLeaderSplit'`; settings key `'displays:leaderSplits'` mapping fingerprint → px.
  - `stateStore`: `presentation.setOutputLeaderSplit(w, px)`; `registerOutput(w, variant, view, leaderSplit?)`.
  - `displays.ts`: `setLeaderSplitByFingerprint(fingerprint, px)`, `setLeaderSplitFromSender(sender: Electron.WebContents, px)`.

- [ ] **Step 1: Write the failing tests** — in `src/shared/displays/roles.test.ts`:

```ts
test('clampLeaderSplit clamps, rounds, and defaults non-numbers', () => {
  expect(clampLeaderSplit(320)).toBe(320)
  expect(clampLeaderSplit(10)).toBe(220)
  expect(clampLeaderSplit(9000)).toBe(560)
  expect(clampLeaderSplit(300.6)).toBe(301)
  expect(clampLeaderSplit(undefined)).toBe(320)
  expect(clampLeaderSplit('x')).toBe(320)
})
test('resolveLeaderSplit reads the saved value for a fingerprint, defaulting when absent', () => {
  expect(resolveLeaderSplit({ fp1: 400 }, 'fp1')).toBe(400)
  expect(resolveLeaderSplit({}, 'fp1')).toBe(320)
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/shared/displays/roles.test.ts`. Expected: FAIL (not exported).

- [ ] **Step 3: Implement shared pieces** — append to `src/shared/displays/roles.ts`:

```ts
/** Leader view hero/rail split: the rail's width in px. */
export const LEADER_SPLIT_MIN = 220;
export const LEADER_SPLIT_MAX = 560;
export const DEFAULT_LEADER_SPLIT = 320;
export function clampLeaderSplit(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_LEADER_SPLIT;
  return Math.max(LEADER_SPLIT_MIN, Math.min(LEADER_SPLIT_MAX, Math.round(n)));
}
export function resolveLeaderSplit(saved: Record<string, number>, fingerprint: string): number {
  return clampLeaderSplit(saved[fingerprint]);
}
```

`src/shared/types.ts`:

```ts
export interface OutputPayload { slide: Slide; variant: OutputVariant; view: OutputViewMode; leaderSplit?: number }
```

`DisplayInfo` gains (after `view`):

```ts
  leaderSplit: number | null;   // rail px for the leader view; null for the operator display
```

`CH` gains (after `displaysSetView`):

```ts
  displaysSetLeaderSplit: 'displays:setLeaderSplit',
```

`HelmApi.displays` gains:

```ts
    setLeaderSplit(fingerprint: string | null, px: number): void;
```

- [ ] **Step 4: Run shared tests** — `npx vitest run src/shared/displays/roles.test.ts`. Expected: PASS.

- [ ] **Step 5: Main-process plumbing** — `src/main/stateStore.ts`, extend the per-window tag and add a payload helper + setter:

```ts
import { DEFAULT_LEADER_SPLIT, clampLeaderSplit } from '../shared/displays/roles';

let state: PresentationState = initialPresentation();
const outputWindows = new Map<BrowserWindow, { variant: OutputVariant; view: OutputViewMode; leaderSplit: number }>();

function payloadFor(t: { variant: OutputVariant; view: OutputViewMode; leaderSplit: number }) {
  return { ...outputPayload(state, t.variant, t.view), leaderSplit: t.leaderSplit };
}
function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.presState, state);
  for (const [w, t] of outputWindows) if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, payloadFor(t));
}
```

`registerOutput` gains a fourth param `leaderSplit = DEFAULT_LEADER_SPLIT` stored in the map, and its `did-finish-load` handler sends `payloadFor(t)` (with the map-miss fallback becoming `{ variant: 'audience', view: 'slides', leaderSplit: DEFAULT_LEADER_SPLIT }`). `setOutputVariant`/`setOutputView` switch their direct `outputPayload(...)` sends to `payloadFor({ ...t, variant })` / `payloadFor({ ...t, view })`. Add, mirroring `setOutputView`:

```ts
  setOutputLeaderSplit(w: BrowserWindow, leaderSplit: number) {
    if (!outputWindows.has(w)) return;
    const t = outputWindows.get(w)!;
    const clamped = clampLeaderSplit(leaderSplit);
    outputWindows.set(w, { ...t, leaderSplit: clamped });
    if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, payloadFor({ ...t, leaderSplit: clamped }));
  },
```

`src/main/displays.ts` — persistence and live re-tag, mirroring the view path exactly:

```ts
import { ..., DEFAULT_LEADER_SPLIT, resolveLeaderSplit, clampLeaderSplit } from '../shared/displays/roles';

const SPLITS_KEY = 'displays:leaderSplits';
function savedSplits(): Record<string, number> {
  return settings?.get<Record<string, number>>(SPLITS_KEY, {}) ?? {};
}
```

- `Tracked` gains `leaderSplit: number`.
- `createOutputWindow` gains a fifth param `leaderSplit = DEFAULT_LEADER_SPLIT`, passed to `presentation.registerOutput(win, variant, view, leaderSplit)`.
- In `sync()`: `const splits = savedSplits();` before the plan loop; inside it `const leaderSplit = resolveLeaderSplit(splits, a.fingerprint);` — for an existing window, re-tag on change like `view` does (`presentation.setOutputLeaderSplit(existing.win, leaderSplit)`); for a new window pass it to `createOutputWindow(a.bounds, true, ROLE_VARIANT[a.role], view, leaderSplit)` and store it in `byDisplayId`.
- In the `lastDisplays` mapping: `leaderSplit: isOperator ? null : resolveLeaderSplit(splits, fingerprint),`.
- New exports:

```ts
export function setLeaderSplitByFingerprint(fingerprint: string, px: number): void {
  const clamped = clampLeaderSplit(px);
  const splits = savedSplits();
  splits[fingerprint] = clamped;
  settings?.set(SPLITS_KEY, splits);
  for (const t of byDisplayId.values()) {
    if (t.fingerprint === fingerprint && !t.win.isDestroyed()) {
      t.leaderSplit = clamped;
      presentation.setOutputLeaderSplit(t.win, clamped);
    }
  }
  lastDisplays = lastDisplays.map((d) =>
    !d.isOperator && d.fingerprint === fingerprint ? { ...d, leaderSplit: clamped } : d,
  );
  broadcastStatus();
}
// The leader window reports its own drag; it doesn't know its fingerprint, but main can
// resolve it from the sending WebContents. Test outputs (dev windows, no fingerprint)
// get a live re-tag only — nothing to persist against.
export function setLeaderSplitFromSender(sender: Electron.WebContents, px: number): void {
  for (const t of byDisplayId.values()) {
    if (t.win.webContents === sender) { setLeaderSplitByFingerprint(t.fingerprint, px); return; }
  }
  for (const w of testOutputs) {
    if (w.webContents === sender && !w.isDestroyed()) presentation.setOutputLeaderSplit(w, clampLeaderSplit(px));
  }
}
```

`src/main/ipc.ts` (after the `displaysSetView` line; extend the imports from `./displays`):

```ts
  ipcMain.on(CH.displaysSetLeaderSplit, (e, fp: string | null, px: number) =>
    fp === null ? setLeaderSplitFromSender(e.sender, px) : setLeaderSplitByFingerprint(fp, px));
```

`src/preload/index.ts` (in `displays`):

```ts
    setLeaderSplit: (fp, px) => ipcRenderer.send(CH.displaysSetLeaderSplit, fp, px),
```

- [ ] **Step 6: Fix DisplayInfo test literals** — `grep -rn "isOperator" src --include="*.test.tsx"` (expect `DisplaysSettings.test.tsx`, `OutputViewPopover.test.tsx`) and add `leaderSplit: null` (operator entries) / `leaderSplit: 320` (output entries) to each `DisplayInfo` literal.

- [ ] **Step 7: Run** — `npm test`. Expected: PASS.

- [ ] **Step 8: Commit** — `git add -A src && git commit -m "feat(displays): per-display leader split setting, delivered on the output payload"`

---

### Task 6: LeaderView — operator theme, cue-following, full-line rail, draggable split

Rewrite of `src/renderer/output/LeaderView.tsx`. Everything the current file does right is kept: the song fetch with identity gating, the SlidesView fallback, `useFitText` on the hero, the `leader-view`/`leader-rail`/`leader-section-i` testids.

**Files:**
- Modify: `src/renderer/output/LeaderView.tsx` (full rewrite)
- Test: `src/renderer/output/LeaderView.test.tsx`

**Interfaces:**
- Consumes: `st.cuedKey`/`st.cuedSnap` (Task 1), `song.key` (Task 2), nowrap contract (Task 4), `payload.leaderSplit` + `window.helm.displays.setLeaderSplit(null, px)` + `clampLeaderSplit`/`DEFAULT_LEADER_SPLIT` (Task 5), `DARK` theme from `src/shared/theme.ts`.
- Produces: testids `leader-view`, `leader-rail`, `leader-section-${i}` with `data-live` (true on the section currently displayed in the hero), new `leader-divider`, chip text `LIVE` / `CUED` (plus existing `LOGO` / `BLACK`).

- [ ] **Step 1: Update/extend the tests first** — rework `LeaderView.test.tsx`:

1. Update the `payload` helper: `({ slide: ..., variant: 'stage', view: 'leader', leaderSplit: 320 })`.
2. Existing tests: states already carry `cuedKey`/`cuedSnap` mirroring live (Task 1 Step 4). The rail-snippet expectations change: the rail now renders **all** lines of every section, so the first test's "live line appears twice" comment still holds. The LOGO test now also shows `CUED`? No — logo state with `cuedKey === liveKey` displays the live section; chip set is `LIVE`? The hero tracks the cue; whether it's "LIVE" depends on `output === 'live' && displayedKey === liveKey`. On logo output that's false, so the chips are `CUED` + `LOGO`. Update that test to assert both `LOGO` and `CUED` are present.
3. New tests:

```tsx
it('follows the cued section immediately, without go-live, and shows CUED', async () => {
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
  // Hero shows the CUED section (Verse 2), not the live one.
  expect(r.getByTestId('leader-section-1').dataset.live).toBe('true')
  expect(r.getByText('CUED')).toBeTruthy()
  expect(r.queryByText('LIVE')).toBeNull()
})
it('shows LIVE when the displayed section is what the congregation sees', async () => {
  const snap = { kind: 'lyrics' as const, accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines }
  const st: PresentationState = { output: 'live', liveKey: 'song:s1:0', liveSnap: snap, cuedKey: 'song:s1:0', cuedSnap: snap }
  installHelmStub(st)
  const r = render(<LeaderView payload={payload(st)} />)
  await waitFor(() => expect(r.getByText('LIVE')).toBeTruthy())
})
it('renders every line of every section in the rail', async () => {
  // Give SONG a multi-line section in this test's own Song fixture or extend SONG's
  // sections; assert the second line's text is present inside leader-rail.
})
it('shows the song key in the title row when set', async () => {
  // Song fixture with key: 'D' → expect text matching /Key D/ after the rail renders.
})
it('sizes the rail from payload.leaderSplit', async () => {
  // render with payload leaderSplit: 400 → getByTestId('leader-rail').style.width === '400px'
})
```

Flesh the last three out fully in the file (fixtures with `key: 'D'` and a section `{ label: 'Chorus', lines: ['line one', 'line two'] }`); the stub pattern is already in the file.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/renderer/output/LeaderView.test.tsx`. Expected: new tests FAIL (hero tracks live, no chips, snippet-only rail, fixed 30% width).

- [ ] **Step 3: Rewrite `LeaderView.tsx`** —

```tsx
import { useEffect, useRef, useState, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react'
import type { OutputPayload, Song } from '../../shared/types'
import { parseSongKey } from '../../shared/presentation/core'
import { DEFAULT_LEADER_SPLIT, LEADER_SPLIT_MAX, LEADER_SPLIT_MIN, clampLeaderSplit } from '../../shared/displays/roles'
import { bandCandidates } from '../../shared/slides/fitText'
import { useFitText, fitSizeValue } from '../shared/useFitText'
import { usePresentationState } from '../operator/useHelm'
import { DARK as T } from '../../shared/theme'
import { SlidesView } from './SlidesView'

const LEADER_BAND = bandCandidates(10.5, 3.5)

export function LeaderView({ payload }: { payload: OutputPayload }): JSX.Element {
  const st = usePresentationState()
  // The leader follows the operator's selection (cue), not the projector: a cued section
  // shows here immediately, before Go live. Falls back to the live key so a leader window
  // opened mid-service (no cue recorded yet) still shows the song on screen.
  const shownKey = st.cuedKey ?? st.liveKey
  const parsed = parseSongKey(shownKey)
  const [song, setSong] = useState<Song | null>(null)
  useEffect(() => {
    if (!parsed) return
    let live = true
    void window.helm.songs
      .get(parsed.songId)
      .then((s) => { if (live) setSong(s) })
      .catch((err: unknown) => { console.error('[helm] leader song fetch failed:', err) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.songId])

  // Split: payload value is authoritative between drags; local state carries the live drag.
  const [split, setSplit] = useState(() => clampLeaderSplit(payload.leaderSplit ?? DEFAULT_LEADER_SPLIT))
  const [dragging, setDragging] = useState(false)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!dragging) setSplit(clampLeaderSplit(payload.leaderSplit ?? DEFAULT_LEADER_SPLIT))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.leaderSplit])
  useEffect(() => () => dragCleanupRef.current?.(), [])
  const startDrag = (e: ReactMouseEvent): void => {
    e.preventDefault()
    if (dragCleanupRef.current) return
    const startX = e.clientX
    const startW = split
    let latest = startW
    const onMove = (ev: MouseEvent): void => {
      // Rail is right-anchored: dragging left grows it.
      latest = clampLeaderSplit(startW - (ev.clientX - startX))
      setSplit(latest)
    }
    const cleanup = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      dragCleanupRef.current = null
    }
    const onUp = (): void => {
      cleanup()
      setDragging(false)
      window.helm.displays.setLeaderSplit(null, latest)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    dragCleanupRef.current = cleanup
    setDragging(true)
  }

  const rootRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const current = parsed && song && song.id === parsed.songId ? song : null
  const section = current && parsed ? current.sections[parsed.section] : undefined
  useFitText(rootRef, heroRef, section ? LEADER_BAND : null, [shownKey, song?.id, split])

  if (!parsed || !current || !section)
    return (
      <div data-testid="leader-view" style={{ position: 'fixed', inset: 0 }}>
        <SlidesView payload={payload} />
      </div>
    )

  const isLive = st.output === 'live' && st.liveKey === shownKey
  const outChip = st.output === 'logo' ? 'LOGO' : st.output === 'black' ? 'BLACK' : null

  const rootStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: T.appBg,
    color: T.text,
    display: 'flex',
    fontFamily: "'Hanken Grotesk',sans-serif"
  }
  const heroWrapStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: '3cqmin 0 3cqmin 4cqmin',
    containerType: 'size'
  }
  const heroMiddleStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    containerType: 'size',
    overflow: 'hidden'
  }
  const titleRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexShrink: 0,
    fontFamily: "'JetBrains Mono',monospace",
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontSize: 'max(12px, 2.2cqmin)',
    color: T.faint
  }
  const chipStyle = (color: string): CSSProperties => ({
    padding: '2px 10px',
    borderRadius: '6px',
    background: `${color}2b`,
    color,
    fontWeight: 700
  })
  const lineStyle: CSSProperties = {
    fontWeight: 700,
    lineHeight: 1.22,
    letterSpacing: '-0.012em',
    whiteSpace: 'nowrap',
    color: T.text,
    fontSize: `max(14px, ${fitSizeValue('7.4cqmin')})`
  }
  const dividerStyle: CSSProperties = {
    width: '12px',
    flexShrink: 0,
    cursor: 'col-resize',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
  const gripStyle: CSSProperties = {
    width: '3px',
    height: '44px',
    borderRadius: '2px',
    background: dragging ? T.accent : T.border
  }
  const railStyle: CSSProperties = {
    width: `${split}px`,
    flexShrink: 0,
    overflowY: 'auto',
    borderLeft: `1px solid ${T.hairline}`,
    background: T.panel,
    padding: '2.5cqmin 2cqmin',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    containerType: 'size'
  }
  // Rail text scales with rail width, same shape as the operator's SectionRail formula —
  // wider bounds because this screen is read from further away.
  const railFont = Math.round(Math.max(13, Math.min(26, split / 18)) * 10) / 10
  const sectionCardStyle = (active: boolean): CSSProperties => ({
    padding: '12px 14px',
    borderRadius: '11px',
    background: active ? '#221d10' : T.panel2,
    boxShadow: active ? `inset 0 0 0 2px ${T.accent}` : `inset 0 0 0 1px ${T.hairline}`
  })
  const sectionLabelStyle = (active: boolean): CSSProperties => ({
    fontFamily: "'JetBrains Mono',monospace",
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontSize: `${Math.max(10.5, railFont * 0.62)}px`,
    fontWeight: 600,
    color: active ? T.accent : T.faint,
    marginBottom: '6px'
  })
  const sectionLineStyle = (active: boolean): CSSProperties => ({
    fontSize: `${railFont}px`,
    lineHeight: 1.45,
    fontWeight: 500,
    color: active ? T.text : '#b4b1aa'
  })

  return (
    <div style={rootStyle} data-testid="leader-view">
      <div style={heroWrapStyle}>
        <div style={titleRowStyle}>
          <span>{current.title}</span>
          <span>· {section.label}</span>
          {current.key && <span>· Key {current.key}</span>}
          <span style={chipStyle(isLive ? T.live : T.accent)}>{isLive ? 'LIVE' : 'CUED'}</span>
          {outChip && <span style={chipStyle(T.accent)}>{outChip}</span>}
        </div>
        <div ref={rootRef} style={heroMiddleStyle}>
          <div
            ref={heroRef}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.8em', width: '100%', textAlign: 'center' }}
          >
            {section.lines.map((ln, i) => (
              <div key={i} style={lineStyle}>
                {ln}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={dividerStyle} data-testid="leader-divider" title="Drag to resize" onMouseDown={startDrag}>
        <div style={gripStyle} />
      </div>
      <div style={railStyle} data-testid="leader-rail">
        {current.sections.map((s, i) => {
          const active = parsed.section === i
          return (
            <div
              key={i}
              style={sectionCardStyle(active)}
              data-testid={`leader-section-${i}`}
              data-live={String(active)}
            >
              <div style={sectionLabelStyle(active)}>{s.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {s.lines.map((ln, j) => (
                  <div key={j} style={sectionLineStyle(active)}>
                    {ln}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

Notes for the implementer:
- The stale-song identity gate (`song.id === parsed.songId`) and the fetch-effect comments from the old file are preserved in spirit; carry the original comments over where they still apply (fetch fallback, identity gating).
- `data-live` now means "the section shown in the hero" (which is the cued one); the test suite from Step 1 encodes that.
- The old file's `MirrorView`-style `whiteSpace: nowrap` rail snippet is gone — full lines now.

- [ ] **Step 4: Run** — `npx vitest run src/renderer/output/LeaderView.test.tsx src/renderer/output/OutputApp.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A src && git commit -m "feat(leader): operator-theme leader view — follows cue, full-line rail, draggable split"`

---

### Task 7: Operator-side split slider in the display popover

**Files:**
- Modify: `src/renderer/operator/OutputViewPopover.tsx`
- Test: `src/renderer/operator/OutputViewPopover.test.tsx`

**Interfaces:**
- Consumes: `DisplayInfo.leaderSplit` and `window.helm.displays.setLeaderSplit(fingerprint, px)` (Task 5), `LEADER_SPLIT_MIN/MAX`, `DEFAULT_LEADER_SPLIT` from roles.
- Produces: `<input type="range" data-testid={`split-${fingerprint}`}>` rendered only for outputs whose `view === 'leader'`.

- [ ] **Step 1: Write the failing tests** — in `OutputViewPopover.test.tsx`, following the file's existing stub/render helpers:

```tsx
it('shows a leader-split slider only for leader-view outputs and sends changes by fingerprint', () => {
  // displays fixture: one output with view: 'leader', leaderSplit: 320, fingerprint 'fpL';
  //                   one output with view: 'slides', fingerprint 'fpS'
  // - getByTestId('split-fpL') exists; queryByTestId('split-fpS') is null
  // - fireEvent.change(slider, { target: { value: '400' } })
  //   → setLeaderSplit stub called with ('fpL', 400)
  // - the popover does NOT close on slider change (onClose not called)
})
```

Write it out fully against the file's existing `window.helm` stub (it already stubs `displays`; add a `setLeaderSplit` spy).

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/renderer/operator/OutputViewPopover.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement** — in `OutputViewPopover.tsx`, import `DEFAULT_LEADER_SPLIT, LEADER_SPLIT_MAX, LEADER_SPLIT_MIN` from `'../../shared/displays/roles'`. Inside the `outputs.map` row, after the segmented view buttons block (keep it inside the same `key`ed wrapper — wrap the existing row content and the new slider row in a fragment or column div):

```tsx
{d.view === 'leader' && (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 8px 6px' }}>
    <span style={{ ...roleStyle, flexShrink: 0 }}>SPLIT</span>
    <input
      type="range"
      min={LEADER_SPLIT_MIN}
      max={LEADER_SPLIT_MAX}
      step={10}
      value={d.leaderSplit ?? DEFAULT_LEADER_SPLIT}
      data-testid={`split-${d.fingerprint}`}
      style={{ flex: 1, accentColor: T.accent }}
      onChange={(e) => window.helm.displays.setLeaderSplit(d.fingerprint, Number(e.target.value))}
    />
  </div>
)}
```

The slider re-renders from `useDisplayStatus` as `setLeaderSplitByFingerprint` re-broadcasts status — no local state needed. Do not call `onClose` here.

- [ ] **Step 4: Run** — `npx vitest run src/renderer/operator/OutputViewPopover.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A src && git commit -m "feat(displays): leader split slider in the output view popover"`

---

### Task 8: Full suite + live visual verification

**Files:**
- Create: `scratch/verify-display-views.mjs` (throwaway driver, not committed if scratch is untracked — it is)

**Interfaces:** none — verification only.

- [ ] **Step 1: Full test run** — `npm test`. Expected: all green. Fix anything broken before proceeding.

- [ ] **Step 2: Live verification** — model the driver on the existing `scratch/verify-*.mjs` scripts (e.g. `scratch/verify-direct-live.mjs` — same launch/CDP pattern; read it first). Drive this sequence and screenshot each state into `scratch/display-views-shots/`:
  1. Launch dev app, open a test output (`displays:openTest`), set its view to `leader` via `setDisplayView('test', 'leader')` (the `'test'` fingerprint path).
  2. Add a song with a deliberately long line ("Blessed assurance, Jesus is mine! Oh what a foretaste of glory divine!") and key "D".
  3. Select it in the operator (cue only, no go-live) → leader window shows the section with a CUED chip immediately.
  4. Go live → chip flips to LIVE. Open a second test output left as `slides` (audience): the long line renders on ONE line (shrunken), with "Verse 1 · Key D" at the bottom.
  5. Resize the leader window / drag the leader divider → hero text re-fits, no mid-line wrapping at any size; rail shows all lines of each section.
  6. Verify the operator popover slider moves the test leader window's split (test outputs take the live re-tag path).
- [ ] **Step 3: Check off spec acceptance** — walk the spec's Testing section and confirm each bullet; note any deviation in the final report rather than silently skipping.
- [ ] **Step 4: Final commit if the driver revealed fixes** — conventional-commit each fix separately.

---

## Self-review notes

- Spec §1 → Task 4; §2 → Tasks 2–3; §3 → Task 6; §4 → Tasks 5–7; §5 → Tasks 1, 6; §6 → Task 5. Error-handling rows: missing song fallback (Task 6 keeps it), absent key (Tasks 2–3 use optional-spread), split clamping (Task 5 `clampLeaderSplit` at every boundary).
- Type names cross-checked: `cuedKey`/`cuedSnap`, `Song.key`, `Slide.sectionLabel`/`songKey`, `OutputPayload.leaderSplit`, `DisplayInfo.leaderSplit`, `setLeaderSplit(fingerprint | null, px)`, `setLeaderSplitByFingerprint`/`setLeaderSplitFromSender`, `presentation.setOutputLeaderSplit`, `clampLeaderSplit`/`resolveLeaderSplit`/`DEFAULT_LEADER_SPLIT`/`LEADER_SPLIT_MIN`/`LEADER_SPLIT_MAX` — consistent across tasks.
- Known intentional deviations: the spec's "song editor" for the key is QuickAdd only (no standalone editor exists — quick-edit is a stub, `SongsMode.tsx:178`); the operator hero remains untouched per Non-goals.
