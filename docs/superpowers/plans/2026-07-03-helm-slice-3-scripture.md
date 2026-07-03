# Helm Slice 3: Scripture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The sermon mode's Scripture track end-to-end: type "john 3:16" and put it on the projector — with bible storage, a bundled KJV, a downloadable-translations installer in a new Settings card, side-by-side translation compare, the chapter rail, and a persistent reading schedule.

**Architecture:** Bible text lives in SQLite (`bible_versions` + `verses`), installed transactionally from getbible.net v2 JSON behind a `BibleSource` normalizer; KJV ships bundled in `resources/bibles/` and auto-installs on first run. Pure logic (66-book reference parser, scripture keys/slides) goes in `src/shared/scripture/` with unit tests. The sermon UI ports the design's scripture track exactly; Message and Slides tracks render as disabled placeholders for slices 4–5.

**Tech Stack:** Existing (Electron, React, TS strict, better-sqlite3, vitest). Downloads via Node 20 global `fetch` in the main process.

## Global Constraints

- Everything from the slice 1–2 plan still binds: Helm naming user-visible, TS `strict`, no `any` in `src/shared/`, IPC channel names only from `CH` in `src/shared/types.ts`, colocated vitest tests, `npm test` + `npm run typecheck` + eslint (0 errors) clean at every commit, **no Co-Authored-By trailers**, renderer touches Electron only via `window.helm`.
- Design fidelity source: `docs/design/Lectern.pretty.html` — sermon-mode markup lines 167–463, sermon style objects lines 1113–1180 and 1284–1344. Copy style values character-exactly (established review standard).
- Bible text is data — never hand-edit verse text; installs are transactional (a failed download/install leaves no partial version); network failures surface calmly in the UI and never crash or block the operator console.
- Scripture cue keys are `scr:<book>:<chapter>:<verse>` — `sameFlow` in `src/shared/presentation/core.ts` already treats same book+chapter as one flow. Do not change core.ts semantics.
- Missing translation on screen renders the spec §9 fallback text `[ Install a Bible in Settings ]` — never an empty panel or crash.
- Pinned bible source (verified live 2026-07-03): `https://api.getbible.net/v2/<id>.json` for ids `kjv`, `web`, `asv`, `darby`. Schema: `{translation, abbreviation, lang, books: [{nr, name, chapters: [{chapter, verses: [{verse, text}]}]}]}`.

## File Structure (new/modified)

```
scripts/fetch-bibles.mjs              — one-shot: download kjv.json into resources/bibles/ (run once, commit output)
resources/bibles/kjv.json             — bundled KJV (committed, ~9 MB; packaged via extraResources)
src/shared/scripture/books.ts         — 66-book canon: names + aliases          (pure)
src/shared/scripture/refs.ts          — parseRef, matchBook, formatRef          (pure)
src/shared/scripture/slides.ts        — keyForScripture, buildScriptureSlide, verseCols (pure)
src/main/biblesRepo.ts                — bible_versions/verses CRUD + getChapter
src/main/bibleSource.ts               — manifest, getbible fetch + normalize, installer service
src/main/scheduleRepo.ts              — default service + scripture schedule items
src/main/db.ts                        — MODIFY: append new tables to SCHEMA
src/main/ipc.ts, src/preload/index.ts, src/shared/types.ts — MODIFY: new channels + HelmApi surface
src/main/index.ts                     — MODIFY: repos wiring, first-run KJV install
src/renderer/operator/SermonMode.tsx  — scripture track: schedule panel + center + transport
src/renderer/operator/ChapterRail.tsx — right panel verse rail
src/renderer/operator/VersionPicker.tsx — translations popover
src/renderer/operator/SettingsModal.tsx — settings card with Bibles section
src/renderer/operator/App.tsx, Header.tsx — MODIFY: sermon mount, settings gear, mode keep-alive
electron-builder.yml                  — MODIFY: extraResources for resources/bibles
```

---

### Task 1: Book canon + reference parser (TDD)

**Files:**
- Create: `src/shared/scripture/books.ts`, `src/shared/scripture/refs.ts`, `src/shared/scripture/refs.test.ts`, `src/shared/scripture/slides.ts`, `src/shared/scripture/slides.test.ts`

