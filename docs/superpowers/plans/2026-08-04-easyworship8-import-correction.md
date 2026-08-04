# EasyWorship 8 Import Correction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the shipped EasyWorship importer against verified EW8 library data — fix the slide split, stop assuming the library's location and schema, and cross-check every song's slide count against the source's own authoritative count.

**Architecture:** The two slide-splitting bugs share one root cause — RTF paragraph structure is flattened to a string before slide rules run. So the RTF scanner starts returning paragraphs, a new pure unit applies EasyWorship's paragraph→slide rules to that array, and the adapter's pipeline becomes `rtfToParagraphs → ewSlideBreaks → importTidy`. `splitToSlides` is shared with hand-entered songs and does not change. Locate becomes a bounded downward search that counts candidates and ranks them, so a stale zero-song library cannot be imported silently.

**Tech Stack:** TypeScript, Electron, `better-sqlite3` (production) / `node:sqlite` (tests), Vitest, React.

**Spec:** [`docs/superpowers/specs/2026-08-04-easyworship8-import-correction-design.md`](../specs/2026-08-04-easyworship8-import-correction-design.md)

## Global Constraints

- **Read-only, always.** Never open the user's library for writing. Scan works on temp copies; the copies are removed in a `finally`.
- **Never issue `WHERE`, `ORDER BY`, `DISTINCT` or `GROUP BY` against a text column** of an EasyWorship table. `title`, `author`, `words`, `copyright`, `tags`, `reference_number` and `filename` are declared `COLLATE UTF8_U_CI`, which `better-sqlite3` cannot register.
- **★ An INDEX SCAN on a collated column throws too, even when the SQL compares no text** — verified during Task 6 against the committed fixture. `SELECT COUNT(*) FROM song` throws `no such collation sequence: UTF8_U_CI`, because SQLite plans it as a scan of `idx_song_title` (an index on a `COLLATE UTF8_U_CI` column) rather than of the table. Real libraries index `title`, `author`, `copyright`, `administrator` and `reference_number`, so this is not hypothetical. Append **`NOT INDEXED`** to any bare-count query: `SELECT COUNT(*) AS n FROM song NOT INDEXED` forces `SCAN song` and works. Plain multi-column projections (`SELECT rowid, title, author FROM song`) are unaffected — they need columns no index covers, so the planner reads the table anyway.
- **Never assume a column, table or file exists.** Two libraries reporting schema `6.5.1.0` differed in 15 columns/tables. Introspect with `PRAGMA table_info` and treat every optional column as nullable.
- **One bad song never aborts a run.** Collect the failure with the song's title, continue, report at the end.
- **`node:sqlite` rejects `CREATE TABLE … COLLATE UTF8_U_CI`** with `no such collation sequence` — verified. New test fixtures built with `DatabaseSync` **must omit the `COLLATE` clause**. The committed binary fixture at `src/main/importSources/__fixtures__/ew/` is the only thing that pins the collation hazard, and it must keep working untouched.
- **These test files must pass unmodified** at every task boundary, as evidence the blast radius is contained: `src/shared/songs/importTidy.test.ts`, `splitToSlides.test.ts`, `importKey.test.ts`, `src/main/songsRepo.test.ts`. (`rtfToText.test.ts` is *appended to* in Task 1 and so is not on this list — but every one of its pre-existing cases must keep passing with its assertions unchanged.)
- Baseline before any change: **62 test files, 526 tests, all passing** (`npm test`).
- Commit messages: concise conventional-commit subject, no `Co-Authored-By` or `Claude-Session` trailers (see `CLAUDE.md`).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/shared/songs/rtfToText.ts` | RTF → text, and RTF → paragraphs. Owns the `\par` vs `\line` distinction. | Modify: scanner returns paragraphs; add `rtfToParagraphs` export |
| `src/shared/songs/ewSlideBreaks.ts` | EasyWorship's paragraph→slide rules. Pure. | **Create** |
| `src/shared/songs/ewSlideBreaks.test.ts` | Rules 1–4 plus both proof cases from the EW8 spec | **Create** |
| `src/main/importSources/easyworship.ts` | The adapter: locate, candidate ranking, scan, schema introspection | Modify (all tasks) |
| `src/main/importSources/easyworship.test.ts` | Adapter tests + new synthetic-library fixtures | Modify |
| `src/shared/types.ts:54,62` | `ScannedSong.sourceStanzas`, `ImportReviewRow.sourceStanzas`, `LocateFailure` variant | Modify |
| `src/main/songImport.ts:69-75` | Carry `sourceStanzas` onto the review row | Modify |
| `src/renderer/operator/SongImport.tsx:89-96,202-212` | Mismatch badge; new locate-error copy | Modify |

`splitToSlides.ts` and `importTidy.ts` are **not** in this table. If a task makes you want to edit either, the boundary was drawn wrong — stop and re-read the spec's §1.

---

### Task 1: `rtfToParagraphs` — stop flattening `\par` and `\line` together

`rtfToText` maps `\par`, `\line` and `\sect` all to `\n`. But `\line` is a *soft* break inside a paragraph and can never break a slide; only `\par` can. This task makes the scanner produce paragraphs, so the distinction survives. `rtfToText`'s output stays byte-identical (paragraphs joined with `\n` reproduces exactly what it emitted before).

**Files:**
- Modify: `src/shared/songs/rtfToText.ts`
- Test: `src/shared/songs/rtfToText.test.ts` (append; existing cases must not change)

**Interfaces:**
- Consumes: nothing
- Produces: `rtfToParagraphs(rtf: string): string[]` — one entry per `\par`/`\sect`, with `\line` rendered as `\n` *inside* an entry. `rtfToText(rtf: string): string` keeps its exact current signature and output.

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/songs/rtfToText.test.ts`. Add `rtfToParagraphs` to the existing import from `./rtfToText`.

```ts
describe('rtfToParagraphs', () => {
  it('splits on \\par but never on \\line', () => {
    expect(rtfToParagraphs('{\\rtf1 one\\line two\\par three\\par}')).toEqual(['one\ntwo', 'three', '']);
  });

  // The trap from EW8 spec §4.3: a control word swallows exactly ONE following space as its
  // delimiter. `\fntnamaut \par` is an empty paragraph (a slide break); `\fntnamaut  \par`
  // has a second space that is content (not a break). Everything in ewSlideBreaks rests on
  // this staying distinguishable.
  it('keeps a one-space paragraph distinct from an empty one', () => {
    expect(rtfToParagraphs('{\\rtf1 a\\par \\fntnamaut \\par \\fntnamaut  \\par}'))
      .toEqual(['a', '', ' ', '']);
  });

  it('does not split on a \\par inside an ignorable destination', () => {
    expect(rtfToParagraphs('{\\rtf1 A{\\*\\pnseclvl1 B\\par C}D\\par}')).toEqual(['AD', '']);
  });

  it('returns an empty array for empty input', () => {
    expect(rtfToParagraphs('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/songs/rtfToText.test.ts`
Expected: FAIL — `rtfToParagraphs is not a function` (or a TS error that it is not exported).

- [ ] **Step 3: Restructure the scanner to produce paragraphs**

In `src/shared/songs/rtfToText.ts`, rename `export function rtfToText` to `function scanParagraphs` and change its return type to `string[]`. Replace the header comment above it, the `out`/`emit` declarations, the `\par` branch, and the `return`:

Replace the declaration block (currently lines 17–27) with:

