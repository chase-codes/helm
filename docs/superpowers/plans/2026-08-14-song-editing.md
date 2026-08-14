# Song Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement issue #4 — right-click → Edit on song rows (whole-song modal) and on section-rail cards (in-place quick edit), backed by a new transactional `songs:update` IPC channel that keeps the FTS index in sync.

**Architecture:** A sections-based `SongsRepo.update` rewrites `songs` + `song_fts` in one transaction. The section quick-edit patches one section's lines in place (Enter saves, Shift+Enter newline, Escape cancels); the whole-song path reuses `QuickAdd` in an edit mode fed by a text round-trip of the stored sections. After any save, `SongsMode.onSongSaved` updates the library, refreshes the active search, and re-cues — `applyCue`'s same-flow rule then silently swaps live projector text with no flicker.

**Tech Stack:** Electron (main/preload/renderer), React 19 inline-style components, better-sqlite3 + FTS5 (node:sqlite shim in tests), vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-14-song-editing-design.md`

## Global Constraints

- Never call `presentation.goLive` from any save path — on an already-live key it means take-down. Corrected live text reaches the projector only via `presentation.cue` (applyCue's same-flow silent swap).
- `songs` and `song_fts` must be written in the same `db.transaction` — a lagging FTS row keeps matching deleted text.
- Escape inside either editor is consumed (`stopPropagation` / handled-before-fallthrough) — a typo fix must never black the screen.
- `source` and `createdAt` are never changed by an update.
- Commit messages: concise conventional-commit subjects, no Co-Authored-By / Claude-Session trailers (CLAUDE.md).
- Tests run with `npx vitest run <file>` (config has no `globals: true`; jsdom tests need `// @vitest-environment jsdom` and explicit `afterEach(cleanup)`).

---

### Task 1: `SongsRepo.update` + `UpdateSongInput`

**Files:**
- Modify: `src/shared/types.ts` (~line 13, next to `NewSongInput`)
- Modify: `src/main/songsRepo.ts`
- Test: `src/main/songsRepo.test.ts`

**Interfaces:**
- Consumes: existing `Song`, `SongSection`, `lyricsOf` (`src/shared/songs/lyrics.ts`), `openTestDb`.
- Produces: `UpdateSongInput { title: string; author?: string; key?: string; sections: SongSection[] }` in `src/shared/types.ts`; `SongsRepo.update(id: string, input: UpdateSongInput): Song` (throws `'Song not found'` on unknown id, `'Song has no content'` when no section keeps a non-blank line). Later tasks call it only through `window.helm.songs.update`.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/songsRepo.test.ts`:

```ts
test('update rewrites title, author, key and sections', () => {
  const s = repo.add({ title: 'Old Title', author: 'Old Author', text: 'Verse 1\nold line one', key: 'C' });
  const updated = repo.update(s.id, {
    title: 'New Title',
    author: 'New Author',
    key: 'G',
    sections: [{ label: 'Verse 1', lines: ['new line one', 'new line two'] }],
  });
  expect(updated.title).toBe('New Title');
  const got = repo.get(s.id);
  expect(got?.title).toBe('New Title');
  expect(got?.author).toBe('New Author');
  expect(got?.key).toBe('G');
  expect(got?.sections).toEqual([{ label: 'Verse 1', lines: ['new line one', 'new line two'] }]);
});

test('update preserves source and createdAt, and can clear the key', () => {
  const s = repo.add({ title: 'T', text: 'Verse 1\nx', source: 'web', key: 'D' });
  const updated = repo.update(s.id, { title: 'T', sections: s.sections });
  expect(updated.source).toBe('web');
  expect(updated.createdAt).toBe(s.createdAt);
  expect(repo.get(s.id)?.key).toBeUndefined();
});

test('update reindexes FTS: new lyrics match, removed lyrics do not', () => {
  const s = repo.add({ title: 'Findable', text: 'Verse 1\nwonderful unique zebra' });
  repo.update(s.id, { title: 'Findable', sections: [{ label: 'Verse 1', lines: ['gracious mighty falcon'] }] });
  expect(repo.search('falcon', 'lyric').map((r) => r.song.id)).toContain(s.id);
  expect(repo.search('zebra', 'lyric').map((r) => r.song.id)).not.toContain(s.id);
});

