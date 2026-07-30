# Song Library Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An "Import songs" wizard that reads an EasyWorship library (SQLite + RTF) into Helm's song library, built on a source seam so CSV and others become new adapters later.

**Architecture:** Three pure units in `src/shared/songs/` (RTF stripping, tidy rules, dedupe key) do all the text work with no I/O. One main-process adapter (`src/main/importSources/easyworship.ts`) reads the two SQLite files behind an injectable `openDb` seam. A source-agnostic orchestrator (`src/main/songImport.ts`) classifies, dedupes and commits through the existing `songsRepo.add()`. A modal wizard drives it over four IPC calls.

**Tech Stack:** TypeScript, Electron 39, React 19, `better-sqlite3` (production reads), `node:sqlite` (tests), vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-30-song-library-import-design.md`. Read it before Task 1.
- **Never `WHERE` or `ORDER BY` an EasyWorship text column.** Verified empirically: against a table declaring `COLLATE UTF8_U_CI`, `SELECT rowid, title, author FROM song` and `SELECT *` succeed, while `ORDER BY title` and `WHERE title = ?` both throw `no such collation sequence: UTF8_U_CI`. `better-sqlite3@12.11.1` exposes no API to register one. Sort in JavaScript.
- **Never import `better-sqlite3` at module top level** in anything under `src/main/` that a test imports. `npm test` runs on stock Node where that native binary is the wrong ABI. Use a lazy `require` inside a default-dependency function, following `messageInstaller.ts:25-29`, and keep the eslint-disable comment used there.
- **Never write to the source library.** Copy `Songs.db` / `SongWords.db` to a temp dir, open the copies read-only, delete them in a `finally`.
- **Commit through `songsRepo.add()`.** It runs `splitToSlides`, the insert transaction and the `song_fts` index together. Anything writing songs another way produces songs that exist but cannot be found by search.
- **Tidy rules are exactly the six in the spec.** No punctuation stripping, no recapitalisation, no `x2` removal, no section renaming, no reflow.
- Existing gate must stay green: `npm test`, `npm run typecheck`, `npx eslint .`.
- Commit messages: concise conventional-commit subject, no `Co-Authored-By` or `Claude-Session` trailers (`CLAUDE.md`).

---

### Task 1: RTF → text

**Files:**
- Create: `src/shared/songs/rtfToText.ts`
- Test: `src/shared/songs/rtfToText.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `rtfToText(rtf: string): string` — plain text using `\n` only. Never throws.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { rtfToText } from './rtfToText';