```ts
// The scanner produces *paragraphs* rather than one flat string, because that distinction is
// the only thing that can separate a slide break from a blank line inside a stanza:
// EasyWorship breaks a slide on an empty `\par` paragraph and never on `\line` (EW8 library
// spec §4.2). Flattening both to "\n" destroys the evidence before anything can act on it.
function scanParagraphs(rtf: string): string[] {
  const paragraphs: string[] = [];
  let out: string[] = [];
  const stack: GroupState[] = [{ skip: false, uc: 1 }];
  let g = stack[0];
  let i = 0;
  let skipChars = 0; // literal characters still to be swallowed after \uN

  const emit = (s: string): void => {
    if (!g.skip) out.push(s);
  };

  // Guarded by `skip` for the same reason `emit` is: a `\par` inside {\*\pnseclvl…} is part of
  // the discarded destination and must not break the lyric.
  const endParagraph = (): void => {
    if (g.skip) return;
    paragraphs.push(out.join(''));
    out = [];
  };
```

Replace the `\par` branch (currently line 116):

```ts
      else if (word === 'par' || word === 'sect') endParagraph();
      else if (word === 'line') emit('\n');
```

Replace the closing `return out.join('');` (currently line 131) with:

```ts
  // Flush unconditionally, not via endParagraph: `out` already holds only non-skipped text, so
  // this mirrors the old `return out.join('')` exactly even when the blob ends mid-destination.
  paragraphs.push(out.join(''));
  return paragraphs;
}

export function rtfToText(rtf: string): string {
  return rtf ? scanParagraphs(rtf).join('\n') : '';
}

/** One entry per `\par`/`\sect`. `\line` stays as a "\n" *within* an entry. */
export function rtfToParagraphs(rtf: string): string[] {
  return rtf ? scanParagraphs(rtf) : [];
}
```

Delete the now-duplicated `if (!rtf) return '';` guard from the top of `scanParagraphs` — both exports guard before calling it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/songs/rtfToText.test.ts`
Expected: PASS — the new cases *and* every pre-existing `rtfToText` case, unmodified. If any pre-existing case changed behaviour, the refactor is wrong; do not edit the test to match.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: 526 tests + 4 new = 530 passing.

- [ ] **Step 6: Commit**

```bash
git add src/shared/songs/rtfToText.ts src/shared/songs/rtfToText.test.ts
git commit -m "feat(songs): expose RTF paragraphs so \\par and \\line stay distinct"
```

---

### Task 2: `ewSlideBreaks` — EasyWorship's paragraph→slide rules

The measured rules from EW8 spec §4.2, which scored 97.65% and 99.55% against the authoritative slide counts of two real libraries.

**Files:**
- Create: `src/shared/songs/ewSlideBreaks.ts`
- Test: `src/shared/songs/ewSlideBreaks.test.ts`

**Interfaces:**
- Consumes: `rtfToParagraphs` output (Task 1) — a `string[]`
- Produces: `ewSlideBreaks(paragraphs: string[]): EwSplit` where `EwSplit` is `{ slideCount: number; text: string }`

- [ ] **Step 1: Write the failing test**

Create `src/shared/songs/ewSlideBreaks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ewSlideBreaks } from './ewSlideBreaks';