**Interfaces:**
- Consumes: `norm` from `../search/fuzzy`; `Slide`, `SlideColumn` from `../types`.
- Produces:
  - `BOOKS: ReadonlyArray<{ name: string; aliases: string[] }>` — all 66, canonical names below
  - `matchBook(token: string): string | null` — exact alias match first, then alias-prefix match (prototype rule, `Lectern.pretty.html:944`)
  - `parseRef(raw: string): ParsedRef | null` where `ParsedRef = { book: string; ch: number; from: number; to: number }`
  - `formatRef(p: ParsedRef): string` → `"John 3:16"` / `"Genesis 1:1–10"` (en dash for ranges)
  - `keyForScripture(book: string, ch: number, v: number): string` → `` `scr:${book}:${ch}:${v}` ``
  - `verseCols(textByVersion: Record<string, string>, selected: string[], abbrOf: (id: string) => string): SlideColumn[]` — selected order, skip missing texts; empty result means caller shows the install-hint fallback
  - `buildScriptureSlide(ref: string, columns: SlideColumn[]): Slide` → `{ kind: 'scripture', accent: '#6f9cf0', ref, label: ref, columns }`

- [ ] **Step 1: Write `books.ts`.** Canonical names (use exactly these) and aliases. Aliases are compared post-`norm()` (lowercased, punctuation stripped); include the name itself, common abbreviations, and for numbered books both spaced and unspaced forms. Transcribe this table completely:

```ts
// name, then aliases beyond the normalized name itself
const T = (name: string, ...aliases: string[]) => ({ name, aliases: [norm(name), ...aliases] });
export const BOOKS = [
  T('Genesis','gen','ge','gn'), T('Exodus','exod','exo','ex'), T('Leviticus','lev','lv'),
  T('Numbers','num','nu','nm','nb'), T('Deuteronomy','deut','deu','dt'),
  T('Joshua','josh','jos','jsh'), T('Judges','judg','jdg','jg'), T('Ruth','rth','ru'),
  T('1 Samuel','1samuel','1 sam','1sam','1sa','1 sa','i samuel'), T('2 Samuel','2samuel','2 sam','2sam','2sa','2 sa','ii samuel'),
  T('1 Kings','1kings','1 kgs','1kgs','1ki','1 ki','i kings'), T('2 Kings','2kings','2 kgs','2kgs','2ki','2 ki','ii kings'),
  T('1 Chronicles','1chronicles','1 chron','1chron','1 chr','1chr','1ch'), T('2 Chronicles','2chronicles','2 chron','2chron','2 chr','2chr','2ch'),
  T('Ezra','ezr'), T('Nehemiah','neh','ne'), T('Esther','esth','est','es'),
  T('Job','jb'), T('Psalm','psalms','psa','pss','ps','psm'), T('Proverbs','prov','pro','pr','prv'),
  T('Ecclesiastes','eccles','eccl','ecc','ec','qoheleth'), T('Song of Solomon','song of songs','song','sos','so','canticles','cant'),
  T('Isaiah','isa','is'), T('Jeremiah','jer','je','jr'), T('Lamentations','lam','la'),
  T('Ezekiel','ezek','eze','ezk'), T('Daniel','dan','da','dn'), T('Hosea','hos','ho'),
  T('Joel','jl'), T('Amos','am'), T('Obadiah','obad','ob'), T('Jonah','jnh','jon'),
  T('Micah','mic','mc'), T('Nahum','nah','na'), T('Habakkuk','hab','hb'),
  T('Zephaniah','zeph','zep','zp'), T('Haggai','hag','hg'), T('Zechariah','zech','zec','zc'),
  T('Malachi','mal','ml'),
  T('Matthew','matt','mat','mt'), T('Mark','mrk','mk','mr'), T('Luke','luk','lk'),
  T('John','jhn','jn'), T('Acts','act','ac'), T('Romans','rom','ro','rm'),
  T('1 Corinthians','1corinthians','1 cor','1cor','1co','1 co','i corinthians'), T('2 Corinthians','2corinthians','2 cor','2cor','2co','2 co','ii corinthians'),
  T('Galatians','gal','ga'), T('Ephesians','eph','ephes'), T('Philippians','phil','php','pp'),
  T('Colossians','col','co'), T('1 Thessalonians','1thessalonians','1 thess','1thess','1th','1 th'), T('2 Thessalonians','2thessalonians','2 thess','2thess','2th','2 th'),
  T('1 Timothy','1timothy','1 tim','1tim','1ti','1 ti'), T('2 Timothy','2timothy','2 tim','2tim','2ti','2 ti'),
  T('Titus','tit','ti'), T('Philemon','philem','phm','pm'), T('Hebrews','heb'),
  T('James','jas','jm'), T('1 Peter','1peter','1 pet','1pet','1pe','1 pe','1pt'), T('2 Peter','2peter','2 pet','2pet','2pe','2 pe','2pt'),
  T('1 John','1john','1 jn','1jn','1jo','1 jo'), T('2 John','2john','2 jn','2jn','2jo','2 jo'), T('3 John','3john','3 jn','3jn','3jo','3 jo'),
  T('Jude','jud','jd'), T('Revelation','revelations','rev','re','apocalypse')
] as const;
```