describe('rtfToText', () => {
  it('returns plain text from a minimal document', () => {
    expect(rtfToText('{\\rtf1\\ansi Hello}')).toBe('Hello');
  });

  it('turns \\par and \\line into newlines', () => {
    expect(rtfToText('{\\rtf1 Line one\\par Line two\\line Line three}')).toBe(
      'Line one\nLine two\nLine three'
    );
  });

  it('discards the font table entirely', () => {
    expect(rtfToText('{\\rtf1{\\fonttbl{\\f0\\fnil Arial;}}\\f0\\fs40 Text}')).toBe('Text');
  });

  it('discards ignorable destinations', () => {
    expect(rtfToText('{\\rtf1{\\*\\generator Riched20 10.0;}Text}')).toBe('Text');
  });

  it('decodes a unicode escape and swallows its substitute character', () => {
    expect(rtfToText("{\\rtf1 It\\u8217?s}")).toBe('It\u2019s');
  });

  it('decodes hex escapes using cp1252, not latin-1', () => {
    expect(rtfToText("{\\rtf1 caf\\'e9}")).toBe('caf\u00e9');
    expect(rtfToText("{\\rtf1 It\\'92s}")).toBe('It\u2019s');
  });

  it('emits escaped braces and backslashes literally', () => {
    expect(rtfToText('{\\rtf1 \\{x\\} \\\\ y}')).toBe('{x} \\ y');
  });

  it('ignores the line wrapping of the source file', () => {
    expect(rtfToText('{\\rtf1 A\r\nB}')).toBe('AB');
  });

  it('returns best-effort text rather than throwing on unbalanced braces', () => {
    expect(rtfToText('{\\rtf1 Text')).toBe('Text');
    expect(rtfToText('{\\rtf1 Text}}}')).toBe('Text');
  });

  it('returns an empty string for empty input', () => {
    expect(rtfToText('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/songs/rtfToText.test.ts`
Expected: FAIL — cannot find module `./rtfToText`.

- [ ] **Step 3: Write minimal implementation**

```ts
// RTF → plain text, scoped to the dialect EasyWorship's editor emits rather than the whole
// RTF specification. Never throws: a blob it cannot make sense of yields whatever text was
// recoverable, and the caller treats an empty result as an unreadable song.

// Control words whose entire group is metadata, not lyrics.
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'generator', 'filetbl',
  'listtable', 'listoverridetable', 'rsidtbl', 'themedata', 'datastore', 'xmlnstbl'
]);

// Windows-1252 puts printable characters where Latin-1 has control codes (0x80–0x9F), and
// EasyWorship's \'xx escapes are cp1252 — curly quotes and dashes land in exactly this range,
// so treating them as Latin-1 would yield control characters instead of punctuation.
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178
};

interface GroupState {
  skip: boolean; // inside a destination whose text is discarded
  uc: number;    // substitute characters to swallow after a \u escape
}

export function rtfToText(rtf: string): string {
  if (!rtf) return '';
  const out: string[] = [];
  const stack: GroupState[] = [{ skip: false, uc: 1 }];
  let g = stack[0];
  let i = 0;
  let skipChars = 0; // literal characters still to be swallowed after \uN

  const emit = (s: string): void => {
    if (!g.skip) out.push(s);
  };

  while (i < rtf.length) {
    const ch = rtf[i];

    if (ch === '{') {
      stack.push({ ...g });
      g = stack[stack.length - 1];
      i++;
      continue;
    }

    if (ch === '}') {
      if (stack.length > 1) {
        stack.pop();
        g = stack[stack.length - 1];
      }
      skipChars = 0; // a \uN substitute never spans a group boundary
      i++;
      continue;
    }

    if (ch === '\\') {
      i++;
      const next = rtf[i];
      if (next === undefined) break;

      if (next === '\\' || next === '{' || next === '}') {
        if (skipChars > 0) skipChars--;
        else emit(next);
        i++;
        continue;
      }

      if (next === '*') {
        g.skip = true;
        i++;
        continue;
      }

      if (next === "'") {
        const code = parseInt(rtf.slice(i + 1, i + 3), 16);
        i += 3;
        if (skipChars > 0) skipChars--;
        else if (!Number.isNaN(code)) emit(String.fromCharCode(CP1252_HIGH[code] ?? code));
        continue;
      }

      if (!/[a-z]/i.test(next)) {
        i++; // control symbols such as \~ \- \_ carry no lyric text
        continue;
      }

      // Control word: letters, an optional signed number, then an optional single space
      // which is a delimiter rather than text.
      let j = i;
      while (j < rtf.length && /[a-z]/i.test(rtf[j])) j++;
      const word = rtf.slice(i, j);
      let numStr = '';
      if (rtf[j] === '-') {
        numStr = '-';
        j++;
      }
      while (j < rtf.length && /[0-9]/.test(rtf[j])) numStr += rtf[j++];
      if (rtf[j] === ' ') j++;
      i = j;
      const num = numStr === '' ? null : parseInt(numStr, 10);

      if (SKIP_DESTINATIONS.has(word)) g.skip = true;
      else if (word === 'uc') g.uc = num ?? 1;
      else if (word === 'u' && num !== null) {
        emit(String.fromCodePoint(num < 0 ? num + 0x10000 : num));
        skipChars = g.uc;
      } else if (word === 'par' || word === 'line' || word === 'sect') emit('\n');
      else if (word === 'tab') emit('\t');
      // every other control word is formatting and produces no text
      continue;
    }

    i++;
    if (ch === '\r' || ch === '\n') continue; // source-file wrapping, not lyric structure
    if (skipChars > 0) {
      skipChars--;
      continue;
    }
    emit(ch);
  }

  return out.join('');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/songs/rtfToText.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/songs/rtfToText.ts src/shared/songs/rtfToText.test.ts
git commit -m "feat(songs): add an RTF-to-text stripper for library import"
```

---

### Task 2: Tidy rules

**Files:**
- Create: `src/shared/songs/importTidy.ts`
- Test: `src/shared/songs/importTidy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `importTidy(text: string): string` — applied to stripped text before `splitToSlides`.

**Note on rule order.** The spec lists artifact-line removal (rule 5) after the blank-line collapse (rule 3). The implementation must run removal *first*, because deleting a line leaves an extra newline behind and the collapse is what tidies it up. The observable outcome is what the spec describes.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { importTidy } from './importTidy';

describe('importTidy', () => {
  it('normalises CRLF and CR to LF', () => {
    expect(importTidy('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('trims trailing whitespace on each line', () => {
    expect(importTidy('a   \nb\t\t')).toBe('a\nb');
  });

  it('collapses three or more newlines to exactly two', () => {
    expect(importTidy('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('keeps a single blank line, because that is one slide break', () => {
    expect(importTidy('a\n\nb')).toBe('a\n\nb');
  });

  it('straightens curly quotes', () => {
    expect(importTidy('\u2018a\u2019 \u201cb\u201d')).toBe("'a' \"b\"");
  });

  it('drops lines that are only RTF-stripping debris', () => {
    expect(importTidy('a\n()\nb\n[]\nc\n.\nd')).toBe('a\nb\nc\nd');
  });

  it('trims leading and trailing blank lines', () => {
    expect(importTidy('\n\n\na\n\n\n')).toBe('a');
  });

  it('returns an empty string when nothing survives', () => {
    expect(importTidy('\n\n()\n\n')).toBe('');
  });

  // Guard test: everything "light tidying" must NOT do. Without this, the six rules drift
  // into the opinionated cleanup the spec rejected, and a lyric changes without anyone noticing.
  it('leaves lyric content untouched', () => {
    const lyric = [
      'Verse 1',
      'amazing grace, how sweet the sound. x2',
      'That saved a wretch like me,',
      '',
      'Chorus 2',
      'praise God! (2x)'
    ].join('\n');
    expect(importTidy(lyric)).toBe(lyric);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/songs/importTidy.test.ts`
Expected: FAIL — cannot find module `./importTidy`.

- [ ] **Step 3: Write minimal implementation**

```ts
// The six normalisations applied to imported lyrics, and no others. Source-agnostic: a CSV
// adapter will want exactly these too.
//
// Deliberately NOT done — each one can silently alter a lyric nobody re-reads until it is on
// the projector: punctuation stripping, recapitalisation, "x2" removal, section renaming,
// reflowing long blocks. importTidy.test.ts pins this with a guard test.

const ARTIFACT_LINE = /^(?:\(\s*\)|\[\s*\]|\.)$/;

export function importTidy(text: string): string {
  return (text || '')
    .replace(/\r\n?/g, '\n')                       // 1. CRLF / CR → LF
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))    // 2. trailing whitespace
    .filter((line) => !ARTIFACT_LINE.test(line.trim())) // 5. debris (before the collapse)
    .join('\n')
    .replace(/[\u2018\u2019\u02bc]/g, "'")         // 4. curly quotes
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\n{3,}/g, '\n\n')                    // 3. one blank line = one slide break
    .replace(/^\n+|\n+$/g, '');                    // 6. leading / trailing blank lines
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/songs/importTidy.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/songs/importTidy.ts src/shared/songs/importTidy.test.ts
git commit -m "feat(songs): add import tidy rules with a no-cleanup guard test"
```

---

### Task 3: Dedupe key

**Files:**
- Create: `src/shared/songs/importKey.ts`
- Modify: `src/shared/songs/lyrics.ts` (add `lyricsOfSections`, have `lyricsOf` delegate)
- Test: `src/shared/songs/importKey.test.ts`

**Interfaces:**
- Consumes: `splitToSlides` (`src/shared/songs/splitToSlides.ts`), `Song`/`SongSection` (`src/shared/types.ts`).
- Produces:
  - `lyricsOfSections(sections: SongSection[]): string`
  - `songImportKey(song: Song): string`
  - `scannedImportKey(title: string, text: string): string`

**Why both sides run `splitToSlides`.** `splitToSlides` *removes* a leading `Verse 1` / `Chorus` line and promotes it to the section label, so a stored `Song`'s lyrics never contain those markers while raw scanned text does. Comparing raw text against `lyricsOf(song)` would therefore never match and every song would import twice. Both key functions must funnel through `splitToSlides`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { openTestDb } from '../../main/testDb';
import { createSongsRepo, type SongsRepo } from '../../main/songsRepo';
import { scannedImportKey, songImportKey } from './importKey';

let repo: SongsRepo;
beforeEach(() => {
  repo = createSongsRepo(openTestDb());
});

describe('importKey', () => {
  // The trap this exists to prevent: section labels are stripped by splitToSlides, so a raw
  // text key and a stored Song key would never agree and nothing would ever be a duplicate.
  it('gives a scanned song and the Song it becomes the same key', () => {
    const title = 'Amazing Grace';
    const text = 'Verse 1\nAmazing grace! how sweet the sound\n\nChorus\nPraise God';
    const song = repo.add({ title, author: 'John Newton', text });
    expect(scannedImportKey(title, text)).toBe(songImportKey(song));
  });

  it('ignores case and whitespace differences', () => {
    expect(scannedImportKey('Amazing  Grace', 'Praise   God')).toBe(
      scannedImportKey('amazing grace', 'praise god')
    );
  });

  it('distinguishes two arrangements sharing a title', () => {
    expect(scannedImportKey('Amazing Grace', 'Praise God')).not.toBe(
      scannedImportKey('Amazing Grace', 'A different second verse')
    );
  });

  it('distinguishes two songs sharing lyrics but not a title', () => {
    expect(scannedImportKey('One', 'Praise God')).not.toBe(scannedImportKey('Two', 'Praise God'));
  });

  it('ignores the author, which is not part of identity', () => {
    const text = 'Praise God';
    const a = repo.add({ title: 'Doxology', author: 'Ken', text });
    expect(songImportKey(a)).toBe(scannedImportKey('Doxology', text));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/songs/importKey.test.ts`
Expected: FAIL — cannot find module `./importKey`.

- [ ] **Step 3: Write minimal implementation**

Replace `src/shared/songs/lyrics.ts` with:

```ts
import type { Song, SongSection } from '../types';

// Flatten sections into a single space-joined lyric blob. Shared by the FTS indexer
// (songsRepo), the in-memory ranker (songScore) and the import dedupe key (importKey) so
// every one of them indexes, searches and compares over identical text.
export const lyricsOfSections = (sections: SongSection[]): string =>
  sections.map((sc) => sc.lines.join(' ')).join(' ');

export const lyricsOf = (s: Song): string => lyricsOfSections(s.sections);
```

Create `src/shared/songs/importKey.ts`:

```ts
import type { Song } from '../types';
import { lyricsOf, lyricsOfSections } from './lyrics';
import { splitToSlides } from './splitToSlides';

// A song is a duplicate when BOTH its title and its lyrics already match. Title alone would
// silently drop a second arrangement of a common hymn title, and that absence would only
// surface mid-service.
const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

const importKey = (title: string, lyrics: string): string =>
  `${normalize(title)}\u0000${normalize(lyrics)}`;

export const songImportKey = (song: Song): string => importKey(song.title, lyricsOf(song));

// Runs the same splitToSlides the repo will run on commit, so the section labels it strips
// are absent from both sides of the comparison. See importKey.test.ts.
export const scannedImportKey = (title: string, text: string): string =>
  importKey(title, lyricsOfSections(splitToSlides(text)));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/songs/importKey.test.ts && npx vitest run src/main/songsRepo.test.ts src/shared/search/songScore.test.ts`
Expected: PASS — the new tests, and no regression in the two suites that consume `lyricsOf`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/songs/importKey.ts src/shared/songs/importKey.test.ts src/shared/songs/lyrics.ts
git commit -m "feat(songs): add the import dedupe key, keyed on title plus lyrics"
```

---

### Task 4: EasyWorship adapter

**Files:**
- Create: `src/main/importSources/types.ts`
- Create: `src/main/importSources/easyworship.ts`
- Create: `src/main/importSources/__fixtures__/make-fixture.py`
- Create (binary, generated): `src/main/importSources/__fixtures__/ew/Songs.db`, `src/main/importSources/__fixtures__/ew/SongWords.db`
- Modify: `src/shared/types.ts` (add the wire types below, near `MediaImportResult` at `:48`)
- Test: `src/main/importSources/easyworship.test.ts`

**Interfaces:**
- Consumes: `rtfToText` (Task 1), `importTidy` (Task 2).
- Produces:
  - In `src/shared/types.ts`:
    ```ts
    export interface ScannedSong { title: string; author: string; text: string }
    export interface UnreadableSong { title: string; reason: string }
    export interface ScanOutcome { songs: ScannedSong[]; unreadable: UnreadableSong[] }
    export interface ImportSourceInfo { id: string; label: string }
    export type LocateFailure = { error: 'no-source-files' | 'canceled'; expected?: string };
    export type Located = { path: string };
    export type LocateResult = Located | LocateFailure;
    ```
  - In `src/main/importSources/types.ts`:
    ```ts
    export interface SourceDb { all<T>(sql: string): T[]; close(): void }
    export interface ImportSource {
      id: string;
      label: string;
      locate(): Promise<LocateResult>;
      scan(located: Located): Promise<ScanOutcome>;
    }
    ```
  - `createEasyWorshipSource(deps?: Partial<EasyWorshipDeps>): ImportSource`

- [ ] **Step 1: Generate the test fixture**

Stock SQLite refuses to *create* a table declaring an unknown collation (`CREATE TABLE … COLLATE UTF8_U_CI` → `no such collation sequence`), so the fixture cannot be built from Node. Python's `sqlite3` can register one. Create `src/main/importSources/__fixtures__/make-fixture.py`:

```python
"""Regenerate the EasyWorship test fixture.

Run: python3 src/main/importSources/__fixtures__/make-fixture.py

Node cannot build this file: better-sqlite3 and node:sqlite both lack a create-collation
API, and SQLite rejects CREATE TABLE with an unregistered collation. The declaration is the
point of the fixture — it is what makes the adapter's collation-safe SQL testable.
"""
import os
import sqlite3

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ew')
os.makedirs(HERE, exist_ok=True)

AMAZING = (
    r'{\rtf1\ansi\ansicpg1252{\fonttbl{\f0\fnil Arial;}}\f0\fs40 '
    r'Verse 1\par Amazing grace! how sweet the sound\par '
    r'That saved a wretch like me\par\par Chorus\par Praise God\par}'
)
BLESSED = (
    r'{\rtf1\ansi{\fonttbl{\f0\fnil Tahoma;}}{\*\generator Riched20 10.0;}'
    r'Verse 1\par Blessed assurance, Jesus is mine\par It\u8217?s a foretaste\par '
    r'caf\'e9 song\par}'
)
EMPTY = r'{\rtf1\ansi{\fonttbl{\f0\fnil Arial;}}\par\par}'


def build(name, ddl, rows):
    path = os.path.join(HERE, name)
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    con.create_collation('UTF8_U_CI', lambda a, b: (a.lower() > b.lower()) - (a.lower() < b.lower()))
    con.execute(ddl)
    con.executemany('INSERT INTO %s VALUES (%s)' % (
        'song' if name == 'Songs.db' else 'word',
        ','.join('?' * len(rows[0])),
    ), rows)
    con.commit()
    con.close()


build(
    'Songs.db',
    'CREATE TABLE song (song_item_uid TEXT, title TEXT COLLATE UTF8_U_CI, '
    'author TEXT COLLATE UTF8_U_CI, copyright TEXT, ccli_no TEXT)',
    [
        ('u1', 'Amazing Grace', 'John Newton', 'Public Domain', '22025'),
        ('u2', 'Blessed Assurance', 'Fanny Crosby', 'Public Domain', '22324'),
        ('u3', 'Empty Song', '', '', ''),
        ('u4', 'No Words Song', '', '', ''),
    ],
)
# EasyWorship indexes title; the index must not make a bare scan fail.
con = sqlite3.connect(os.path.join(HERE, 'Songs.db'))
con.create_collation('UTF8_U_CI', lambda a, b: (a.lower() > b.lower()) - (a.lower() < b.lower()))
con.execute('CREATE INDEX idx_song_title ON song (title)')
con.commit()
con.close()

build(
    'SongWords.db',
    'CREATE TABLE word (song_id INTEGER, words TEXT COLLATE UTF8_U_CI)',
    [(1, AMAZING), (2, BLESSED), (3, EMPTY)],  # rowid 4 deliberately has no lyric row
)
print('fixture written to', HERE)
```

Run it:

```bash
python3 src/main/importSources/__fixtures__/make-fixture.py
```

Verify the hazard is really present in the fixture (this is the whole reason it exists):

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('src/main/importSources/__fixtures__/ew/Songs.db');
console.log('bare scan:', db.prepare('SELECT rowid, title FROM song').all().length, 'rows');
try { db.prepare('SELECT rowid FROM song ORDER BY title').all(); console.log('ORDER BY: NO THROW — fixture is wrong'); }
catch (e) { console.log('ORDER BY throws as expected:', e.message); }
"
```
Expected: `bare scan: 4 rows` and `ORDER BY throws as expected: no such collation sequence: UTF8_U_CI`.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createEasyWorshipSource } from './easyworship';
import type { SourceDb } from './types';

const FIXTURE = join(__dirname, '__fixtures__', 'ew');

// Mirrors the production opener's contract using node:sqlite, so the test never loads
// better-sqlite3 (wrong ABI under stock Node — see testDb.ts).
const openTestSourceDb = (path: string): SourceDb => {
  const db = new DatabaseSync(path);
  return {
    all: <T,>(sql: string) => db.prepare(sql).all() as T[],
    close: () => db.close()
  };
};

const source = (path: string) =>
  createEasyWorshipSource({
    openDb: openTestSourceDb,
    pickFolder: () => Promise.resolve(path)
  });

describe('easyworship source', () => {
  it('reports the two expected files when the folder does not hold them', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'ew-empty-'));
    const located = await source(empty).locate();
    expect(located).toEqual({
      error: 'no-source-files',
      expected: String.raw`C:\Users\Public\Documents\Softouch\EasyWorship\Default\Databases\Data\`
    });
    rmSync(empty, { recursive: true, force: true });
  });

  it('reports cancellation when no folder is chosen', async () => {
    const canceled = createEasyWorshipSource({
      openDb: openTestSourceDb,
      pickFolder: () => Promise.resolve(null)
    });
    expect(await canceled.locate()).toEqual({ error: 'canceled' });
  });

  it('locates a folder holding both databases', async () => {
    expect(await source(FIXTURE).locate()).toEqual({ path: FIXTURE });
  });

  // The reason the fixture declares COLLATE UTF8_U_CI: this fails the moment anyone adds an
  // ORDER BY or WHERE against a text column.
  it('reads songs without tripping the custom collation', async () => {
    const outcome = await source(FIXTURE).scan({ path: FIXTURE });
    expect(outcome.songs.map((s) => s.title)).toEqual(['Amazing Grace', 'Blessed Assurance']);
  });

  it('strips RTF, tidies, and preserves section structure', async () => {
    const outcome = await source(FIXTURE).scan({ path: FIXTURE });
    const amazing = outcome.songs.find((s) => s.title === 'Amazing Grace');
    expect(amazing).toEqual({
      title: 'Amazing Grace',
      author: 'John Newton',
      text: 'Verse 1\nAmazing grace! how sweet the sound\nThat saved a wretch like me\n\nChorus\nPraise God'
    });
  });

  it('decodes unicode and cp1252 escapes in lyrics', async () => {
    const outcome = await source(FIXTURE).scan({ path: FIXTURE });
    const blessed = outcome.songs.find((s) => s.title === 'Blessed Assurance');
    expect(blessed?.text).toContain("It's a foretaste");
    expect(blessed?.text).toContain('caf\u00e9 song');
  });

  it('reports a song whose lyrics vanish after stripping, by name', async () => {
    const outcome = await source(FIXTURE).scan({ path: FIXTURE });
    expect(outcome.unreadable).toContainEqual({
      title: 'Empty Song',
      reason: 'no lyrics left after removing formatting'
    });
  });

  it('reports a song with no lyric row at all, by name', async () => {
    const outcome = await source(FIXTURE).scan({ path: FIXTURE });
    expect(outcome.unreadable).toContainEqual({
      title: 'No Words Song',
      reason: 'no lyrics found'
    });
  });

  it('never opens the source files themselves, and removes its copies', async () => {
    const opened: string[] = [];
    const temps: string[] = [];
    const s = createEasyWorshipSource({
      openDb: (p) => {
        opened.push(p);
        return openTestSourceDb(p);
      },
      pickFolder: () => Promise.resolve(FIXTURE),
      mkdtemp: () => {
        const d = mkdtempSync(join(tmpdir(), 'ew-scan-'));
        temps.push(d);
        return d;
      }
    });
    await s.scan({ path: FIXTURE });
    expect(opened.every((p) => !p.startsWith(FIXTURE))).toBe(true);
    expect(temps.every((d) => !existsSync(d))).toBe(true);
  });

  it('removes its copies even when opening the copy fails', async () => {
    const temps: string[] = [];
    const s = createEasyWorshipSource({
      openDb: () => {
        throw new Error('boom');
      },
      pickFolder: () => Promise.resolve(FIXTURE),
      mkdtemp: () => {
        const d = mkdtempSync(join(tmpdir(), 'ew-fail-'));
        temps.push(d);
        return d;
      }
    });
    await expect(s.scan({ path: FIXTURE })).rejects.toThrow('boom');
    expect(temps.every((d) => !existsSync(d))).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/importSources/easyworship.test.ts`
Expected: FAIL — cannot find module `./easyworship`.

- [ ] **Step 4: Add the wire types**

In `src/shared/types.ts`, immediately after the `MediaImportResult` interface (`:48-52`), add:

```ts
export interface ScannedSong { title: string; author: string; text: string }
export interface UnreadableSong { title: string; reason: string }
export interface ScanOutcome { songs: ScannedSong[]; unreadable: UnreadableSong[] }
export interface ImportSourceInfo { id: string; label: string }
export type Located = { path: string };
export type LocateFailure = { error: 'no-source-files' | 'canceled'; expected?: string };
export type LocateResult = Located | LocateFailure;
```

- [ ] **Step 5: Write the source contract**

Create `src/main/importSources/types.ts`:

```ts
import type { Located, LocateResult, ScanOutcome } from '../../shared/types';

// The seam that makes a second source (CSV, Excel, another projection program) a new module
// plus a registry entry rather than a second import feature. Everything downstream of scan
// operates on ScannedSong[] and never learns where the songs came from.
export interface ImportSource {
  id: string;
  label: string;
  locate(): Promise<LocateResult>;
  scan(located: Located): Promise<ScanOutcome>;
}

// The slice of a database handle the adapters need. Injected so tests can back it with
// node:sqlite while production uses better-sqlite3.
export interface SourceDb {
  all<T>(sql: string): T[];
  close(): void;
}
```

- [ ] **Step 6: Write the adapter**

Create `src/main/importSources/easyworship.ts`:

```ts
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Located, LocateResult, ScanOutcome, ScannedSong, UnreadableSong } from '../../shared/types';
import { rtfToText } from '../../shared/songs/rtfToText';
import { importTidy } from '../../shared/songs/importTidy';
import type { ImportSource, SourceDb } from './types';

const SONGS_DB = 'Songs.db';
const WORDS_DB = 'SongWords.db';

export const EW_DEFAULT_PATH = String.raw`C:\Users\Public\Documents\Softouch\EasyWorship\Default\Databases\Data\`;

interface SongRow { rowid: number; title: string | null; author: string | null }
interface WordRow { song_id: number; words: string | null }

export interface EasyWorshipDeps {
  openDb: (path: string) => SourceDb;
  pickFolder: () => Promise<string | null>;
  mkdtemp: () => string;
  rmTemp: (dir: string) => void;
  exists: (path: string) => boolean;
  copy: (src: string, dest: string) => void;
}

// better-sqlite3 is required lazily: importing it at module scope would load the native
// binary during `npm test`, where it is compiled for the wrong ABI (see testDb.ts).
function defaultOpenDb(path: string): SourceDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const db = new Database(path, { readonly: true, fileMustExist: true });
  return {
    all: <T,>(sql: string) => db.prepare(sql).all() as T[],
    close: () => db.close()
  };
}

async function defaultPickFolder(): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dialog } = require('electron') as typeof import('electron');
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
}

export function createEasyWorshipSource(overrides: Partial<EasyWorshipDeps> = {}): ImportSource {
  const deps: EasyWorshipDeps = {
    openDb: defaultOpenDb,
    pickFolder: defaultPickFolder,
    mkdtemp: () => mkdtempSync(join(tmpdir(), 'helm-ew-')),
    rmTemp: (dir) => rmSync(dir, { recursive: true, force: true }),
    exists: existsSync,
    copy: copyFileSync,
    ...overrides
  };

  return {
    id: 'easyworship',
    label: 'EasyWorship',

    async locate(): Promise<LocateResult> {
      const path = await deps.pickFolder();
      if (!path) return { error: 'canceled' };
      const hasBoth = deps.exists(join(path, SONGS_DB)) && deps.exists(join(path, WORDS_DB));
      return hasBoth ? { path } : { error: 'no-source-files', expected: EW_DEFAULT_PATH };
    },

    async scan(located: Located): Promise<ScanOutcome> {
      // EasyWorship holds its files open, so we work on copies and never open the church's
      // live library for writing.
      const temp = deps.mkdtemp();
      try {
        deps.copy(join(located.path, SONGS_DB), join(temp, SONGS_DB));
        deps.copy(join(located.path, WORDS_DB), join(temp, WORDS_DB));

        const songsDb = deps.openDb(join(temp, SONGS_DB));
        let wordsDb: SourceDb | null = null;
        try {
          wordsDb = deps.openDb(join(temp, WORDS_DB));
          // No WHERE and no ORDER BY: EasyWorship declares COLLATE UTF8_U_CI on its text
          // columns and better-sqlite3 cannot register it, so any comparison or sort throws
          // "no such collation sequence". Sorting happens in JS below.
          const rows = songsDb.all<SongRow>('SELECT rowid, title, author FROM song');
          const words = new Map<number, string>();
          for (const w of wordsDb.all<WordRow>('SELECT song_id, words FROM word')) {
            if (typeof w.words === 'string') words.set(w.song_id, w.words);
          }

          const songs: ScannedSong[] = [];
          const unreadable: UnreadableSong[] = [];
          for (const row of rows) {
            const title = (row.title ?? '').trim() || 'Untitled Song';
            const raw = words.get(row.rowid);
            if (raw === undefined) {
              unreadable.push({ title, reason: 'no lyrics found' });
              continue;
            }
            const text = importTidy(rtfToText(raw));
            if (!text) {
              unreadable.push({ title, reason: 'no lyrics left after removing formatting' });
              continue;
            }
            songs.push({ title, author: (row.author ?? '').trim(), text });
          }
          songs.sort((a, b) => a.title.localeCompare(b.title));
          return { songs, unreadable };
        } finally {
          songsDb.close();
          wordsDb?.close();
        }
      } finally {
        deps.rmTemp(temp);
      }
    }
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/main/importSources/easyworship.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 8: Commit**

```bash
git add src/main/importSources src/shared/types.ts
git commit -m "feat(songs): read an EasyWorship library behind an import-source seam"
```

---

### Task 5: Orchestrator

**Files:**
- Create: `src/main/songImport.ts`
- Modify: `src/shared/types.ts` (add the review/result types below)
- Test: `src/main/songImport.test.ts`

**Interfaces:**
- Consumes: `ImportSource`/`SourceDb` (Task 4), `songImportKey`/`scannedImportKey` (Task 3), `SongsRepo` (`src/main/songsRepo.ts`), `splitToSlides`.
- Produces:
  - In `src/shared/types.ts`:
    ```ts
    export interface ImportReviewRow {
      title: string; author: string; stanzas: number;
      status: 'new' | 'duplicate' | 'unreadable'; reason?: string;
    }
    export interface SongImportScan { token: string; rows: ImportReviewRow[] }
    export type SongImportScanResult = SongImportScan | LocateFailure | { error: 'unknown-source' };
    export interface SongImportResult { imported: number; skipped: number; unreadable: number }
    export interface SongImportProgress { done: number; total: number }
    ```
  - `createSongImport(repo: SongsRepo, sources: ImportSource[], deps?: SongImportDeps): SongImport`
  - `SongImport = { sources(): ImportSourceInfo[]; scan(sourceId: string): Promise<SongImportScanResult>; commit(token: string): SongImportResult }`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openTestDb } from './testDb';
import { createSongsRepo, type SongsRepo } from './songsRepo';
import { createSongImport, type SongImport } from './songImport';
import type { ImportSource } from './importSources/types';
import type { ScanOutcome, SongImportProgress } from '../shared/types';

const AMAZING = 'Verse 1\nAmazing grace! how sweet the sound\n\nChorus\nPraise God';
const BLESSED = 'Verse 1\nBlessed assurance, Jesus is mine';

function fakeSource(outcome: ScanOutcome, id = 'fake'): ImportSource {
  return {
    id,
    label: 'Fake',
    locate: () => Promise.resolve({ path: '/somewhere' }),
    scan: () => Promise.resolve(outcome)
  };
}

const outcome = (songs: ScanOutcome['songs'], unreadable: ScanOutcome['unreadable'] = []): ScanOutcome => ({
  songs,
  unreadable
});

let repo: SongsRepo;
beforeEach(() => {
  repo = createSongsRepo(openTestDb());
});

const build = (source: ImportSource, onProgress?: (p: SongImportProgress) => void): SongImport =>
  createSongImport(repo, [source], onProgress ? { onProgress } : {});

describe('songImport', () => {
  it('lists the registered sources', () => {
    expect(build(fakeSource(outcome([]))).sources()).toEqual([{ id: 'fake', label: 'Fake' }]);
  });

  it('rejects an unknown source id', async () => {
    expect(await build(fakeSource(outcome([]))).scan('nope')).toEqual({ error: 'unknown-source' });
  });

  it('passes a locate failure straight through, without scanning', async () => {
    const scan = vi.fn();
    const failing: ImportSource = {
      id: 'fake',
      label: 'Fake',
      locate: () => Promise.resolve({ error: 'no-source-files', expected: 'X' }),
      scan
    };
    expect(await build(failing).scan('fake')).toEqual({ error: 'no-source-files', expected: 'X' });
    expect(scan).not.toHaveBeenCalled();
  });

  it('reports every scanned song as new, with its stanza count', async () => {
    const result = await build(fakeSource(outcome([{ title: 'Amazing Grace', author: 'Newton', text: AMAZING }]))).scan('fake');
    expect('rows' in result && result.rows).toEqual([
      { title: 'Amazing Grace', author: 'Newton', stanzas: 2, status: 'new' }
    ]);
  });

  it('marks a song already in the library as a duplicate', async () => {
    repo.add({ title: 'Amazing Grace', author: 'Newton', text: AMAZING });
    const imp = build(fakeSource(outcome([{ title: 'Amazing Grace', author: 'Newton', text: AMAZING }])));
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    expect(result.rows[0].status).toBe('duplicate');
    expect(imp.commit(result.token)).toEqual({ imported: 0, skipped: 1, unreadable: 0 });
    expect(repo.count()).toBe(1);
  });

  it('imports two arrangements that share a title', async () => {
    repo.add({ title: 'Amazing Grace', author: 'Newton', text: AMAZING });
    const imp = build(fakeSource(outcome([{ title: 'Amazing Grace', author: 'Other', text: BLESSED }])));
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    expect(result.rows[0].status).toBe('new');
    expect(imp.commit(result.token).imported).toBe(1);
    expect(repo.count()).toBe(2);
  });

  it('collapses duplicates inside the source library itself', async () => {
    const imp = build(
      fakeSource(
        outcome([
          { title: 'Amazing Grace', author: 'Newton', text: AMAZING },
          { title: 'Amazing Grace', author: 'Newton', text: AMAZING }
        ])
      )
    );
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    expect(result.rows.map((r) => r.status)).toEqual(['new', 'duplicate']);
    expect(imp.commit(result.token)).toEqual({ imported: 1, skipped: 1, unreadable: 0 });
  });

  it('carries unreadable songs into the review rows and never imports them', async () => {
    const imp = build(
      fakeSource(outcome([], [{ title: 'Empty Song', reason: 'no lyrics found' }]))
    );
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    expect(result.rows).toEqual([
      { title: 'Empty Song', author: '', stanzas: 0, status: 'unreadable', reason: 'no lyrics found' }
    ]);
    expect(imp.commit(result.token)).toEqual({ imported: 0, skipped: 0, unreadable: 1 });
    expect(repo.count()).toBe(0);
  });

  it('records the source id on imported songs', async () => {
    const imp = build(fakeSource(outcome([{ title: 'Amazing Grace', author: 'Newton', text: AMAZING }])));
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    imp.commit(result.token);
    expect(repo.list()[0].source).toBe('fake');
  });

  it('emits progress for each song committed', async () => {
    const seen: SongImportProgress[] = [];
    const imp = build(
      fakeSource(
        outcome([
          { title: 'A', author: '', text: 'one' },
          { title: 'B', author: '', text: 'two' }
        ])
      ),
      (p) => seen.push(p)
    );
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    imp.commit(result.token);
    expect(seen).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 }
    ]);
  });

  it('keeps importing when one song fails to commit', async () => {
    const imp = build(
      fakeSource(
        outcome([
          { title: 'Good', author: '', text: 'a real line' },
          { title: 'Bad', author: '', text: '' }, // repo.add throws "Song has no content"
          { title: 'Also good', author: '', text: 'another line' }
        ])
      )
    );
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    expect(imp.commit(result.token)).toEqual({ imported: 2, skipped: 0, unreadable: 1 });
    expect(repo.count()).toBe(2);
  });

  it('throws on an unknown or already-spent token', async () => {
    const imp = build(fakeSource(outcome([{ title: 'A', author: '', text: 'x' }])));
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    imp.commit(result.token);
    expect(() => imp.commit(result.token)).toThrow(/token/);
    expect(() => imp.commit('never-issued')).toThrow(/token/);
  });

  it('is idempotent across two full runs', async () => {
    const source = fakeSource(outcome([{ title: 'Amazing Grace', author: 'Newton', text: AMAZING }]));
    const imp = build(source);
    const first = await imp.scan('fake');
    if (!('rows' in first)) throw new Error('expected rows');
    imp.commit(first.token);
    const second = await imp.scan('fake');
    if (!('rows' in second)) throw new Error('expected rows');
    expect(imp.commit(second.token)).toEqual({ imported: 0, skipped: 1, unreadable: 0 });
    expect(repo.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/songImport.test.ts`
Expected: FAIL — cannot find module `./songImport`.

- [ ] **Step 3: Add the wire types**

In `src/shared/types.ts`, after the types added in Task 4:

```ts
export interface ImportReviewRow {
  title: string;
  author: string;
  stanzas: number;
  status: 'new' | 'duplicate' | 'unreadable';
  reason?: string;
}
export interface SongImportScan { token: string; rows: ImportReviewRow[] }
export type SongImportScanResult = SongImportScan | LocateFailure | { error: 'unknown-source' };
export interface SongImportResult { imported: number; skipped: number; unreadable: number }
export interface SongImportProgress { done: number; total: number }
```

- [ ] **Step 4: Write the orchestrator**

Create `src/main/songImport.ts`:

```ts
import { randomUUID } from 'crypto';
import type { SongsRepo } from './songsRepo';
import type { ImportSource } from './importSources/types';
import { scannedImportKey, songImportKey } from '../shared/songs/importKey';
import { splitToSlides } from '../shared/songs/splitToSlides';
import type {
  ImportReviewRow,
  ImportSourceInfo,
  ScannedSong,
  SongImportProgress,
  SongImportResult,
  SongImportScanResult
} from '../shared/types';

export interface SongImportDeps {
  onProgress?: (p: SongImportProgress) => void;
}

export interface SongImport {
  sources(): ImportSourceInfo[];
  scan(sourceId: string): Promise<SongImportScanResult>;
  commit(token: string): SongImportResult;
}

interface Pending {
  sourceId: string;
  songs: ScannedSong[]; // only the rows classified 'new'
  skipped: number;      // duplicates
  unreadable: number;   // could not be read from the source
}

// Source-agnostic: everything here operates on ScannedSong and never learns where the songs
// came from. Adding a source means implementing ImportSource, not touching this file.
export function createSongImport(
  repo: SongsRepo,
  sources: ImportSource[],
  deps: SongImportDeps = {}
): SongImport {
  const emit = deps.onProgress ?? ((): void => {});
  const pending = new Map<string, Pending>();

  return {
    sources: () => sources.map((s) => ({ id: s.id, label: s.label })),

    async scan(sourceId) {
      const source = sources.find((s) => s.id === sourceId);
      if (!source) return { error: 'unknown-source' };

      const located = await source.locate();
      if ('error' in located) return located;

      const outcome = await source.scan(located);

      // Seeded from the library, then grown as we go, so duplicates *within* the source
      // collapse under the same rule.
      const seen = new Set(repo.list().map(songImportKey));

      const rows: ImportReviewRow[] = [];
      const fresh: ScannedSong[] = [];
      let skipped = 0;
      for (const song of outcome.songs) {
        const key = scannedImportKey(song.title, song.text);
        const duplicate = seen.has(key);
        if (duplicate) skipped++;
        else {
          seen.add(key);
          fresh.push(song);
        }
        rows.push({
          title: song.title,
          author: song.author,
          stanzas: splitToSlides(song.text).length,
          status: duplicate ? 'duplicate' : 'new'
        });
      }
      for (const u of outcome.unreadable) {
        rows.push({ title: u.title, author: '', stanzas: 0, status: 'unreadable', reason: u.reason });
      }

      const token = randomUUID();
      pending.set(token, {
        sourceId,
        songs: fresh,
        skipped,
        unreadable: outcome.unreadable.length
      });
      return { token, rows };
    },

    commit(token) {
      const job = pending.get(token);
      if (!job) throw new Error(`songImport.commit: unknown or already-spent token "${token}"`);
      pending.delete(token);

      let imported = 0;
      let unreadable = job.unreadable;
      const total = job.songs.length;
      for (let i = 0; i < total; i++) {
        const song = job.songs[i];
        try {
          // repo.add owns splitToSlides, the insert transaction and the FTS index; going
          // around it yields songs that exist but can never be found by search.
          repo.add({
            title: song.title,
            author: song.author,
            text: song.text,
            source: job.sourceId
          });
          imported++;
        } catch {
          // One bad song must never abort a library migration.
          unreadable++;
        }
        emit({ done: i + 1, total });
      }
      return { imported, skipped: job.skipped, unreadable };
    }
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/songImport.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add src/main/songImport.ts src/main/songImport.test.ts src/shared/types.ts
git commit -m "feat(songs): add the source-agnostic import orchestrator"
```

---

### Task 6: IPC, preload and main wiring

**Files:**
- Modify: `src/shared/types.ts` (`CH` at `:78`, `HelmApi` at `:164`)
- Modify: `src/preload/index.ts` (after the `media` block at `:78-85`)
- Modify: `src/main/ipc.ts` (signature at `:29-41`, handlers after the media block at `:106-110`)
- Modify: `src/main/index.ts` (wiring after `mediaImport` at `:170-174`, and the `registerIpc` call at `:176-188`)

**Interfaces:**
- Consumes: `createSongImport` (Task 5), `createEasyWorshipSource` (Task 4).
- Produces: `window.helm.songImport` with `sources()`, `scan(sourceId)`, `commit(token)`, `onProgress(cb)`.

This task has no unit test of its own — the repo has no IPC-layer tests, and the wiring is proven by typecheck plus the end-to-end run in Task 7. Do not invent one.

- [ ] **Step 1: Add the channels**

In `src/shared/types.ts`, inside the `CH` object (after the media channels at `:109-111`):

```ts
  songImportSources: 'songImport:sources', songImportScan: 'songImport:scan',
  songImportCommit: 'songImport:commit', songImportProgress: 'songImport:progress',
```

- [ ] **Step 2: Add the renderer-facing API type**

In `src/shared/types.ts`, inside `HelmApi` after the `media` block (`:230-237`):

```ts
  songImport: {
    sources(): Promise<ImportSourceInfo[]>;
    scan(sourceId: string): Promise<SongImportScanResult>;
    commit(token: string): Promise<SongImportResult>;
    onProgress(cb: (p: SongImportProgress) => void): () => void;
  };
```

- [ ] **Step 3: Wire the preload bridge**

In `src/preload/index.ts`, after the `media` block:

```ts
  songImport: {
    sources: () => ipcRenderer.invoke(CH.songImportSources),
    scan: (sourceId) => ipcRenderer.invoke(CH.songImportScan, sourceId),
    commit: (token) => ipcRenderer.invoke(CH.songImportCommit, token),
    onProgress: sub(CH.songImportProgress),
  },
```

- [ ] **Step 4: Register the handlers**

In `src/main/ipc.ts`: add `import type { SongImport } from './songImport';`, add a `songImport: SongImport,` parameter to `registerIpc` after `mediaImport`, and add after the media handlers:

```ts
  ipcMain.handle(CH.songImportSources, () => songImport.sources());
  ipcMain.handle(CH.songImportScan, (_e, sourceId: string) => songImport.scan(sourceId));
  ipcMain.handle(CH.songImportCommit, (_e, token: string) => songImport.commit(token));
```

- [ ] **Step 5: Build it in main**

In `src/main/index.ts`, after the `mediaImport` construction:

```ts
  const broadcastSongImportProgress = (p: SongImportProgress): void => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.songImportProgress, p)
  }
  const songImport = createSongImport(repo, [createEasyWorshipSource()], {
    onProgress: broadcastSongImportProgress
  })
```

Add the imports `import { createSongImport } from './songImport'`, `import { createEasyWorshipSource } from './importSources/easyworship'`, and add `SongImportProgress` to the existing type import from `../shared/types`. Pass `songImport` as the final argument to `registerIpc`.

- [ ] **Step 6: Verify the wiring compiles and nothing regressed**

Run: `npm run typecheck && npm test && npx eslint .`
Expected: typecheck clean, all tests pass, no lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/preload/index.ts src/main/ipc.ts src/main/index.ts
git commit -m "feat(songs): expose song import over IPC"
```

---

### Task 7: The wizard and its entry point

**Files:**
- Create: `src/renderer/operator/SongImport.tsx`
- Test: `src/renderer/operator/SongImport.test.tsx`
- Modify: `src/renderer/operator/SongSearchRail.tsx` (props at `:20-36`, button at `:231-233`)
- Modify: `src/renderer/operator/SongsMode.tsx` (state at `:67`, initial-load effect at `:72-86`, rail props at `:407`, modal mount at `:482`)

**Interfaces:**
- Consumes: `window.helm.songImport` (Task 6), `ThemeCtx`.
- Produces: `<SongImport open onClose onImported />`, where `onImported: () => void` tells `SongsMode` to reload the library.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SongImport } from './SongImport';
import { ThemeCtx } from './ThemeCtx';
import { themeFor } from '../../shared/theme';
import type { ImportReviewRow, SongImportScanResult, SongImportResult } from '../../shared/types';

afterEach(cleanup);

const ROWS: ImportReviewRow[] = [
  { title: 'Amazing Grace', author: 'John Newton', stanzas: 2, status: 'new' },
  { title: 'Blessed Assurance', author: 'Fanny Crosby', stanzas: 1, status: 'duplicate' },
  { title: 'Empty Song', author: '', stanzas: 0, status: 'unreadable', reason: 'no lyrics found' }
];

function installHelm(
  scan: SongImportScanResult,
  commit: SongImportResult = { imported: 1, skipped: 1, unreadable: 1 }
): { scan: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn> } {
  const scanFn = vi.fn().mockResolvedValue(scan);
  const commitFn = vi.fn().mockResolvedValue(commit);
  (window as unknown as { helm: unknown }).helm = {
    songImport: {
      sources: () => Promise.resolve([{ id: 'easyworship', label: 'EasyWorship' }]),
      scan: scanFn,
      commit: commitFn,
      onProgress: () => () => {}
    }
  };
  return { scan: scanFn, commit: commitFn };
}

const renderModal = (onImported = vi.fn()) =>
  render(
    <ThemeCtx.Provider value={themeFor(true)}>
      <SongImport open onClose={vi.fn()} onImported={onImported} />
    </ThemeCtx.Provider>
  );

describe('SongImport', () => {
  it('offers the registered sources first', async () => {
    installHelm({ token: 't', rows: ROWS });
    renderModal();
    expect(await screen.findByText('EasyWorship')).toBeTruthy();
  });

  it('shows every scanned song with its status once a source is chosen', async () => {
    installHelm({ token: 't', rows: ROWS });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText('Amazing Grace')).toBeTruthy();
    expect(screen.getByText('Blessed Assurance')).toBeTruthy();
    expect(screen.getByText('Empty Song')).toBeTruthy();
    expect(screen.getByText(/no lyrics found/)).toBeTruthy();
  });

  it('says how many songs will actually be imported', async () => {
    installHelm({ token: 't', rows: ROWS });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText(/Import 1 song/)).toBeTruthy();
  });

  it('surfaces a missing-files error instead of a review list', async () => {
    installHelm({ error: 'no-source-files', expected: 'C:\\somewhere\\Data\\' });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText(/Couldn't find/)).toBeTruthy();
    expect(screen.getByText(/C:\\somewhere\\Data\\/)).toBeTruthy();
  });

  it('returns to the source step silently when the picker is cancelled', async () => {
    installHelm({ error: 'canceled' });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    await waitFor(() => expect(screen.getByText('EasyWorship')).toBeTruthy());
    expect(screen.queryByText(/Couldn't find/)).toBeNull();
  });

  it('commits with the scan token and reports the summary', async () => {
    const helm = installHelm({ token: 'tok-1', rows: ROWS });
    const onImported = vi.fn();
    renderModal(onImported);
    fireEvent.click(await screen.findByText('EasyWorship'));
    fireEvent.click(await screen.findByText(/Import 1 song/));
    await waitFor(() => expect(helm.commit).toHaveBeenCalledWith('tok-1'));
    expect(await screen.findByText(/Imported 1 song/)).toBeTruthy();
    // The rendered strings are "1 song already in Helm." and "1 song couldn't be read." —
    // match what is actually on screen, not a paraphrase of it.
    expect(screen.getByText(/1 song already in Helm/)).toBeTruthy();
    expect(screen.getByText(/1 song couldn't be read/)).toBeTruthy();
    expect(onImported).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    installHelm({ token: 't', rows: ROWS });
    const { container } = render(
      <ThemeCtx.Provider value={themeFor(true)}>
        <SongImport open={false} onClose={vi.fn()} onImported={vi.fn()} />
      </ThemeCtx.Provider>
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/operator/SongImport.test.tsx`
Expected: FAIL — cannot find module `./SongImport`.

- [ ] **Step 3: Write the wizard**

Create `src/renderer/operator/SongImport.tsx`:

```tsx
import { useContext, useEffect, useState, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import { ThemeCtx } from './ThemeCtx';
import type { ImportReviewRow, ImportSourceInfo, SongImportProgress, SongImportResult } from '../../shared/types';

export interface SongImportProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Step =
  | { name: 'source' }
  | { name: 'scanning' }
  | { name: 'error'; message: string; expected?: string }
  | { name: 'review'; token: string; rows: ImportReviewRow[] }
  | { name: 'importing'; done: number; total: number }
  | { name: 'done'; result: SongImportResult };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function SongImport({ open, onClose, onImported }: SongImportProps): JSX.Element | null {
  const T = useContext(ThemeCtx);
  const [sources, setSources] = useState<ImportSourceInfo[]>([]);
  const [step, setStep] = useState<Step>({ name: 'source' });

  useEffect(() => {
    if (!open) return;
    setStep({ name: 'source' });
    let live = true;
    void window.helm.songImport
      .sources()
      .then((s) => {
        if (live) setSources(s);
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return window.helm.songImport.onProgress((p: SongImportProgress) =>
      setStep((s) => (s.name === 'importing' ? { name: 'importing', ...p } : s))
    );
  }, [open]);

  if (!open) return null;

  const chooseSource = (id: string): void => {
    setStep({ name: 'scanning' });
    void window.helm.songImport
      .scan(id)
      .then((result) => {
        if ('rows' in result) {
          setStep({ name: 'review', token: result.token, rows: result.rows });
          return;
        }
        if (result.error === 'canceled') {
          setStep({ name: 'source' }); // the operator backed out; not an error
          return;
        }
        setStep({
          name: 'error',
          message:
            result.error === 'no-source-files'
              ? "Couldn't find Songs.db and SongWords.db in that folder."
              : 'That import source is not available.',
          expected: 'expected' in result ? result.expected : undefined
        });
      })
      .catch((err: unknown) => {
        console.error(err);
        setStep({ name: 'error', message: "Couldn't read that library." });
      });
  };

  const runImport = (token: string, total: number): void => {
    setStep({ name: 'importing', done: 0, total });
    void window.helm.songImport
      .commit(token)
      .then((result) => {
        setStep({ name: 'done', result });
        onImported();
      })
      .catch((err: unknown) => {
        console.error(err);
        setStep({ name: 'error', message: "Couldn't finish the import." });
      });
  };

  const stop = (e: ReactMouseEvent): void => e.stopPropagation();

  const overlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(8,9,12,.6)',
    backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: '4vh 4vw'
  };
  const modalStyle: CSSProperties = {
    width: '760px', maxWidth: '96vw', height: '88vh', background: T.panel,
    borderRadius: '16px', boxShadow: '0 30px 80px rgba(0,0,0,.5)', display: 'flex',
    flexDirection: 'column', overflow: 'hidden', border: `1px solid ${T.border}`
  };
  const headerStyle: CSSProperties = { padding: '16px 22px', borderBottom: `1px solid ${T.hairline}` };
  const bodyStyle: CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 22px' };
  const footerStyle: CSSProperties = {
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px',
    padding: '15px 22px', borderTop: `1px solid ${T.hairline}`
  };
  const sourceBtnStyle: CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '14px 16px', marginBottom: '8px',
    borderRadius: '10px', background: T.panel2, boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '14px', fontWeight: 600, color: T.text
  };
  const rowStyle: CSSProperties = {
    display: 'flex', alignItems: 'baseline', gap: '10px', padding: '8px 12px',
    borderRadius: '8px', background: T.panel2, marginBottom: '5px'
  };
  const badgeStyle = (color: string): CSSProperties => ({
    fontFamily: "'JetBrains Mono',monospace", fontSize: '10px', letterSpacing: '0.06em',
    color, flexShrink: 0
  });
  const cancelStyle: CSSProperties = {
    height: '38px', padding: '0 18px', borderRadius: '10px', background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`, fontSize: '13.5px', color: T.dim
  };
  const primaryStyle: CSSProperties = {
    height: '38px', padding: '0 20px', borderRadius: '10px', background: T.accent,
    color: T.accentInk, fontWeight: 700, fontSize: '13.5px'
  };

  const newCount = step.name === 'review' ? step.rows.filter((r) => r.status === 'new').length : 0;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={stop}>
        <div style={headerStyle}>
          <div style={{ fontWeight: 700, fontSize: '18px' }}>Import songs</div>
          <div style={{ fontSize: '13px', color: T.dim, marginTop: '4px', lineHeight: 1.4 }}>
            Bring an existing song library into Helm. Nothing is saved until you confirm.
          </div>
        </div>

        <div style={bodyStyle}>
          {step.name === 'source' && (
            <>
              <div style={{ fontSize: '12px', color: T.faint, marginBottom: '10px' }}>
                WHICH PROGRAM ARE YOU COMING FROM?
              </div>
              {sources.map((s) => (
                <button key={s.id} style={sourceBtnStyle} onClick={() => chooseSource(s.id)}>
                  {s.label}
                </button>
              ))}
            </>
          )}

          {step.name === 'scanning' && <div style={{ color: T.dim, fontSize: '13px' }}>Reading the library…</div>}

          {step.name === 'error' && (
            <div style={{ fontSize: '13.5px', color: T.live, lineHeight: 1.6 }}>
              <div>{step.message}</div>
              {step.expected && (
                <div style={{ color: T.dim, marginTop: '8px' }}>
                  It is usually at <code>{step.expected}</code>
                </div>
              )}
            </div>
          )}

          {step.name === 'review' && (
            <>
              <div style={{ fontSize: '12px', color: T.faint, marginBottom: '10px' }}>
                FOUND {plural(step.rows.length, 'SONG', 'SONGS').toUpperCase()}
              </div>
              {step.rows.map((r, i) => (
                <div key={`${r.title}-${i}`} style={rowStyle}>
                  <span style={badgeStyle(r.status === 'new' ? T.accent : r.status === 'duplicate' ? T.faint : T.live)}>
                    {r.status === 'new' ? 'NEW' : r.status === 'duplicate' ? 'IN HELM' : 'UNREADABLE'}
                  </span>
                  <span style={{ fontSize: '13.5px', color: T.text, flex: 1, minWidth: 0 }}>{r.title}</span>
                  <span style={{ fontSize: '12px', color: T.dim }}>
                    {r.status === 'unreadable' ? r.reason : `${plural(r.stanzas, 'stanza', 'stanzas')}`}
                  </span>
                </div>
              ))}
            </>
          )}

          {step.name === 'importing' && (
            <div style={{ color: T.dim, fontSize: '13px' }}>
              Importing… {step.done} of {step.total}
            </div>
          )}

          {step.name === 'done' && (
            <div style={{ fontSize: '14px', color: T.text, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700 }}>Imported {plural(step.result.imported, 'song', 'songs')}.</div>
              {step.result.skipped > 0 && (
                <div style={{ color: T.dim }}>{plural(step.result.skipped, 'song', 'songs')} already in Helm.</div>
              )}
              {step.result.unreadable > 0 && (
                <div style={{ color: T.dim }}>{plural(step.result.unreadable, "song couldn't", "songs couldn't")} be read.</div>
              )}
            </div>
          )}
        </div>

        <div style={footerStyle}>
          <button style={cancelStyle} onClick={onClose}>
            {step.name === 'done' ? 'Close' : 'Cancel'}
          </button>
          {step.name === 'review' && newCount > 0 && (
            <button style={primaryStyle} onClick={() => runImport(step.token, newCount)}>
              Import {plural(newCount, 'song', 'songs')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SongImport.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the entry point**

In `src/renderer/operator/SongSearchRail.tsx`, add `onImportSongs: () => void;` to `SongSearchRailProps`, destructure it alongside `onAddSong`, and add a second button beneath the existing one at `:231-233`:

```tsx
        <button style={pasteSongStyle} onClick={onAddSong}>
          + Add a song — search or paste
        </button>
        <button style={pasteSongStyle} onClick={onImportSongs}>
          ↓ Import a song library
        </button>
```

In `src/renderer/operator/SongsMode.tsx`:

1. Import the modal: `import { SongImport } from './SongImport';`
2. Add state beside `quickAddOpen` (`:67`): `const [importOpen, setImportOpen] = useState(false);`
3. Extract the initial-load effect body (`:72-86`) into a reusable loader so the import can reuse it:

```tsx
  const refreshLibrary = useCallback((selectFirst: boolean): Promise<void> => {
    return window.helm.songs
      .list()
      .then((songs) => {
        setLibrary(songs);
        if (selectFirst && songs.length) {
          setActiveSongId(songs[0].id);
          setSection(0);
        }
      })
      .catch(console.error);
  }, []);

  // Initial load: fetch the library and select the first song (seed order = Amazing Grace).
  useEffect(() => {
    void refreshLibrary(true);
  }, [refreshLibrary]);
```

Add `useCallback` to the React import at `:1`.

4. Pass the handler to the rail at `:407`: `onImportSongs={() => setImportOpen(true)}`
5. Mount the modal beside `QuickAdd` at `:482`:

```tsx
      {importOpen && (
        <SongImport
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={() => void refreshLibrary(false)}
        />
      )}
```

- [ ] **Step 6: Verify the whole gate**

Run: `npm test && npm run typecheck && npx eslint .`
Expected: all suites pass, typecheck clean, no lint errors.

- [ ] **Step 7: Verify in the running app**

```bash
python3 src/main/importSources/__fixtures__/make-fixture.py   # if not already generated
npm run dev
```

In Songs mode, click **↓ Import a song library** → **EasyWorship** → choose `src/main/importSources/__fixtures__/ew`. Confirm:
- the review list shows Amazing Grace (NEW, 2 stanzas), Blessed Assurance (NEW), Empty Song and No Words Song (UNREADABLE, with reasons)
- **Import 2 songs** imports them, the summary names the two unreadable ones
- both songs appear in the library list and are findable by search (this proves the FTS index went in)
- running the import a second time reports both as already in Helm and imports nothing

- [ ] **Step 8: Commit**

```bash
git add src/renderer/operator/SongImport.tsx src/renderer/operator/SongImport.test.tsx src/renderer/operator/SongSearchRail.tsx src/renderer/operator/SongsMode.tsx
git commit -m "feat(songs): add the import wizard and its Songs-mode entry point"
```

---

## After the plan

Two follow-ups belong to the Windows session, not to this branch:

1. **Confirm the schema against a real library** — `PRAGMA table_info(song)` / `table_info(word)`, and dump one real `words` blob to see how slide breaks actually appear. If anything differs, only `src/main/importSources/easyworship.ts` changes.
2. **Import the real library against a copy first**, and compare a handful of songs to what EasyWorship shows on screen.

Update the roadmap's *Song library import* entry when this lands, following the pattern of the other shipped entries in `docs/superpowers/roadmap.md`.
