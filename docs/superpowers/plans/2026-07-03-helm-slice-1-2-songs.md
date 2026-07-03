# Helm Slices 1–2: Scaffold, Operator Shell, Songs Vertical Slice

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A launchable Mac/Windows Electron app with the Helm operator console, a local SQLite song library with typo-tolerant search, cue/live presentation state, and a live output window that auto-appears on a second display — the "first usable Sunday build" from the spec.

**Architecture:** Electron main process owns the SQLite DB, presentation state, and display management; the operator window (React) and output windows (React SlideCanvas) are renderers wired over typed IPC. Pure logic (search scoring, lyric splitting, state transitions) lives in `src/shared/` as framework-free functions with unit tests.

**Tech Stack:** Electron (via electron-vite), TypeScript (strict), React 18, better-sqlite3 (FTS5), vitest, electron-builder.

## Global Constraints

- App name is **Helm** everywhere user-visible: window title `Helm`, `productName: "Helm"`, logo slide text `HELM`. The design files say "LECTERN"/"Sunday Service" — replace `LECTERN` with `HELM`; keep "Sunday Service" as the default service title.
- Spec: `docs/superpowers/specs/2026-07-03-helm-design.md`. Design fidelity source: `docs/design/Lectern.dc.html` (pretty-printed twin `Lectern.pretty.html` with line numbers) and `docs/design/SlideCanvas.dc.html`. When a task says "port styles from the design", copy the exact style-object values from those files — do not invent styling.
- TypeScript `strict: true`. No `any` in `src/shared/`.
- All IPC channel names and payload types are defined once in `src/shared/types.ts`; main, preload, and renderers import from there. Never inline a channel string elsewhere.
- Tests are colocated: `src/**/foo.test.ts` run by vitest. `npm test` must pass at every commit.
- Commit after every task minimum; **no Co-Authored-By trailers** (user preference).
- Node ≥ 20. Package manager: npm.
- Renderer must not import Node/Electron APIs directly — everything crosses via the preload bridge (`window.helm`), `contextIsolation: true`, `nodeIntegration: false`.

## File Structure (end state of this plan)

```
src/
  shared/
    types.ts               — domain + IPC contract types (single source of truth)
    theme.ts               — DARK/LIGHT palettes + Warm/Cool/Earthen tones (from design)
    search/fuzzy.ts        — norm, lev, fuzzyTok               (pure)
    search/songScore.ts    — scoreSong, rankSongs              (pure)
    songs/splitToSlides.ts — paste-lyrics → labeled sections   (pure)
    presentation/core.ts   — keyForSong, sameFlow, applyCue, goLive, setOutput, outputPayload (pure)
  main/
    index.ts               — app bootstrap, operator window
    db.ts                  — open/migrate SQLite
    songsRepo.ts           — song CRUD + FTS-backed search
    seed.ts                — 10 starter hymns from the design
    stateStore.ts          — presentation state holder + broadcast
    displays.ts            — output-window manager (v0)
    ipc.ts                 — channel registration
  preload/
    index.ts               — contextBridge: window.helm
  renderer/
    operator/index.html
    operator/main.tsx
    operator/App.tsx        — theme, mode tabs, header, mode switch
    operator/Header.tsx
    operator/SongsMode.tsx  — search rail + hero + section rail + transport
    operator/QuickAdd.tsx   — paste-lyrics modal
    operator/useHelm.ts     — hooks over window.helm
    output/index.html
    output/main.tsx         — output window: subscribes, renders SlideCanvas
    shared/SlideCanvas.tsx  — React port of SlideCanvas.dc.html
```

---

### Task 1: Scaffold the Electron app

**Files:**
- Create: entire electron-vite scaffold at repo root, `electron.vite.config.ts`, `vitest.config.ts`, `.gitignore`, `README.md`

**Interfaces:**
- Produces: working `npm run dev` (Electron window opens), `npm test` (vitest runs), `npm run typecheck`.

- [ ] **Step 1: Scaffold into a temp dir and merge**

```bash
cd /Users/lem/repos/helm
npm create @quick-start/electron@latest tmp-scaffold -- --template react-ts --skip
rsync -a tmp-scaffold/ . --exclude .git
rm -rf tmp-scaffold
npm install
```

If the scaffold prompts interactively, answer: project name `helm`, template `react-ts`, no extras.

- [ ] **Step 2: Set identity and add deps**

In `package.json`: set `"name": "helm"`, `"productName": "Helm"`, `"description": "Church presentation app — run the whole service from one seat."`, `"version": "0.1.0"`. Then:

```bash
npm i better-sqlite3
npm i -D vitest @types/better-sqlite3
npm i -D electron-rebuild || true   # electron-vite templates often include this; skip if present
npx electron-builder install-app-deps   # rebuild better-sqlite3 against Electron's Node
```

Add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json"` (adjust to the tsconfig names the scaffold generated).

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], environment: 'node' },
});
```

- [ ] **Step 4: Restructure renderer for two windows**

Rename the scaffold's `src/renderer/index.html` to `src/renderer/operator/index.html` (move its `main.tsx` and `App.tsx` alongside), create an empty-shell `src/renderer/output/index.html` + `main.tsx` (renders `<div>output</div>` for now), and point electron.vite at both:

```ts
// electron.vite.config.ts — renderer section
import { resolve } from 'path';
renderer: {
  resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') } },
  build: {
    rollupOptions: {
      input: {
        operator: resolve(__dirname, 'src/renderer/operator/index.html'),
        output: resolve(__dirname, 'src/renderer/output/index.html'),
      },
    },
  },
}
```

In `src/main/index.ts`, make the main window load `operator/index.html` (dev URL `${ELECTRON_RENDERER_URL}/operator/index.html`, prod `../renderer/operator/index.html`), title `Helm`, min size 1200×760.

- [ ] **Step 5: Verify dev boot, typecheck, tests**

Run: `npm run dev` → Electron window titled **Helm** opens with the scaffold page. Quit.
Run: `npm run typecheck` → clean. Run: `npm test` → "no test files found" is OK at this point (vitest exits 0 with `--passWithNoTests`; add that flag to the test script).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: scaffold Helm electron-vite app with dual renderer entries"
```

---

### Task 2: Shared types and theme tokens

**Files:**
- Create: `src/shared/types.ts`, `src/shared/theme.ts`

**Interfaces:**
- Produces (consumed by every later task):
  - `SongSection { label: string; lines: string[] }`
  - `Song { id: string; title: string; author: string; sections: SongSection[]; source: string; createdAt: number }`
  - `SongSearchResult { song: Song; score: number; snippet: string }`
  - `SearchField = 'all' | 'title' | 'lyric'`
  - `Slide`, `SlideKind`, `SlideColumn` (below)
  - `OutputMode = 'live' | 'logo' | 'black'`
  - `PresentationState { output: OutputMode; liveKey: string | null; liveSnap: Slide | null }`
  - `OutputVariant = 'audience' | 'main' | 'stage' | 'leader' | 'livestream'`
  - `OutputPayload { slide: Slide; variant: OutputVariant }`
  - `DisplayStatus { outputs: number }`
  - `CH` — const object of IPC channel names
  - `HelmApi` — the preload bridge shape
  - Theme: `Theme` type, `DARK`, `LIGHT`, `TONES`, `themeFor(mode, tone)`