describe('ewSlideBreaks', () => {
  it('breaks only on an exactly-empty paragraph', () => {
    expect(ewSlideBreaks(['Verse 1', 'line one', '', 'Chorus', 'line two'])).toEqual({
      slideCount: 2,
      text: 'Verse 1\nline one\n\nChorus\nline two'
    });
  });

  // EW8 spec §4.2 rule 2, proven against Library A song_id 98: EasyWorship records ONE slide
  // for this song, not two. A paragraph holding a single space is content, not a break.
  it('treats a one-space paragraph as content, not a break', () => {
    expect(ewSlideBreaks(['CHORUS', 'line one', ' ', 'line two'])).toEqual({
      slideCount: 1,
      text: 'CHORUS\nline one\nline two'
    });
  });

  it('collapses a run of empty paragraphs into one break', () => {
    expect(ewSlideBreaks(['A', '', '', '', 'B']).slideCount).toBe(2);
  });

  // EW8 spec §4.2 rule 4, proven against Library A song_id 34: the RTF opens with a bare
  // \par and EasyWorship records 6 slides for 5 content sections. The leading empty slide
  // counts, so the comparison against slide_uids lines up — but it is not imported.
  it('counts a leading empty slide but leaves it out of the text', () => {
    expect(ewSlideBreaks(['', 'A', '', 'B'])).toEqual({ slideCount: 3, text: 'A\n\nB' });
  });

  it('drops trailing empty paragraphs without counting a trailing slide', () => {
    expect(ewSlideBreaks(['A', '', ''])).toEqual({ slideCount: 1, text: 'A' });
  });

  it('keeps a \\line-produced newline inside its slide', () => {
    expect(ewSlideBreaks(['A\nB'])).toEqual({ slideCount: 1, text: 'A\nB' });
  });

  it('emits no whitespace-only line, so nothing downstream can reread one as a break', () => {
    const { text } = ewSlideBreaks(['A', '   ', 'B', '', 'C']);
    expect(text).toBe('A\nB\n\nC');
    expect(text.split('\n').some((l) => l !== '' && l.trim() === '')).toBe(false);
  });

  it('preserves leading indentation inside a line', () => {
    expect(ewSlideBreaks(['      houses and lands,']).text).toBe('      houses and lands,');
  });

  it('returns nothing for no paragraphs', () => {
    expect(ewSlideBreaks([])).toEqual({ slideCount: 0, text: '' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/songs/ewSlideBreaks.test.ts`
Expected: FAIL — cannot resolve `./ewSlideBreaks`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/songs/ewSlideBreaks.ts`:

```ts
// EasyWorship's paragraph→slide rules, measured against two real libraries in the EW8 library
// spec §4.2 (97.65% and 99.55% agreement with the authoritative slide_uids count).
//
// This is EasyWorship-specific and deliberately NOT part of importTidy's source-agnostic rule
// set: it encodes one program's convention about what a blank paragraph means. Its output is
// what makes the generic pipeline safe downstream — after this runs, a blank line means a
// slide break and nothing else does, so importTidy and splitToSlides need no special cases.

export interface EwSplit {
  /** Slide count exactly as EasyWorship counts it, including a leading empty slide. This is
   *  the number to compare against the GUID count in `word.slide_uids` — not the section
   *  count Helm ends up with, which omits empty slides. */
  slideCount: number;
  /** Import-ready lyrics: one blank line per slide break, and no other blank lines. */
  text: string;
}

export function ewSlideBreaks(paragraphs: string[]): EwSplit {
  const groups: string[][] = [];
  let current: string[] = [];
  let i = 0;

  while (i < paragraphs.length) {
    if (paragraphs[i] === '') {
      // Rule 1: a paragraph breaks the slide only when it is EXACTLY empty — a paragraph
      // holding a single space is content (spec §4.2 rule 2, Library A song_id 98).
      groups.push(current);
      current = [];
      while (i < paragraphs.length && paragraphs[i] === '') i++; // Rule 2: a run is one break
    } else {
      current.push(paragraphs[i]);
      i++;
    }
  }
  groups.push(current);

  // Rule 4: trailing empties yield no trailing slide. Rule 3 — a leading break still yields a
  // leading (empty) slide — needs no code: the empty `current` pushed at the first break is it.
  while (groups.length > 0 && groups[groups.length - 1].length === 0) groups.pop();

  // A paragraph can hold "\n" from a \line soft break, so flatten before filtering. Dropping
  // whitespace-only lines is the point: they carry no lyric, splitToSlides would discard them
  // anyway, and leaving one in would hand downstream code a second chance to misread it as a
  // break. Leading indentation inside a line is left alone — splitToSlides owns that choice.
  const slides = groups.map((g) =>
    g.flatMap((p) => p.split('\n')).filter((l) => l.trim() !== '').join('\n')
  );

  return { slideCount: groups.length, text: slides.filter((s) => s !== '').join('\n\n') };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/songs/ewSlideBreaks.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/songs/ewSlideBreaks.ts src/shared/songs/ewSlideBreaks.test.ts
git commit -m "feat(songs): add EasyWorship's measured paragraph-to-slide rules"
```

---

### Task 3: Rewire the adapter's lyric pipeline

Switch the adapter to `rtfToParagraphs → ewSlideBreaks → importTidy`, delete the multi-`word`-row append (disproven: `word_song_id` is a UNIQUE index and the spec verified 1:1 with no orphans in either direction, in both libraries), and collapse internal whitespace runs in titles (869 of 1,997 titles in Library A have them).

**Files:**
- Modify: `src/main/importSources/easyworship.ts:140-177`
- Test: `src/main/importSources/easyworship.test.ts`

**Interfaces:**
- Consumes: `rtfToParagraphs` (Task 1), `ewSlideBreaks` (Task 2)
- Produces: no signature change. `ScanOutcome.songs[].text` is now split by EasyWorship's rules.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('easyworship source', …)` block in `src/main/importSources/easyworship.test.ts`. `fakeSource` is already defined at the top of that file.

```ts
  it('does not break a slide on a paragraph holding a single space', async () => {
    // \fntnamaut swallows one space as its delimiter, so the second space is content.
    const rtf = '{\\rtf1 CHORUS\\par line one\\par \\fntnamaut  \\par line two\\par}';
    const outcome = await fakeSource(
      [{ rowid: 1, title: 'Spacer', author: '' }],
      [{ song_id: 1, words: rtf }]
    ).scan({ path: '/src' });
    expect(outcome.songs[0].text).toBe('CHORUS\nline one\nline two');
  });

  it('does not break a slide on a doubled \\line', async () => {
    const rtf = '{\\rtf1 Verse 1\\par first\\line\\line second\\par}';
    const outcome = await fakeSource(
      [{ rowid: 1, title: 'Soft', author: '' }],
      [{ song_id: 1, words: rtf }]
    ).scan({ path: '/src' });
    expect(outcome.songs[0].text).toBe('Verse 1\nfirst\nsecond');
  });

  it('collapses runs of internal whitespace in a title', async () => {
    const outcome = await fakeSource(
      [{ rowid: 1, title: 'A Child Of The King      (Eb)  ', author: '' }],
      [{ song_id: 1, words: '{\\rtf1 words\\par}' }]
    ).scan({ path: '/src' });
    expect(outcome.songs[0].title).toBe('A Child Of The King (Eb)');
  });

  it('keeps the first word row and never fuses two songs when song_id repeats', async () => {
    // word_song_id is UNIQUE, so this cannot happen in a real library — but if it ever did,
    // silently concatenating two songs is the one outcome nobody would catch in review.
    const outcome = await fakeSource(
      [{ rowid: 1, title: 'First', author: '' }],
      [
        { song_id: 1, words: '{\\rtf1 keep me\\par}' },
        { song_id: 1, words: '{\\rtf1 not me\\par}' }
      ]
    ).scan({ path: '/src' });
    expect(outcome.songs[0].text).toBe('keep me');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/importSources/easyworship.test.ts`
Expected: FAIL — the space test yields `'CHORUS\nline one\n\nline two'`, the `\line` test yields `'Verse 1\nfirst\n\nsecond'`, the title test keeps six spaces, and the collision test yields `'keep me\n\nnot me'`.

- [ ] **Step 2b: Delete the two tests that pin the disproven append**

`src/main/importSources/easyworship.test.ts` contains two pre-existing tests that assert the
opposite of the new `'keeps the first word row…'` test, for the identical input shape:

- `'appends rather than overwrites when a song has more than one word row'`
- `'assembles multi-row stanzas in rowid order, even when rows arrive in a different order'`

**Delete both.** They were written against the original design's explicitly *unverified* guess
that `word` might store one row per stanza. The EW8 spec disproves it: `SongWords.db` declares
`CREATE UNIQUE INDEX word_song_id ON word (song_id)`, and both real libraries were 1:1 with no
orphans in either direction (1,997↔1,997 and 223↔223). The behaviour they pin cannot occur, and
if it ever did it would silently fuse two songs.

Coverage is not lost — it is deliberately inverted. The new `'keeps the first word row and never
fuses two songs when song_id repeats'` test covers the same input with the correct expectation.

This is the only pre-existing adapter test deletion in the plan. The four shared-unit test files
in Global Constraints remain untouchable.

- [ ] **Step 3: Rewrite the scan body**

In `src/main/importSources/easyworship.ts`, change the import on line 5 from `rtfToText` to `rtfToParagraphs`, and add the `ewSlideBreaks` import:

```ts
import { rtfToParagraphs } from '../../shared/songs/rtfToText';
import { ewSlideBreaks } from '../../shared/songs/ewSlideBreaks';
```

Replace the whole block from `const rows = songsDb.all<SongRow>(…)` through `songs.sort(…)` (currently lines 140–178) with:

```ts
          const rows = songsDb.all<SongRow>('SELECT rowid, title, author FROM song');
          // Exactly one `word` row per song: SongWords.db declares
          // `CREATE UNIQUE INDEX word_song_id ON word (song_id)`, and the EW8 library spec
          // verified 1:1 with no orphans in either direction across both real libraries
          // (1,997↔1,997 and 223↔223). No ORDER BY is needed, and appending on a repeat would
          // fuse two songs — so a repeat keeps the first row and discards the rest.
          const words = new Map<number, string>();
          for (const w of wordsDb.all<WordRow>('SELECT song_id, words FROM word')) {
            const text = wordsToText(w.words);
            if (text === undefined || words.has(w.song_id)) continue;
            words.set(w.song_id, text);
          }

          const songs: ScannedSong[] = [];
          const unreadable: UnreadableSong[] = [];
          for (const row of rows) {
            // 869 of 1,997 titles in one real library carry runs of two or more spaces
            // ('A Child Of The King      (Eb)'). Collapse for display and matching; the
            // EasyWorship library still holds the original if it is ever wanted.
            const title = (row.title ?? '').replace(/\s+/g, ' ').trim() || 'Untitled Song';
            const raw = words.get(row.rowid);
            if (raw === undefined) {
              unreadable.push({ title, reason: 'no lyrics found' });
              continue;
            }
            const { text: joined } = ewSlideBreaks(rtfToParagraphs(raw));
            const text = importTidy(joined);
            if (!text) {
              unreadable.push({ title, reason: 'no lyrics left after removing formatting' });
              continue;
            }
            songs.push({ title, author: (row.author ?? '').trim(), text });
          }
          songs.sort((a, b) => a.title.localeCompare(b.title));
```

Then update the `WordRow` interface on line 27 to drop the now-unread `rowid`:

```ts
interface WordRow { song_id: number; words: string | Uint8Array | null }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/importSources/easyworship.test.ts`
Expected: PASS, including every pre-existing adapter test unchanged.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all passing. If `songImport.test.ts` or `songsRepo.test.ts` broke, the pipeline change leaked past the adapter — investigate rather than editing those tests.

- [ ] **Step 6: Commit**

```bash
git add src/main/importSources/easyworship.ts src/main/importSources/easyworship.test.ts
git commit -m "fix(songs): split EasyWorship slides on empty paragraphs, not blank lines"
```

---

### Task 4: Schema introspection and the `slide_uids` cross-check

Build the column list at runtime (spec §2.4: two libraries reporting the same schema version differed in 15 columns), and compare our split against `word.slide_uids` — the authoritative slide count, already sitting in a row we read.

**Files:**
- Modify: `src/main/importSources/easyworship.ts`
- Modify: `src/shared/types.ts:54`
- Test: `src/main/importSources/easyworship.test.ts`

**Interfaces:**
- Consumes: `ewSlideBreaks(...).slideCount` (Task 2)
- Produces: `ScannedSong` gains `sourceStanzas?: number` — set **only** when the source reports an authoritative slide count that disagrees with what the source's own rules produced. Absent means "nothing to review", never "zero".

- [ ] **Step 1: Write the failing tests**

First add the fixture builder near the top of `src/main/importSources/easyworship.test.ts`, after the `openTestSourceDb` definition. Extend the `fs` import to include `mkdirSync`.

```ts
// Builds a real on-disk EasyWorship-shaped library. Unlike the committed binary fixture, the
// column set is parameterised, which is the only way to test the schema drift the EW8 spec
// found between two libraries both reporting schema 6.5.1.0.
//
// NOTE: no `COLLATE UTF8_U_CI` here — node:sqlite rejects CREATE TABLE with an unregistered
// collation ("no such collation sequence"). The committed __fixtures__/ew library is what
// pins the collation hazard; these fixtures pin column presence.
interface FixtureSong {
  title: string;
  author?: string;
  rtf?: string;
  slideUids?: string;
  /** song.presentation_id — > 0 means the song carries a laid-out slide set. */
  layout?: number;
}

const makeLibrary = (
  dir: string,
  songs: FixtureSong[],
  opts: { presentationId?: boolean; slideUids?: boolean } = {}
): string => {
  mkdirSync(dir, { recursive: true });
  const withPid = opts.presentationId !== false;
  const withUids = opts.slideUids !== false;

  const s = new DatabaseSync(join(dir, SONGS_DB_NAME));
  s.exec(
    'CREATE TABLE song (rowid integer PRIMARY KEY AUTOINCREMENT NOT NULL UNIQUE, ' +
      `title text NOT NULL, author text${withPid ? ', presentation_id integer' : ''})`
  );
  const insertSong = s.prepare(
    withPid
      ? 'INSERT INTO song (title, author, presentation_id) VALUES (?, ?, ?)'
      : 'INSERT INTO song (title, author) VALUES (?, ?)'
  );
  songs.forEach((song) =>
    withPid
      ? insertSong.run(song.title, song.author ?? '', song.layout ?? 0)
      : insertSong.run(song.title, song.author ?? '')
  );
  s.close();

  const w = new DatabaseSync(join(dir, WORDS_DB_NAME));
  w.exec(
    'CREATE TABLE word (rowid integer PRIMARY KEY NOT NULL UNIQUE, song_id integer, ' +
      `words rtf${withUids ? ', slide_uids text' : ''})`
  );
  const insertWord = w.prepare(
    withUids
      ? 'INSERT INTO word (song_id, words, slide_uids) VALUES (?, ?, ?)'
      : 'INSERT INTO word (song_id, words) VALUES (?, ?)'
  );
  songs.forEach((song, i) => {
    const args: unknown[] = [i + 1, song.rtf ?? '{\\rtf1 words\\par}'];
    if (withUids) args.push(song.slideUids ?? '1-A');
    insertWord.run(...(args as [number, string, string?]));
  });
  w.close();
  return dir;
};

const tempLibrary = (name: string): string => join(mkdtempSync(join(tmpdir(), `ew-${name}-`)), 'Data');
```

Then append these tests inside the `describe` block:

```ts
  it('flags a song whose split disagrees with the source slide count', async () => {
    const dir = makeLibrary(tempLibrary('uids'), [
      // Two slides by our rules; EasyWorship claims three.
      { title: 'Disagrees', rtf: '{\\rtf1 A\\par \\par B\\par}', slideUids: '1-A,1-B,1-C' },
      { title: 'Agrees', rtf: '{\\rtf1 A\\par \\par B\\par}', slideUids: '1-A,1-B' }
    ]);
    const outcome = await source(dir).scan({ path: dir });
    expect(outcome.songs.find((s) => s.title === 'Disagrees')?.sourceStanzas).toBe(3);
    expect(outcome.songs.find((s) => s.title === 'Agrees')).not.toHaveProperty('sourceStanzas');
    rmSync(dir, { recursive: true, force: true });
  });

  it('imports normally when the slide_uids column is absent', async () => {
    const dir = makeLibrary(tempLibrary('nouids'), [{ title: 'Bare' }], { slideUids: false });
    const outcome = await source(dir).scan({ path: dir });
    expect(outcome.songs).toHaveLength(1);
    expect(outcome.songs[0]).not.toHaveProperty('sourceStanzas');
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts how many songs carry an EasyWorship layout', async () => {
    // This number decides whether Path A (exact slides from PresentationLayouts.db) is worth
    // building at all: real libraries ranged from 22% coverage to zero.
    const dir = makeLibrary(tempLibrary('layouts'), [
      { title: 'Laid Out', layout: 17 },
      { title: 'Plain', layout: 0 },
      { title: 'Also Plain', layout: 0 }
    ]);
    const outcome = await source(dir).scan({ path: dir });
    expect(outcome.withLayouts).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('imports normally, with no layout count, when presentation_id is absent', async () => {
    // The older schema in the EW8 spec §2.4 has no song.presentation_id, while reporting the
    // same schema version as one that does. Absent must mean "unknown", not "zero".
    const dir = makeLibrary(tempLibrary('nopid'), [{ title: 'Old Schema' }], { presentationId: false });
    const outcome = await source(dir).scan({ path: dir });
    expect(outcome.songs.map((s) => s.title)).toEqual(['Old Schema']);
    expect(outcome.withLayouts).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('ignores an unparseable slide_uids value rather than failing the song', async () => {
    const dir = makeLibrary(tempLibrary('baduids'), [{ title: 'Junk', slideUids: '' }]);
    const outcome = await source(dir).scan({ path: dir });
    expect(outcome.songs[0].title).toBe('Junk');
    expect(outcome.songs[0]).not.toHaveProperty('sourceStanzas');
    rmSync(dir, { recursive: true, force: true });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/importSources/easyworship.test.ts`
Expected: FAIL — `sourceStanzas` is `undefined` on the disagreeing song, and the two missing-column cases throw `no such column`.

- [ ] **Step 3: Add `sourceStanzas` and `withLayouts` to the shared types**

In `src/shared/types.ts`, replace lines 54 and 56:

```ts
export interface ScannedSong {
  title: string;
  author: string;
  text: string;
  /** The slide count the source itself reports, present only when it disagrees with what the
   *  adapter's own parse produced. A song to look at, not a song to drop. */
  sourceStanzas?: number;
}
```

```ts
export interface ScanOutcome {
  songs: ScannedSong[];
  unreadable: UnreadableSong[];
  /** How many songs carry a laid-out slide set in the source. Absent means the source cannot
   *  say — never zero. This is the measurement that decides whether importing those exact
   *  layouts is worth building. */
  withLayouts?: number;
}
```

- [ ] **Step 4: Implement introspection and the cross-check**

In `src/main/importSources/easyworship.ts`, update the row interfaces (lines 26–27):

```ts
interface SongRow {
  rowid: number;
  title: string | null;
  author: string | null;
  presentation_id?: number | null;
}
interface WordRow { song_id: number; words: string | Uint8Array | null; slide_uids?: string | null }
```

Add this helper just above `createEasyWorshipSource`:

```ts
// EW8 spec §2.4 is emphatic: two libraries both reporting data schema 6.5.1.0 differed in 15
// columns and tables, so a version string never implies a shape. Build every optional column
// into the SELECT at runtime and treat it as nullable when absent.
function columnsOf(db: SourceDb, table: string): Set<string> {
  try {
    return new Set(db.all<{ name: string }>(`PRAGMA table_info('${table}')`).map((c) => c.name));
  } catch {
    return new Set();
  }
}

// `slide_uids` is a comma-separated GUID list, one per slide — the authoritative count, free.
// Anything unparseable yields null, which means "no cross-check for this song", never zero.
function slideUidCount(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const n = value.split(',').filter((s) => s.trim() !== '').length;
  return n > 0 ? n : null;
}
```

Replace the two `SELECT`s and the per-song loop body added in Task 3:

```ts
          const songCols = columnsOf(songsDb, 'song');
          const wordCols = columnsOf(wordsDb, 'word');
          const hasUids = wordCols.has('slide_uids');
          const hasLayouts = songCols.has('presentation_id');
          const songSelect = [
            'rowid',
            'title',
            songCols.has('author') ? 'author' : "'' AS author",
            ...(hasLayouts ? ['presentation_id'] : [])
          ];
          const wordSelect = ['song_id', 'words', ...(hasUids ? ['slide_uids'] : [])];

          const rows = songsDb.all<SongRow>(`SELECT ${songSelect.join(', ')} FROM song`);
          const words = new Map<number, WordRow>();
          for (const w of wordsDb.all<WordRow>(`SELECT ${wordSelect.join(', ')} FROM word`)) {
            if (!words.has(w.song_id)) words.set(w.song_id, w);
          }
```

and inside the per-song loop, replace the lookup and push:

```ts
            const wordRow = words.get(row.rowid);
            const raw = wordRow === undefined ? undefined : wordsToText(wordRow.words);
            if (raw === undefined) {
              unreadable.push({ title, reason: 'no lyrics found' });
              continue;
            }
            const { slideCount, text: joined } = ewSlideBreaks(rtfToParagraphs(raw));
            const text = importTidy(joined);
            if (!text) {
              unreadable.push({ title, reason: 'no lyrics left after removing formatting' });
              continue;
            }
            // Compare EasyWorship's count against OUR count of the same thing — both include
            // empty slides. Helm's eventual section count is a different, smaller number, and
            // comparing against that would flag hundreds of songs that are perfectly fine.
            const expected = hasUids ? slideUidCount(wordRow?.slide_uids) : null;
            songs.push({
              title,
              author: (row.author ?? '').trim(),
              text,
              ...(expected !== null && expected !== slideCount ? { sourceStanzas: expected } : {})
            });
```

Note the `words` map now holds `WordRow`, not `string` — the Task 3 `wordsToText`/`words.has` guard moves into the loop above as shown.

Finally, replace the `return { songs, unreadable };` at the end of `scan` with:

```ts
          // Counted over every row, not just the importable ones, because this is a fact about
          // the source library rather than about this run. Omitted entirely when the column is
          // absent: "unknown" and "none" are different answers, and a zero here would wrongly
          // retire the question of whether to import EasyWorship's exact layouts.
          const withLayouts = hasLayouts
            ? rows.filter((r) => (r.presentation_id ?? 0) > 0).length
            : undefined;
          return { songs, unreadable, ...(withLayouts === undefined ? {} : { withLayouts }) };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/main/importSources/easyworship.test.ts`
Expected: PASS, all cases including the four new ones.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add src/main/importSources/easyworship.ts src/main/importSources/easyworship.test.ts src/shared/types.ts
git commit -m "feat(songs): cross-check imported slides against EasyWorship's own count"
```

---

### Task 5: Surface the mismatch in review

Carry `sourceStanzas` from the scan through the orchestrator onto the review row, and show it. Status stays a three-value enum — a song can be `new` *and* disagree, so this is a separate field, not a fourth status.

**Files:**
- Modify: `src/shared/types.ts:62-69`
- Modify: `src/main/songImport.ts:69-75,92`
- Modify: `src/renderer/operator/SongImport.tsx:19,82,199-212`
- Test: `src/main/songImport.test.ts`, `src/renderer/operator/SongImport.test.tsx`

**Interfaces:**
- Consumes: `ScannedSong.sourceStanzas` and `ScanOutcome.withLayouts` (Task 4)
- Produces: `ImportReviewRow.sourceStanzas?: number`, `SongImportScan.withLayouts?: number`

- [ ] **Step 1: Write the failing tests**

Append to `src/main/songImport.test.ts`, inside its top-level `describe`. The file already defines `fakeSource(outcome, id?)`, `outcome(songs, unreadable?)`, `build(source, onProgress?)` and a `repo` set in `beforeEach` — use those, do not add new helpers.

```ts
  it('carries a source slide-count disagreement onto the review row', async () => {
    const result = await build(
      fakeSource(
        outcome([
          { title: 'Flagged', author: '', text: AMAZING, sourceStanzas: 3 },
          { title: 'Clean', author: '', text: BLESSED }
        ])
      )
    ).scan('fake');
    if (!('rows' in result)) throw new Error('expected a scan result');
    expect(result.rows.find((r) => r.title === 'Flagged')?.sourceStanzas).toBe(3);
    expect(result.rows.find((r) => r.title === 'Clean')?.sourceStanzas).toBeUndefined();
  });

  it('imports a flagged song rather than skipping it', async () => {
    const imp = build(
      fakeSource(outcome([{ title: 'Flagged', author: '', text: AMAZING, sourceStanzas: 3 }]))
    );
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected a scan result');
    expect(result.rows[0].status).toBe('new');
    expect(imp.commit(result.token).imported).toBe(1);
  });

  it('passes the source layout count through to the scan result', async () => {
    const withLayouts = { ...outcome([{ title: 'A', author: '', text: AMAZING }]), withLayouts: 7 };
    const result = await build(fakeSource(withLayouts)).scan('fake');
    expect('withLayouts' in result && result.withLayouts).toBe(7);
  });
```

> The existing test *"reports every scanned song as new, with its stanza count"* asserts
> `rows` with `toEqual` against an exact object. The conditional spread in Step 4 adds no key
> when `sourceStanzas` is undefined, so that test keeps passing unmodified — if it starts
> failing, the spread was written as an unconditional assignment.

Append to `src/renderer/operator/SongImport.test.tsx`. That file already defines
`installHelm(scan, commit?)` and `renderModal(onImported?)`; the review step is reached by
clicking the source button.

```ts
  it('marks a row whose stanza count disagrees with the source', async () => {
    installHelm({
      token: 't',
      rows: [
        { title: 'Flagged', author: '', stanzas: 2, status: 'new', sourceStanzas: 3 },
        { title: 'Clean', author: '', stanzas: 2, status: 'new' }
      ]
    });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText('CHECK')).toBeTruthy();
    expect(screen.getByText('2 stanzas · EasyWorship counts 3')).toBeTruthy();
    expect(screen.getByText('2 stanzas')).toBeTruthy();
  });

  it('reports how many songs carry a layout in the source', async () => {
    installHelm({ token: 't', rows: ROWS, withLayouts: 438 });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText(/438 WITH EASYWORSHIP LAYOUTS/)).toBeTruthy();
  });

  it('says nothing about layouts when the source cannot report them', async () => {
    installHelm({ token: 't', rows: ROWS });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    await screen.findByText('Amazing Grace');
    expect(screen.queryByText(/LAYOUTS/)).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/songImport.test.ts src/renderer/operator/SongImport.test.tsx`
Expected: FAIL — `sourceStanzas` is undefined on the row, and `CHECK` is not in the document.

- [ ] **Step 3: Add the fields to the review types**

In `src/shared/types.ts`, replace the `ImportReviewRow` interface and the `SongImportScan`
line (lines 62–69):

```ts
export interface ImportReviewRow {
  title: string;
  author: string;
  stanzas: number;
  status: 'new' | 'duplicate' | 'unreadable';
  reason?: string;
  /** The source's own slide count, present only when it disagrees with ours. Orthogonal to
   *  `status`: a song can be `new` and still be worth a second look. */
  sourceStanzas?: number;
}
export interface SongImportScan {
  token: string;
  rows: ImportReviewRow[];
  /** How many songs carry a laid-out slide set in the source, when the source can say. */
  withLayouts?: number;
}
```

- [ ] **Step 4: Carry both through the orchestrator**

In `src/main/songImport.ts`, replace the `rows.push({…})` call (lines 69–74):

```ts
        rows.push({
          title: song.title,
          author: song.author,
          stanzas: splitToSlides(song.text).length,
          status: duplicate ? 'duplicate' : 'new',
          ...(song.sourceStanzas === undefined ? {} : { sourceStanzas: song.sourceStanzas })
        });
```

and replace the `return { token, rows };` at the end of `scan` (line 92):

```ts
      return { token, rows, ...(outcome.withLayouts === undefined ? {} : { withLayouts: outcome.withLayouts }) };
```

- [ ] **Step 5: Render the badge and the layout count**

In `src/renderer/operator/SongImport.tsx`, widen the review step type (line 19):

```ts
  | { name: 'review'; token: string; rows: ImportReviewRow[]; withLayouts?: number }
```

carry it when entering the step (line 82):

```tsx
          setStep({
            name: 'review',
            token: result.token,
            rows: result.rows,
            ...(result.withLayouts === undefined ? {} : { withLayouts: result.withLayouts })
          });
```

replace the review header (lines 199–201):

```tsx
              <div style={{ fontSize: '12px', color: T.faint, marginBottom: '10px' }}>
                FOUND {plural(step.rows.length, 'SONG', 'SONGS').toUpperCase()}
                {step.withLayouts !== undefined && step.withLayouts > 0 &&
                  ` · ${step.withLayouts.toLocaleString()} WITH EASYWORSHIP LAYOUTS`}
              </div>
```

and replace the review row body (lines 203–211):

```tsx
                <div key={`${r.title}-${i}`} style={rowStyle}>
                  <span style={badgeStyle(r.status === 'new' ? T.accent : r.status === 'duplicate' ? T.faint : T.live)}>
                    {r.status === 'new' ? 'NEW' : r.status === 'duplicate' ? 'IN HELM' : 'UNREADABLE'}
                  </span>
                  {r.sourceStanzas !== undefined && <span style={badgeStyle(T.scripture)}>CHECK</span>}
                  <span style={{ fontSize: '13.5px', color: T.text, flex: 1, minWidth: 0 }}>{r.title}</span>
                  <span style={{ fontSize: '12px', color: T.dim }}>
                    {r.status === 'unreadable'
                      ? r.reason
                      : r.sourceStanzas !== undefined
                        ? `${plural(r.stanzas, 'stanza', 'stanzas')} · EasyWorship counts ${r.sourceStanzas}`
                        : plural(r.stanzas, 'stanza', 'stanzas')}
                  </span>
                </div>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/main/songImport.test.ts src/renderer/operator/SongImport.test.tsx`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all passing.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/main/songImport.ts src/main/songImport.test.ts src/renderer/operator/SongImport.tsx src/renderer/operator/SongImport.test.tsx
git commit -m "feat(songs): flag imported songs whose slide count disagrees with the source"
```

---

### Task 6: Locate — bounded search, ranking, and a picker

`EW_DEFAULT_PATH` currently points at `…\EasyWorship\Default\Databases\Data\`, which omits the version directory and so cannot exist. None of the three variable segments may be assumed: the profile may be `Default_1`, the version directory may be `v6.1` or `v6.1.2`, and **a version directory can hold a complete schema with zero songs** — the trap this task exists to close, because importing it succeeds and yields nothing.

**Files:**
- Modify: `src/main/importSources/easyworship.ts`
- Modify: `src/shared/types.ts:59`
- Modify: `src/renderer/operator/SongImport.tsx:89-96`
- Test: `src/main/importSources/easyworship.test.ts`, `src/renderer/operator/SongImport.test.tsx`

**Interfaces:**
- Consumes: `makeLibrary` / `tempLibrary` test helpers (Task 4)
- Produces: `EW_ROOT`, `EW_DEFAULT_PATH` (a shape hint, not a real path); `EasyWorshipDeps` gains `listDir`, `readText`, `pickCandidate`; `LocateFailure['error']` gains `'all-candidates-empty'`

- [ ] **Step 1: Write the failing tests**

Append to `src/main/importSources/easyworship.test.ts`. Extend the `fs` import with `writeFileSync` if not already present (it is).

```ts
  it('finds a library nested below the folder the operator picked', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-nested-'));
    const data = join(root, 'Default_1', 'v6.1', 'Databases', 'Data');
    makeLibrary(data, [{ title: 'Nested' }]);
    expect(await source(root).locate()).toEqual({ path: data });
    rmSync(root, { recursive: true, force: true });
  });

  it('ignores a library buried in Archive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-archive-'));
    makeLibrary(join(root, 'Default', 'v6.1', 'Databases', 'Archive'), [{ title: 'Stale' }]);
    expect(await source(root).locate()).toEqual({
      error: 'no-source-files',
      expected: EW_DEFAULT_PATH
    });
    rmSync(root, { recursive: true, force: true });
  });

  it('skips a candidate that has zero songs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-empty-cand-'));
    makeLibrary(join(root, 'Default_1', 'v6.1.2', 'Databases', 'Data'), []);
    const live = join(root, 'Default_1', 'v6.1', 'Databases', 'Data');
    makeLibrary(live, [{ title: 'Real' }]);
    // Only one non-empty candidate remains, so no picker is shown.
    expect(await source(root).locate()).toEqual({ path: live });
    rmSync(root, { recursive: true, force: true });
  });

  it('reports the empty-library case distinctly from a missing one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-all-empty-'));
    makeLibrary(join(root, 'Default', 'v6.1', 'Databases', 'Data'), []);
    expect(await source(root).locate()).toEqual({
      error: 'all-candidates-empty',
      expected: EW_DEFAULT_PATH
    });
    rmSync(root, { recursive: true, force: true });
  });

  it('asks which library to use when more than one holds songs, ranked by song count', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-two-'));
    const small = join(root, 'Default', 'v6.1', 'Databases', 'Data');
    const big = join(root, 'Default_1', 'v6.1', 'Databases', 'Data');
    makeLibrary(small, [{ title: 'One' }]);
    makeLibrary(big, [{ title: 'A' }, { title: 'B' }, { title: 'C' }]);

    let offered: string[] = [];
    const s = createEasyWorshipSource({
      openDb: openTestSourceDb,
      pickFolder: () => Promise.resolve(root),
      pickCandidate: (cands) => {
        offered = cands.map((c) => c.label);
        return Promise.resolve(cands[0]);
      }
    });
    expect(await s.locate()).toEqual({ path: big });
    expect(offered[0]).toContain('Default_1 (v6.1)');
    expect(offered[0]).toContain('3 songs');
    expect(offered[1]).toContain('Default (v6.1)');
    rmSync(root, { recursive: true, force: true });
  });

  it('treats backing out of the library picker as cancellation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-pick-cancel-'));
    makeLibrary(join(root, 'Default', 'v6.1', 'Databases', 'Data'), [{ title: 'One' }]);
    makeLibrary(join(root, 'Default_1', 'v6.1', 'Databases', 'Data'), [{ title: 'Two' }]);
    const s = createEasyWorshipSource({
      openDb: openTestSourceDb,
      pickFolder: () => Promise.resolve(root),
      pickCandidate: () => Promise.resolve(null)
    });
    expect(await s.locate()).toEqual({ error: 'canceled' });
    rmSync(root, { recursive: true, force: true });
  });

  it('does not descend more than four levels below the picked folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-deep-'));
    makeLibrary(join(root, 'a', 'b', 'c', 'd', 'e'), [{ title: 'Too Deep' }]);
    expect(await source(root).locate()).toEqual({
      error: 'no-source-files',
      expected: EW_DEFAULT_PATH
    });
    rmSync(root, { recursive: true, force: true });
  });
