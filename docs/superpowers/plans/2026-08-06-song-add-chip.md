# Song Add Chip Below Search Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the songs rail's add/import affordances from the bottom of the scrolling song list to a fixed block directly below the search bar, with the add chip opening QuickAdd prefilled from the search query.

**Architecture:** `SongSearchRail` (pure presentational) gains an always-visible add chip + slim import row in its fixed header block, mirroring the scripture `SchedulePanel` chip pattern but tinted with the songs gold accent. `QuickAdd` gains an optional `initialTitle` prop (prefill + focus the lyrics box). `SongsMode` captures the query at chip-click time and passes it through. Persistence is untouched.

**Tech Stack:** React 19 + TypeScript, inline `CSSProperties` from `Theme` (no CSS files/classnames), Vitest + @testing-library/react (jsdom), Electron IPC via `window.helm` (unchanged here).

**Spec:** `docs/superpowers/specs/2026-08-06-song-add-chip-design.md`

## Global Constraints

- All styling is inline `CSSProperties` built from the `Theme` object (`T`); no CSS modules or classnames.
- `SongSearchRail` stays purely presentational: theme + data + callbacks, no `window.helm` calls.
- Chip tint uses the songs accent: `background: ${T.accent}22`, `color: T.accent` — NOT `T.scripture`.
- Chip label copy, exactly (note typographic curly quotes “ ”, matching `emptyText`): with query → `+ Add “<query>” as a new song`; empty → `+ Add a song`.
- Import row copy stays exactly `↓ Import a song library` (SongsMode.test.tsx clicks it by this text).
- Nothing is duplicated at the bottom of the scroll region — the two old bottom buttons are removed.
- Test files start with `// @vitest-environment jsdom` and register `afterEach(cleanup)` manually (vitest `globals` is off in this project).
- Commit messages: short conventional-commit subjects, NO `Co-Authored-By` or session trailers.
- Full check before finishing: `npm test`, `npm run typecheck`, `npm run lint`.

---

### Task 1: SongSearchRail — chip + import row in the header, bottom buttons removed

**Files:**
- Modify: `src/renderer/operator/SongSearchRail.tsx` (header block ends at :169; bottom buttons at :236-241; `pasteSongStyle` at :121-135)
- Test: `src/renderer/operator/SongSearchRail.test.tsx`

**Interfaces:**
- Consumes: existing `SongSearchRailProps` — `q: string`, `onAddSong: () => void`, `onImportSongs: () => void`. No prop changes.
- Produces: rendered chip whose visible text is `+ Add a song` / `+ Add “<q>” as a new song`; Task 3's SongsMode test clicks the chip by that exact text.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('SongSearchRail', …)` block in `src/renderer/operator/SongSearchRail.test.tsx`:

```tsx
  it('shows the add chip in the header, and the old bottom button is gone', () => {
    render(<SongSearchRail {...baseProps} />)
    expect(screen.getByText('+ Add a song')).toBeTruthy()
    expect(screen.queryByText('+ Add a song — search or paste')).toBeNull()
  })

  it('labels the chip with the query when one is typed', () => {
    render(<SongSearchRail {...baseProps} q="Way Maker" />)
    expect(screen.getByText('+ Add “Way Maker” as a new song')).toBeTruthy()
  })

  it('clicking the chip fires onAddSong', () => {
    const onAddSong = vi.fn()
    render(<SongSearchRail {...baseProps} onAddSong={onAddSong} />)
    fireEvent.click(screen.getByText('+ Add a song'))
    expect(onAddSong).toHaveBeenCalledTimes(1)
  })

  it('renders the import row above the song list and fires onImportSongs', () => {
    const onImportSongs = vi.fn()
    render(<SongSearchRail {...baseProps} onImportSongs={onImportSongs} />)
    const imp = screen.getByText('↓ Import a song library')
    fireEvent.click(imp)
    expect(onImportSongs).toHaveBeenCalledTimes(1)
    // Import row must precede the first song row in DOM order (fixed header, not list bottom).
    const firstRow = screen.getByText('Amazing Grace')
    expect(imp.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/renderer/operator/SongSearchRail.test.tsx`
