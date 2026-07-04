# Helm Slice 4: The Message Track — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The sermon mode's Message track end-to-end — acquire William Branham sermon "tapes" (text + audio + sync timing) from the authoritative source with full-text offline search, project deliberate quote slides, and an automatic follow-along scrolling reading view that tracks the playing tape audio, plus a local file-import supplement — all through the existing cue → goLive → output pipeline in the `message` purple accent.

**Architecture:** Pure shared modules (tape-number/paragraph parsing, search scoring, slide+key builders, timing lookup) with zero I/O and full unit tests; a `messagesRepo` (SQLite + FTS5, mirroring `songsRepo`) plus a `messagesScheduleRepo` (reusing the `service_items` pattern); a `MessageSource` adapter + `messageInstaller` (mirroring `bibleSource`/`bibleInstaller`) whose concrete endpoint is pinned by an up-front spike; and renderer work that ports the design-source Message markup character-exact and adds a dedicated `ReadingCanvas` for the scrolling render. Two on-screen experiences (quote slide, reading view) render from the same `paragraphs` rows; the reading view auto-advances via a `TimingMap` consumed on audio `timeupdate`.

**Tech Stack:** Electron + React + TypeScript (strict) + Vite, `better-sqlite3` + FTS5, vitest, `@testing-library/react`.

## Global Constraints

- **Commit messages:** NO `Co-Authored-By` trailers (house rule).
- **better-sqlite3 dual ABI:** `npm test` needs the Node ABI; dev/packaged app needs the Electron ABI (`npx electron-rebuild`). After any run that rebuilds for Electron, revert to the Node ABI so `npm test` stays green (`npm rebuild better-sqlite3`). Every task ends on the Node ABI.
- **Design fidelity source:** `docs/design/Lectern.pretty.html` — Message-track left-rail markup lines **207–281**, quote hero lines **328–334**, message data/logic lines **714–734, 984–997, 1158–1175**, message/tape style objects lines **1294–1313**. Copy style values **character-exactly** (established review standard; reviewers check byte-level).
- **IPC:** channel names only from `CH` in `src/shared/types.ts` — no ad-hoc strings. `contextIsolation` stays on; renderer never touches the DB or network directly.
- **TS strict, no `any` in `src/shared`.**
- **Accent:** message quote/reading slides use accent `#a88bc4` (prototype `Lectern.pretty.html:1065`); operator-panel chrome uses `T.message` from `src/shared/theme.ts`.
- **Authoritative source only:** Message text/audio/timing come from VGR's official distribution (The Table). No community mirrors.

---

## File Structure (new / modified)

**New — shared (pure):**
- `src/shared/message/tapeNo.ts` — parse/format tape numbers.
- `src/shared/message/parseImport.ts` — parse imported TXT/PDF-text into a `MessageImportResult`.
- `src/shared/search/messageScore.ts` — tape + quote scoring/ranking, reusing `fuzzy.ts`.
- `src/shared/message/slides.ts` — quote/reading slide builders + cue keys.
- `src/shared/message/timing.ts` — `activeOrdAt(map, t)` lookup.

**New — main:**
- `src/main/messagesRepo.ts` — storage + FTS search + audio-path + timings.
- `src/main/messagesScheduleRepo.ts` — quote schedule (`service_items` kind `quote`).
- `src/main/messageSource.ts` — `MessageSource` adapter (endpoint from spike) + normalizer.
- `src/main/messageInstaller.ts` — corpus install + on-demand audio download, with progress.

**New — renderer:**
- `src/renderer/shared/ReadingCanvas.tsx` — scrolling reading render + highlight + auto-scroll.
- `src/renderer/operator/MessageMode.tsx` — the Message-track operator surface.
- `src/renderer/operator/MessageSearchRail.tsx` — tape-scope search + TAPES/QUOTES/SCHEDULE lists.
- `src/renderer/operator/ParagraphRail.tsx` — `¶`-labelled paragraph rail with CUED/LIVE badges.
- `src/renderer/operator/TapePlayer.tsx` — audio element + player card + on-demand download + sync.
- `src/renderer/operator/MessageImport.tsx` — local-import review modal.

**Modified:**
- `src/main/db.ts` — new tables.
- `src/shared/types.ts` — new types, `CH` entries, `Slide` `reading` kind, `HelmApi.message`/`.quoteSchedule`.
- `src/preload/index.ts` — expose `message` + `quoteSchedule` APIs.
- `src/main/ipc.ts` + `src/main/index.ts` — register handlers, construct repos/installer.
- `src/renderer/output/OutputApp.tsx` — route `reading` kind to `ReadingCanvas`.
- `src/renderer/operator/SermonMode.tsx` — replace the `message` placeholder with `MessageMode`; message keyboard delegate.
- `src/renderer/operator/SettingsModal.tsx` — Message library section (install corpus, import).
- `README.md` — Message library + audio-cache notes.

---

## Task 1: Spike — pin The Table acquisition format

**Not TDD.** Deliverable: a findings note + a captured fixture + a locked `MessageSource` contract that Tasks 7/8 implement against. This blocks only the *provider choice*, not the rest of the slice.

**Files:**
- Create: `docs/superpowers/notes/2026-07-03-the-table-acquisition.md`
- Create: `src/main/__fixtures__/message-sermon.sample.json` (one real sermon: text + paragraph labels + timing map + audio URL, as returned by the source)
- Create: `src/main/__fixtures__/message-index.sample.json` (tape index slice: id, tape_no, title, date, duration_s)

- [ ] **Step 1: Investigate** the authoritative source (`table.branham.org` and its network/API layer): how a per-sermon payload (text + paragraph labels + sync map + audio URL) and the tape index are fetched. Capture real HTTP status, format, and one sermon end-to-end. Respect ToS; official distribution only.
- [ ] **Step 2: Decide the timing provider.** If text+timing are cleanly fetchable → **import provider** (light path). If not → record that automatic sync falls to **aeneas forced alignment** as a follow-up (slice 4b), and that slice 4 ships reading-view + player wired to `TimingMap` with timings absent until 4b. Either way the `MessageSource`/`TimingMap` interfaces below are unchanged.
- [ ] **Step 3: Write the note** documenting endpoints/format/decision, and save the two fixtures (redact nothing structural; these back Tasks 7/8 tests).
- [ ] **Step 4: Lock the contract** (copy into the note verbatim; Tasks 7/8/9 depend on it):

```ts
// MessageSource contract (Task 7 implements; Task 10 fixture-tests the normalizer)
export interface SermonIndexEntry { id: string; tapeNo: string; title: string; date: string; durationS: number }
export interface SermonPayload {
  paragraphs: { label: string; text: string }[];
  timing: { ord: number; tStart: number; tEnd: number }[]; // [] if source has no timing
}
export interface MessageSource {
  fetchIndex(): Promise<SermonIndexEntry[]>;
  fetchSermon(id: string): Promise<SermonPayload>;
  audioUrl(entry: SermonIndexEntry): string;
}
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/notes/2026-07-03-the-table-acquisition.md src/main/__fixtures__/
git commit -m "spike: pin The Table acquisition format and MessageSource contract"
```