- [ ] **Step 1: Write `src/shared/types.ts`**

```ts
export interface SongSection { label: string; lines: string[] }
export interface Song {
  id: string; title: string; author: string;
  sections: SongSection[]; source: string; createdAt: number;
}
export interface SongSearchResult { song: Song; score: number; snippet: string }
export type SearchField = 'all' | 'title' | 'lyric';
export interface NewSongInput { title: string; author?: string; text: string; source?: string }

export type SlideKind =
  | 'lyrics' | 'scripture' | 'quote' | 'title' | 'sermon'
  | 'countdown' | 'logo' | 'black' | 'blank';
export interface SlideColumn { version: string; text: string }
export interface Slide {
  kind: SlideKind; accent?: string; label?: string; lines?: string[];
  ref?: string; columns?: SlideColumn[]; text?: string; source?: string;
  title?: string; subtitle?: string; points?: string[];
  message?: string; countdownText?: string; bg?: string;
}

export type OutputMode = 'live' | 'logo' | 'black';
export interface PresentationState {
  output: OutputMode; liveKey: string | null; liveSnap: Slide | null;
}
export type OutputVariant = 'audience' | 'main' | 'stage' | 'leader' | 'livestream';
export interface OutputPayload { slide: Slide; variant: OutputVariant }
export interface DisplayStatus { outputs: number }

export const CH = {
  songsSearch: 'songs:search', songsList: 'songs:list',
  songsGet: 'songs:get', songsAdd: 'songs:add',
  presGet: 'presentation:get', presCue: 'presentation:cue',
  presGoLive: 'presentation:goLive', presSetOutput: 'presentation:setOutput',
  presState: 'presentation:state',           // main → all windows
  outputSlide: 'output:slide',               // main → output windows
  displaysGet: 'displays:get', displaysStatus: 'displays:status',
  displaysOpenTest: 'displays:openTest',
} as const;

export interface HelmApi {
  songs: {
    search(q: string, field: SearchField): Promise<SongSearchResult[]>;
    list(): Promise<Song[]>;
    get(id: string): Promise<Song | null>;
    add(input: NewSongInput): Promise<Song>;
  };
  presentation: {
    get(): Promise<PresentationState>;
    cue(key: string, slide: Slide): void;
    goLive(key: string, slide: Slide): void;
    setOutput(mode: OutputMode): void;
    onState(cb: (s: PresentationState) => void): () => void;
  };
  output: { onSlide(cb: (p: OutputPayload) => void): () => void };
  displays: {
    get(): Promise<DisplayStatus>;
    onStatus(cb: (d: DisplayStatus) => void): () => void;
    openTest(): void;
  };
}
```

- [ ] **Step 2: Write `src/shared/theme.ts`** — copy palette values verbatim from `docs/design/Lectern.pretty.html` lines 705–706 (DARK/LIGHT) and 817–821 (tones):

```ts
export interface Theme {
  appBg: string; panel: string; panel2: string; panel3: string;
  text: string; dim: string; faint: string; hairline: string; border: string;
  inputBg: string; accent: string; accentInk: string; live: string;
  scripture: string; sermon: string; message: string; quote: string;
}
export const DARK = { appBg: '#0f1115', panel: '#15171c', panel2: '#1c1f25', panel3: '#23262e', text: '#e8e6e1', dim: '#9a9488', faint: '#736f66', hairline: 'rgba(255,255,255,.06)', border: 'rgba(255,255,255,.08)', inputBg: '#1c1f25', accent: '#e0a341', accentInk: '#1a1206', live: '#cf6a5e', scripture: '#6f9cf0', sermon: '#6f9c7a', quote: '#b98cf0' };
export const LIGHT = { appBg: '#ece5d6', panel: '#f7f3ea', panel2: '#fdfbf6', panel3: '#ffffff', text: '#2c2823', dim: '#7a7263', faint: '#a59c8a', hairline: 'rgba(0,0,0,.08)', border: 'rgba(0,0,0,.12)', inputBg: '#ffffff', accent: '#b87a2c', accentInk: '#ffffff', live: '#bf4f44', scripture: '#3f6bb5', sermon: '#4f7d5f', quote: '#8a5cc0' };
export type Tone = 'Warm' | 'Cool' | 'Earthen';
export const TONES = {
  Warm:    { scripture: '#6f9cf0', sermon: '#6f9c7a', message: '#a88bc4' },
  Cool:    { accent: '#5aa9d6', scripture: '#7c8cf0', sermon: '#56b39a', message: '#8f7ce0', live: '#d06a8a' },
  Earthen: { accent: '#cf9646', scripture: '#8f9bc2', sermon: '#88a06a', message: '#a08a9e', live: '#c46a52' },
} as const;
export function themeFor(mode: 'dark' | 'light', tone: Tone = 'Warm'): Theme {
  const base = mode === 'light' ? LIGHT : DARK;
  return { ...base, message: '#a88bc4', ...TONES[tone] } as Theme;
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck` → clean.

```bash
git add src/shared && git commit -m "feat: shared domain types, IPC contract, and design theme tokens"
```

---

### Task 3: Fuzzy search core (TDD)

**Files:**
- Create: `src/shared/search/fuzzy.ts`, `src/shared/search/fuzzy.test.ts`, `src/shared/search/songScore.ts`, `src/shared/search/songScore.test.ts`

**Interfaces:**
- Consumes: `Song`, `SongSearchResult`, `SearchField` from `@shared/types`.
- Produces:
  - `norm(s: string): string`
  - `lev(a: string, b: string): number`
  - `fuzzyTok(tok: string, words: string[]): boolean`
  - `scoreSong(query: string, song: Song, field: SearchField): { score: number; snippet: string }`
  - `rankSongs(query: string, songs: Song[], field: SearchField): SongSearchResult[]`

This is a direct port of the prototype's scorer (`Lectern.pretty.html` lines 923–940, 1056). Behavior must match: empty query returns all songs score 1; exact-title 1200; title-substring 1000 − index; all-tokens-fuzzy-matched ≥ 380 + 12·matched; snippet = first lyric line containing a token of length > 2; `field==='title'` suppresses snippets; snippet floor score 360 for non-title fields.

