# Songs Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two small Songs-mode improvements — relabel the song-list count as "N stanzas", and show a subordinate "Also in lyrics" hint under a thin Title search.

**Architecture:** Two pure, dependency-free helpers in `src/shared/songs/` (unit-tested with plain data) drive presentational changes in `SongsMode.tsx` (state/derivation) and `SongSearchRail.tsx` (rendering). Mirrors the codebase's existing pure-core ↔ renderer-shell split.

**Tech Stack:** TypeScript, React, Vitest (jsdom for renderer tests via `// @vitest-environment jsdom`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-songs-quick-wins-design.md`.
- Additive only. Touch NO bible/verse/output/display code. Reuse `songScore.ts` as-is.
- Stanza count = `song.sections.length` (no repeat-collapsing) — must match the Section Rail row count one-to-one.
- Secondary lyric hint appears ONLY when `field === 'title'`, query non-empty, and title results number fewer than 3 (`SECONDARY_TITLE_MAX = 3`); show at most 3 (`SECONDARY_LIMIT = 3`), excluding songs already in the title results; never reorder/outrank title results.
- Commit messages: concise conventional-commit subject; NO `Co-Authored-By`/`Claude-Session` trailers.
- Gate per task: `npm run typecheck` · `npm test` (full suite, Electron binary installed) · `npx eslint <changed files>` → 0 errors (pre-existing prettier warnings are fine).

---

### Task 1: Stanza count label

**Files:**
- Create: `src/shared/songs/stanza.ts`
- Test: `src/shared/songs/stanza.test.ts`
- Modify: `src/renderer/operator/SongsMode.tsx` (`toRow`, ~lines 38–48)

**Interfaces:**
- Consumes: nothing new.
- Produces: `stanzaLabel(count: number): string` — `'1 stanza'` for 1, otherwise `` `${count} stanzas` ``.

- [ ] **Step 1: Write the failing test**

Create `src/shared/songs/stanza.test.ts`:

```ts
import { expect, test } from 'vitest';
import { stanzaLabel } from './stanza';

test('stanzaLabel: singular for exactly one', () => {
  expect(stanzaLabel(1)).toBe('1 stanza');
});
test('stanzaLabel: plural for zero and many', () => {
  expect(stanzaLabel(0)).toBe('0 stanzas');
  expect(stanzaLabel(4)).toBe('4 stanzas');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/shared/songs/stanza.test.ts`
Expected: FAIL — cannot resolve `./stanza`.

- [ ] **Step 3: Implement `stanza.ts`**

Create `src/shared/songs/stanza.ts`:

```ts
// A stanza is any lyric block (verse/chorus/bridge/tag). The count equals the number of
// section rows the operator sees in the Section Rail, so it never mislabels a chorus as a
// "verse" and always matches the visible rail one-to-one.
export function stanzaLabel(count: number): string {
  return count === 1 ? '1 stanza' : `${count} stanzas`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/shared/songs/stanza.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire it into `toRow`**

In `src/renderer/operator/SongsMode.tsx`, add the import near the other `../../shared` imports:

```ts
import { stanzaLabel } from '../../shared/songs/stanza';
```

Replace the `toRow` body (currently lines ~38–48) so the author line uses the stanza label and the unused `sectionCount` local is gone:

```ts
function toRow(song: Song, snippet: string, activeSongId: string | null): SongRow {
  return {
    id: song.id,
    title: song.title,
    author: `${song.author} · ${stanzaLabel(song.sections.length)}`,
    snippet,
    hasSnippet: !!snippet,
    isActive: song.id === activeSongId
  };
}
```

- [ ] **Step 6: Run the full gate**

Run: `npm run typecheck && npm test && npx eslint src/shared/songs/stanza.ts src/shared/songs/stanza.test.ts src/renderer/operator/SongsMode.tsx`
Expected: typecheck PASS; full suite PASS; 0 eslint errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/songs/stanza.ts src/shared/songs/stanza.test.ts src/renderer/operator/SongsMode.tsx
git commit -m "feat(songs): label song rows by stanza count"
```

---

### Task 2: Secondary lyric matches under a thin Title search

**Files:**
- Create: `src/shared/songs/secondaryLyric.ts`
- Test: `src/shared/songs/secondaryLyric.test.ts`
- Modify: `src/renderer/operator/SongSearchRail.tsx` (add `secondaryRows` prop + subordinate group)
- Modify: `src/renderer/operator/SongsMode.tsx` (lyric-hint state + effect, derive `secondaryRows`, pass prop)

**Interfaces:**
- Consumes: `SongSearchResult` (`../../shared/types`), `toRow` and `SongRow` (already in `SongsMode.tsx` / `SongSearchRail.tsx`), `window.helm.songs.search(q, field)`.
- Produces: `secondaryLyricRows(titleResults: SongSearchResult[], lyricResults: SongSearchResult[], threshold: number, limit: number): SongSearchResult[]`; `SongSearchRailProps.secondaryRows?: SongRow[]`.

- [ ] **Step 1: Write the failing test**

Create `src/shared/songs/secondaryLyric.test.ts`:

```ts
import { expect, test } from 'vitest';
import { secondaryLyricRows } from './secondaryLyric';
import type { Song, SongSearchResult } from '../types';

const song = (id: string): Song => ({
  id, title: id, author: 'A', sections: [], source: 'seed', createdAt: 0,
});
const res = (id: string): SongSearchResult => ({ song: song(id), score: 100, snippet: `line-${id}` });

test('returns [] when title results are not thin (>= threshold)', () => {
  const title = [res('a'), res('b'), res('c')];
  const lyric = [res('d'), res('e')];
  expect(secondaryLyricRows(title, lyric, 3, 3)).toEqual([]);
});

test('returns lyric matches (capped at limit) when title results are thin', () => {
  const title = [res('a')];
  const lyric = [res('d'), res('e'), res('f'), res('g')];
  expect(secondaryLyricRows(title, lyric, 3, 3).map((r) => r.song.id)).toEqual(['d', 'e', 'f']);
});

test('excludes songs already present in the title results (dedup by song id)', () => {
  const title = [res('a'), res('b')];
  const lyric = [res('a'), res('c'), res('b'), res('d')];
  expect(secondaryLyricRows(title, lyric, 3, 3).map((r) => r.song.id)).toEqual(['c', 'd']);
});

test('empty lyric results → []', () => {
  expect(secondaryLyricRows([res('a')], [], 3, 3)).toEqual([]);
});

test('returns all lyric matches when fewer than limit', () => {
  expect(secondaryLyricRows([res('a')], [res('c')], 3, 3).map((r) => r.song.id)).toEqual(['c']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/shared/songs/secondaryLyric.test.ts`
Expected: FAIL — cannot resolve `./secondaryLyric`.

- [ ] **Step 3: Implement `secondaryLyric.ts`**

Create `src/shared/songs/secondaryLyric.ts`:

```ts
import type { SongSearchResult } from '../types';

// Lyric matches to show as a subordinate hint under a Title search: [] unless the title
// results are "thin" (fewer than `threshold`); otherwise the lyric results whose song is
// not already a title hit, capped at `limit`. Title results are never reordered here.
export function secondaryLyricRows(
  titleResults: SongSearchResult[],
  lyricResults: SongSearchResult[],
  threshold: number,
  limit: number,
): SongSearchResult[] {
  if (titleResults.length >= threshold) return [];
  const titleIds = new Set(titleResults.map((r) => r.song.id));
  return lyricResults.filter((r) => !titleIds.has(r.song.id)).slice(0, limit);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/shared/songs/secondaryLyric.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the `secondaryRows` prop + subordinate group to `SongSearchRail.tsx`**

In `src/renderer/operator/SongSearchRail.tsx`, add to `SongSearchRailProps` (after `rows: SongRow[]`):

```ts
  secondaryRows?: SongRow[];
```

Add `secondaryRows` to the destructured params (after `rows,`). Then, inside the scrollable list `<div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 10px' }}>`, immediately AFTER the `{rows.map(...)}` block and BEFORE `{noResults && ...}`, insert:

```tsx
        {!!secondaryRows?.length && (
          <>
            <div style={{ fontSize: '10px', letterSpacing: '0.12em', color: T.faint, fontWeight: 600, margin: '10px 2px 6px' }}>
              ALSO IN LYRICS
            </div>
            <div style={{ opacity: 0.72 }}>
              {secondaryRows.map((r) => (
                <button key={r.id} style={rowStyle(r.isActive)} onClick={() => onSelect(r.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: '13px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: r.isActive ? T.accent : T.text
                      }}
                    >
                      {r.title}
                    </div>
                    <div style={{ fontSize: '11px', color: T.faint, marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.author}
                    </div>
                    {r.hasSnippet && <div style={snippetStyle}>&ldquo;{r.snippet}&rdquo;</div>}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
```

- [ ] **Step 6: Wire the lyric hint into `SongsMode.tsx`**

In `src/renderer/operator/SongsMode.tsx`:

(a) Add the import near the other `../../shared` imports:

```ts
import { secondaryLyricRows } from '../../shared/songs/secondaryLyric';
```

(b) Add the two constants near the top-level `LIST_W_*` constants (after line ~22):

```ts
const SECONDARY_TITLE_MAX = 3;
const SECONDARY_LIMIT = 3;
```

(c) Add lyric-hint state next to the other `useState` calls (near `const [results, setResults] = useState<SongSearchResult[]>([]);`):

```ts
const [lyricHint, setLyricHint] = useState<SongSearchResult[]>([]);
```

(d) Add this effect immediately after the existing search effect (the one keyed on `[q, field]`, ~lines 84–93):

```ts
  // In Title mode only, run a parallel lyric-scored pass so a thin title search can show a
  // subordinate "Also in lyrics" hint (see secondaryLyricRows). Cleared when not applicable.
  useEffect(() => {
    if (field !== 'title' || !q.trim()) { setLyricHint([]); return; }
    let live = true;
    void window.helm.songs.search(q, 'lyric').then((r) => { if (live) setLyricHint(r); }).catch(console.error);
    return () => {
      live = false;
    };
  }, [q, field]);
```

(e) Derive the secondary rows just after `displayedRows`/`noResults` are computed (~line 127):

```ts
  const secondaryResults =
    field === 'title' && hasQuery ? secondaryLyricRows(results, lyricHint, SECONDARY_TITLE_MAX, SECONDARY_LIMIT) : [];
  const secondaryRows: SongRow[] = secondaryResults.map((r) => toRow(r.song, r.snippet, activeSongId));
```

(f) Pass the prop to `<SongSearchRail … />` (add alongside `rows={displayedRows}`):

```tsx
        secondaryRows={secondaryRows}
```

- [ ] **Step 7: Run the full gate**

Run: `npm run typecheck && npm test && npx eslint src/shared/songs/secondaryLyric.ts src/shared/songs/secondaryLyric.test.ts src/renderer/operator/SongSearchRail.tsx src/renderer/operator/SongsMode.tsx`
Expected: typecheck PASS; full suite PASS; 0 eslint errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/songs/secondaryLyric.ts src/shared/songs/secondaryLyric.test.ts src/renderer/operator/SongSearchRail.tsx src/renderer/operator/SongsMode.tsx
git commit -m "feat(songs): show subordinate lyric matches under a thin title search"
```

---

## Self-Review (author checklist — completed)

**Spec coverage:** §2 stanza label → Task 1. §3.2 `secondaryLyricRows` → Task 2 Steps 1–4. §3.3 SongsMode wiring → Task 2 Step 6. §3.4 SongSearchRail rendering → Task 2 Step 5. §3.5 helper tests → Task 2 Steps 1–4. ✅

**Placeholder scan:** No TBD/TODO/vague steps — all code and commands concrete. ✅

**Type consistency:** `stanzaLabel(count: number): string`, `secondaryLyricRows(titleResults, lyricResults, threshold, limit): SongSearchResult[]`, `SongSearchRailProps.secondaryRows?: SongRow[]`, constants `SECONDARY_TITLE_MAX`/`SECONDARY_LIMIT` used consistently across tasks. `toRow`/`SongRow`/`SongSearchResult` reused as they already exist. ✅