```

Also update the existing first test in the file — it pins the old constant, which is the bug:

```ts
  it('reports the two expected files when the folder does not hold them', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'ew-empty-'));
    const located = await source(empty).locate();
    expect(located).toEqual({
      error: 'no-source-files',
      // A shape, not a path: the profile and version segments both vary in the wild, and a
      // version directory can exist while holding zero songs.
      expected:
        'C:\\Users\\Public\\Documents\\Softouch\\Easyworship\\<Profile>\\<Version>\\Databases\\Data\\'
    });
    rmSync(empty, { recursive: true, force: true });
  });
```

Add `EW_DEFAULT_PATH` to the existing import from `./easyworship`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/importSources/easyworship.test.ts`
Expected: FAIL — `locate()` only checks the picked folder itself, so every nested case returns `no-source-files`, and `pickCandidate` is not a recognised dep.

- [ ] **Step 3: Add the new failure variant to the shared type**

In `src/shared/types.ts`, replace line 59:

```ts
export type LocateFailure = {
  error: 'no-source-files' | 'canceled' | 'all-candidates-empty';
  expected?: string;
};
```

- [ ] **Step 4: Implement discovery, counting and the picker**

In `src/main/importSources/easyworship.ts`, extend the `fs` import to `import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';` and add `dirname` to the `path` import.