- [ ] **Step 1: Write failing tests `fuzzy.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { norm, lev, fuzzyTok } from './fuzzy';

describe('norm', () => {
  test('lowercases, strips apostrophes and punctuation, collapses spaces', () => {
    expect(norm("’Twas Grace  that taught!")).toBe('twas grace that taught');
    expect(norm("I'd Rather")).toBe('id rather');
  });
});
describe('lev', () => {
  test('edit distances', () => {
    expect(lev('grace', 'grace')).toBe(0);
    expect(lev('beleive', 'believe')).toBe(2);
    expect(lev('', 'abc')).toBe(3);
  });
});
describe('fuzzyTok', () => {
  test('tolerance scales with token length', () => {
    expect(fuzzyTok('beleive', ['believe'])).toBe(true);  // len 7 → tol 2
    expect(fuzzyTok('gras', ['grace'])).toBe(true);       // len 4 → tol 1
    expect(fuzzyTok('cat', ['dog'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/search/fuzzy.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `fuzzy.ts`** (port verbatim, typed)

```ts
export function norm(s: string): string {
  return (s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
  }
  return d[m][n];
}
export function fuzzyTok(tok: string, words: string[]): boolean {
  const tol = tok.length >= 6 ? 2 : 1;
  return words.some((w) => Math.abs(w.length - tok.length) <= 2 && lev(tok, w) <= tol);
}
```

- [ ] **Step 4: Run tests** — Expected: PASS.

- [ ] **Step 5: Write failing tests `songScore.test.ts`** (typo cases straight from the design's placeholder copy)

```ts
import { describe, expect, test } from 'vitest';
import { rankSongs, scoreSong } from './songScore';
import type { Song } from '../types';

const song = (id: string, title: string, author: string, secs: [string, string[]][]): Song => ({
  id, title, author, source: 'local', createdAt: 0,
  sections: secs.map(([label, lines]) => ({ label, lines })),
});
const AMAZING = song('amazing', 'Amazing Grace', 'John Newton', [
  ['Verse 1', ['Amazing grace! how sweet the sound,', 'That saved a wretch like me;']],
]);
const BELIEVE = song('onlybelieve', 'Only Believe', 'Paul Rader', [
  ['Chorus', ['Only believe, only believe,', 'All things are possible, only believe;']],
]);
const LIB = [AMAZING, BELIEVE];

test('empty query returns all songs in library order', () => {
  const r = rankSongs('', LIB, 'all');
  expect(r.map((x) => x.song.id)).toEqual(['amazing', 'onlybelieve']);
});
test('typo in title still matches: "amazin grace"', () => {
  const r = rankSongs('amazin grace', LIB, 'all');
  expect(r[0].song.id).toBe('amazing');
});
test('typo in lyric matches: "only beleive"', () => {
  const r = rankSongs('only beleive', LIB, 'all');
  expect(r[0].song.id).toBe('onlybelieve');
});
test('lyric line match yields snippet', () => {
  const r = rankSongs('sweet the sound', LIB, 'all');
  expect(r[0].snippet).toContain('sweet the sound');
});
test('exact title beats substring', () => {
  expect(scoreSong('amazing grace', AMAZING, 'all').score).toBeGreaterThanOrEqual(1200);
});
test('title field suppresses snippet', () => {
  expect(scoreSong('amazing', AMAZING, 'title').snippet).toBe('');
});
test('non-matching query excluded', () => {
  expect(rankSongs('zzzz qqqq', LIB, 'all')).toHaveLength(0);
});
```

- [ ] **Step 6: Run** — Expected: FAIL. **Step 7: Implement `songScore.ts`**

```ts
import type { Song, SongSearchResult, SearchField } from '../types';
import { norm, lev } from './fuzzy';

const lyricsOf = (s: Song) => s.sections.map((sc) => sc.lines.join(' ')).join(' ');
const blobOf = (s: Song) => `${s.title} ${s.author} ${lyricsOf(s)}`;

export function scoreSong(query: string, song: Song, field: SearchField): { score: number; snippet: string } {
  const q = norm(query);
  if (!q) return { score: 1, snippet: '' };
  const title = norm(song.title);
  const blob = field === 'title' ? title : field === 'lyric' ? norm(lyricsOf(song)) : norm(blobOf(song));
  let score = 0; let snippet = '';
  if (field !== 'lyric') { if (title === q) score = 1200; else if (title.includes(q)) score = 1000 - title.indexOf(q); }
  const words = blob.split(' '); const qts = q.split(' '); let matched = 0;
  for (const t of qts) {
    let best = 99;
    for (const w of words) {
      if (w === t) { best = 0; break; }
      if (Math.abs(w.length - t.length) <= 2) { const dd = lev(t, w); if (dd < best) best = dd; }
    }
    const tol = t.length <= 4 ? 1 : 2; if (best <= tol) matched++;
  }
  if (matched === qts.length && matched > 0) score = Math.max(score, 380 + matched * 12);
  for (const sc of song.sections) {
    for (const ln of sc.lines) { if (qts.some((t) => t.length > 2 && norm(ln).includes(t))) { snippet = ln; break; } }
    if (snippet) break;
  }
  if (field === 'title' && snippet) snippet = '';
  if (snippet && score < 360 && field !== 'title') score = 360;
  return { score, snippet };
}