test('update throws on unknown id and on empty sections', () => {
  const s = repo.add({ title: 'T', text: 'Verse 1\nx' });
  expect(() => repo.update('nope', { title: 'T', sections: s.sections })).toThrow('Song not found');
  expect(() => repo.update(s.id, { title: 'T', sections: [] })).toThrow('Song has no content');
  expect(() => repo.update(s.id, { title: 'T', sections: [{ label: 'Verse 1', lines: ['  '] }] })).toThrow('Song has no content');
  // failed update leaves the row untouched
  expect(repo.get(s.id)?.sections[0].lines).toEqual(['x']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/songsRepo.test.ts`
Expected: the four new tests FAIL with `repo.update is not a function`; existing tests still pass.

- [ ] **Step 3: Add the type and implement `update`**

In `src/shared/types.ts`, directly under `NewSongInput` (line 13):

```ts
export interface UpdateSongInput { title: string; author?: string; key?: string; sections: SongSection[] }
```

In `src/main/songsRepo.ts`:

1. Extend the import: `import type { NewSongInput, SearchField, Song, SongSearchResult, UpdateSongInput } from '../shared/types';` and add `lyricsOfSections` to the lyrics import: `import { lyricsOf, lyricsOfSections } from '../shared/songs/lyrics';`.
2. Add to the `SongsRepo` interface: `update(id: string, input: UpdateSongInput): Song;`.
3. Inside `createSongsRepo`, hoist `get` out of the returned object so `update` can reuse it (the object then references it as `get,`):

```ts
const get = (id: string): Song | null => {
  const r = db.prepare('SELECT rowid, * FROM songs WHERE id = ?').get(id) as Row | undefined;
  return r ? toSong(r) : null;
};
```

4. Add prepared statements next to `insertSong`/`insertFts`:

```ts
const updateSong = db.prepare('UPDATE songs SET title = ?, author = ?, sections_json = ?, music_key = ? WHERE id = ?');
const updateFts = db.prepare('UPDATE song_fts SET title = ?, author = ?, lyrics = ? WHERE rowid = (SELECT rowid FROM songs WHERE id = ?)');
```

5. Add the method to the returned object (mirror `add`'s trimming conventions):

```ts
update(id, input) {
  const existing = get(id);
  if (!existing) throw new Error('Song not found');
  const sections = input.sections
    .map((s) => ({ label: s.label, lines: s.lines.map((l) => l.trim()).filter(Boolean) }))
    .filter((s) => s.lines.length);
  if (!sections.length) throw new Error('Song has no content');
  const title = input.title.trim() || 'Untitled Song';
  const author = input.author?.trim() ?? '';
  const key = input.key?.trim() ?? '';
  const song: Song = {
    id, title, author, sections,
    source: existing.source, createdAt: existing.createdAt,
    ...(key ? { key } : {})
  };
  db.transaction(() => {
    updateSong.run(title, author, JSON.stringify(sections), key, id);
    updateFts.run(title, author, lyricsOfSections(sections), id);
  })();
  return song;
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/songsRepo.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/songsRepo.ts src/main/songsRepo.test.ts
git commit -m "feat(songs): SongsRepo.update rewrites song and FTS in one transaction"
```

---

### Task 2: `songs:update` IPC channel + preload

**Files:**
- Modify: `src/shared/types.ts` (`CH` map ~line 170; `HelmApi.songs` ~line 264)
- Modify: `src/main/ipc.ts` (~line 60)
- Modify: `src/preload/index.ts` (~line 14)

**Interfaces:**
- Consumes: `SongsRepo.update` from Task 1.
- Produces: `window.helm.songs.update(id: string, input: UpdateSongInput): Promise<Song>` — the only save entry point the renderer tasks use.

- [ ] **Step 1: Wire the channel**

In `src/shared/types.ts`:
- `CH` map line becomes: `songsGet: 'songs:get', songsAdd: 'songs:add', songsUpdate: 'songs:update',`
- In `HelmApi.songs`, after `add`: `update(id: string, input: UpdateSongInput): Promise<Song>;`

In `src/main/ipc.ts`, after the `songsAdd` handler (import `UpdateSongInput` in the existing type import from `../shared/types`):

```ts
ipcMain.handle(CH.songsUpdate, (_e, id: string, input: UpdateSongInput) => repo.update(id, input));
```

In `src/preload/index.ts`, after `add`:

```ts
update: (id, input) => ipcRenderer.invoke(CH.songsUpdate, id, input),
```

- [ ] **Step 2: Verify with typecheck**

Run: `npm run typecheck`
Expected: clean. (No runtime test — `ipc.ts` handlers have no test harness in this repo; the repo behavior is covered by Task 1 and the renderer contract by Tasks 4–6 mocks.)

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts src/main/ipc.ts src/preload/index.ts
git commit -m "feat(songs): songs:update IPC channel"
```

---

### Task 3: Section quick-edit — in-place editor + save/re-cue wiring

**Files:**
- Modify: `src/renderer/operator/SectionRail.tsx`
- Modify: `src/renderer/operator/SongsMode.tsx`
- Test: `src/renderer/operator/SongsMode.test.tsx`

**Interfaces:**
- Consumes: `window.helm.songs.update` (Task 2); existing `useContextMenu` (`open(e, items)` / `menu`), `keyForSong`, `slideFor`, `presentation.cue`.
- Produces:
  - `SectionRail` props gain: `editingIndex: number | null; editError: boolean; onSectionContextMenu: (i: number, e: ReactMouseEvent) => void; onEditSave: (i: number, lines: string[]) => void; onEditCancel: () => void;`
  - `SongsMode` internal `onSongSaved(song: Song): void` — Task 6 reuses it for the modal path.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/operator/SongsMode.test.tsx`. The stubs need `update` support: extend `installHelmStubWith`'s return object with an `update` mock — inside the function add

```ts
const update = vi.fn((id: string, input: { title: string; sections: { label: string; lines: string[] }[] }) =>
  Promise.resolve({ ...songs.find((s) => s.id === id)!, title: input.title, sections: input.sections })
);
```

pass `update` into the `songs: { ... }` object, and add `update` to the returned record (and to the function's return type). Also extend the plain `installHelmStub`'s `songs` object with `update: vi.fn()` so unrelated tests can't crash on the new call.

```tsx
describe('section quick-edit', () => {
  const openSectionEditor = async (): Promise<HTMLTextAreaElement> => {
    // SONGS has one section, 'Verse 1' / ['Amazing grace']
    await screen.findByText('Amazing grace');
    fireEvent.contextMenu(screen.getAllByText('Amazing grace').at(-1)!);
    fireEvent.click(screen.getByText('Edit'));
    return (await screen.findByDisplayValue('Amazing grace')) as HTMLTextAreaElement;
  };

  it('right-click → Edit swaps the card lines for a textarea, without cueing elsewhere', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    const box = await openSectionEditor();
    expect(box.value).toBe('Amazing grace');
    expect(document.activeElement).toBe(box);
  });

  it('Enter saves: songs.update gets the patched section and the fresh slide is re-cued', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    const box = await openSectionEditor();
    fireEvent.change(box, { target: { value: 'Amazing grace fixed\nsecond line' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() =>
      expect(h.update).toHaveBeenCalledWith('s1', {
        title: 'Amazing Grace',
        author: 'John Newton',
        sections: [{ label: 'Verse 1', lines: ['Amazing grace fixed', 'second line'] }]
      })
    );
    // re-cue carries the corrected lines; goLive is never used from a save path
    await waitFor(() =>
      expect(h.cue).toHaveBeenCalledWith(
        'song:s1:0',
        expect.objectContaining({ lines: ['Amazing grace fixed', 'second line'] })
      )
    );
    expect(h.goLive).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByDisplayValue(/fixed/)).toBeNull());
  });

  it('Shift+Enter does not save', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    const box = await openSectionEditor();
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(h.update).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Amazing grace')).toBeTruthy();
  });

  it('Escape cancels the edit, keeps the old lines, and never blacks the screen', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    const box = await openSectionEditor();
    fireEvent.change(box, { target: { value: 'half-typed junk' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByDisplayValue('half-typed junk')).toBeNull();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.setOutput).not.toHaveBeenCalled();
    expect(screen.getAllByText('Amazing grace').length).toBeGreaterThan(0);
  });

  it('a blank-only draft cancels instead of saving', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    const box = await openSectionEditor();
    fireEvent.change(box, { target: { value: '   \n  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(h.update).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('a failed save keeps the editor and the draft, and shows an error', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    h.update.mockImplementation(() => Promise.reject(new Error('boom')));
    renderMode(keyHandlerRef);
    const box = await openSectionEditor();
    fireEvent.change(box, { target: { value: 'Amazing grace fixed' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByText(/Couldn’t save/);
    expect(screen.getByDisplayValue('Amazing grace fixed')).toBeTruthy();
  });

  it('saving refreshes an active search so results reflect the edit', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    fireEvent.change(await screen.findByPlaceholderText('Title or a lyric line…'), { target: { value: 'grace' } });
    await waitFor(() => expect(h.search).toHaveBeenCalledWith('grace', 'all'));
    h.search.mockClear();
    const box = await openSectionEditor();
    fireEvent.change(box, { target: { value: 'Amazing grace fixed' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(h.search).toHaveBeenCalledWith('grace', 'all'));
  });
});
```

Note: `installHelmStubWith` must also return `search` for the last test — add the existing `search` spy to its return object if it isn't there.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx`
Expected: new tests FAIL (no `Edit` menu item on section cards / no textarea); existing tests PASS.

- [ ] **Step 3: Implement the SectionRail editor**

In `src/renderer/operator/SectionRail.tsx`:

1. Extend imports: `import { useEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';`
2. Extend `SectionRailProps` with the five props listed in **Interfaces** above.
3. Add an internal editor component (draft state stays local so a re-render of the rail can't clobber typing):

```tsx
interface SectionEditorProps {
  theme: Theme;
  initial: string;
  font: number;
  error: boolean;
  onSave: (lines: string[]) => void;
  onCancel: () => void;
}

// In-place quick edit for one section's lines. Enter saves, Shift+Enter inserts a
// newline, Escape cancels; both keys stop propagation so the global key dispatcher
// (go-live / take-down chain) never sees them. Blur = click-outside = cancel.
function SectionEditor({ theme: T, initial, font, error, onSave, onCancel }: SectionEditorProps): JSX.Element {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      onSave(value.split('\n'));
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };
  const style: CSSProperties = {
    width: '100%',
    padding: 0,
    border: 'none',
    outline: 'none',
    resize: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: `${font}px`,
    lineHeight: 1.45,
    fontWeight: 500,
    color: T.text
  };
  return (
    <div>
      <textarea
        ref={ref}
        rows={Math.max(3, value.split('\n').length + 1)}
        style={style}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onCancel}
      />
      {error && <div style={{ fontSize: '11px', color: T.live, marginTop: '4px' }}>Couldn’t save — try again</div>}
    </div>
  );
}
```

4. In the section map, render the editing card as a `div` (a textarea inside a `button` is invalid HTML and would re-fire `onSelect`), everything else unchanged:

```tsx
{sections.map((sc, i) => {
  const isCued = i === cuedIndex;
  const isLive = isSectionLive(i);
  const showBadge = isCued || isLive;
  const isEditing = i === editingIndex;
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
      <div style={secLabelStyle(isCued)}>{sc.label}</div>
      {showBadge && (
        <div style={secBadgeStyle(isLive)}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
          {isLive ? 'LIVE' : 'CUED'}
        </div>
      )}
    </div>
  );
  if (isEditing) {
    return (
      <div key={i} style={secRowStyle(isCued, isLive)}>
        {header}
        <SectionEditor
          theme={T}
          initial={sc.lines.join('\n')}
          font={secFont}
          error={editError}
          onSave={(lines) => onEditSave(i, lines)}
          onCancel={onEditCancel}
        />
      </div>
    );
  }
  return (
    <button
      key={i}
      ref={i === cuedIndex ? cuedRef : undefined}
      style={secRowStyle(isCued, isLive)}
      onClick={() => onSelect(i)}
      onContextMenu={(e) => onSectionContextMenu(i, e)}
    >
      {header}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {sc.lines.map((ln, j) => (
          <div key={j} style={secLineStyle(isCued)}>
            {ln}
          </div>
        ))}
      </div>
    </button>
  );
})}
```

(`Theme` is already imported as a type; `secRowStyle`'s `cursor: 'pointer'` is fine on the editing div.)

- [ ] **Step 4: Wire SongsMode**

In `src/renderer/operator/SongsMode.tsx`:

1. State, next to the other song-view state:

```tsx
const [editingSection, setEditingSection] = useState<number | null>(null);
const [editError, setEditError] = useState(false);
```

2. Reset when the active song changes — the file's existing render-time-adjustment idiom (see the `prevOutput` block), not an effect:

```tsx
// A quick-edit in flight belongs to ONE song; if the selection moves (arrow keys,
// live-lock reconciliation, switch commit), the editor must not survive onto the
// next song's section at the same index. Same render-time-adjustment shape as
// `prevOutput` above.
const [editingSongId, setEditingSongId] = useState(activeSongId);
if (editingSongId !== activeSongId) {
  setEditingSongId(activeSongId);
  if (editingSection !== null) setEditingSection(null);
  if (editError) setEditError(false);
}
```

3. The shared post-save path (place after `selectSong`; Task 6 reuses it):

```tsx
// One post-save path for both editors (spec §4): refresh the library row, keep an
// active search honest, and re-cue so the leader — and, via applyCue's same-flow
// swap, a live projector — shows the corrected text. cue, never goLive: goLive on
// the already-live key means take-down.
const onSongSaved = (song: Song): void => {
  setLibrary((prev) => prev.map((s) => (s.id === song.id ? song : s)));
  const query = q.trim();
  if (query) {
    void window.helm.songs.search(query, field).then((r) => {
      if (mountedRef.current) setResults(r);
    }).catch(console.error);
    if (field === 'title') {
      void window.helm.songs.search(query, 'lyric').then((r) => {
        if (mountedRef.current) setLyricHint(r);
      }).catch(console.error);
    }
  }
  if (song.id === activeSongId && song.sections.length) {
    const idx = Math.max(0, Math.min(clampedSection, song.sections.length - 1));
    window.helm.presentation.cue(keyForSong(song.id, idx), slideFor(song, song.sections[idx]));
  }
};
```

4. The quick-edit handlers:

```tsx
const onSectionContextMenu = (i: number, e: ReactMouseEvent): void => {
  contextMenu.open(e, [
    { label: 'Edit', onSelect: () => { setEditError(false); setEditingSection(i); } }
  ]);
};

const saveSection = (i: number, rawLines: string[]): void => {
  const song = activeSong;
  const prev = song?.sections[i];
  if (!song || !prev) {
    setEditingSection(null);
    return;
  }
  const lines = rawLines.map((l) => l.trim()).filter(Boolean);
  // Blank or unchanged drafts cancel — no half-saved state, no empty sections.
  if (!lines.length || lines.join('\n') === prev.lines.join('\n')) {
    setEditingSection(null);
    return;
  }
  const sections = song.sections.map((s, j) => (j === i ? { ...s, lines } : s));
  const input: UpdateSongInput = { title: song.title, sections };
  if (song.author) input.author = song.author;
  if (song.key) input.key = song.key;
  window.helm.songs.update(song.id, input).then(
    (saved) => {
      setEditingSection(null);
      setEditError(false);
      onSongSaved(saved);
    },
    () => setEditError(true)
  );
};
```

Imports to extend: `type MouseEvent as ReactMouseEvent` from `react`; `UpdateSongInput` in the `../../shared/types` type import.

5. Pass the new props to `<SectionRail>`:

```tsx
editingIndex={editingSection}
editError={editError}
onSectionContextMenu={onSectionContextMenu}
onEditSave={saveSection}
onEditCancel={() => { setEditingSection(null); setEditError(false); }}
```

6. Escape ordering in the `onEscape` handler: after the modal checks, before the `armedNextId` check (the SectionEditor consumes Escape itself when focused; this covers focus having wandered):

```tsx
if (editingSection !== null) {
  setEditingSection(null);
  setEditError(false);
  return true;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx`
Expected: all PASS (new and existing).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/SectionRail.tsx src/renderer/operator/SongsMode.tsx src/renderer/operator/SongsMode.test.tsx
git commit -m "feat(songs): in-place section quick-edit from the section rail"
```

---

### Task 4: `sectionsToText` round-trip helper

**Files:**
- Create: `src/shared/songs/sectionsToText.ts`
- Test: `src/shared/songs/sectionsToText.test.ts`

**Interfaces:**
- Consumes: `SongSection` type; `splitToSlides` (test only).
- Produces: `sectionsToText(sections: SongSection[]): string` — Task 5 uses it to prefill the edit modal's textarea.

- [ ] **Step 1: Write the failing tests**

Create `src/shared/songs/sectionsToText.test.ts`:

```ts
import { expect, test } from 'vitest';
import { sectionsToText } from './sectionsToText';
import { splitToSlides } from './splitToSlides';

test('emits label lines and blank-line stanza separators', () => {
  expect(
    sectionsToText([
      { label: 'Verse 1', lines: ['line a', 'line b'] },
      { label: 'Chorus', lines: ['line c'] }
    ])
  ).toBe('Verse 1\nline a\nline b\n\nChorus\nline c');
});

test('round-trips through splitToSlides: labels and lines survive', () => {
  const sections = [
    { label: 'Verse 1', lines: ['Amazing grace! how sweet the sound'] },
    { label: 'Chorus', lines: ['Praise God', 'from whom all blessings flow'] },
    { label: 'Verse 2', lines: ['Chorus of angels sing'] }, // lyric line that LOOKS like a label
    { label: 'Bridge', lines: ['up from the grave'] },
    { label: 'Tag', lines: ['amen', 'amen'] }
  ];
  expect(splitToSlides(sectionsToText(sections))).toEqual(sections);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/songs/sectionsToText.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/shared/songs/sectionsToText.ts`:

```ts
import type { SongSection } from '../types';

// Inverse of splitToSlides for stored songs: every persisted label either matched
// splitToSlides' label regex or is a generated `Verse N`, so emitting the label as
// the stanza's first line re-parses to the identical sections. (splitToSlides only
// consumes ONE label line per stanza, so a lyric line that happens to start with
// "Chorus…" after a real label survives the trip.)
export const sectionsToText = (sections: SongSection[]): string =>
  sections.map((s) => [s.label, ...s.lines].join('\n')).join('\n\n');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/songs/sectionsToText.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/songs/sectionsToText.ts src/shared/songs/sectionsToText.test.ts
git commit -m "feat(songs): sectionsToText round-trip helper"
```

---

### Task 5: QuickAdd edit mode

**Files:**
- Modify: `src/renderer/operator/QuickAdd.tsx`
- Test: `src/renderer/operator/QuickAdd.test.tsx`

**Interfaces:**
- Consumes: `sectionsToText` (Task 4), `window.helm.songs.update` (Task 2), `UpdateSongInput`.
- Produces: `QuickAddProps` gains `editSong?: Song`. With it set: header "Edit song", paste-tab only (no search tab), fields prefilled, save button "Save changes" calling `songs.update`. `onSaved` receives the updated `Song` exactly as in add mode.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/operator/QuickAdd.test.tsx`:

```tsx
const EDIT_SONG = {
  id: 's9',
  title: 'Amazing Grace',
  author: 'John Newton',
  key: 'G',
  sections: [
    { label: 'Verse 1', lines: ['Amazing grace! how sweet the sound'] },
    { label: 'Chorus', lines: ['Praise God'] }
  ],
  source: 'web',
  createdAt: 5
};

const renderEdit = (onSaved = vi.fn(), onClose = vi.fn()): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <QuickAdd open editSong={EDIT_SONG} onClose={onClose} onSaved={onSaved} />
    </ThemeCtx.Provider>
  );

describe('QuickAdd edit mode', () => {
  it('prefills title, author, key and round-tripped lyrics; hides the search tab', () => {
    renderEdit();
    expect(screen.getByText('Edit song')).toBeTruthy();
    expect((screen.getByPlaceholderText('Song title') as HTMLInputElement).value).toBe('Amazing Grace');
    expect((screen.getByPlaceholderText('Author (optional)') as HTMLInputElement).value).toBe('John Newton');
    expect((screen.getByPlaceholderText('Key') as HTMLInputElement).value).toBe('G');
    expect((screen.getByPlaceholderText(/Paste lyrics here/) as HTMLTextAreaElement).value).toBe(
      'Verse 1\nAmazing grace! how sweet the sound\n\nChorus\nPraise God'
    );
    expect(screen.queryByText('Search online')).toBeNull();
    expect(screen.getByText('Save changes')).toBeTruthy();
  });

  it('save calls songs.update (never add) with re-split sections', async () => {
    const update = vi.fn().mockResolvedValue({ ...EDIT_SONG, title: 'Amazing Grace (fixed)' });
    const add = vi.fn();
    (window as unknown as { helm: unknown }).helm = { songs: { update, add } };
    const onSaved = vi.fn();
    renderEdit(onSaved);
    fireEvent.change(screen.getByPlaceholderText('Song title'), { target: { value: 'Amazing Grace (fixed)' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste lyrics here/), {
      target: { value: 'Verse 1\nAmazing grace! fixed sound\n\nChorus\nPraise God' }
    });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('s9', {
        title: 'Amazing Grace (fixed)',
        author: 'John Newton',
        key: 'G',
        sections: [
          { label: 'Verse 1', lines: ['Amazing grace! fixed sound'] },
          { label: 'Chorus', lines: ['Praise God'] }
        ]
      })
    );
    expect(add).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...EDIT_SONG, title: 'Amazing Grace (fixed)' }));
  });

  it('a failed update keeps the modal open with the text intact', async () => {
    const update = vi.fn().mockRejectedValue(new Error('boom'));
    (window as unknown as { helm: unknown }).helm = { songs: { update } };
    const onClose = vi.fn();
    renderEdit(vi.fn(), onClose);
    fireEvent.click(screen.getByText('Save changes'));
    await screen.findByText(/Couldn’t save/);
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText(/Paste lyrics here/) as HTMLTextAreaElement).value).toContain('Amazing grace');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/operator/QuickAdd.test.tsx`
Expected: new tests FAIL (`editSong` prop unknown / 'Edit song' not found); existing tests PASS.

- [ ] **Step 3: Implement edit mode**

In `src/renderer/operator/QuickAdd.tsx`:

1. Imports: add `sectionsToText` from `../../shared/songs/sectionsToText`; add `UpdateSongInput` to the `../../shared/types` type import.
2. Props:

```tsx
export interface QuickAddProps {
  open: boolean;
  /** Prefill for the title field (e.g. the rail's search query). When non-blank,
   *  initial focus lands in the lyrics textarea instead of the title input. */
  initialTitle?: string;
  /** Edit mode: prefill from this song and save via songs:update instead of add.
   *  The search-online tab is hidden — editing starts from what's stored. */
  editSong?: Song;
  onClose: () => void;
  onSaved: (song: Song) => void;
}
```

3. Initial state (the parent mounts fresh per open, so `useState` initializers are enough):

```tsx
const editing = !!editSong;
const [title, setTitle] = useState(editSong?.title ?? initialTitle?.trim() ?? '');
const [author, setAuthor] = useState(editSong?.author ?? '');
const [songKey, setSongKey] = useState(editSong?.key ?? '');
const [text, setText] = useState(editSong ? sectionsToText(editSong.sections) : '');
```

(`prefilled` stays as-is; in edit mode `autoFocus` landing on the lyrics box via `prefilled` is fine since the title is non-blank.)

4. Save — branch inside the existing `save()`:

```tsx
const save = (): void => {
  if (!canSave) return;
  setSaving(true);
  setSaveError(false);
  const done = (song: Song): void => {
    onClose();
    onSaved(song);
  };
  const fail = (): void => {
    // Keep the modal (and the user's text) intact; let them retry.
    setSaving(false);
    setSaveError(true);
  };
  if (editSong) {
    const input: UpdateSongInput = { title: title.trim() || 'Untitled Song', sections: splitToSlides(text) };
    if (author.trim()) input.author = author.trim();
    if (songKey.trim()) input.key = songKey.trim();
    window.helm.songs.update(editSong.id, input).then(done, fail);
    return;
  }
  const input: NewSongInput = { title: title.trim() || 'Untitled Song', text };
  if (author.trim()) input.author = author.trim();
  if (songKey.trim()) input.key = songKey.trim();
  if (fromWeb) input.source = 'web';
  window.helm.songs.add(input).then(done, fail);
};
```

5. Copy: header `{editing ? 'Edit song' : 'Add a song'}`; save button `{editing ? 'Save changes' : 'Add to library'}`; the tab strip renders only when `!editing` (wrap the `tabsWrapStyle` div in `{!editing && (...)}`); in edit mode force the subtitle to the paste-tab copy (tab state already starts at `'paste'`, so the ternary on `tab` needs no change).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/QuickAdd.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/QuickAdd.tsx src/renderer/operator/QuickAdd.test.tsx
git commit -m "feat(songs): QuickAdd edit mode saving via songs:update"
```

---

### Task 6: Whole-song edit wiring — replace the stub

**Files:**
- Modify: `src/renderer/operator/SongsMode.tsx`
- Test: `src/renderer/operator/SongsMode.test.tsx`

**Interfaces:**
- Consumes: `QuickAdd` `editSong` prop (Task 5), `onSongSaved` (Task 3).
- Produces: right-click a song row → Edit opens the edit modal; the `onEditSong` stub and its `console.info` are gone.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/operator/SongsMode.test.tsx`:

```tsx
describe('whole-song edit', () => {
  it('right-click a song row → Edit opens the edit modal prefilled, with no console stub', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    installHelmStubWith(SONGS, NOTHING_LIVE);
    const info = vi.spyOn(console, 'info');
    renderMode(keyHandlerRef);
    // 'Amazing Grace' renders in the rail row AND the center header; the rail comes
    // first in DOM order, so [0] is the row.
    fireEvent.contextMenu((await screen.findAllByText('Amazing Grace'))[0]);
    fireEvent.click(screen.getByText('Edit'));
    expect(await screen.findByText('Edit song')).toBeTruthy();
    expect((screen.getByPlaceholderText('Song title') as HTMLInputElement).value).toBe('Amazing Grace');
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('saving from the modal updates the library row in place', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    fireEvent.contextMenu((await screen.findAllByText('Amazing Grace'))[0]); // [0] = rail row (rail precedes the center header in DOM order)
    fireEvent.click(screen.getByText('Edit'));
    await screen.findByText('Edit song');
    fireEvent.change(screen.getByPlaceholderText('Song title'), { target: { value: 'Amazing Grace (2nd ed.)' } });
    fireEvent.click(screen.getByText('Save changes'));
    // modal closes and the retitled song is in the rail + header
    await waitFor(() => expect(screen.queryByText('Edit song')).toBeNull());
    expect((await screen.findAllByText('Amazing Grace (2nd ed.)')).length).toBeGreaterThan(0);
  });

  it('Escape closes the edit modal before touching anything else', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    fireEvent.contextMenu((await screen.findAllByText('Amazing Grace'))[0]); // [0] = rail row (rail precedes the center header in DOM order)
    fireEvent.click(screen.getByText('Edit'));
    await screen.findByText('Edit song');
    expect(keyHandlerRef.current?.onEscape()).toBe(true);
    await waitFor(() => expect(screen.queryByText('Edit song')).toBeNull());
    expect(h.setOutput).not.toHaveBeenCalled();
    expect(keyHandlerRef.current?.isModalOpen()).toBe(false);
  });
});
```

(The `update` mock added to `installHelmStubWith` in Task 3 already returns the patched song, so the save test needs no new stubbing.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx`
Expected: new tests FAIL ('Edit song' never appears / `console.info` called); existing tests PASS.

- [ ] **Step 3: Implement**

In `src/renderer/operator/SongsMode.tsx`:

1. Replace the `onEditSong` stub (and its comment block) with:

```tsx
const [editSongId, setEditSongId] = useState<string | null>(null);
const editTarget = editSongId ? (library.find((s) => s.id === editSongId) ?? null) : null;

const onEditSong = (id: string): void => setEditSongId(id);
```

2. In `onEscape`, extend the modal chain (before the quick-edit check from Task 3):

```tsx
if (editSongId) {
  setEditSongId(null);
  return true;
}
```

3. Extend `isModalOpen`: `isModalOpen: () => quickAddOpen || importOpen || editSongId !== null,`

4. Render the modal next to the QuickAdd add-mode instance:

```tsx
{editTarget && (
  <QuickAdd
    open
    editSong={editTarget}
    onClose={() => setEditSongId(null)}
    onSaved={(song) => {
      setEditSongId(null);
      onSongSaved(song);
    }}
  />
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/SongsMode.tsx src/renderer/operator/SongsMode.test.tsx
git commit -m "feat(songs): right-click song row opens whole-song edit modal"
```

---

### Task 7: Full verification sweep

**Files:** none new.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean. Fix anything surfaced (likely candidates: unused imports, the `react-hooks` rules on new state — the render-time-adjustment blocks follow the file's existing sanctioned idiom).

- [ ] **Step 3: Acceptance checklist against issue #4**

Verify each by pointing at the code/tests (no re-run needed if steps 1–2 are green):

- Right-click a song row → Edit opens the whole song for editing (Task 6 test 1).
- Right-click a section in the preview → in-place edit without leaving the view (Task 3 test 1).
- Enter saves; Shift+Enter inserts a newline (Task 3 tests 2–3).
- Saving updates the song record and FTS — new text found, removed text not (Task 1 test 3).
- The `onEditSong` stub and `console.info` are gone (Task 6 test 1 + code removal).
- Live safety: saves go through `cue`, never `goLive`; Escape never blacks the screen (Task 3 tests 2 and 4).

- [ ] **Step 4: Commit any fixups**

```bash
git add -A && git commit -m "chore(songs): lint/typecheck fixups for song editing" # only if needed
```