Replace the `EW_DEFAULT_PATH` constant (lines 20–24):

```ts
// Spelled with a lowercase `w` on disk, though the product is branded "EasyWorship" — it
// matters when a copied folder is read on a case-sensitive filesystem.
export const EW_ROOT = 'C:\\Users\\Public\\Documents\\Softouch\\Easyworship';

// A SHAPE, not a location. The profile may be `Default_1`, the version directory may be
// `v6.1` or `v6.1.2`, and a version directory can hold a full schema with zero songs — so
// this is only ever shown to orient the operator, never probed as if it existed.
export const EW_DEFAULT_PATH = `${EW_ROOT}\\<Profile>\\<Version>\\Databases\\Data\\`;

// Exactly the distance from the EasyWorship root down to Data
// (<root>/<profile>/<version>/Databases/Data), so picking the topmost sensible folder still
// finds every library while a mis-picked home directory cannot become a whole-disk walk.
const MAX_DEPTH = 4;

// None of these ever holds the live library. Archive is the one that matters: it can hold a
// real-looking library that is not the one in use.
const SKIP_DIRS = new Set(['resources', 'datacache', 'archive', 'locks', 'thumbnails', 'posterframes', 'temp']);
```

Add the candidate type and helpers above `createEasyWorshipSource`:

```ts
export interface LibraryCandidate {
  /** The directory holding Songs.db and SongWords.db. */
  path: string;
  /** On-disk filenames, preserved with their real case so a case-sensitive filesystem can
   *  still open what a case-insensitive match found. */
  songsFile: string;
  wordsFile: string;
  songs: number;
  label: string;
}

function libraryFilesIn(entries: { name: string; isDir: boolean }[]): [string, string] | null {
  const files = entries.filter((e) => !e.isDir);
  const songs = files.find((f) => f.name.toLowerCase() === SONGS_DB.toLowerCase());
  const words = files.find((f) => f.name.toLowerCase() === WORDS_DB.toLowerCase());
  return songs && words ? [songs.name, words.name] : null;
}

function findCandidateDirs(deps: EasyWorshipDeps, dir: string, depth: number): string[] {
  let entries: { name: string; isDir: boolean }[];
  try {
    entries = deps.listDir(dir);
  } catch {
    return []; // unreadable directory (permissions, a vanished mount) is not a failure
  }
  const found = libraryFilesIn(entries) ? [dir] : [];
  if (depth >= MAX_DEPTH) return found;
  for (const entry of entries) {
    if (!entry.isDir || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
    found.push(...findCandidateDirs(deps, join(dir, entry.name), depth + 1));
  }
  return found;
}

// "<profile> (<version>)" pulled off the path, since that is how the operator recognises which
// library is which. Falls back to the full path when the folder is not laid out that way.
function describeCandidate(dataDir: string, songs: number, appVersion: string | null): string {
  const parts = dataDir.split(/[\\/]/).filter(Boolean);
  const dbIdx = parts.findIndex((p) => p.toLowerCase() === 'databases');
  const where = dbIdx >= 2 ? `${parts[dbIdx - 2]} (${parts[dbIdx - 1]})` : dataDir;
  const count = `${songs.toLocaleString()} ${songs === 1 ? 'song' : 'songs'}`;
  return appVersion ? `${where} — ${count} — EasyWorship ${appVersion}` : `${where} — ${count}`;
}

// version.dat is two lines: app version, then data schema version. Shown to help the operator
// tell two libraries apart — never used to infer the schema, which EW8 spec §2.4 proves it
// cannot do (two libraries reporting 6.5.1.0 differed in 15 columns).
function appVersionOf(deps: EasyWorshipDeps, dataDir: string): string | null {
  const raw = deps.readText(join(dataDir, 'version.dat'));
  const first = raw?.split(/\r?\n/)[0]?.trim();
  return first ? first : null;
}

// Counts on a temp copy for the same reason scan does: EasyWorship holds the live files open.
// COUNT(*) compares no text, so it never touches the UTF8_U_CI collation.
function countCandidate(deps: EasyWorshipDeps, dataDir: string): LibraryCandidate | null {
  const entries = deps.listDir(dataDir);
  const names = libraryFilesIn(entries);
  if (!names) return null;
  const [songsFile, wordsFile] = names;
  const temp = deps.mkdtemp();
  try {
    copyWithSidecars(deps, dataDir, temp, songsFile);
    const db = deps.openDb(join(temp, songsFile));
    try {
      const songs = db.all<{ n: number }>('SELECT COUNT(*) AS n FROM song')[0]?.n ?? 0;
      return {
        path: dataDir,
        songsFile,
        wordsFile,
        songs,
        label: describeCandidate(dataDir, songs, appVersionOf(deps, dataDir))
      };
    } finally {
      db.close();
    }
  } catch (err) {
    // Dropped, never fatal to the whole locate — but said out loud, because "this folder was
    // silently not offered" is otherwise indistinguishable from "this folder does not exist".
    console.warn(`easyworship: skipping unreadable library at "${dataDir}"`, err);
    return null;
  } finally {
    deps.rmTemp(temp);
  }
}
```