export function rankSongs(query: string, songs: Song[], field: SearchField): SongSearchResult[] {
  if (!norm(query)) return songs.map((song) => ({ song, score: 1, snippet: '' }));
  return songs
    .map((song) => ({ song, ...scoreSong(query, song, field) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 8: Run all tests** — `npm test` — Expected: PASS. **Step 9: Commit**

```bash
git add src/shared/search && git commit -m "feat: typo-tolerant song search core ported from prototype"
```

---

### Task 4: Lyric splitter (TDD)

**Files:**
- Create: `src/shared/songs/splitToSlides.ts`, `src/shared/songs/splitToSlides.test.ts`

**Interfaces:**
- Produces: `splitToSlides(text: string): SongSection[]` — blank-line-separated blocks; a leading line matching `/^(chorus|verse|bridge|refrain|intro|outro|tag|pre-?chorus)\b/i` becomes the label (trailing `:`/`.` stripped), else `Verse n`.

- [ ] **Step 1: Failing tests**

```ts
import { expect, test } from 'vitest';
import { splitToSlides } from './splitToSlides';

test('splits on blank lines and auto-labels', () => {
  const r = splitToSlides('Line one\nLine two\n\nChorus\nThe chorus line');
  expect(r).toEqual([
    { label: 'Verse 1', lines: ['Line one', 'Line two'] },
    { label: 'Chorus', lines: ['The chorus line'] },
  ]);
});
test('recognizes labeled headers case-insensitively, strips punctuation', () => {
  const r = splitToSlides('VERSE 2:\nA line\n\nPre-Chorus.\nB line');
  expect(r[0].label).toBe('VERSE 2'); expect(r[1].label).toBe('Pre-Chorus');
});
test('empty and whitespace-only input → []', () => {
  expect(splitToSlides('')).toEqual([]); expect(splitToSlides(' \n \n ')).toEqual([]);
});
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement** (port of prototype line 1048)

```ts
import type { SongSection } from '../types';
export function splitToSlides(text: string): SongSection[] {
  const blocks = (text || '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b, i) => {
    let lines = b.split(/\n/).map((l) => l.trim()).filter(Boolean);
    let label = `Verse ${i + 1}`;
    if (/^(chorus|verse|bridge|refrain|intro|outro|tag|pre-?chorus)\b/i.test(lines[0] || '')) {
      label = lines[0].replace(/[:.]$/, ''); lines = lines.slice(1);
    }
    return { label, lines };
  });
}
```

- [ ] **Step 4: Run — PASS.** **Step 5: Commit**

```bash
git add src/shared/songs && git commit -m "feat: paste-lyrics splitter with section auto-labeling"
```

---

### Task 5: SQLite song repository + seed (TDD)

**Files:**
- Create: `src/main/db.ts`, `src/main/songsRepo.ts`, `src/main/songsRepo.test.ts`, `src/main/seed.ts`

**Interfaces:**
- Consumes: `rankSongs` (Task 3), `splitToSlides` (Task 4), types (Task 2).
- Produces:
  - `openDb(path: string): Database` (better-sqlite3 instance, migrated)
  - `createSongsRepo(db: Database)` returning `{ list(): Song[]; get(id): Song | null; add(input: NewSongInput): Song; search(q, field): SongSearchResult[]; count(): number }`
  - `seedIfEmpty(repo): void`

- [ ] **Step 1: Failing tests `songsRepo.test.ts`** (in-memory DB)

```ts
import { beforeEach, expect, test } from 'vitest';
import { openDb } from './db';
import { createSongsRepo, type SongsRepo } from './songsRepo';

let repo: SongsRepo;
beforeEach(() => { repo = createSongsRepo(openDb(':memory:')); });

test('add parses text into sections and persists', () => {
  const s = repo.add({ title: 'Amazing Grace', author: 'John Newton', text: 'Verse 1\nAmazing grace! how sweet the sound,\n\nChorus\nPraise God' });
  expect(s.sections).toHaveLength(2);
  expect(repo.get(s.id)?.title).toBe('Amazing Grace');
  expect(repo.count()).toBe(1);
});
test('search finds by typo’d lyric via re-rank fallback', () => {
  repo.add({ title: 'Only Believe', text: 'Chorus\nOnly believe, only believe,\nAll things are possible' });
  repo.add({ title: 'Holy Holy Holy', text: 'Verse 1\nHoly, holy, holy! Lord God Almighty!' });
  const r = repo.search('only beleive', 'all');
  expect(r[0].song.title).toBe('Only Believe');
});
test('empty query lists everything', () => {
  repo.add({ title: 'A', text: 'x' }); repo.add({ title: 'B', text: 'y' });
  expect(repo.search('', 'all')).toHaveLength(2);
});
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement `db.ts`**

```ts
import Database from 'better-sqlite3';
const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  sections_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'local',
  created_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS song_fts USING fts5(
  title, author, lyrics, tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
`;
export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 4: Implement `songsRepo.ts`** — FTS kept in sync inside the same transaction as the row write (no triggers); search = FTS prefix candidates, falling back to full-library scan when candidates are sparse (< 30), then `rankSongs` re-ranks. FTS match string is built from `norm()`d tokens as `"tok"*` so user input can never inject FTS syntax.

```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { NewSongInput, SearchField, Song, SongSearchResult } from '../shared/types';
import { norm } from '../shared/search/fuzzy';
import { rankSongs } from '../shared/search/songScore';
import { splitToSlides } from '../shared/songs/splitToSlides';

export interface SongsRepo {
  list(): Song[]; get(id: string): Song | null;
  add(input: NewSongInput): Song;
  search(q: string, field: SearchField): SongSearchResult[];
  count(): number;
}
interface Row { id: string; title: string; author: string; sections_json: string; source: string; created_at: number; rowid: number }
const toSong = (r: Row): Song => ({ id: r.id, title: r.title, author: r.author, sections: JSON.parse(r.sections_json), source: r.source, createdAt: r.created_at });
const lyricsOf = (s: Song) => s.sections.map((x) => x.lines.join(' ')).join(' ');

export function createSongsRepo(db: Database.Database): SongsRepo {
  const insertSong = db.prepare('INSERT INTO songs (id, title, author, sections_json, source, created_at) VALUES (?,?,?,?,?,?)');
  const insertFts = db.prepare('INSERT INTO song_fts (rowid, title, author, lyrics) VALUES ((SELECT rowid FROM songs WHERE id = ?),?,?,?)');
  const list = (): Song[] => (db.prepare('SELECT rowid, * FROM songs ORDER BY created_at, title').all() as Row[]).map(toSong);
  return {
    list,
    get: (id) => { const r = db.prepare('SELECT rowid, * FROM songs WHERE id = ?').get(id) as Row | undefined; return r ? toSong(r) : null; },
    count: () => (db.prepare('SELECT COUNT(*) AS n FROM songs').get() as { n: number }).n,
    add(input) {
      const sections = splitToSlides(input.text);
      if (!sections.length) throw new Error('Song has no content');
      const song: Song = { id: randomUUID(), title: input.title.trim() || 'Untitled Song', author: input.author?.trim() ?? '', sections, source: input.source ?? 'local', createdAt: Date.now() };
      db.transaction(() => {
        insertSong.run(song.id, song.title, song.author, JSON.stringify(song.sections), song.source, song.createdAt);
        insertFts.run(song.id, song.title, song.author, lyricsOf(song));
      })();
      return song;
    },
    search(q, field) {
      const tokens = norm(q).split(' ').filter(Boolean);
      if (!tokens.length) return rankSongs('', list(), field);
      const match = tokens.map((t) => `"${t}"*`).join(' OR ');
      const rowids = (db.prepare('SELECT rowid FROM song_fts WHERE song_fts MATCH ?').all(match) as { rowid: number }[]).map((r) => r.rowid);
      let candidates: Song[];
      if (rowids.length >= 30) {
        const qs = rowids.map(() => '?').join(',');
        candidates = (db.prepare(`SELECT rowid, * FROM songs WHERE rowid IN (${qs})`).all(...rowids) as Row[]).map(toSong);
      } else candidates = list(); // sparse FTS hits → typo likely; scan library, scorer handles fuzz
      return rankSongs(q, candidates, field).slice(0, 50);
    },
  };
}
```

- [ ] **Step 5: Run — PASS.** **Step 6: Write `src/main/seed.ts`**

`seedIfEmpty(repo)` adds the prototype's 10 hymns when `repo.count() === 0`. Source of truth: `docs/design/Lectern.pretty.html` lines 829–870 (`buildData()`), which contains full sections for: Amazing Grace, Only Believe, It Is Well With My Soul, Blessed Assurance, Great Is Thy Faithfulness, Holy Holy Holy, How Great Thou Art, The Old Rugged Cross, I'd Rather Have Jesus, Down From His Glory. Transcribe each `song(...)` call to a `NewSongInput` with `source: 'seed'`, joining sections with blank lines and label headers. Format example (repeat this shape for all 10; copy lyrics exactly from the design file):

```ts
import type { SongsRepo } from './songsRepo';
const HYMNS: { title: string; author: string; text: string }[] = [
  {
    title: 'Amazing Grace', author: 'John Newton',
    text: 'Verse 1\nAmazing grace! how sweet the sound,\nThat saved a wretch like me;\nI once was lost, but now am found,\nWas blind, but now I see.\n\nVerse 2\n’Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear\nThe hour I first believed.\n\nVerse 3\nThrough many dangers, toils, and snares,\nI have already come;\n’Tis grace hath brought me safe thus far,\nAnd grace will lead me home.\n\nVerse 4\nWhen we’ve been there ten thousand years,\nBright shining as the sun,\nWe’ve no less days to sing God’s praise\nThan when we’d first begun.',
  },
  // ...the other 9 hymns, transcribed from docs/design/Lectern.pretty.html lines 836–870
];
export function seedIfEmpty(repo: SongsRepo): void {
  if (repo.count() > 0) return;
  for (const h of HYMNS) repo.add({ ...h, source: 'seed' });
}
```

Add a test in `songsRepo.test.ts`: seeding an empty repo yields 10 songs; seeding twice still yields 10.

- [ ] **Step 7: Run all — PASS.** **Step 8: Commit**

```bash
git add src/main && git commit -m "feat: sqlite song repository with FTS+fuzzy search and seed hymns"
```

---

### Task 6: Presentation state core (TDD)

**Files:**
- Create: `src/shared/presentation/core.ts`, `src/shared/presentation/core.test.ts`

**Interfaces:**
- Produces (pure functions, no Electron imports):
  - `initialPresentation(): PresentationState` → `{ output: 'black', liveKey: null, liveSnap: null }`
  - `keyForSong(songId: string, section: number): string` → `` `song:${id}:${section}` ``
  - `sameFlow(a: string | null, b: string | null): boolean` — same key prefix and same id (for future `scr:` keys: same book+chapter; implement the prototype's rule now)
  - `applyCue(st, key, slide): PresentationState` — hot-update live snap only when live and sameFlow
  - `goLive(st, key, slide): PresentationState` — toggle down to black if already live on this key, else snapshot+live
  - `setOutput(st, mode): PresentationState`
  - `outputPayload(st, logoTitle?): OutputPayload` — black→`{kind:'black'}`, logo→`{kind:'logo', title:'HELM'}`, live→snap or `{kind:'blank'}`

- [ ] **Step 1: Failing tests** (port semantics from prototype lines 959–963)

```ts
import { expect, test } from 'vitest';
import { applyCue, goLive, initialPresentation, keyForSong, outputPayload, sameFlow, setOutput } from './core';
import type { Slide } from '../types';

const slide = (label: string): Slide => ({ kind: 'lyrics', label, lines: ['x'] });

test('initial state is black with no snapshot', () => {
  expect(initialPresentation()).toEqual({ output: 'black', liveKey: null, liveSnap: null });
});
test('goLive snapshots the cued slide', () => {
  const st = goLive(initialPresentation(), keyForSong('a', 0), slide('V1'));
  expect(st.output).toBe('live'); expect(st.liveKey).toBe('song:a:0'); expect(st.liveSnap?.label).toBe('V1');
});
test('goLive on the already-live key takes it down (black)', () => {
  let st = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  st = goLive(st, 'song:a:0', slide('V1'));
  expect(st.output).toBe('black');
});
test('sameFlow: same song different section is same flow; different song is not', () => {
  expect(sameFlow('song:a:0', 'song:a:2')).toBe(true);
  expect(sameFlow('song:a:0', 'song:b:0')).toBe(false);
  expect(sameFlow(null, 'song:a:0')).toBe(false);
});
test('applyCue while live in same flow hot-updates the screen', () => {
  let st = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  st = applyCue(st, 'song:a:1', slide('V2'));
  expect(st.liveKey).toBe('song:a:1'); expect(st.liveSnap?.label).toBe('V2'); expect(st.output).toBe('live');
});
test('applyCue while live in different flow leaves the screen alone', () => {
  let st = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  st = applyCue(st, 'song:b:0', slide('OTHER'));
  expect(st.liveKey).toBe('song:a:0'); expect(st.liveSnap?.label).toBe('V1');
});
test('applyCue while black never touches the screen', () => {
  const st = applyCue(initialPresentation(), 'song:a:0', slide('V1'));
  expect(st.liveSnap).toBeNull();
});
test('outputPayload derives the audience slide', () => {
  expect(outputPayload(initialPresentation()).slide.kind).toBe('black');
  expect(outputPayload(setOutput(initialPresentation(), 'logo')).slide).toEqual({ kind: 'logo', title: 'HELM' });
  const live = goLive(initialPresentation(), 'song:a:0', slide('V1'));
  expect(outputPayload(live).slide.label).toBe('V1');
});
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement `core.ts`**

```ts
import type { OutputMode, OutputPayload, PresentationState, Slide } from '../types';

export function initialPresentation(): PresentationState {
  return { output: 'black', liveKey: null, liveSnap: null };
}
export function keyForSong(songId: string, section: number): string {
  return `song:${songId}:${section}`;
}
export function sameFlow(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const pa = a.split(':'), pb = b.split(':');
  if (pa[0] !== pb[0]) return false;
  if (pa[0] === 'scr') return pa[1] === pb[1] && pa[2] === pb[2];
  return pa[1] === pb[1];
}
export function applyCue(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output === 'live' && sameFlow(st.liveKey, key)) return { ...st, liveKey: key, liveSnap: slide };
  return st;
}
export function goLive(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output === 'live' && st.liveKey === key) return { ...st, output: 'black' };
  return { output: 'live', liveKey: key, liveSnap: slide };
}
export function setOutput(st: PresentationState, mode: OutputMode): PresentationState {
  return { ...st, output: mode };
}
export function outputPayload(st: PresentationState, logoTitle = 'HELM'): OutputPayload {
  const slide: Slide = st.output === 'black' ? { kind: 'black' }
    : st.output === 'logo' ? { kind: 'logo', title: logoTitle }
    : st.liveSnap ?? { kind: 'blank' };
  return { slide, variant: 'audience' };
}
```

- [ ] **Step 4: Run — PASS.** **Step 5: Commit**

```bash
git add src/shared/presentation && git commit -m "feat: cue/live presentation state machine ported from prototype"
```

---

### Task 7: Main-process wiring — state store, IPC, preload, displays v0

**Files:**
- Create: `src/main/stateStore.ts`, `src/main/ipc.ts`, `src/main/displays.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts` (+ the scaffold's `src/preload/index.d.ts` to declare `window.helm: HelmApi`)

**Interfaces:**
- Consumes: Tasks 2, 5, 6.
- Produces: `window.helm` implementing `HelmApi` exactly; main broadcasts `CH.presState` (PresentationState) to all windows and `CH.outputSlide` (OutputPayload) to output windows on every change; `createOutputWindow(bounds)` and `initDisplays()` in `displays.ts`.

- [ ] **Step 1: `stateStore.ts`**

```ts
import { BrowserWindow } from 'electron';
import { CH, type OutputMode, type PresentationState, type Slide } from '../shared/types';
import { applyCue, goLive, initialPresentation, outputPayload, setOutput } from '../shared/presentation/core';

let state: PresentationState = initialPresentation();
const outputWindows = new Set<BrowserWindow>();

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.presState, state);
  const payload = outputPayload(state);
  for (const w of outputWindows) if (!w.isDestroyed()) w.webContents.send(CH.outputSlide, payload);
}
export const presentation = {
  get: () => state,
  cue: (key: string, slide: Slide) => { state = applyCue(state, key, slide); broadcast(); },
  goLive: (key: string, slide: Slide) => { state = goLive(state, key, slide); broadcast(); },
  setOutput: (mode: OutputMode) => { state = setOutput(state, mode); broadcast(); },
  registerOutput(w: BrowserWindow) {
    outputWindows.add(w);
    w.on('closed', () => outputWindows.delete(w));
    w.webContents.once('did-finish-load', () => w.webContents.send(CH.outputSlide, outputPayload(state)));
  },
  outputCount: () => outputWindows.size,
};
```

- [ ] **Step 2: `displays.ts`** — v0 per spec §6 (roles/fingerprints come in slice 6; v0 = every non-primary display gets an audience output, auto-attached on plug-in)

```ts
import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { CH, type DisplayStatus } from '../shared/types';
import { presentation } from './stateStore';