Expected: the 2 pre-existing tests PASS; the 4 new tests FAIL (`+ Add a song` not found / old label still present / DOM-order assertion fails).

- [ ] **Step 3: Implement in SongSearchRail.tsx**

3a. Replace `pasteSongStyle` (lines 121-135) with two new styles:

```tsx
  const addChipStyle: CSSProperties = {
    width: '100%',
    height: '34px',
    marginTop: '8px',
    padding: '0 10px',
    borderRadius: '9px',
    background: `${T.accent}22`,
    color: T.accent,
    fontSize: '12.5px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };
  const importRowStyle: CSSProperties = {
    width: '100%',
    height: '26px',
    marginTop: '5px',
    borderRadius: '8px',
    fontSize: '11.5px',
    fontWeight: 600,
    color: T.faint,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent'
  };
```

3b. In the fixed header block, directly after the field-tabs `<div style={songFieldWrapStyle}>…</div>` closes (line 168) and before the header `</div>` (line 169), insert:

```tsx
        <button style={addChipStyle} onClick={onAddSong}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {q.trim() ? `+ Add “${q.trim()}” as a new song` : '+ Add a song'}
          </span>
        </button>
        <button style={importRowStyle} onClick={onImportSongs}>
          ↓ Import a song library
        </button>
```

(The `<span>` wrapper is required: the button is a flex container, so text-overflow ellipsis only applies to an inner block element when the query is long.)

3c. Delete the two bottom buttons (lines 236-241, the `pasteSongStyle` buttons at the end of the scroll region).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SongSearchRail.test.tsx`
Expected: all 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/SongSearchRail.tsx src/renderer/operator/SongSearchRail.test.tsx
git commit -m "feat(songs): move add chip and import row below the search bar"
```

---

### Task 2: QuickAdd — `initialTitle` prop with lyrics-first focus

**Files:**
- Modify: `src/renderer/operator/QuickAdd.tsx` (props at :6-10, title state at :16, title input at :157, textarea at :158-163)
- Create: `src/renderer/operator/QuickAdd.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `QuickAddProps` gains `initialTitle?: string`. Contract: when `initialTitle` is non-blank, the title field starts as that string and initial focus is the lyrics `<textarea>`; otherwise title starts blank and initial focus is the title `<input>`. Task 3 passes this prop from SongsMode.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/operator/QuickAdd.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuickAdd } from './QuickAdd'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

const renderQuickAdd = (initialTitle?: string): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('dark')}>
      <QuickAdd open initialTitle={initialTitle} onClose={vi.fn()} onSaved={vi.fn()} />
    </ThemeCtx.Provider>
  )

describe('QuickAdd initialTitle', () => {
  it('prefills the title and focuses the lyrics box when initialTitle is given', () => {
    renderQuickAdd('Way Maker')
    const title = screen.getByPlaceholderText('Song title') as HTMLInputElement
    expect(title.value).toBe('Way Maker')
    const lyrics = screen.getByPlaceholderText(/Paste lyrics here/) as HTMLTextAreaElement
    expect(document.activeElement).toBe(lyrics)
  })

  it('starts blank with focus on the title field without initialTitle', () => {
    renderQuickAdd()
    const title = screen.getByPlaceholderText('Song title') as HTMLInputElement
    expect(title.value).toBe('')
    expect(document.activeElement).toBe(title)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/operator/QuickAdd.test.tsx`
Expected: FAIL — first test: TypeScript/prop error or `title.value` is `''`; second test: `document.activeElement` is `document.body` (QuickAdd currently sets no autofocus at all).

- [ ] **Step 3: Implement in QuickAdd.tsx**

3a. Extend the props interface (lines 6-10):

```tsx
export interface QuickAddProps {
  open: boolean;
  /** Prefill for the title field (e.g. the rail's search query). When non-blank,
   *  initial focus lands in the lyrics textarea instead of the title input. */
  initialTitle?: string;
  onClose: () => void;
  onSaved: (song: Song) => void;
}
```