Add the three deps to `EasyWorshipDeps` (after `copy`):

```ts
  listDir: (path: string) => { name: string; isDir: boolean }[];
  readText: (path: string) => string | null;
  /** Which library to import when more than one holds songs. Returns null when the operator
   *  backs out. Injected so the choice is testable without Electron. */
  pickCandidate: (candidates: LibraryCandidate[]) => Promise<LibraryCandidate | null>;
```

Add the default picker beside `defaultPickFolder`:

```ts
function defaultPickCandidate(
  getParentWindow?: () => Electron.BrowserWindow | null
): (candidates: LibraryCandidate[]) => Promise<LibraryCandidate | null> {
  return async (candidates) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dialog } = require('electron') as typeof import('electron');
    const buttons = [...candidates.map((c) => c.label), 'Cancel'];
    const opts: Electron.MessageBoxOptions = {
      type: 'question',
      title: 'Choose a library',
      message: 'More than one EasyWorship library was found.',
      detail: 'Pick the one to import from. They are listed with the largest first.',
      buttons,
      cancelId: buttons.length - 1 // no defaultId: the operator chooses, nothing is preselected
    };
    const parent = getParentWindow?.() ?? null;
    const { response } = parent
      ? await dialog.showMessageBox(parent, opts)
      : await dialog.showMessageBox(opts);
    return response === buttons.length - 1 ? null : candidates[response];
  };
}
```