const byDisplayId = new Map<number, BrowserWindow>();

function loadOutput(win: BrowserWindow): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/output/index.html`);
  else win.loadFile(join(__dirname, '../renderer/output/index.html'));
}
export function createOutputWindow(bounds: Electron.Rectangle, frameless = true): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds, frame: !frameless, resizable: !frameless, movable: !frameless,
    backgroundColor: '#000000', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false },
  });
  if (frameless) { win.setAlwaysOnTop(true, 'screen-saver'); win.setSkipTaskbar(true); win.setBounds(bounds); }
  loadOutput(win);
  presentation.registerOutput(win);
  return win;
}
export function displayStatus(): DisplayStatus { return { outputs: byDisplayId.size }; }

export function initDisplays(): void {
  const sync = (): void => {
    const primary = screen.getPrimaryDisplay();
    const externals = screen.getAllDisplays().filter((d) => d.id !== primary.id);
    for (const [id, win] of byDisplayId) if (!externals.some((d) => d.id === id)) { win.destroy(); byDisplayId.delete(id); }
    for (const d of externals) {
      const existing = byDisplayId.get(d.id);
      if (existing && !existing.isDestroyed()) { existing.setBounds(d.bounds); continue; }
      byDisplayId.set(d.id, createOutputWindow(d.bounds));
    }
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.displaysStatus, displayStatus());
  };
  screen.on('display-added', sync); screen.on('display-removed', sync); screen.on('display-metrics-changed', sync);
  sync();
}
// Dev helper: windowed output for single-display machines
export function openTestOutput(): void { createOutputWindow({ x: 80, y: 80, width: 960, height: 540 }, false); }
```