3b. Update the signature and title state (lines 12, 16). The parent mounts this component fresh on every open (existing comment at :14-15), so seeding `useState` from the prop is safe:

```tsx
export function QuickAdd({ open, initialTitle, onClose, onSaved }: QuickAddProps): JSX.Element | null {
```

```tsx
  const prefilled = !!initialTitle?.trim();
  const [title, setTitle] = useState(initialTitle?.trim() ?? '');
```

3c. Add `autoFocus` to both fields — title input (line 157) and lyrics textarea (line 158):

```tsx
            <input style={titleStyle} autoFocus={!prefilled} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" />
            <textarea
              style={textStyle}
              autoFocus={prefilled}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Paste lyrics here…\n\nVerse 1\nLine one\nLine two\n\nChorus\nThe chorus'}
            />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/QuickAdd.test.tsx`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/QuickAdd.tsx src/renderer/operator/QuickAdd.test.tsx
git commit -m "feat(songs): QuickAdd initialTitle prefill with lyrics-first focus"
```

---

### Task 3: SongsMode — wire query → QuickAdd, fix no-results copy

**Files:**
- Modify: `src/renderer/operator/SongsMode.tsx` (state at :69, `emptyText` at :300, `onAddSong` at :403, QuickAdd mount at :477)
- Test: `src/renderer/operator/SongsMode.test.tsx`

**Interfaces:**
- Consumes: Task 1's chip (clickable by text `+ Add “<q>” as a new song`), Task 2's `initialTitle?: string` prop on `QuickAdd`.
- Produces: user-facing behavior only; no new exports.

- [ ] **Step 1: Write the failing test**

Append inside `describe('SongsMode', …)` in `src/renderer/operator/SongsMode.test.tsx` (uses the existing `installHelmStub` — its `search` defaults to resolving `[]`, which is fine):

```tsx
  it('opens QuickAdd with the search query prefilled as the title', async () => {
    installHelmStub();
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await screen.findByText(/John Newton ·/);

    fireEvent.change(screen.getByPlaceholderText('Title or a lyric line…'), {
      target: { value: 'Way Maker' }
    });
    fireEvent.click(screen.getByText('+ Add “Way Maker” as a new song'));

    const title = (await screen.findByPlaceholderText('Song title')) as HTMLInputElement;
    expect(title.value).toBe('Way Maker');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx`
Expected: the new test FAILS with `title.value` being `''` (chip exists after Task 1, but SongsMode doesn't pass the query yet). Pre-existing tests PASS.

- [ ] **Step 3: Implement in SongsMode.tsx**

3a. Add state next to `quickAddOpen` (line 69). Captured at click time so typing in the search box after opening can never mutate the modal's title:

```tsx
  const [quickAddTitle, setQuickAddTitle] = useState('');
```

3b. Update the chip callback (line 403):

```tsx
        onAddSong={() => {
          setQuickAddTitle(q.trim());
          setQuickAddOpen(true);
        }}
```

3c. Pass the prop at the QuickAdd mount (line 477):

```tsx
      {quickAddOpen && (
        <QuickAdd open={quickAddOpen} initialTitle={quickAddTitle} onClose={() => setQuickAddOpen(false)} onSaved={onQuickAddSaved} />
      )}
```

3d. Fix the stale copy (line 300) — the affordance now sits above the list, not below:

```tsx
  const emptyText = `No match for “${q}”. Try another word, or add it as a new song above.`;
```

- [ ] **Step 4: Run the mode tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SongsMode.test.tsx`
Expected: all PASS (including the pre-existing import-wizard tests, which click `↓ Import a song library` — the label is unchanged, only relocated).

- [ ] **Step 5: Full verification**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all suites pass, no type errors, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/SongsMode.tsx src/renderer/operator/SongsMode.test.tsx
git commit -m "feat(songs): prefill QuickAdd from search query; point empty-state copy at the chip"
```