---

## Task 2: Tape-number parse/format (TDD)

**Files:**
- Create: `src/shared/message/tapeNo.ts`
- Test: `src/shared/message/tapeNo.test.ts`

**Interfaces:**
- Produces: `parseTapeNo(s: string): string | null` (normalizes to canonical `YY-MMDD` + optional trailing letter, e.g. `65-1204`, `64-0206B`); `formatTapeLabel(tapeNo: string): string` (identity passthrough for display, present for a single call-site).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseTapeNo } from './tapeNo';

describe('parseTapeNo', () => {
  it('accepts canonical tape numbers', () => {
    expect(parseTapeNo('65-1204')).toBe('65-1204');
    expect(parseTapeNo('64-0206B')).toBe('64-0206B');
  });
  it('trims surrounding text and normalizes whitespace/dashes', () => {
    expect(parseTapeNo('  65-1204  ')).toBe('65-1204');
    expect(parseTapeNo('Tape 47-0412 The Rapture')).toBe('47-0412');
  });
  it('returns null when no tape number is present', () => {
    expect(parseTapeNo('The Rapture')).toBeNull();
    expect(parseTapeNo('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './tapeNo'`).

Run: `npx vitest run src/shared/message/tapeNo.test.ts`

- [ ] **Step 3: Implement**

```ts
const TAPE_RE = /\b(\d{2}-\d{4}[A-Za-z]?)\b/;

export function parseTapeNo(s: string): string | null {
  const m = TAPE_RE.exec(s || '');
  return m ? m[1].toUpperCase() : null;
}

export function formatTapeLabel(tapeNo: string): string {
  return tapeNo;
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/shared/message/tapeNo.ts src/shared/message/tapeNo.test.ts
git commit -m "feat: tape-number parser"
```

---

## Task 3: Imported-text parser (TDD)

Parses a plain-text sermon (PDF already extracted to text upstream, or a TXT) into header fields + numbered paragraphs. Paragraph tokens are line-leading numbers, plain or letter-prefixed (`E-1`). The label is stored verbatim.

**Files:**
- Create: `src/shared/message/parseImport.ts`
- Test: `src/shared/message/parseImport.test.ts`

**Interfaces:**
- Consumes: `parseTapeNo` (Task 2).
- Produces: `parseMessageText(raw: string): MessageImportResult` where
  `interface MessageImportResult { tapeNo: string; title: string; date: string; paragraphs: { label: string; text: string }[] }`.
  (Define `MessageImportResult` in `src/shared/types.ts` in Task 9; for this task declare it locally and re-export — see Step 3.)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseMessageText } from './parseImport';

const RAW = [
  'The Rapture',
  '65-1204',
  'December 4, 1965',
  '',
  'E-1 Let us pray. Our heavenly Father, we approach Thee.',
  'E-2 And now, Lord, as we open Thy Word.',
  '',
  '76 Now, the Rapture is made up of three things.',
  '77 There will be three things happen: a shout, a voice, and a trumpet.',
].join('\n');

describe('parseMessageText', () => {
  it('extracts tape number, title, date', () => {
    const r = parseMessageText(RAW);
    expect(r.tapeNo).toBe('65-1204');
    expect(r.title).toBe('The Rapture');
    expect(r.date).toBe('December 4, 1965');
  });
  it('splits numbered paragraphs, preserving letter-prefixed labels', () => {
    const r = parseMessageText(RAW);
    expect(r.paragraphs).toHaveLength(4);
    expect(r.paragraphs[0]).toEqual({ label: 'E-1', text: 'Let us pray. Our heavenly Father, we approach Thee.' });
    expect(r.paragraphs[2]).toEqual({ label: '76', text: 'Now, the Rapture is made up of three things.' });
  });
  it('joins wrapped continuation lines into the current paragraph', () => {
    const r = parseMessageText('T\n65-1204\nJan 1, 1965\n\n1 First line\ncontinues here.\n2 Second.');
    expect(r.paragraphs[0]).toEqual({ label: '1', text: 'First line continues here.' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npx vitest run src/shared/message/parseImport.test.ts`

- [ ] **Step 3: Implement**

```ts
import { parseTapeNo } from './tapeNo';

export interface MessageImportResult {
  tapeNo: string;
  title: string;
  date: string;
  paragraphs: { label: string; text: string }[];
}

const PARA_RE = /^(E-\d+|\d+)\s+(.*)$/; // line-leading label: "E-1 …" or "76 …"

export function parseMessageText(raw: string): MessageImportResult {
  const lines = (raw || '').replace(/\r\n/g, '\n').split('\n');

  // Header: first non-empty line is the title; the tape number is the first line
  // that parses as one; the date is the first line after the title that isn't the
  // tape line and isn't a paragraph.
  const nonEmpty = lines.map((l) => l.trim());
  const title = nonEmpty.find((l) => l.length > 0) ?? '';
  let tapeNo = '';
  for (const l of nonEmpty) {
    const t = parseTapeNo(l);
    if (t) { tapeNo = t; break; }
  }
  let date = '';
  for (const l of nonEmpty) {
    if (!l || l === title || parseTapeNo(l) === l || PARA_RE.test(l)) continue;
    if (parseTapeNo(l) && l.length <= 12) continue;
    date = l; break;
  }

  const paragraphs: { label: string; text: string }[] = [];
  for (const raw2 of lines) {
    const line = raw2.trim();
    const m = PARA_RE.exec(line);
    if (m) {
      paragraphs.push({ label: m[1], text: m[2].trim() });
    } else if (line && paragraphs.length) {
      const last = paragraphs[paragraphs.length - 1];
      last.text = `${last.text} ${line}`.trim();
    }
  }
  return { tapeNo, title, date, paragraphs };
}
```

> Note: `date` heuristic is intentionally loose — the operator confirms/fixes it in the import review screen (Task 13). Keep this parser pure and forgiving.

- [ ] **Step 4: Run — expect PASS.** Adjust the date heuristic only if a test fails; keep the three tests green.

- [ ] **Step 5: Commit**

```bash
git add src/shared/message/parseImport.ts src/shared/message/parseImport.test.ts
git commit -m "feat: imported-sermon text parser"
```

---

## Task 4: Message search scorer (TDD)

Ports the prototype's `searchTapes`/`searchQuotes` (`Lectern.pretty.html:991–992`) reusing `norm`/`lev` from `fuzzy.ts`. **Resolves the len-5 tolerance divergence**: use the `songScore` rule (`tok.length <= 4 → 1`, else `2`) everywhere here.

**Files:**
- Create: `src/shared/search/messageScore.ts`
- Test: `src/shared/search/messageScore.test.ts`

**Interfaces:**
- Consumes: `norm`, `lev` from `src/shared/search/fuzzy.ts`.
- Produces:
  - `scoreTape(query: string, tape: { tapeNo: string; title: string }): number`
  - `rankTapes(query: string, tapes: TapeRow[]): TapeRow[]` (`TapeRow = { id; tapeNo; title; date }`)
  - `scoreQuote(query: string, row: { title: string; tapeNo: string; text: string }): { score: number; snippet: string }`
  - `rankQuotes(query: string, rows: QuoteRow[]): QuoteRow[]` (sorted desc, capped at 12), where `QuoteRow = { msgId; tapeNo; title; ord; label; text; snippet }`.
  - `matchTol(tokLen: number): number` — the shared tolerance rule (`tokLen <= 4 ? 1 : 2`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { matchTol, rankQuotes, rankTapes, scoreTape } from './messageScore';

const TAPES = [
  { id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: 'December 4, 1965' },
  { id: 'faith', tapeNo: '47-0412', title: 'Faith Is The Substance', date: 'April 12, 1947' },
];
const QUOTES = [
  { msgId: 'rapture', tapeNo: '65-1204', title: 'The Rapture', ord: 2, label: '76', text: 'Now, the Rapture is made up of three things.', snippet: '' },
  { msgId: 'faith', tapeNo: '47-0412', title: 'Faith Is The Substance', ord: 0, label: '1', text: 'Faith is the substance of things hoped for.', snippet: '' },
];

describe('messageScore', () => {
  it('shares the songScore tolerance rule (resolves len-5 divergence)', () => {
    expect(matchTol(4)).toBe(1);
    expect(matchTol(5)).toBe(2);
    expect(matchTol(6)).toBe(2);
  });
  it('ranks tapes by title/tape number with typo tolerance', () => {
    const r = rankTapes('raptur', TAPES);
    expect(r[0].id).toBe('rapture');
  });
  it('matches a tape by its number', () => {
    expect(scoreTape('65-1204', TAPES[0])).toBeGreaterThan(0);
  });
  it('ranks quotes by paragraph text and caps at 12', () => {
    const r = rankQuotes('substance', QUOTES);
    expect(r[0].msgId).toBe('faith');
  });
  it('returns nothing for an empty query', () => {
    expect(rankTapes('', TAPES)).toEqual([]);
    expect(rankQuotes('', QUOTES)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npx vitest run src/shared/search/messageScore.test.ts`

- [ ] **Step 3: Implement**

```ts
import { lev, norm } from './fuzzy';

export interface TapeRow { id: string; tapeNo: string; title: string; date: string }
export interface QuoteRow { msgId: string; tapeNo: string; title: string; ord: number; label: string; text: string; snippet: string }

export function matchTol(tokLen: number): number {
  return tokLen <= 4 ? 1 : 2;
}

function tokensMatch(blob: string, qts: string[]): number {
  const words = blob.split(' ');
  let matched = 0;
  for (const t of qts) {
    if (blob.includes(t)) { matched++; continue; }
    const tol = matchTol(t.length);
    if (words.some((w) => Math.abs(w.length - t.length) <= 2 && lev(t, w) <= tol)) matched++;
  }
  return matched;
}

export function scoreTape(query: string, tape: { tapeNo: string; title: string }): number {
  const q = norm(query);
  if (!q) return 0;
  const qts = q.split(' ');
  const blob = norm(`${tape.title} ${tape.tapeNo}`);
  const matched = tokensMatch(blob, qts);
  if (matched < qts.length) return 0;
  const title = norm(tape.title);
  return title === q ? 1000 : title.includes(q) ? 800 - title.indexOf(q) : 400 + matched * 12;
}

export function rankTapes(query: string, tapes: TapeRow[]): TapeRow[] {
  if (!norm(query)) return [];
  return tapes
    .map((t) => ({ t, s: scoreTape(query, t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}

export function scoreQuote(query: string, row: { title: string; tapeNo: string; text: string }): { score: number; snippet: string } {
  const q = norm(query);
  if (!q) return { score: 0, snippet: '' };
  const qts = q.split(' ');
  const blob = norm(`${row.title} ${row.tapeNo} ${row.text}`);
  const matched = tokensMatch(blob, qts);
  if (matched < qts.length) return { score: 0, snippet: '' };
  const snippet = qts.some((t) => t.length > 2 && norm(row.text).includes(t)) ? row.text : '';
  return { score: 300 + matched * 12, snippet };
}

export function rankQuotes(query: string, rows: QuoteRow[]): QuoteRow[] {
  if (!norm(query)) return [];
  return rows
    .map((r) => ({ r, ...scoreQuote(query, r) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((x) => ({ ...x.r, snippet: x.snippet }));
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/shared/search/messageScore.ts src/shared/search/messageScore.test.ts
git commit -m "feat: message search scorer (aligns len-5 tolerance to songScore)"
```

---

## Task 5: Slide/key builders + timing lookup (TDD)

**Files:**
- Create: `src/shared/message/slides.ts`, `src/shared/message/timing.ts`
- Test: `src/shared/message/slides.test.ts`, `src/shared/message/timing.test.ts`

**Interfaces:**
- Consumes: `Slide`, `Message`, `MessageParagraph`, `TimingMap`, `TimingSpan` from `src/shared/types.ts` (defined in Task 9; for this task import them — the module graph resolves once Task 9 lands, but the tests below only use the builders' outputs, so define the needed types in Task 9 before running the full suite. Run these two test files standalone in this task using local type aliases if Task 9 is not yet merged).
- Produces:
  - `keyForMessageQuote(msgId: string, ord: number): string` → `msg:<msgId>:<ord>` (matches prototype `keyFor`, `Lectern.pretty.html:959`; `sameFlow` already treats same-`msgId` as same flow).
  - `keyForReading(msgId: string): string` → `read:<msgId>`.
  - `buildQuoteSlide(msg, ord): Slide` — `{ kind:'quote', accent:'#a88bc4', label:'Tape '+tapeNo+' · ¶'+label, text, source:title+' · Tape '+tapeNo+' · ¶'+label }` (output source form, `Lectern.pretty.html:1065`).
  - `buildReadingSlide(msg, activeOrd): Slide` — `{ kind:'reading', accent:'#a88bc4', label:title, source:'Tape '+tapeNo, title, paras: paragraphs.map(({label,text})=>({label,text})), activeOrd }`.
  - `MESSAGE_ACCENT = '#a88bc4'`.
  - `activeOrdAt(map: TimingMap, t: number): number` (timing.ts).

- [ ] **Step 1: Write failing tests**

`slides.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildQuoteSlide, buildReadingSlide, keyForMessageQuote, keyForReading } from './slides';

const MSG = {
  id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: 'December 4, 1965',
  durationS: 9430, audioPath: null, source: 'vgr',
  paragraphs: [
    { ord: 0, label: 'E-1', text: 'Let us pray.' },
    { ord: 1, label: '76', text: 'Now, the Rapture is made up of three things.' },
  ],
};

describe('message slides', () => {
  it('builds a quote slide with byte-exact reference', () => {
    const s = buildQuoteSlide(MSG, 1);
    expect(s.kind).toBe('quote');
    expect(s.text).toBe('Now, the Rapture is made up of three things.');
    expect(s.source).toBe('The Rapture · Tape 65-1204 · ¶76');
    expect(s.accent).toBe('#a88bc4');
  });
  it('builds a reading slide carrying all paragraphs + activeOrd', () => {
    const s = buildReadingSlide(MSG, 1);
    expect(s.kind).toBe('reading');
    expect(s.activeOrd).toBe(1);
    expect(s.paras).toHaveLength(2);
    expect(s.paras?.[0]).toEqual({ label: 'E-1', text: 'Let us pray.' });
  });
  it('keys: same tape = same flow key prefix; reading key is per-tape', () => {
    expect(keyForMessageQuote('rapture', 1)).toBe('msg:rapture:1');
    expect(keyForReading('rapture')).toBe('read:rapture');
  });
});
```

`timing.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { activeOrdAt } from './timing';

const MAP = [
  { ord: 0, tStart: 0, tEnd: 5 },
  { ord: 1, tStart: 5, tEnd: 12 },
  { ord: 2, tStart: 12, tEnd: 20 },
];

describe('activeOrdAt', () => {
  it('returns the span whose range contains t', () => {
    expect(activeOrdAt(MAP, 0)).toBe(0);
    expect(activeOrdAt(MAP, 6)).toBe(1);
    expect(activeOrdAt(MAP, 19.9)).toBe(2);
  });
  it('holds the last ord past the end and first ord before the start', () => {
    expect(activeOrdAt(MAP, -1)).toBe(0);
    expect(activeOrdAt(MAP, 99)).toBe(2);
  });
  it('holds the previous ord inside a gap between spans', () => {
    expect(activeOrdAt([{ ord: 0, tStart: 0, tEnd: 5 }, { ord: 1, tStart: 8, tEnd: 12 }], 6)).toBe(0);
  });
  it('returns 0 for an empty map', () => {
    expect(activeOrdAt([], 10)).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (both files).

- [ ] **Step 3: Implement**

`timing.ts`:
```ts
import type { TimingMap } from '../types';

export function activeOrdAt(map: TimingMap, t: number): number {
  if (!map.length) return 0;
  if (t < map[0].tStart) return map[0].ord;
  let cur = map[0].ord;
  for (const span of map) {
    if (t >= span.tStart) cur = span.ord;
    if (t >= span.tStart && t < span.tEnd) return span.ord;
  }
  return cur; // past the last span, or in a gap → hold the latest started ord
}
```

`slides.ts`:
```ts
import type { Message, Slide } from '../types';

export const MESSAGE_ACCENT = '#a88bc4';

export function keyForMessageQuote(msgId: string, ord: number): string {
  return `msg:${msgId}:${ord}`;
}
export function keyForReading(msgId: string): string {
  return `read:${msgId}`;
}
export function buildQuoteSlide(msg: Message, ord: number): Slide {
  const p = msg.paragraphs[Math.max(0, Math.min(ord, msg.paragraphs.length - 1))];
  const ref = `Tape ${msg.tapeNo} · ¶${p.label}`;
  return { kind: 'quote', accent: MESSAGE_ACCENT, label: ref, text: p.text, source: `${msg.title} · ${ref}` };
}
export function buildReadingSlide(msg: Message, activeOrd: number): Slide {
  return {
    kind: 'reading', accent: MESSAGE_ACCENT, label: msg.title, title: msg.title,
    source: `Tape ${msg.tapeNo}`,
    paras: msg.paragraphs.map(({ label, text }) => ({ label, text })),
    activeOrd,
  };
}
```

- [ ] **Step 4: Run — expect PASS.** (Requires the Task 9 type additions to compile; if executing strictly in order, temporarily add the `reading`/`paras`/`activeOrd` fields to `Slide` and the `Message`/`TimingMap` types now and note it — Task 9 will consolidate. Prefer to land Task 9's `types.ts` additions first if the graph won't compile.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/message/slides.ts src/shared/message/slides.test.ts src/shared/message/timing.ts src/shared/message/timing.test.ts
git commit -m "feat: message slide/key builders and timing lookup"
```

---

## Task 6: Storage — schema, messagesRepo, quote schedule (TDD)

**Files:**
- Modify: `src/main/db.ts` (add tables)
- Create: `src/main/messagesRepo.ts`, `src/main/messagesScheduleRepo.ts`
- Test: `src/main/messagesRepo.test.ts`, `src/main/messagesScheduleRepo.test.ts`

**Interfaces:**
- Consumes: `rankTapes`, `rankQuotes` (Task 4); `norm` (`fuzzy.ts`); `Message`, `MessageMeta`, `TapeRow`, `QuoteRow`, `TimingMap` (Task 9 types).
- Produces `MessagesRepo`:
  - `installIndex(entries: SermonIndexEntry[]): void` (upsert message rows, no paragraphs yet)
  - `installSermon(id: string, paragraphs: {label:string;text:string}[], timing: TimingMap): void`
  - `list(): MessageMeta[]`
  - `get(id: string): Message | null`
  - `search(q: string, scope: string | null): { tapes: TapeRow[]; quotes: QuoteRow[] }`
  - `addImported(r: MessageImportResult): MessageMeta[]`
  - `setAudioPath(id: string, path: string): void`
  - `timings(id: string): TimingMap`
  - `count(): number`
- Produces `MessagesScheduleRepo`: `list(): QuoteScheduleItem[]`; `add(msgId: string, ord: number): QuoteScheduleItem[]`.

- [ ] **Step 1: Add schema** to `src/main/db.ts` `SCHEMA` (before the closing backtick):

```sql
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, tape_no TEXT NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL DEFAULT '',
  duration_s INTEGER NOT NULL DEFAULT 0, audio_path TEXT, audio_url TEXT,
  source TEXT NOT NULL DEFAULT 'vgr', installed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paragraphs (
  message_id TEXT NOT NULL, ord INTEGER NOT NULL, label TEXT NOT NULL, text TEXT NOT NULL,
  PRIMARY KEY (message_id, ord)
);
CREATE VIRTUAL TABLE IF NOT EXISTS paragraph_fts USING fts5(
  text, tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS paragraph_timings (
  message_id TEXT NOT NULL, ord INTEGER NOT NULL, t_start REAL NOT NULL, t_end REAL NOT NULL,
  PRIMARY KEY (message_id, ord)
);
```

> `paragraph_fts` is contentless-style like `song_fts`; the repo inserts a row per paragraph keyed by an integer `rowid` it maps back to `(message_id, ord)` via a `paragraphs.rowid` join — mirror `songsRepo`'s `insertFts` `(SELECT rowid …)` approach using `paragraphs`' implicit rowid.

- [ ] **Step 2: Write the failing `messagesRepo` test**

```ts
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './db';
import { createMessagesRepo } from './messagesRepo';

function repo() {
  const db = new Database(':memory:');
  db.exec(openDb.SCHEMA ?? ''); // if SCHEMA isn't exported, replace with: openDb creates via a temp file
  return createMessagesRepo(db);
}

describe('messagesRepo', () => {
  let r: ReturnType<typeof createMessagesRepo>;
  beforeEach(() => {
    const db = new Database(':memory:');
    // Reuse the app schema:
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, 'db.ts'), 'utf-8').split('`')[1]);
    r = createMessagesRepo(db);
  });

  it('installs an index then a sermon and reads it back', () => {
    r.installIndex([{ id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: 'December 4, 1965', durationS: 9430 }]);
    r.installSermon('rapture', [
      { label: 'E-1', text: 'Let us pray.' },
      { label: '76', text: 'Now, the Rapture is made up of three things.' },
    ], [{ ord: 0, tStart: 0, tEnd: 5 }, { ord: 1, tStart: 5, tEnd: 12 }]);
    const msg = r.get('rapture');
    expect(msg?.paragraphs).toHaveLength(2);
    expect(msg?.paragraphs[1]).toEqual({ ord: 1, label: '76', text: 'Now, the Rapture is made up of three things.' });
    expect(r.timings('rapture')).toHaveLength(2);
    expect(r.list()[0]).toMatchObject({ id: 'rapture', tapeNo: '65-1204', hasAudio: false });
  });

  it('searches tapes and quotes (FTS + fuzzy)', () => {
    r.installIndex([{ id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: '', durationS: 1 }]);
    r.installSermon('rapture', [{ label: '76', text: 'Now, the Rapture is made up of three things.' }], []);
    const res = r.search('rapture', null);
    expect(res.tapes[0].id).toBe('rapture');
    expect(res.quotes[0].label).toBe('76');
  });

  it('scopes quote search to one tape', () => {
    r.installIndex([
      { id: 'a', tapeNo: '65-1204', title: 'The Rapture', date: '', durationS: 1 },
      { id: 'b', tapeNo: '47-0412', title: 'Faith', date: '', durationS: 1 },
    ]);
    r.installSermon('a', [{ label: '1', text: 'grace abounds' }], []);
    r.installSermon('b', [{ label: '1', text: 'grace and faith' }], []);
    expect(r.search('grace', 'a').quotes.every((q) => q.msgId === 'a')).toBe(true);
  });

  it('sets an audio path', () => {
    r.installIndex([{ id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: '', durationS: 1 }]);
    r.setAudioPath('rapture', '/library/65-1204.mp3');
    expect(r.list()[0].hasAudio).toBe(true);
  });
});
```

> The `db.exec(... split('`')[1])` trick reads the `SCHEMA` template literal out of `db.ts` for an in-memory DB. Simpler alternative: **export `SCHEMA`** from `db.ts` (`export const SCHEMA = ...`) and `db.exec(SCHEMA)` — do this refactor as part of Step 1 and use it in the test. Prefer the export.

- [ ] **Step 3: Run — expect FAIL.**

Run: `npx vitest run src/main/messagesRepo.test.ts`

- [ ] **Step 4: Implement `messagesRepo.ts`** (mirror `songsRepo`: FTS candidates → fuzzy re-rank; sparse-hit → full scan). Key shape:

```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { norm } from '../shared/search/fuzzy';
import { rankQuotes, rankTapes, type QuoteRow, type TapeRow } from '../shared/search/messageScore';
import { parseTapeNo } from '../shared/message/tapeNo';
import type { Message, MessageMeta, MessageImportResult, TimingMap } from '../shared/types';

export interface SermonIndexEntry { id: string; tapeNo: string; title: string; date: string; durationS: number }

export interface MessagesRepo {
  installIndex(entries: SermonIndexEntry[]): void;
  installSermon(id: string, paragraphs: { label: string; text: string }[], timing: TimingMap): void;
  list(): MessageMeta[];
  get(id: string): Message | null;
  search(q: string, scope: string | null): { tapes: TapeRow[]; quotes: QuoteRow[] };
  addImported(r: MessageImportResult): MessageMeta[];
  setAudioPath(id: string, path: string): void;
  timings(id: string): TimingMap;
  count(): number;
}

export function createMessagesRepo(db: Database.Database): MessagesRepo {
  // prepared statements: upsert message; delete+insert paragraphs (+ fts) in a txn;
  // list (LEFT rows → MessageMeta with hasAudio = audio_path IS NOT NULL);
  // get (message + ORDER BY ord paragraphs); timings; setAudioPath.
  // search():
  //   tapes = rankTapes(q, all index rows)   // ~1,200 rows, fine to scan
  //   quotes: FTS candidates via paragraph_fts MATCH ("tok"* OR …), map rowid → (message_id, ord, label, text, title, tape_no),
  //           restrict to scope when set, then rankQuotes(q, rows). Sparse-hit (<30) → scan scope/all paragraphs (fuzzy path).
  // addImported: create id=randomUUID(), tape_no=parseTapeNo(r.tapeNo) ?? r.tapeNo, source='local',
  //   installIndex-equivalent + installSermon(paragraphs, []).
  //   ... full implementation here ...
}
```

Implement fully following the `songsRepo` FTS pattern (`src/main/songsRepo.ts:37–48`). Insert one `paragraph_fts` row per paragraph inside the same transaction as the `paragraphs` insert; store the mapping by selecting `paragraphs.rowid`.

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Write + pass the `messagesScheduleRepo` test** (mirror `scheduleRepo.test.ts`), then implement `messagesScheduleRepo.ts` reusing `service_items` with `kind='quote'`, `ref_json={msgId, ord}`, joining `messages`/`paragraphs` to produce `QuoteScheduleItem { id, msgId, ord, label, tapeNo, title }`. Dedupe on `(msgId, ord)` like `scheduleRepo.add`.

```ts
// QuoteScheduleItem row build: SELECT ref_json → {msgId,ord}; JOIN messages m ON m.id=msgId
// and paragraphs p ON (p.message_id=msgId AND p.ord=ord) for label/title/tape_no.
```

- [ ] **Step 7: Run both repo tests — expect PASS.**

- [ ] **Step 8: Commit**

```bash
git add src/main/db.ts src/main/messagesRepo.ts src/main/messagesRepo.test.ts src/main/messagesScheduleRepo.ts src/main/messagesScheduleRepo.test.ts
git commit -m "feat: message storage, FTS search, and quote schedule"
```

---

## Task 7: MessageSource adapter + normalizer (TDD on normalizer)

**Files:**
- Create: `src/main/messageSource.ts`
- Test: `src/main/messageSource.test.ts` (uses the Task 1 fixtures)

**Interfaces:**
- Consumes: the Task 1 fixtures; `SermonIndexEntry`, `SermonPayload`, `MessageSource` (Task 1 contract).
- Produces: `createMessageSource(): MessageSource` (default, live endpoint from spike) and pure `normalizeIndex(raw): SermonIndexEntry[]`, `normalizeSermon(raw): SermonPayload` (unit-tested against fixtures; the live `fetch` calls are thin wrappers, not asserted in unit tests — mirror `bibleSource.ts`).

- [ ] **Step 1: Write the failing normalizer test** against `src/main/__fixtures__/message-index.sample.json` and `message-sermon.sample.json`: assert `normalizeIndex` yields entries with `tapeNo`/`title`/`date`/`durationS`, and `normalizeSermon` yields `paragraphs[].{label,text}` and a `timing[]` (possibly empty). Assert a known paragraph label is a **string** (e.g. `'E-1'` or `'76'`).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `normalizeIndex`/`normalizeSermon` per the fixture shape from Task 1, plus `createMessageSource` (fetch wrappers + `audioUrl`). Keep normalizers pure; validate structure and throw on malformed payloads (mirror `normalizeGetBible`'s guard style, `bibleSource.ts:59–70`).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat: MessageSource adapter and normalizers`.

---

## Task 8: messageInstaller — corpus install + on-demand audio (TDD with fakes)

Mirrors `bibleInstaller` (in-flight guard, progress phases, dependency injection for testability).

**Files:**
- Create: `src/main/messageInstaller.ts`
- Test: `src/main/messageInstaller.test.ts`

**Interfaces:**
- Consumes: `MessagesRepo` (Task 6), `MessageSource` (Task 7).
- Produces `MessageInstaller`:
  - `installCorpus(): void` — `fetchIndex` → `installIndex` → per-sermon `fetchSermon` → `installSermon`, broadcasting `MessageInstallProgress { phase, count, total, error }`. In-flight guard.
  - `downloadAudio(id: string): void` — resolve entry → fetch `audioUrl` → write to `library/<tapeNo>.mp3` → `repo.setAudioPath` → broadcast `AudioDownloadProgress`. In-flight guard per id.
  - Deps injected: `{ source: MessageSource; writeAudio: (tapeNo: string, bytes: ArrayBuffer) => Promise<string> }` with production defaults (real source + fs write into the app-data `library/`).

- [ ] **Step 1: Write the failing test** with a fake `MessageSource` (returns a 2-entry index + fixed payloads) and a fake `writeAudio` (returns a fake path); assert: `installCorpus` broadcasts `downloading`→`installing`→`done` and the repo now `count()===2` with paragraphs; `downloadAudio` sets the audio path and broadcasts `done`; a second concurrent `downloadAudio(id)` while in-flight is ignored (in-flight guard). Model the assertions on `bibleInstaller.test.ts`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `createMessageInstaller(repo, broadcast, deps)` following `bibleInstaller.ts:31–94` (async IIFE, try/finally, `inFlight` Set).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat: message corpus installer and on-demand audio download`.

---

## Task 9: Types, IPC, preload, main wiring

**Not TDD** (wiring). Verified by typecheck + app boot. Fold in the `types.ts` additions the earlier shared tasks referenced.

**Files:**
- Modify: `src/shared/types.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts`

- [ ] **Step 1: Add types** to `src/shared/types.ts`:

```ts
// Slide: add 'reading' to SlideKind, and fields:
//   paras?: { label: string; text: string }[]; activeOrd?: number;
export interface MessageParagraph { ord: number; label: string; text: string }
export interface Message {
  id: string; tapeNo: string; title: string; date: string;
  durationS: number; audioPath: string | null; source: string;
  paragraphs: MessageParagraph[];
}
export interface MessageMeta { id: string; tapeNo: string; title: string; date: string; durationS: number; hasAudio: boolean }
export interface MessageImportResult { tapeNo: string; title: string; date: string; paragraphs: { label: string; text: string }[] }
export interface QuoteScheduleItem { id: string; msgId: string; ord: number; label: string; tapeNo: string; title: string }
export interface TimingSpan { ord: number; tStart: number; tEnd: number }
export type TimingMap = TimingSpan[];
export interface MessageInstallProgress { phase: 'downloading' | 'installing' | 'done' | 'error'; count?: number; total?: number; error?: string }
export interface AudioDownloadProgress { msgId: string; phase: 'downloading' | 'done' | 'error'; received?: number; total?: number; error?: string }
// Re-export the search row types from messageScore for the API surface:
export type { TapeRow, QuoteRow } from './search/messageScore';
```

Add to `CH`:
```ts
messageSearch: 'message:search', messageList: 'message:list', messageGet: 'message:get',
messageInstallCorpus: 'message:installCorpus', messageImportParse: 'message:importParse',
messageImportSave: 'message:importSave', messageDownloadAudio: 'message:downloadAudio',
messageTiming: 'message:timing',
messageInstallProgress: 'message:installProgress',   // main → all
messageAudioProgress: 'message:audioProgress',        // main → all
quoteScheduleList: 'quoteSchedule:list', quoteScheduleAdd: 'quoteSchedule:add',
```

Add to `HelmApi`:
```ts
message: {
  search(q: string, scope: string | null): Promise<{ tapes: TapeRow[]; quotes: QuoteRow[] }>;
  list(): Promise<MessageMeta[]>;
  get(id: string): Promise<Message | null>;
  installCorpus(): void;
  importParse(kind: 'txt' | 'pdf', data: string): Promise<MessageImportResult>;
  importSave(r: MessageImportResult): Promise<MessageMeta[]>;
  downloadAudio(id: string): void;
  timing(id: string): Promise<TimingMap>;
  onInstallProgress(cb: (p: MessageInstallProgress) => void): () => void;
  onAudioProgress(cb: (p: AudioDownloadProgress) => void): () => void;
};
quoteSchedule: {
  list(): Promise<QuoteScheduleItem[]>;
  add(msgId: string, ord: number): Promise<QuoteScheduleItem[]>;
};
```

- [ ] **Step 2: Wire preload** (`src/preload/index.ts`) mirroring the `bibles` block (invoke for request/response, `send` for fire-and-forget, `sub(CH.…)` for progress). `importParse` for `kind:'pdf'` receives already-extracted text `data` (PDF→text happens in the renderer/main import step of Task 13; here `data` is text).
- [ ] **Step 3: Wire ipc** (`src/main/ipc.ts`): add `messagesRepo`, `messagesScheduleRepo`, `messageInstaller` params; register handlers. `importParse` calls `parseMessageText(data)`. `timing` → `repo.timings(id)`.
- [ ] **Step 4: Wire `src/main/index.ts`**: construct `createMessagesRepo(db)`, `createMessagesScheduleRepo(db)`, `createMessageSource()`, `createMessageInstaller(repo, broadcast, …)`; broadcast progress on `CH.messageInstallProgress`/`CH.messageAudioProgress` to all windows (mirror the bibles progress broadcast); pass into `registerIpc`.
- [ ] **Step 5: Verify** — `npm run typecheck` (or `tsc --noEmit`) passes; `npm run dev` boots without console errors. Run `npm test` (Node ABI) — all prior tests still green.
- [ ] **Step 6: Commit** `feat: wire message IPC, preload, and main services`.

---

## Task 10: ReadingCanvas + output routing (TDD render)

**Files:**
- Create: `src/renderer/shared/ReadingCanvas.tsx`
- Test: `src/renderer/shared/ReadingCanvas.test.tsx`
- Modify: `src/renderer/output/OutputApp.tsx` (route `slide.kind === 'reading'` → `ReadingCanvas`), and the operator live-preview render site (Task 11 wires the operator side).

**Interfaces:**
- Consumes: `Slide` (`paras`, `activeOrd`, `title`, `source`, `accent`).
- Produces: `ReadingCanvas({ slide, fill }: { slide: Slide; fill?: boolean }): JSX.Element` — a scrolling column of `slide.paras`, the `activeOrd` paragraph at full emphasis (accent-tinted) and others dimmed, translated so the active paragraph is centered (`transform: translateY(...)` with `transition: transform .5s ease`), a `¶<label>` gutter on each paragraph. Serif body (`'Newsreader', Georgia, serif`), sizing in `cqmin` (matches `SlideCanvas`). Header shows `slide.title` / `slide.source`.

- [ ] **Step 1: Write the failing test** — render `<ReadingCanvas slide={{ kind:'reading', title:'The Rapture', source:'Tape 65-1204', accent:'#a88bc4', activeOrd:1, paras:[{label:'E-1',text:'Let us pray.'},{label:'76',text:'Now, the Rapture…'}] }} />`; assert both paragraph texts render, the active one carries the active style marker (e.g. `data-active="true"` on the active paragraph), and the `¶76` label appears. (Model on `SlideCanvas.test.tsx`.)
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `ReadingCanvas.tsx`. Put `data-active` on each paragraph for the test hook; center the active paragraph via `translateY(calc(50% - <active offset>))` using measured refs or a simple per-paragraph fixed line model (paragraph heights vary — measure with a `ref` array in a `useLayoutEffect`, or approximate by scrolling the active element into center with `scrollIntoView({block:'center'})` on `activeOrd` change inside a scroll container). Prefer a scroll container + `useEffect` calling `activeRef.current?.scrollIntoView({ block:'center', behavior:'smooth' })` — simplest and smooth.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Route** in `OutputApp.tsx`: when `payload.slide.kind === 'reading'`, render `<ReadingCanvas slide={payload.slide} fill />` instead of `<SlideCanvas … fill />`.
- [ ] **Step 6: Commit** `feat: scrolling reading-view canvas and output routing`.

---

## Task 11: MessageMode operator surface (search rail, paragraph rail, quote hero)

Ports the design-source Message markup **character-exact** (`Lectern.pretty.html:207–281` left rail, `328–334` quote hero, style objects `1294–1313`). Wires search/cue/goLive/schedule through `window.helm.message` / `.quoteSchedule` / `.presentation`.

**Files:**
- Create: `src/renderer/operator/MessageMode.tsx`, `src/renderer/operator/MessageSearchRail.tsx`, `src/renderer/operator/ParagraphRail.tsx`
- Modify: `src/renderer/operator/SermonMode.tsx` (render `<MessageMode/>` for `track === 'message'`, pass `keyHandlerRef`/`active`), `src/renderer/operator/SermonCenter.tsx` (or a small `MessageCenter` — reuse `SermonCenter`'s hero shell; add the quote hero branch from `328–334`).

**Interfaces:**
- Consumes: `keyForMessageQuote`, `buildQuoteSlide`, `keyForReading`, `buildReadingSlide` (Task 5); `window.helm.message`/`.quoteSchedule` (Task 9); `usePresentationState` (`useHelm.ts`); `ThemeCtx`.
- Produces: `MessageMode({ themeMode, keyHandlerRef, active }: { themeMode: ThemeMode; keyHandlerRef: ModeKeyHandlerRef; active: boolean }): JSX.Element`.

- [ ] **Step 1: `MessageMode` state + data load.** State: `list: MessageMeta[]`, `msgId`, `msg: Message | null` (fetched via `message.get`), `msgIdx` (cued ord), `q`, `scope: string | null`, `schedule: QuoteScheduleItem[]`, `tapePos`/`tapePlaying` (Task 12). On mount: `message.list()` → pick first as current; `quoteSchedule.list()`. On `msgId` change: `message.get(msgId)` → `setMsg`.
- [ ] **Step 2: Cue effect (quote).** On `msg`/`msgIdx` change (when not in reading playback): `presentation.cue(keyForMessageQuote(msgId, msgIdx), buildQuoteSlide(msg, msgIdx))` — mirrors `SermonMode`'s scripture cue effect (`SermonMode.tsx:164–172`).
- [ ] **Step 3: `MessageSearchRail`** — port `Lectern.pretty.html:207–281`: scope chip (`msgChipStyle`), `›` prefix, input with `msgQPlaceholder`; when `q` non-empty call `message.search(q, scope)` (debounced/onChange) and render `TAPES — SELECT TO SEARCH WITHIN` (rows set scope) + `QUOTES`/`QUOTES IN THIS TAPE` (rows call `selectQuote(msgId, ord)`); when empty render `QUOTE SCHEDULE` from `schedule`. Then the tape player card slot (Task 12). Use `T.message` accent chrome. `selectQuote(id, ord)` = `setMsgId(id); setMsgIdx(ord); setQ('')`.
- [ ] **Step 4: `ParagraphRail`** — the right panel: port the `¶`-labelled rows (`Lectern.pretty.html:1171–1175` styles) from `msg.paragraphs`, each showing `¶ <label>` + preview, CUED/LIVE badges (`isCued = ord===msgIdx`; `isLive = output==='live' && liveKey===keyForMessageQuote(msgId, ord)`), planned-quote highlight from `schedule`. Click → `showPara(ord)` = `setMsgIdx(ord)`.
- [ ] **Step 5: Quote hero** in the center — port `328–334`: `heroLabel = 'Tape '+tapeNo+' — ¶'+label`, `quoteText`, `quoteSource = title+' · '+date` (operator hero form, `Lectern.pretty.html:1303–1305`). `goLive()` = `presentation.goLive(keyForMessageQuote(msgId, msgIdx), buildQuoteSlide(msg, msgIdx))`. On-deck preview = next paragraph tagged `QUOTE`/`KEEP READING` (`1147`).
- [ ] **Step 6: SermonMode wiring** — replace the `message` branch of the placeholder (`SermonMode.tsx:411–413`) with `<MessageMode themeMode={themeMode} keyHandlerRef={keyHandlerRef} active={active && track==='message'} />`. In SermonMode's keyboard delegate (`322–339`), delegate arrows/goLive to MessageMode when `track==='message'` (MessageMode registers its own handler via the shared ref while active — mirror the scripture/message split; simplest: MessageMode owns the ref when `active && track==='message'`, SermonMode owns it when `track==='scripture'`).
- [ ] **Step 7: Verify in-app** — `npm run dev`: switch to Message tab, search a tape, scope into it, cue a paragraph, Go Live → quote slide shows on the output window in message purple. Run `npm test` (Node ABI) green.
- [ ] **Step 8: Commit** `feat: message-track operator surface (search, paragraph rail, quote slides)`.

---

## Task 12: TapePlayer + playback→reading sync

**Files:**
- Create: `src/renderer/operator/TapePlayer.tsx`
- Modify: `src/renderer/operator/MessageMode.tsx` (mount `TapePlayer`; own the reading cue during playback)

**Interfaces:**
- Consumes: `activeOrdAt`, `keyForReading`, `buildReadingSlide` (Task 5); `window.helm.message.timing`, `.downloadAudio`, `.onAudioProgress` (Task 9); `window.helm.presentation`.
- Produces: `TapePlayer({ msg, audioSrc, timing, onActiveOrd, onEnsureAudio, theme }: TapePlayerProps): JSX.Element` — the player card from `Lectern.pretty.html:268–280` (circular play/pause `tapeBtnStyle`, title, `MM:SS / MM:SS` `tapeTime`, seekable `tapeBarStyle`/`tapeFillStyle`). Holds an `<audio ref>`; on `timeupdate` computes `activeOrdAt(timing, audio.currentTime)` and calls `onActiveOrd(ord)` **only when it changes**; seeking the bar sets `audio.currentTime`.

- [ ] **Step 1: Player card + audio element.** Render the card ported from `268–280`; `<audio ref={a} src={audioSrc}/>`. Play/pause toggles `a.play()/pause()`. Bind `timeupdate`→ position (for `tapeTime`/`tapeFillStyle`) and the changed-ord callback. Total duration from `msg.durationS` (available pre-download).
- [ ] **Step 2: On-demand download.** If `!msg.audioPath` when play is pressed: call `onEnsureAudio()` (→ `message.downloadAudio(msg.id)`), show a downloading state from `onAudioProgress`, then play once the path arrives (MessageMode re-`get`s the message on `audioProgress.phase==='done'` and passes the new `audioSrc`).
- [ ] **Step 3: Reading cue during playback.** In `MessageMode`: fetch `timing = await message.timing(msgId)` when `msg` loads. Pass `onActiveOrd={(ord)=>{ presentation.cue(keyForReading(msgId), buildReadingSlide(msg, ord)); }}` — re-cues the reading slide with the new `activeOrd`; because `keyForReading` is stable per tape, `applyCue`/`sameFlow` hot-updates the live reading snapshot. When the operator presses **Go Live** with the reading view intended (a "Follow along" action in the player card), call `presentation.goLive(keyForReading(msgId), buildReadingSlide(msg, activeOrd))` once; subsequent `timeupdate` ord changes flow via `cue`. Guard: only send a new cue when `ord` changed (Step 1's callback already dedupes).
- [ ] **Step 4: Verify in-app** — download a tape (or point `audioSrc` at a local fixture mp3), press Follow-along → Go Live, play: the output window scrolls and highlights the active paragraph in sync with audio; seeking jumps the highlight. Node ABI `npm test` green.
- [ ] **Step 5: Commit** `feat: tape player with on-demand audio and reading-view sync`.

> **Perf note:** re-cueing carries the full `paras` array each paragraph boundary (seconds apart) — acceptable for v1. If profiling shows IPC cost, split the reading payload so `goLive` sends `paras` once and boundary updates send only `activeOrd`; leave as-is unless measured.

---

## Task 13: Local-import review modal + Settings Message section

**Files:**
- Create: `src/renderer/operator/MessageImport.tsx`
- Modify: `src/renderer/operator/SettingsModal.tsx` (Message library section)

- [ ] **Step 1: Settings → Message section** (mirror the Bibles section): library stats (`message.list().length`), an **Install corpus** button (`message.installCorpus()`, progress via `onInstallProgress`), and an **Import file…** button opening `MessageImport`.
- [ ] **Step 2: `MessageImport` modal** — file picker (TXT/PDF); for PDF, extract text to a string first (use the app's existing PDF-text path if present, else a minimal `pdfjs`/`pdf-parse` call in main behind `message.importParse('pdf', text)` — **the renderer passes extracted text**, keeping the parser pure). Call `message.importParse(kind, text)` → show the parsed header (editable `tapeNo`/`title`/`date`) + a scrollable parsed-paragraph preview (this is the operator safety net). **Save** → `message.importSave(result)` → refresh list.
- [ ] **Step 3: Verify in-app** — import a fixture TXT sermon; confirm header + paragraphs preview; save; it appears in Message search. Node ABI `npm test` green.
- [ ] **Step 4: Commit** `feat: local sermon import review and Settings message library`.

---

## Task 14: Final gate — full suite, ABI, lint, docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** `npm rebuild better-sqlite3` (Node ABI) → `npm test` — full suite green (list the count).
- [ ] **Step 2:** `npm run typecheck` and `npm run lint` — no new errors (note the pre-existing prettier warning backlog; don't regress it).
- [ ] **Step 3:** `npm run dev` end-to-end manual pass: install/import a tape → search (tape + quote + scoped) → cue quote → Go Live (purple quote slide) → play tape → Follow-along reading view scrolls/highlights in sync on the output window → seek jumps highlight.
- [ ] **Step 4:** README — document the Message library (authoritative source, on-demand audio cache in `library/`, local import), and reaffirm the better-sqlite3 dual-ABI note.
- [ ] **Step 5: Commit** `chore: slice 4 verification and Message library docs`.
- [ ] **Step 6:** Whole-branch review (superpowers:requesting-code-review) before merging with superpowers:finishing-a-development-branch.

---

## Self-Review Notes

**Spec coverage:**
- §2 two experiences → quote slide (Tasks 5/11), reading view (Tasks 5/10/12). ✓
- §3 authoritative acquisition + spike + fallback → Task 1 (spike), Task 7 (adapter), Task 8 (installer). aeneas fallback recorded as slice-4b contingency in Task 1. ✓
- §3.2 text full-install / audio on-demand → Task 6 (`installIndex`/`installSermon`), Task 8 (`downloadAudio`). ✓
- §3.3 local import (best-effort + review) → Task 3 (parser), Task 13 (review modal). ✓
- §4 data model (`messages`/`paragraphs`/`paragraph_fts`/`paragraph_timings`, `service_items` kind `quote`, `label` string, `duration_s` from index) → Task 6. ✓
- §5 search reuse + len-5 tolerance → Task 4 (`matchTol`), Task 6 (FTS+fuzzy). ✓
- §6 reading view + TimingMap + provider → Task 5 (`timing`), Task 10 (`ReadingCanvas`), Task 12 (sync). ✓
- §7 tape player → Task 12. ✓
- §8 UI character-exact → Tasks 10/11/12/13 (design-source line refs). ✓
- §9 pipeline/IPC (`quote`/`reading` kinds, `CH`, contextIsolation) → Task 9. ✓
- §10 testing (Node ABI) → every task + Task 14. ✓

**Placeholder scan:** Task 6 Step 4 and Task 7/8/11/12/13 describe implementations by pattern-reference (to `songsRepo`/`bibleInstaller`/design-source lines) rather than inlining every line — deliberate, since those are ports of existing, in-repo patterns and the character-exact UI source is the canonical spec. All *logic* modules (Tasks 2–5) carry complete code. No `TBD`/`TODO`.

**Type consistency:** `MessageImportResult`, `Message`, `MessageMeta`, `TimingMap`/`TimingSpan`, `TapeRow`/`QuoteRow`, `QuoteScheduleItem`, `SermonIndexEntry`/`SermonPayload`, `keyForMessageQuote`/`keyForReading`, `buildQuoteSlide`/`buildReadingSlide`, `activeOrdAt`, `matchTol` — names/signatures are consistent across tasks. `Slide` gains `reading` kind + `paras`/`activeOrd` (Task 9), consumed by Tasks 5/10/12. `CH` message channels defined once (Task 9), used in preload/ipc.

**Ordering note:** Task 5's tests need the Task 9 `Slide`/`Message`/`TimingMap` type additions to compile. Land the `types.ts` additions from Task 9 Step 1 before (or at) Task 5 if executing strictly in order — called out in Task 5 Step 4.