Alias collision rule: `matchBook` checks exact alias equality across ALL books first; only if nothing matches exactly does it try `alias.startsWith(token)` in canon order. (This keeps `jn`→John exact while `j`→Joshua-by-prefix stays deterministic.)

- [ ] **Step 2: Failing tests `refs.test.ts`** (representative — write all of these):

```ts
import { expect, test } from 'vitest';
import { matchBook, parseRef, formatRef } from './refs';

test('exact aliases win', () => {
  expect(matchBook('jn')).toBe('John');
  expect(matchBook('ps')).toBe('Psalm');
  expect(matchBook('1 jn')).toBe('1 John');
  expect(matchBook('1jn')).toBe('1 John');
});
test('prefix fallback in canon order', () => {
  expect(matchBook('gene')).toBe('Genesis');
  expect(matchBook('song of sol')).toBe('Song of Solomon');
});
test('unknown returns null', () => { expect(matchBook('zzz')).toBeNull(); });
test('parseRef full forms', () => {
  expect(parseRef('john 3:16')).toEqual({ book: 'John', ch: 3, from: 16, to: 16 });
  expect(parseRef('gen 1:1-10')).toEqual({ book: 'Genesis', ch: 1, from: 1, to: 10 });
  expect(parseRef('gen 1:1–10')).toEqual({ book: 'Genesis', ch: 1, from: 1, to: 10 }); // en dash
  expect(parseRef('1 sam 3:10')).toEqual({ book: '1 Samuel', ch: 3, from: 10, to: 10 });
  expect(parseRef('Psalm 23')).toEqual({ book: 'Psalm', ch: 23, from: 1, to: 1 });
  expect(parseRef('song of solomon 2:1')).toEqual({ book: 'Song of Solomon', ch: 2, from: 1, to: 1 });
});
test('parseRef rejects garbage', () => {
  expect(parseRef('')).toBeNull(); expect(parseRef('3:16')).toBeNull(); expect(parseRef('john')).toBeNull();
});
test('formatRef', () => {
  expect(formatRef({ book: 'John', ch: 3, from: 16, to: 16 })).toBe('John 3:16');
  expect(formatRef({ book: 'Genesis', ch: 1, from: 1, to: 10 })).toBe('Genesis 1:1–10');
});
```

- [ ] **Step 3: Run — FAIL.** **Step 4: Implement `refs.ts`.** Port of prototype `parseRef` (`Lectern.pretty.html:945`) with the book group widened for multi-word names:

```ts
import { norm } from '../search/fuzzy';
import { BOOKS } from './books';

export interface ParsedRef { book: string; ch: number; from: number; to: number }

export function matchBook(token: string): string | null {
  const t = norm(token);
  if (!t) return null;
  for (const b of BOOKS) if (b.aliases.includes(t)) return b.name;
  for (const b of BOOKS) if (b.aliases.some((a) => a.startsWith(t))) return b.name;
  return null;
}
export function parseRef(raw: string): ParsedRef | null {
  const m = (raw || '').trim().match(/^([1-3]?\s?[a-zA-Z][a-zA-Z ]*?)\.?\s*(\d+)(?::\s*(\d+)\s*(?:[-–]\s*(\d+))?)?$/);
  if (!m) return null;
  const book = matchBook(m[1]);
  if (!book) return null;
  const ch = parseInt(m[2]);
  const from = m[3] ? parseInt(m[3]) : 1;
  const to = m[4] ? parseInt(m[4]) : from;
  if (to < from) return null;
  return { book, ch, from, to };
}
export function formatRef(p: ParsedRef): string {
  return `${p.book} ${p.ch}:${p.from}` + (p.to > p.from ? `–${p.to}` : '');
}
```