- [ ] **Step 3: `ipc.ts`**

```ts
import { ipcMain } from 'electron';
import { CH, type NewSongInput, type OutputMode, type SearchField, type Slide } from '../shared/types';
import type { SongsRepo } from './songsRepo';
import { presentation } from './stateStore';
import { displayStatus, openTestOutput } from './displays';

export function registerIpc(repo: SongsRepo): void {
  ipcMain.handle(CH.songsSearch, (_e, q: string, field: SearchField) => repo.search(q, field));
  ipcMain.handle(CH.songsList, () => repo.list());
  ipcMain.handle(CH.songsGet, (_e, id: string) => repo.get(id));
  ipcMain.handle(CH.songsAdd, (_e, input: NewSongInput) => repo.add(input));
  ipcMain.handle(CH.presGet, () => presentation.get());
  ipcMain.on(CH.presCue, (_e, key: string, slide: Slide) => presentation.cue(key, slide));
  ipcMain.on(CH.presGoLive, (_e, key: string, slide: Slide) => presentation.goLive(key, slide));
  ipcMain.on(CH.presSetOutput, (_e, mode: OutputMode) => presentation.setOutput(mode));
  ipcMain.handle(CH.displaysGet, () => displayStatus());
  ipcMain.on(CH.displaysOpenTest, () => openTestOutput());
}
```

- [ ] **Step 4: `preload/index.ts`**

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CH, type HelmApi } from '../shared/types';

const sub = <T>(channel: string) => (cb: (v: T) => void) => {
  const h = (_e: IpcRendererEvent, v: T): void => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};
const api: HelmApi = {
  songs: {
    search: (q, field) => ipcRenderer.invoke(CH.songsSearch, q, field),
    list: () => ipcRenderer.invoke(CH.songsList),
    get: (id) => ipcRenderer.invoke(CH.songsGet, id),
    add: (input) => ipcRenderer.invoke(CH.songsAdd, input),
  },
  presentation: {
    get: () => ipcRenderer.invoke(CH.presGet),
    cue: (key, slide) => ipcRenderer.send(CH.presCue, key, slide),
    goLive: (key, slide) => ipcRenderer.send(CH.presGoLive, key, slide),
    setOutput: (mode) => ipcRenderer.send(CH.presSetOutput, mode),
    onState: sub(CH.presState),
  },
  output: { onSlide: sub(CH.outputSlide) },
  displays: {
    get: () => ipcRenderer.invoke(CH.displaysGet),
    onStatus: sub(CH.displaysStatus),
    openTest: () => ipcRenderer.send(CH.displaysOpenTest),
  },
};
contextBridge.exposeInMainWorld('helm', api);
```

And `index.d.ts`: `declare global { interface Window { helm: HelmApi } }`.

- [ ] **Step 5: Wire `main/index.ts`** — on `app.whenReady()`: `const db = openDb(join(app.getPath('userData'), 'helm.db'))`, `const repo = createSongsRepo(db)`, `seedIfEmpty(repo)`, `registerIpc(repo)`, create operator window, `initDisplays()`. Add an app menu item **View → Open Test Output** calling `openTestOutput()`.

- [ ] **Step 6: Verify**

Run: `npm run typecheck` → clean. `npm test` → all pass.
Run: `npm run dev` → operator window opens; View → Open Test Output opens a black 960×540 window (black because initial output mode is `black`). In the operator devtools console: `await window.helm.songs.list()` returns 10 seeded hymns; `window.helm.presentation.setOutput('logo')` turns the test output window content to the logo payload (it renders in Task 8; for now verify via `await window.helm.presentation.get()`).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: main-process state store, typed IPC bridge, display manager v0"
```

---

### Task 8: SlideCanvas React port + output window renderer

**Files:**
- Create: `src/renderer/shared/SlideCanvas.tsx`, `src/renderer/shared/SlideCanvas.test.tsx`
- Modify: `src/renderer/output/main.tsx`

**Interfaces:**
- Consumes: `Slide`, `OutputPayload`, `OutputVariant`, `window.helm.output.onSlide`.
- Produces: `<SlideCanvas slide={Slide} variant={OutputVariant} clock?: string; next?: string; title?: string; fill?: boolean />` — used by the output window now and by operator previews in later slices. `fill` (default false) renders `height: 100%` instead of `aspectRatio: 16/9` for fullscreen output.