Extend `defaultPickFolder` to start the dialog at the EasyWorship root when it exists, by replacing its `opts` line:

```ts
    const opts = { properties: ['openDirectory'] } as Electron.OpenDialogOptions;
    if (existsSync(EW_ROOT)) opts.defaultPath = EW_ROOT;
```

Add the three defaults to the `deps` object inside `createEasyWorshipSource`, before `...overrides`:

```ts
    listDir: (p) => readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() })),
    readText: (p) => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    },
    pickCandidate: defaultPickCandidate(overrides.getParentWindow),
```

Replace `locate()` entirely:

```ts
    async locate(): Promise<LocateResult> {
      const picked = await deps.pickFolder();
      if (!picked) return { error: 'canceled' };

      const dirs = findCandidateDirs(deps, picked, 0);
      if (dirs.length === 0) return { error: 'no-source-files', expected: EW_DEFAULT_PATH };

      const candidates = dirs
        .map((d) => countCandidate(deps, d))
        .filter((c): c is LibraryCandidate => c !== null && c.songs > 0);

      // Distinct from 'no-source-files' on purpose. A version directory holding a complete
      // schema and zero songs is a real, observed state (Default_1\v6.1.2 in EW8 spec §1.2),
      // and reporting it as "not found" would send the operator hunting for a folder they
      // already found.
      if (candidates.length === 0) return { error: 'all-candidates-empty', expected: EW_DEFAULT_PATH };
      if (candidates.length === 1) return { path: candidates[0].path };

      // Ranked by song count, never by version string: the higher version directory was the
      // empty one in the real sample.
      candidates.sort((a, b) => b.songs - a.songs);
      const chosen = await deps.pickCandidate(candidates);
      return chosen ? { path: chosen.path } : { error: 'canceled' };
    },
```

Finally, make `scan` use the on-disk filenames rather than the constants, so a case-sensitive filesystem works. Replace the two `copyWithSidecars` calls and the two `openDb` calls in `scan`:

```ts
        const entries = deps.listDir(located.path);
        const names = libraryFilesIn(entries);
        if (!names) throw new Error(`easyworship.scan: no library at "${located.path}"`);
        const [songsFile, wordsFile] = names;
        copyWithSidecars(deps, located.path, temp, songsFile);
        copyWithSidecars(deps, located.path, temp, wordsFile);

        const songsDb = deps.openDb(join(temp, songsFile));
        let wordsDb: SourceDb | null = null;
        try {
          wordsDb = deps.openDb(join(temp, wordsFile));
```

Note: the existing `fakeSource` helper in the test file stubs `exists: () => true` but not `listDir`. Add `listDir: () => [{ name: 'Songs.db', isDir: false }, { name: 'SongWords.db', isDir: false }]` to that helper so the fake-source tests keep working.

- [ ] **Step 5: Run the adapter tests**

Run: `npx vitest run src/main/importSources/easyworship.test.ts`
Expected: PASS, including all seven new locate cases.

- [ ] **Step 6: Handle the new error in the wizard**

In `src/renderer/operator/SongImport.tsx`, replace the `setStep({ name: 'error', … })` block (lines 89–96):

```tsx
        setStep({
          name: 'error',
          message:
            result.error === 'no-source-files'
              ? "Couldn't find Songs.db and SongWords.db in that folder."
              : result.error === 'all-candidates-empty'
                ? 'Found an EasyWorship library there, but it holds no songs. EasyWorship keeps more than one library — try another profile or version folder.'
                : 'That import source is not available.',
          expected: 'expected' in result ? result.expected : undefined
        });
```

- [ ] **Step 7: Add the wizard test**

Append to `src/renderer/operator/SongImport.test.tsx`, using the same `installHelm` /
`renderModal` pair as the other wizard tests:

```ts
  it('explains an empty library differently from a missing one', async () => {
    installHelm({ error: 'all-candidates-empty', expected: 'C:\\Softouch\\Easyworship\\' });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText(/holds no songs/)).toBeTruthy();
  });
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: all passing.

- [ ] **Step 9: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src --ext .ts,.tsx`
Expected: clean. `LibraryCandidate` is exported and used by the `pickCandidate` dep signature, so no unused-export warning.

- [ ] **Step 10: Commit**

```bash
git add src/main/importSources/easyworship.ts src/main/importSources/easyworship.test.ts src/shared/types.ts src/renderer/operator/SongImport.tsx src/renderer/operator/SongImport.test.tsx
git commit -m "fix(songs): find and rank EasyWorship libraries instead of assuming one path"
```

---

## Final verification

- [ ] **Run everything**

```bash
npm test && npx tsc --noEmit && npx eslint src --ext .ts,.tsx
```

- [ ] **Confirm the containment claim**

```bash
git diff --stat edeef51..HEAD -- src/shared/songs/splitToSlides.ts src/shared/songs/importTidy.ts \
  src/shared/songs/splitToSlides.test.ts src/shared/songs/importTidy.test.ts \
  src/shared/songs/importKey.test.ts src/main/songsRepo.test.ts
```

Expected: **empty output.** These six files are the evidence the pipeline change stayed inside the adapter's path. If any of them changed, the boundary was drawn wrong — stop and re-read the spec's §1 before proceeding.

- [ ] **Update the Windows handoff note**

`docs/superpowers/notes/2026-07-31-song-import-windows-handoff.md` predates this correction. Add a short section noting that the schema questions it poses are now answered by `EasyWorship8-Library-Spec.md`, and that the remaining Windows task is to run the import against a copy of the real library and check three things: which library the picker offers, how many songs carry a CHECK badge, and whether a spot-check of a flagged song's slides matches EasyWorship on screen.

- [ ] **Commit the note**

```bash
git add docs/superpowers/notes/2026-07-31-song-import-windows-handoff.md
git commit -m "docs(notes): point the Windows handoff at the verified EW8 spec"
```

---

## What this plan deliberately does not build

Carried from the spec, so a reviewer does not read these as omissions:

- **Path A** — exact slides from `PresentationLayouts.db`. Deferred pending the `presentation_id` diagnostic this work produces; layout coverage was 22% in one real library and 0% in the other.
- **`CAST(words AS BLOB)`** — correct only if Delphi wrote cp1252 into that column; the spec measured zero raw bytes above 127 across all 2,220 songs, so both paths are indistinguishable on real data and `wordsToText` already handles either return type.
- **Zero-slide songs as title-only stubs** — kept as `unreadable`, which names the song for the operator instead of leaving a silent blank in the library.
- **`.ewsx` packages, `Media.db`, `Collections.db`, themes, trailing `(Key)` parsing** — out of scope.
- **Unattended auto-detection** with no browse step — the forgiving search plus ranking already closes the zero-song trap while keeping the operator in control of which library is read.