- [ ] **Step 5: `slides.ts` + tests.** Implement per the Interfaces block (all three functions are ≤6 lines each; `verseCols` filters `selected` to entries with non-empty text and maps `{ version: abbrOf(id), text }`). Tests: key format; slide shape; verseCols preserves selection order, skips missing, returns `[]` when nothing installed.

- [ ] **Step 6: Full `npm test` + typecheck — PASS.** **Step 7: Commit** `feat: 66-book scripture reference parser and slide helpers`.

---

### Task 2: Bible + schedule storage (TDD)

**Files:**
- Modify: `src/main/db.ts` (append to SCHEMA)
- Create: `src/main/biblesRepo.ts`, `src/main/biblesRepo.test.ts`, `src/main/scheduleRepo.ts`, `src/main/scheduleRepo.test.ts`

**Interfaces:**
- Consumes: `openDb` (existing).
- Produces:
  - Types (add to `src/shared/types.ts` in this task): `InstalledVersion { id: string; abbr: string; name: string; language: string }`, `ChapterData { book: string; chapter: number; verseCount: number; verses: Record<number, Record<string, string>> }` (`verses[n][versionId] = text`), `ScriptureReading { id: string; book: string; ch: number; from: number; to: number }`, `NormalizedBible { id: string; abbr: string; name: string; language: string; books: { name: string; chapters: { n: number; verses: { n: number; text: string }[] }[] }[] }`
  - `createBiblesRepo(db)` → `{ installed(): InstalledVersion[]; install(bible: NormalizedBible): void; uninstall(id: string): void; getChapter(book: string, chapter: number): ChapterData; isInstalled(id: string): boolean }`
  - `createScheduleRepo(db)` → `{ list(): ScriptureReading[]; add(r: Omit<ScriptureReading,'id'>): ScriptureReading[] }` (add dedupes on exact book/ch/from/to and returns the full list)

- [ ] **Step 1: Schema append** (in `db.ts` SCHEMA string):

```sql
CREATE TABLE IF NOT EXISTS bible_versions (
  id TEXT PRIMARY KEY, abbr TEXT NOT NULL, name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en', installed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS verses (
  version_id TEXT NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL, text TEXT NOT NULL,
  PRIMARY KEY (version_id, book, chapter, verse)
);
CREATE INDEX IF NOT EXISTS idx_verses_chapter ON verses (book, chapter, version_id);
CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS service_items (
  id TEXT PRIMARY KEY, service_id TEXT NOT NULL, kind TEXT NOT NULL,
  ref_json TEXT NOT NULL, position INTEGER NOT NULL
);
```

- [ ] **Step 2: Failing tests.** biblesRepo (in-memory DB): install a tiny two-book `NormalizedBible` fixture → `installed()` lists it, `getChapter('Genesis',1)` returns verseCount + texts keyed by version; installing a second version merges into the same chapter map; `uninstall` removes rows from both tables (verify `verses` emptied for that id); `install` is transactional — a fixture with a duplicate verse row (same PK twice) throws and leaves NOTHING installed for that id (assert `installed()` empty and zero verse rows). scheduleRepo: default service auto-created once; `add` appends with stable position ordering; exact-duplicate add is a no-op; `list` round-trips after reopen (same db handle is fine).

- [ ] **Step 3: Implement.** `install` wraps `INSERT INTO bible_versions` + prepared verse inserts in ONE `db.transaction`; `getChapter` = one indexed query `SELECT version_id, verse, text FROM verses WHERE book=? AND chapter=?` folded into the map, `verseCount = MAX(verse)` over the result (0 rows → verseCount 0, empty map). scheduleRepo ensures a default service row (`id='default'`, title `'Sunday Service'`) on construction; readings stored as `service_items` with `kind='scripture'`, `ref_json` = the reading, position = `MAX(position)+1`.

- [ ] **Step 4: Full test + typecheck — PASS.** **Step 5: Commit** `feat: bible and scripture-schedule storage`.

---

### Task 3: Bible source — manifest, normalizer, bundled KJV, installer (TDD on normalizer)