- [ ] **Step 1: Port the component.** `docs/design/SlideCanvas.dc.html` contains the complete logic and every style object in its `renderVals()` — transcribe it to a React function component: props `{ slide, variant = 'audience', clock, next, title, fill }`; compute the same booleans (`isLyrics`, `isScripture`, `isQuote`, `isTitle`, `isCountdown`, `isBlank`, `showChrome`, `showLabel`, `isLowerThird`, `showBackPlate`) and copy every style object verbatim as `React.CSSProperties`. Two changes only: (a) the logo/blank fallback text is `'HELM'` not `'LECTERN'`; (b) when `fill` is true, `rootStyle` uses `height: '100%'` and drops `aspectRatio`. Load the three Google-font families in `output/index.html` and `operator/index.html` with the same `<link>` tags the design files use.

- [ ] **Step 2: Tests** (vitest + jsdom; add `environment: 'jsdom'` pragma per-file with `// @vitest-environment jsdom` and `npm i -D @testing-library/react jsdom`)

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { SlideCanvas } from './SlideCanvas';

test('renders lyric lines', () => {
  render(<SlideCanvas slide={{ kind: 'lyrics', lines: ['Amazing grace!', 'How sweet'] }} />);
  expect(screen.getByText('Amazing grace!')).toBeTruthy();
});
test('logo shows HELM', () => {
  render(<SlideCanvas slide={{ kind: 'logo' }} />);
  expect(screen.getByText('HELM')).toBeTruthy();
});
test('black renders no visible text', () => {
  const { container } = render(<SlideCanvas slide={{ kind: 'black' }} />);
  expect(container.textContent).toBe('');
});
test('scripture renders ref and columns', () => {
  render(<SlideCanvas slide={{ kind: 'scripture', ref: 'John 3:16', columns: [{ version: 'KJV', text: 'For God so loved…' }] }} />);
  expect(screen.getByText('John 3:16')).toBeTruthy();
  expect(screen.getByText('KJV')).toBeTruthy();
});
```

- [ ] **Step 3: Run — PASS after implementation.**

- [ ] **Step 4: Output window `output/main.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { OutputPayload } from '../../shared/types';
import { SlideCanvas } from '../shared/SlideCanvas';

function OutputApp(): React.JSX.Element {
  const [payload, setPayload] = useState<OutputPayload>({ slide: { kind: 'black' }, variant: 'audience' });
  useEffect(() => window.helm.output.onSlide(setPayload), []);
  useEffect(() => { document.body.style.cursor = 'none'; document.body.style.background = '#000'; }, []);
  return <div style={{ position: 'fixed', inset: 0 }}><SlideCanvas slide={payload.slide} variant={payload.variant} fill /></div>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<OutputApp />);
```

- [ ] **Step 5: Verify end-to-end.** `npm run dev` → View → Open Test Output → from operator devtools run `window.helm.presentation.goLive('song:x:0', { kind: 'lyrics', label: 'Verse 1', lines: ['Amazing grace! how sweet the sound'] })` → the test output shows the lyric big and centered. `window.helm.presentation.setOutput('logo')` → HELM logo. `setOutput('black')` → black.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: SlideCanvas render component and live output window"
```

---

### Task 9: Operator shell — theme, header, mode tabs

**Files:**
- Create: `src/renderer/operator/Header.tsx`, `src/renderer/operator/useHelm.ts`
- Modify: `src/renderer/operator/App.tsx`, `src/renderer/operator/main.tsx`, `src/renderer/operator/index.html`

**Interfaces:**
- Consumes: `themeFor` (Task 2), `window.helm` (Task 7).
- Produces:
  - `useHelm.ts` hooks: `usePresentationState(): PresentationState` (seeded by `presentation.get()`, updated by `onState`), `useDisplayStatus(): DisplayStatus`, `useClock(): string` (HH:MM:SS, 1 s tick)
  - `ThemeCtx = React.createContext<Theme>(themeFor('dark'))` exported from `App.tsx`
  - `App` renders: header + mode area; `mode` state `'pre' | 'songs' | 'sermon'` defaulting `'songs'`; `pre`/`sermon` render a centered placeholder panel: title "Pre-service" / "Sermon", body copy "Coming in a later slice — see docs/superpowers/specs/2026-07-03-helm-design.md §11."

- [ ] **Step 1: `useHelm.ts`**

```ts
import { useEffect, useState } from 'react';
import type { DisplayStatus, PresentationState } from '../../shared/types';

export function usePresentationState(): PresentationState {
  const [st, setSt] = useState<PresentationState>({ output: 'black', liveKey: null, liveSnap: null });
  useEffect(() => {
    let live = true;
    void window.helm.presentation.get().then((s) => { if (live) setSt(s); });
    const off = window.helm.presentation.onState(setSt);
    return () => { live = false; off(); };
  }, []);
  return st;
}
export function useDisplayStatus(): DisplayStatus {
  const [d, setD] = useState<DisplayStatus>({ outputs: 0 });
  useEffect(() => {
    void window.helm.displays.get().then(setD);
    return window.helm.displays.onStatus(setD);
  }, []);
  return d;
}
export function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const p = (n: number): string => (n < 10 ? '0' : '') + n;
  return `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}
