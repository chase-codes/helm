# Helm — Songs quick wins (stanza count + secondary lyric matches)

**Date:** 2026-07-06
**Status:** Approved — ready for planning
**Roadmap:** `docs/superpowers/roadmap.md` → Songs → "Count label" and "Secondary lyric matches"

Two small, independent Songs-mode improvements. Both are additive to the operator UI and touch no bible/verse or output code.

---

## 1. Purpose

- **Stanza count label** — the song list currently labels each row `<author> · N sections` (`SongsMode.tsx` `toRow`). "Sections" is jargon and "verses" would be inaccurate (a chorus/bridge isn't a verse). Show **`N stanzas`** instead — "stanza" is the accurate generic term for any lyric block, and the number matches the rows shown in the Section Rail one-to-one.
- **Secondary lyric matches** — when searching by **Title** and the title results are thin, show a small subordinate "Also in lyrics" group (top 3) so the operator gets a "you might also mean…" hint without a full lyric search taking over.

---

## 2. Feature 1 — Stanza count label

### 2.1 Rule
`stanzaCount = song.sections.length` — every section block is one stanza. **No repeat-collapsing:** the count must match the number of cueable rows in the Section Rail (each section = one row), so a repeated chorus that exists as two blocks counts as two. This keeps the number the operator reads equal to what they see.

### 2.2 Pure helper — `src/shared/songs/stanza.ts`
```ts
export function stanzaLabel(count: number): string {
  return count === 1 ? '1 stanza' : `${count} stanzas`;
}
```

### 2.3 Wiring — `src/renderer/operator/SongsMode.tsx`
In `toRow`, replace the author-line suffix:
```ts
// before
author: `${song.author} · ${sectionCount}${sectionCount === 1 ? ' section' : ' sections'}`,
// after
author: `${song.author} · ${stanzaLabel(song.sections.length)}`,
```
(The now-unused `sectionCount` local is removed.)

### 2.4 Tests — `src/shared/songs/stanza.test.ts`
- `stanzaLabel(1)` → `'1 stanza'`
- `stanzaLabel(0)` → `'0 stanzas'`
- `stanzaLabel(4)` → `'4 stanzas'`

---

## 3. Feature 2 — Secondary lyric matches (Title mode fallback)

### 3.1 Behavior
When `field === 'title'` and the query is non-empty:
- If the **title** results number **fewer than 3** (the "thin" threshold), also show up to **3** lyric-scored matches whose song is **not** already in the title results, in a subordinate **"Also in lyrics"** group rendered below the title results with dimmed styling.
- If there are 3+ title results, show no lyric hint.
- Clicking a secondary row selects that song exactly like a title result. Title results are never reordered or outranked.

Constants: threshold `SECONDARY_TITLE_MAX = 3`, limit `SECONDARY_LIMIT = 3` (defined in `SongsMode.tsx`).

### 3.2 Pure helper — `src/shared/songs/secondaryLyric.ts`
Encapsulates the whole decision so it is unit-testable with plain data:
```ts
import type { SongSearchResult } from '../types';

// Returns the lyric matches to show as a subordinate hint under a Title search:
// [] when the title results are not "thin" (>= threshold); otherwise the lyric
// results whose song is not already a title hit, capped at `limit`.
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

### 3.3 Wiring — `src/renderer/operator/SongsMode.tsx`
- New state: `const [lyricHint, setLyricHint] = useState<SongSearchResult[]>([]);`
- New effect (fetches the lyric pass only in Title mode; clears otherwise):
```ts
useEffect(() => {
  if (field !== 'title' || !q.trim()) { setLyricHint([]); return; }
  let live = true;
  void window.helm.songs.search(q, 'lyric').then((r) => { if (live) setLyricHint(r); }).catch(console.error);
  return () => { live = false; };
}, [q, field]);
```
- Derive the secondary rows in render (only meaningful in Title mode; `results` holds the title results there):
```ts
const secondaryResults = field === 'title' && hasQuery
  ? secondaryLyricRows(results, lyricHint, SECONDARY_TITLE_MAX, SECONDARY_LIMIT)
  : [];
const secondaryRows: SongRow[] = secondaryResults.map((r) => toRow(r.song, r.snippet, activeSongId));
```
- Pass `secondaryRows` to `<SongSearchRail secondaryRows={secondaryRows} … />`.

Note: lyric-scored results carry a `snippet` (the matching lyric line), so `toRow` renders that line as the row's italic snippet — exactly the "you might also mean…" context. Title results have an empty snippet (unchanged).

### 3.4 Presentation — `src/renderer/operator/SongSearchRail.tsx`
- Add optional prop `secondaryRows?: SongRow[]` to `SongSearchRailProps`.
- After the primary `rows.map(...)` and before `noResults`/the add button, render **only when `secondaryRows?.length`**:
  - a small uppercase divider label `Also in lyrics` (styled like the existing `OPERATOR · FIND A SONG` caption — `fontSize 10px`, `letterSpacing 0.12em`, `color T.faint`, with top margin),
  - then the secondary rows using the existing `rowStyle`/row markup, wrapped in a container at reduced opacity (`opacity: 0.72`) so they read as subordinate. Each still calls `onSelect(r.id)`.
- No change to primary-row rendering.

### 3.5 Tests — `src/shared/songs/secondaryLyric.test.ts`
Using minimal `SongSearchResult` fixtures:
- title results `>=` threshold → `[]` (no hint when title results are full).
- title results thin, lyric results present → returns lyric results, capped at `limit`.
- a song present in both title and lyric results is **excluded** from the secondary rows (dedup by `song.id`).
- empty lyric results → `[]`.
- fewer lyric results than `limit` → returns all of them.

The `SongSearchRail` secondary-group rendering (divider + dimmed rows appear only when `secondaryRows` non-empty, clicking selects) is presentational; covered by a light jsdom render test if convenient, otherwise by the manual check below.

---

## 4. Files touched

**New:**
- `src/shared/songs/stanza.ts` + `stanza.test.ts`
- `src/shared/songs/secondaryLyric.ts` + `secondaryLyric.test.ts`

**Modified:**
- `src/renderer/operator/SongsMode.tsx` — `stanzaLabel` in `toRow`; `lyricHint` state + effect; `secondaryRows` derivation; pass prop.
- `src/renderer/operator/SongSearchRail.tsx` — optional `secondaryRows` prop + subordinate group rendering.

**Not touched:** any bible/verse/output/display code; search scoring (`songScore.ts`) is reused as-is.

---

## 5. Manual check (drive-the-app)
- Song list rows read `… · N stanzas` (and `1 stanza` for a one-block song), matching the Section Rail row count.
- Title search with a distinctive title (3+ matches) shows no lyric hint. A title search that yields 0–2 matches but whose word appears in some lyrics shows an "Also in lyrics" group of up to 3 dimmed rows (with lyric snippets), none duplicating a title result; clicking one loads that song.

---

## 6. Out of scope
Full lyric-search redesign, ranking changes, right-click/edit affordances (separate roadmap items). This is only the count relabel and the subordinate Title-mode lyric hint.