**Files:**
- Create: `scripts/fetch-bibles.mjs`, `resources/bibles/kjv.json` (script output, committed), `src/main/bibleSource.ts`, `src/main/bibleSource.test.ts`
- Modify: `electron-builder.yml` (add `extraResources: [{ from: resources/bibles, to: bibles }]`)

**Interfaces:**
- Consumes: `matchBook` (Task 1), `NormalizedBible` (Task 2).
- Produces:
  - `BIBLE_MANIFEST: { id: string; abbr: string; name: string; url: string }[]` — kjv/web/asv/darby with `https://api.getbible.net/v2/<id>.json` (KJV entry additionally marked `bundled: true`)
  - `normalizeGetBible(raw: unknown, entry: ManifestEntryDef): NormalizedBible` — maps getbible book names through `matchBook` to canonical names (throws listing any unmapped book names); strips trailing whitespace from verse text; preserves verse numbers as given
  - `bundledKjvPath(): string` — `app.isPackaged ? join(process.resourcesPath, 'bibles/kjv.json') : join(app.getAppPath(), 'resources/bibles/kjv.json')`
  - `downloadAndNormalize(id: string): Promise<NormalizedBible>` — global fetch, 60 s AbortSignal timeout, non-2xx → throw with status

- [ ] **Step 1: `scripts/fetch-bibles.mjs`** — plain Node script: fetch the KJV URL, `JSON.parse` sanity check (66 books), write `resources/bibles/kjv.json`. Run it once (`node scripts/fetch-bibles.mjs`) and commit the output. (~9 MB — fine for a local repo.)
- [ ] **Step 2: Failing normalizer tests** — small inline fixture in getbible shape (2 books, incl. a name needing mapping like `"Psalms"`→`Psalm` and `"Revelation"`); assert canonical names, chapter/verse numbering, whitespace strip; unknown book name throws with the offending name in the message. Plus one integration-ish test: `normalizeGetBible(JSON.parse(readFileSync('resources/bibles/kjv.json')))` yields 66 books, `books.find(b => b.name==='John').chapters[2].verses[15].text` contains `'For God so loved the world'`.
- [ ] **Step 3: Implement; tests PASS.**
- [ ] **Step 4: Commit** `feat: bible source manifest, getbible normalizer, bundled KJV`.

---

### Task 4: Main wiring — installer service, IPC, preload, first-run KJV