```

- [ ] **Step 2: Header + App.** Port the header from the design (`Lectern.pretty.html` lines 27–49, style objects at lines 1233–1245): 56 px bar with logo tile (letter **H**, the design's gold gradient `linear-gradient(150deg,#e7b95c,#cf8f33)`), service title "Sunday Service", mode tab pills (Pre-service / Songs / Sermon — active pill `accent` bg per `modeTabs` style at line 1089), flex spacer, live-status pill (port `liveStatusStyle`/`liveDotStyle`/`outLabel` logic lines 1091–1093 and 1237–1243: label `SCREEN BLACK` / `LOGO` / `LIVE — <snap label>`, pulsing dot animation `lecPulse` when live, clicking it while live takes down via `setOutput('black')`, showing the `✕ TAKE DOWN` chip), theme toggle button (☀/☾ toggling a `themeMode` state in App), and the monospace clock from `useClock()`. Header receives props `{ mode, setMode, themeMode, toggleTheme }` and reads presentation state via `usePresentationState()`. Also surface `useDisplayStatus()` as a small chip next to the live pill: `N OUTPUTS` (faint when 0). Define the `lecPulse` keyframes plus scrollbar CSS from the design's `<style>` block (lines 15–22) in a global stylesheet `operator/global.css`.

- [ ] **Step 3: Verify.** `npm run dev` → dark operator shell with working tabs, ticking clock, theme toggle flips to the light palette, live pill reads `SCREEN BLACK`, outputs chip shows `0 OUTPUTS` (or 1 with a second display attached). Songs tab shows an empty main area (Task 10 fills it).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: operator shell with header, mode tabs, theme system"
```

---

### Task 10: Songs mode — search rail, hero, section rail, transport

**Files:**
- Create: `src/renderer/operator/SongsMode.tsx`
- Modify: `src/renderer/operator/App.tsx` (render `<SongsMode/>` when mode is songs)

**Interfaces:**
- Consumes: `window.helm.songs`, `window.helm.presentation`, `keyForSong` from `@shared/presentation/core`, `ThemeCtx`, `usePresentationState`.
- Produces: the full songs operator surface. Layout and every style object come from the design — songs mode markup `Lectern.pretty.html` lines 53–165, style objects lines 1096–1111 and 1250–1282.

Component state: `q: string`, `field: SearchField`, `results: SongSearchResult[]`, `library: Song[]` (loaded once for default listing), `activeSongId: string | null`, `section: number`.

Behavior contract (all from the prototype):
- Search box + field tabs (All/Title/Lyric); results re-query `window.helm.songs.search(q, field)` on every keystroke (they're < 50 ms; no debounce needed); show max 9 with title, author + section count, italic snippet when present, active dot.
- Enter in the search box selects the top result; Escape clears the query.
- Selecting a song: `setActiveSongId`, `setSection(0)`, then `cueCurrent()`.
- `cueCurrent()` derives `key = keyForSong(activeSongId, section)` and `slide = { kind: 'lyrics', accent: '#e0a341', label: `${song.title} · ${sec.label}`, lines: sec.lines }` and calls `window.helm.presentation.cue(key, slide)`. Call it whenever song/section changes.
- Section rail: one card per section, click → `setSection(i)` + cue; badge `CUED` when `i === section`, `LIVE` when presentation state says `output==='live' && liveKey === keyForSong(activeSongId, i)` (styles: lines 1107–1111).
- Hero panel: big centered current-section lines (`bigLineStyle` line 1278), label `NOW SINGING · <label>`; ring highlight when the cued key is live (`bigVerseWrapStyle` line 1276).
- Transport bar: `‹ Prev` / `Cue next ›` (clamp section, cue), spacer, **● Go live / ■ Take down** button (green `#2f9e5b` when not live on cued key, `live` red when it is — line 1281; click → `window.helm.presentation.goLive(key, slide)`), `Logo` button (toggles `setOutput(output === 'logo' ? 'live' : 'logo')` — prototype line 971).
- Panel widths: fixed defaults for now (search rail 250 px, section rail 380 px); drag-resize arrives in Task 12.

- [ ] **Step 1: Build the component** per the contract above, copying style objects from the referenced design lines. Keep sub-pieces as local components in the same file unless it passes ~400 lines — then split `SongSearchRail.tsx` / `SectionRail.tsx`.

- [ ] **Step 2: Verify the full loop.** `npm run dev` → Songs tab: type `amazin grace` → Amazing Grace tops the list with a snippet; click it → hero shows Verse 1, section rail shows 4 verses with V1 `CUED`; open View → Test Output; press **Go live** → output shows Verse 1 lines, button flips to **■ Take down**, live pill reads `LIVE — AMAZING GRACE · VERSE 1`; click section 2 → output hot-updates (same flow); search and select a different song → output KEEPS showing Amazing Grace (different flow) until Go live again; **Logo** → HELM logo on output; live pill click → takes down.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: songs mode with live search, section rail, and go-live transport"
```

---

### Task 11: Quick-add paste modal

**Files:**
- Create: `src/renderer/operator/QuickAdd.tsx`
- Modify: `src/renderer/operator/SongsMode.tsx` (add the `+ Add a song — search or paste` rail footer button; on save, select the new song)

**Interfaces:**
- Consumes: `splitToSlides` (Task 4, for live preview), `window.helm.songs.add`, `ThemeCtx`.
- Produces: `<QuickAdd open onClose onSaved(song) />`. Design source: modal markup lines 601–697, styles lines 1387–1409. Scope note: only the **Paste lyrics** tab is functional in this slice; the **Search online** tab button renders but is disabled with tooltip "Online sources arrive with the song-sources slice" (spec §11 slice ordering).

Behavior: overlay click or Escape closes; title input + big textarea; right panel live-previews `splitToSlides(text)` as labeled slide cards with count; **Add to library** calls `window.helm.songs.add({ title, text })`, closes, and `onSaved` selects + cues the new song. Empty text → save disabled.

- [ ] **Step 1: Build modal per contract.**
- [ ] **Step 2: Verify.** Paste a two-stanza lyric with a `Chorus` header → preview shows `Verse 1` and `Chorus` cards; save → song is selected, searchable (restart the app — it persists), and can go live.
- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: quick-add song modal with paste-and-split preview"
```

---

### Task 12: Keyboard control + resizable panels

**Files:**
- Modify: `src/renderer/operator/App.tsx`, `src/renderer/operator/SongsMode.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: global service keyboard handling + persisted panel widths.

Behavior (prototype lines 763–812):
- `keydown` on `document` (registered in App, delegated to the active mode via a ref): ignore when target is input/textarea except Escape; Escape closes any open modal; ArrowRight/ArrowDown → advance section +1 (cue), ArrowLeft/ArrowUp → −1; Enter/Space → go live on current cue.
- Drag handles between search rail / hero / section rail (grip markup lines 99–102 and 127–130): pointer-drag adjusts widths, clamped 200–360 px (list) and 260–620 px (sections); persist to `localStorage` keys `helmSongListW` / `helmSectionPanelW`; section rail font scales with width per `secFont` formula (line 1106): `round(max(13, min(18, width/24)))`.

- [ ] **Step 1: Implement both.**
- [ ] **Step 2: Verify.** Arrows step sections and hot-update live output when live; Enter toggles live; drag handles resize and survive an app restart.
- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: service keyboard control and persisted resizable panels"
```

---

### Task 13: Final verification, packaging smoke, README

**Files:**
- Modify: `README.md`, `package.json` (electron-builder config: `appId: com.helm.app`, `productName: Helm`)

- [ ] **Step 1: Full gate.** `npm run typecheck` → clean; `npm test` → all pass; `npm run dev` → run the Task 10 Step 2 verification loop once more end-to-end.
- [ ] **Step 2: Package for the current platform.** `npm run build && npx electron-builder --dir` → launch the unpacked app from `dist/`; verify it boots, seeds, searches, and drives the test output. (Cross-platform installers are slice 7; this is a packaging smoke only.)
- [ ] **Step 3: README** — what Helm is (one paragraph from spec §1), dev commands (`npm run dev/test/typecheck`), architecture pointer to the spec, and a "Sunday quickstart": plug in the projector before or after launch — the output attaches automatically; Songs → search → Enter → Go live.
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: packaging config, README, slice 1-2 verification"
```

---

## Self-Review Notes

- **Spec coverage (slices 1–2):** scaffold/shell (T1, T9), song DB + search (T3, T5), sections rail + cue/live machine (T6, T10), output window on second display incl. auto-attach v0 (T7, T8), quick-add paste (T4, T11), keyboard + layout persistence (T12), packaging smoke (T13). Deliberately deferred per spec §11: scripture, message, pre-service, settings card, display roles/fingerprints, online song search.
- **Type consistency:** all cross-task names are defined once in Task 2 (`CH`, `HelmApi`, domain types) and referenced verbatim in Tasks 5–12; presentation functions defined in Task 6 are the ones imported in Tasks 7 and 10 (`keyForSong`, `applyCue`, `goLive`, `setOutput`, `outputPayload`).
- **Placeholders:** UI tasks reference exact design-file line ranges for style objects instead of inlining hundreds of CSS lines — the vendored files are in-repo and line-stable; behavior contracts are fully specified inline.