**Files:**
- Modify: `src/shared/types.ts` (channels + HelmApi), `src/main/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Create: `src/main/bibleInstaller.ts`

**Interfaces:**
- New `CH` entries (exact strings): `biblesManifest: 'bibles:manifest'`, `biblesInstall: 'bibles:install'`, `biblesUninstall: 'bibles:uninstall'`, `biblesProgress: 'bibles:progress'` (main→renderer), `biblesGetChapter: 'bibles:getChapter'`, `scheduleList: 'schedule:list'`, `scheduleAdd: 'schedule:add'`, `settingsGet: 'settings:get'`, `settingsSet: 'settings:set'`.
- New types: `BibleManifestEntry { id; abbr; name; bundled?: boolean; installed: boolean }`, `BibleInstallProgress { id: string; phase: 'downloading' | 'installing' | 'done' | 'error'; error?: string }`.
- `HelmApi` additions:

```ts
bibles: {
  manifest(): Promise<BibleManifestEntry[]>;
  install(id: string): void;                       // async; progress via onProgress
  uninstall(id: string): Promise<BibleManifestEntry[]>;
  getChapter(book: string, chapter: number): Promise<ChapterData>;
  onProgress(cb: (p: BibleInstallProgress) => void): () => void;
};
schedule: {
  list(): Promise<ScriptureReading[]>;
  add(r: Omit<ScriptureReading, 'id'>): Promise<ScriptureReading[]>;
};
settings: {
  get<T>(key: string, fallback: T): Promise<T>;
  set(key: string, value: unknown): void;
};
```

- `bibleInstaller.ts`: `createBibleInstaller(repo, broadcast)` → `{ manifest(); install(id); uninstall(id); installBundledKjvIfMissing(): Promise<void> }`. `install`: reject double-install of an in-flight id (track a Set); broadcast `downloading` → `installing` → `done` / `error` (message, never a crash). `installBundledKjvIfMissing`: read `bundledKjvPath()`, normalize, `repo.install` — wrapped in try/catch that logs and continues (a corrupt bundle must not kill boot); called at startup after `registerIpc`.
- settings get/set backed by the existing `settings` table (`value_json`), main-side helpers in `db.ts` or a 10-line `settingsRepo` — implementer's choice, but read/write JSON round-trip and `fallback` on missing key are required.
- Broadcast plumbing: `biblesProgress` goes to all windows (same pattern as `displaysStatus`).

- [ ] **Step 1: Types + channels.** **Step 2: installer service.** **Step 3: ipc + preload (mirror existing `sub<T>` pattern).** **Step 4: index.ts wiring** — construct repos + installer, `await installBundledKjvIfMissing()` before `createWindow()` on first run is NOT acceptable (blocks boot ~2 s); fire it after window creation and let the UI catch up via `biblesProgress`/`manifest` queries.
- [ ] **Step 5: Verification** — typecheck, full tests; boot with a fresh `HELM_USER_DATA`? (userData override not built — instead verify via CDP or console: `await window.helm.bibles.manifest()` shows kjv installed after first boot; `getChapter('John', 3)` returns 36 verses with kjv text). Kill processes, revert ABI.
- [ ] **Step 6: Commit** `feat: bible installer service, settings persistence, scripture IPC surface`.

---

### Task 5: Sermon mode — scripture track schedule panel + center hero + transport

**Files:**
- Create: `src/renderer/operator/SermonMode.tsx`
- Modify: `src/renderer/operator/App.tsx` (mount SermonMode; keep-alive both modes — see contract)

**Interfaces:**
- Consumes: `window.helm.bibles/schedule/presentation/settings`, `parseRef/matchBook/formatRef/keyForScripture/verseCols/buildScriptureSlide`, `ThemeCtx`, `usePresentationState`.
- Produces: sermon mode surface (scripture track). Design: markup lines 167–388 (left panel + center), styles 1113–1148, 1284–1329.

Contract:
- **Track tabs** (Scripture / Message / Slides — styles line 1118): Scripture functional; Message and Slides selectable but render a centered placeholder panel in the whole mode area: "Coming in slice 4/5 — see the spec". Tab colors per design (`scripture`/`message`/`sermon` theme colors).
- **Mode keep-alive:** App keeps SongsMode and SermonMode mounted, hidden via `display:none` wrapper when inactive, so operator state survives tab switches. Each mode receives `active: boolean` and registers its `ModeKeyHandler` on the delegate ref ONLY while active (register in an effect keyed on `active`; null it on deactivate). Pre-service stays a placeholder.
- **State:** `scrBook/scrCh/scrV` (default Genesis 1:1), `versions: string[]` loaded from `settings.get('scriptureVersions', ['kjv'])` and persisted on change, `entryQ` (reading input), `chapter: ChapterData | null` cache refreshed when book/ch or installed versions change.
- **Cue effect** (mirrors SongsMode): on scrBook/scrCh/scrV/versions/chapter change → `key = keyForScripture(...)`, `cols = verseCols(chapter?.verses[scrV] ?? {}, versions, abbrOf)`, slide = `buildScriptureSlide(formatRef({book,ch,from:v,to:v}), cols)`; when `cols` is empty the slide gets one column `{ version: '', text: '[ Install a Bible in Settings ]' }`. `presentation.cue(key, slide)`.
- **Reading input** (design lines 181–188): mono `›` prefix, placeholder `Add reading — John 3:16`; as-you-type `parseRef`; space-completes a bare book token via `matchBook` (prototype `onSermonEntryKey`, line 1005); when parsed, show the `+ Add <formatted ref>` button (style line 1291); Enter or button → `schedule.add`, jump `scrBook/Ch/V` to the reading start, clear input, and go live via `presentation.goLive` (prototype `addSermonEntry` sets output live — keep that: mid-service "type ref, Enter, on screen" is the headline flow).
- **Schedule rows** (lines 189–204): ✝ icon chip, formatted ref, `<n> verses · <primary version abbr>`, live-color dot when current (book+ch match and scrV within range); click → jump to reading start + cue.
- **Center hero** (lines 306–341 scripture branch, styles 1315–1323): now-bar (projText pill, same as songs), hero card with ref label + 1–2 version columns (`verseColMax` 50%/100%), install-hint text when no columns; accent ring when cued-is-live (scripture color).
- **On-deck bar** (lines 344–353, logic line 1146): next verse preview — tag `VERSE` if next verse is inside any scheduled reading for this chapter else `KEEP READING`; at chapter end, `End of <book> <ch>` + "Pick the next reading on the left".
- **Transport** (lines 355–387): `‹ Back` / `Next verse ›` clamped to [1, verseCount], Go live / Take down (shared goLive semantics, keyed on scripture cue key), Logo button. The version-picker button slot renders in this task as a plain button showing `versions.map(abbr).join(' + ')` — the popover itself is Task 6.

- [ ] **Step 1: Build it.** Split into `SermonMode.tsx` + child components if >~400 lines (follow Task 10 slice-2 precedent).
- [ ] **Step 2: Verify** — typecheck, tests, eslint; CDP: type `gen 1:1-10` → Add → live shows Genesis 1:1 KJV on output; Next verse hot-updates live output (same flow); switch to Songs and back — sermon state intact.
- [ ] **Step 3: Commit** `feat: sermon mode scripture track with schedule, hero, and transport`.

---

### Task 6: Version picker + chapter rail

**Files:**
- Create: `src/renderer/operator/VersionPicker.tsx`, `src/renderer/operator/ChapterRail.tsx`
- Modify: `src/renderer/operator/SermonMode.tsx` (integrate both)

**Interfaces:**
- Consumes: `window.helm.bibles.manifest/onProgress`, settings persistence from Task 5.
- Produces: the transport popover and the right-hand verse rail. Design: picker markup lines 361–384 + styles 1327–1340; rail markup lines 390–415 + styles 1150–1156, 1341–1344.

Contract:
- **VersionPicker:** popover anchored above the button (fixed overlay to close, `verPopStyle`); "TRANSLATIONS / pick two to compare" header; a row per manifest entry: abbr, name, mark = `● PRIMARY` (index 0) / `◧ COMPARE` (index 1) / `NOT INSTALLED` (dimmed, opacity .45); pick logic ported from prototype `pickVersion` (line 1002): selected→remove (min 1 stays), else if 2 selected replace the compare slot, else append. Clicking a NOT INSTALLED row closes the popover and opens the Settings modal (Task 7) — wire via an `onOpenSettings` prop (no-op until Task 7 wires it, acceptable interim).
- **ChapterRail:** header `<Book> <ch>` + `<n> planned` mono tag + hint copy (line 1342–1343); one card per verse 1..verseCount: `Verse n` label, 2-line-clamped preview text (primary version), planned/cued/live background+ring tiers exactly per `chapterRows` styles (line 1151–1155); click → set scrV (cue effect handles the rest; hot-update while live works because same book+chapter is sameFlow). `plannedSet` = union of scheduled readings for current book+chapter (prototype line 950).
- Manifest entries refresh on `biblesProgress` done/error events (a translation installed from Settings becomes pickable without restart).

- [ ] **Step 1: Build both, integrate.** **Step 2: Verify** — CDP: pick KJV+WEB → hero + live output show two columns side by side (WEB requires install first via `window.helm.bibles.install('web')` from console — acceptable pre-Task-7 path); chapter rail click while live hot-updates; planned verses tinted. **Step 3: Commit** `feat: translation compare picker and chapter rail`.

---

### Task 7: Settings modal — Bibles section

**Files:**
- Create: `src/renderer/operator/SettingsModal.tsx`
- Modify: `src/renderer/operator/Header.tsx` (gear button), `src/renderer/operator/App.tsx` (modal state, Escape integration), `src/renderer/operator/SermonMode.tsx` (wire VersionPicker's `onOpenSettings`)

**Interfaces:**
- Consumes: `window.helm.bibles.manifest/install/uninstall/onProgress`.
- Produces: `<SettingsModal open onClose />`; header gear `⚙` button (34 px square, `themeBtnStyle` twin) between the theme toggle and clock.

Contract (no design-file source — match the app's established modal language: QuickAdd's overlay/card/section styling):
- Card ~640 px, title "Settings", left nav list with sections **Bibles** (functional) and **Displays / Songs / Message / Backup** (listed, disabled, "coming with later slices" hint) — the spec §8 names these; showing the map now is intentional scope.
- Bibles section: one row per manifest entry — abbr chip, full name, then: `BUNDLED` tag (kjv, non-removable) / `Installed ✓` + `Remove` ghost button / `Install` accent button / progress state (`Downloading…` / `Installing…` with the pulsing-dot treatment) driven by `onProgress`; `error` phase renders the message inline in `live` color with a `Retry` button.
- `Remove` is two-step inline confirm: first click turns the button into `Remove — sure?` (live color) for 4 s, second click uninstalls. Uninstalling a version that's currently in the operator's compare selection must also drop it from `scriptureVersions` settings (listen via manifest refresh in SermonMode — verify this path).
- Escape/overlay close: integrate with the App-level key delegate the same way QuickAdd does (App owns Escape; SettingsModal registers its open-state through the existing onEscape chain — extend `ModeKeyHandler.onEscape` handling in App to close settings first if open, since settings is app-level, not mode-level).

- [ ] **Step 1: Build + wire (gear, VersionPicker hook).**
- [ ] **Step 2: Verify** — CDP: install WEB from Settings (watch progress states), pick it in compare, live shows two columns; remove WEB → compare selection falls back to KJV alone and the live slide re-cues to one column; error path: temporarily point at an invalid manifest id via console to confirm error rendering (or mock by disconnecting network if feasible — else verify the error branch renders by inspection and unit-test the installer's error broadcast in Task 4's scope).
- [ ] **Step 3: Commit** `feat: settings card with bible installer`.

---

### Task 8: Sermon keyboard + goLive modal guard

**Files:**
- Modify: `src/renderer/operator/SermonMode.tsx`, `src/renderer/operator/App.tsx`

Contract:
- SermonMode implements `ModeKeyHandler` while active: arrows step `scrV` ±1 (clamped, cued), Enter/Space toggles goLive on the current scripture cue — identical delegation pattern to SongsMode.
- Carry-over fix from the slice-2 final review: `onGoLive` (both modes) is suppressed while any modal is open (quick-add or settings) — Enter inside a modal must not fire goLive behind it. Implement once in App's delegate dispatch (it knows both modal states), not per-mode.
- Reading input Escape clears the input before falling through to modal-close semantics (input-focused Escape already reaches the handler per the typing-guard design).

- [ ] **Step 1: Implement.** **Step 2: Verify** — CDP: arrows walk Genesis 1 verses with live hot-update; Enter toggles; Enter while Settings open does NOT change output. **Step 3: Commit** `feat: sermon keyboard control and modal go-live guard`.

---

### Task 9: Final gate, packaging smoke, README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Full gate** — typecheck, `npm test` (all suites), `npm run lint` 0 errors.
- [ ] **Step 2: Packaging smoke** — Electron-ABI rebuild, `npm run build && npx electron-builder --dir`; launch unpacked app with a FRESH userData (temporarily rename the dev `helm.db` or point CDP at the packaged app's own userData): bundled KJV must auto-install from `process.resourcesPath` (this validates the `extraResources` path — the one thing dev mode cannot prove); type `john 3:16`, Enter, verify output window. Revert ABI, tests green, no processes left.
- [ ] **Step 3: README** — scripture quickstart line ("type a reference — `john 3:16` — press Enter"), Settings→Bibles note, update Status section (scripture done; message/pre-service/slides/display-roles remaining).
- [ ] **Step 4: Commit** `chore: slice 3 verification and docs`.

## Self-Review Notes

- **Spec coverage (slice 3, spec §11.3):** bible storage (T2), bundled KJV (T3/T4), reference parsing (T1), chapter rail (T6), translation compare (T5/T6), Settings→Bibles installer (T7); §9 install-hint fallback (T5); §8 settings card skeleton (T7); keyboard parity (T8).
- **Type consistency:** all new cross-task names declared once — `ParsedRef`/`keyForScripture`/`verseCols` (T1), `ChapterData`/`ScriptureReading`/`NormalizedBible`/repo shapes (T2), manifest/progress types + `CH` strings + `HelmApi` (T4) — and referenced verbatim in T5–T8.
- **Plan-level choices made explicit:** verse full-text search (verse_fts) deliberately deferred until a search UI consumes it (YAGNI; spec §5 remains satisfiable later); getbible URLs pinned after live verification; scripture schedule persists via the spec's `services`/`service_items` tables under a single default service.
