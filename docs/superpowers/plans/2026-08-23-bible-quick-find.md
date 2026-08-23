# Bible Quick-Find Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Text search over verse text from the existing scripture entry box — one box that stays a reference typeahead until what's typed can't be a reference, then becomes a ranked verse search (plus a curated Passages group), with Enter landing the cursor on the hit.

**Architecture:** A new `search` stage in the `refBuilder` keystroke machine decides when the entry is a text search. Main gets a `verse_fts` FTS5 table (+ `fts5vocab` for typo expansion) as a candidate gate and a JS scorer (`verseScore.ts`) with a deterministic tie-break ladder, same shape as songs/quotes. The renderer swaps the schedule list for a `ScriptureSearchResults` rail while searching; picking a hit sets the builder to that reference so every existing commit path (`+ Add`, Go live, Shift+Enter) works unchanged.

**Tech Stack:** Electron main + React renderer, better-sqlite3 (FTS5, fts5vocab), node:sqlite in tests (`openTestDb`), vitest + @testing-library/react (jsdom), TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-23-bible-quick-find-design.md`

## Global Constraints

- Commit messages: short conventional-commit subject, no `Co-Authored-By`/`Claude-Session` trailers (CLAUDE.md).
- Never run `prettier --write` on this repo (house memory). Match each file's existing style (some files use semicolons, some don't — keep whatever the file you touch uses).
- `npm test` must never load better-sqlite3: repo tests use `openTestDb()` (node:sqlite). Schema lives in `schema.ts` (no native import).
- Run `npm run lint` and `npm run typecheck` before the final commit; `react-hooks` rules treat ref-reads-during-render and set-state-in-effect as errors (see comments in `SermonMode.tsx`).
- Components that render list rows must declare the row component at module scope (see `SongSearchRail.tsx` `Row` comment — double-click survival).
- Tokenizer for every FTS table: `unicode61 remove_diacritics 2`.
- Placeholder for the entry becomes `Add verse — John 3:16, or search a word` (tests match `/Add verse/` and one exact string in `SermonMode.test.tsx`, updated in Task 10).
- Search the primary version only (`versions[0]`).

---

## File map

| File | Responsibility |
|---|---|
| `src/main/ftsQuery.ts` (new) | MATCH-string builders + `FTS_CANDIDATE_LIMIT`; adopted by songs, messages, verses |
| `src/shared/scripture/refBuilder.ts` | `search` stage + transitions, `isSearch`, `searchQuery`, `prior` |
| `src/main/schema.ts` | `verse_fts`, `verse_vocab`, `VERSE_FTS_COLUMNS` |
| `src/main/biblesRepo.ts` | FTS writes on install/uninstall, `ensureSearchIndex`, `search` |
| `src/main/db.ts` | call `ensureSearchIndex` after schema |
| `src/shared/search/verseScore.ts` (new) | `scoreVerse`, `rankVerses`, `VerseHit` |
| `src/shared/search/highlight.ts` (new) | `highlightTokens(text, qts)` → segments for bolding |
| `src/shared/scripture/passages.ts` (new) | curated `PASSAGES` + `matchPassages` |
| `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts` | `bibles:search` |
| `src/renderer/operator/ScriptureSearchResults.tsx` (new) | results rail (passages + verses groups) |
| `src/renderer/operator/SchedulePanel.tsx` | `search` prop → renders results instead of schedule |
| `src/renderer/operator/SermonMode.tsx` | search effect, highlight state, keyboard, pick/activate |
| Tests | `ftsQuery.test.ts`, `refBuilder.test.ts`, `biblesRepo.test.ts`, `verseScore.test.ts`, `highlight.test.ts`, `bibleSearchRanking.test.ts`, `passages.test.ts`, `ScriptureSearchResults.test.tsx`, `SchedulePanel.test.tsx`, `SermonMode.test.tsx` |

---

### Task 1: Shared FTS query helper

**Files:**
- Create: `src/main/ftsQuery.ts`
- Create: `src/main/ftsQuery.test.ts`
- Modify: `src/main/songsRepo.ts:97-107`
- Modify: `src/main/messagesRepo.ts:113-125`

**Interfaces:**
- Produces: `ftsTerm(t: string, prefix: boolean): string`, `orPrefixMatch(tokens: string[]): string`, `andGroupsMatch(groups: string[][]): string`, `FTS_CANDIDATE_LIMIT = 1000`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/ftsQuery.test.ts
import { expect, test } from 'vitest';
import { andGroupsMatch, ftsTerm, orPrefixMatch, FTS_CANDIDATE_LIMIT } from './ftsQuery';

test('ftsTerm quotes, escapes embedded quotes, and appends * for prefix', () => {
  expect(ftsTerm('love', true)).toBe('"love"*');
  expect(ftsTerm('love', false)).toBe('"love"');
  expect(ftsTerm('a"b', false)).toBe('"a""b"');
});

test('orPrefixMatch is the songs/quotes shape: prefix terms joined by OR', () => {
  expect(orPrefixMatch(['amaz', 'grace'])).toBe('"amaz"* OR "grace"*');
});

test('andGroupsMatch ANDs groups; the first alternative of each group is a prefix, the rest exact', () => {
  expect(andGroupsMatch([['zacch'], ['rich', 'riches']])).toBe('("zacch"*) AND ("rich"* OR "riches")');
});

test('candidate limit is shared', () => {
  expect(FTS_CANDIDATE_LIMIT).toBe(1000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ftsQuery.test.ts`
Expected: FAIL — cannot find module `./ftsQuery`.

- [ ] **Step 3: Write the helper**

```ts
// src/main/ftsQuery.ts
// FTS5 MATCH-string construction shared by the song, quote and verse searches, so the
// three repos cannot drift on quoting or the candidate cap. Tokens normally arrive from
// `norm()` ([a-z0-9] only); the quote escaping is for the vocabulary-expanded verse terms,
// which come from the tokenizer and are not guaranteed to be that tame.

/** Max FTS hits taken per query: keeps a common-token query's hit list under SQLite's
 * bound-variable cap for the `IN (...)` that follows — best-ranked hits survive. */
export const FTS_CANDIDATE_LIMIT = 1000;

/** One quoted FTS5 term; `prefix` appends the `*` type-ahead operator. */
export function ftsTerm(t: string, prefix: boolean): string {
  return `"${t.replace(/"/g, '""')}"${prefix ? '*' : ''}`;
}

/** The songs/quotes candidate gate: every token as a prefix, any of them (the JS scorer
 * applies the all-tokens gate afterwards). */
export function orPrefixMatch(tokens: string[]): string {
  return tokens.map((t) => ftsTerm(t, true)).join(' OR ');
}

/** The verse candidate gate: every group must match (AND); within a group, the first
 * alternative is the typed token as a prefix and the rest are exact vocabulary terms the
 * typo expansion added. */
export function andGroupsMatch(groups: string[][]): string {
  return groups
    .map((alts) => `(${alts.map((a, i) => ftsTerm(a, i === 0)).join(' OR ')})`)
    .join(' AND ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ftsQuery.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Adopt in songsRepo and messagesRepo**

In `src/main/songsRepo.ts` add `import { orPrefixMatch, FTS_CANDIDATE_LIMIT } from './ftsQuery';` and replace

```ts
      const match = tokens.map((t) => `"${t}"*`).join(' OR ');
```
with
```ts
      const match = orPrefixMatch(tokens);
```
and in the hit query replace the literal `LIMIT 1000` with `LIMIT ${FTS_CANDIDATE_LIMIT}`.

In `src/main/messagesRepo.ts` add `import { orPrefixMatch, FTS_CANDIDATE_LIMIT } from './ftsQuery';`, replace
```ts
    const match = tokens.map((t) => `"${t}"*`).join(' OR ');
```
with `const match = orPrefixMatch(tokens);` and `LIMIT 1000` in `ftsSql` with `LIMIT ${FTS_CANDIDATE_LIMIT}`.

- [ ] **Step 6: Run the search suites**

Run: `npx vitest run src/main/songsRepo.test.ts src/main/songSearchRanking.test.ts src/main/messagesRepo.test.ts src/main/ftsQuery.test.ts`
Expected: PASS, unchanged behaviour.

- [ ] **Step 7: Commit**

```bash
git add src/main/ftsQuery.ts src/main/ftsQuery.test.ts src/main/songsRepo.ts src/main/messagesRepo.ts
git commit -m "refactor(search): share the FTS MATCH builder and candidate limit"
```

---

### Task 2: `search` stage in the reference builder

**Files:**
- Modify: `src/shared/scripture/refBuilder.ts`
- Modify: `src/shared/scripture/refBuilder.test.ts`
- Modify: `src/shared/scripture/selection.test.ts` (only if it asserts whole-state equality — check with the grep in step 1)

**Interfaces:**
- Produces: `BuilderStage` includes `'search'`; `RefBuilderState.prior: RefBuilderState | null`; `isSearch(s): boolean`; `searchQuery(s): string`.
- Existing `applyKey`, `renderBuilder`, `toParsedRef`, `bookCompletion`, `refGhost`, `fromParsedRef`, `setStart`, `setEnd` keep their signatures.

- [ ] **Step 1: See what existing tests assert about the state shape**

Run: `grep -n "bookQuery: ''" src/shared/scripture/refBuilder.test.ts src/shared/scripture/selection.test.ts src/renderer/operator/*.test.tsx`
Expected: hits at `refBuilder.test.ts` lines ~25, 109, 117, 146, 265, 385, 408 (numbers may drift). Lines 146/385/408 assert `bookQuery: ''` *after a commit* — those change to the typed text in step 4. `toEqual` on `initialBuilder()` (line ~25) gains `prior: null`.

- [ ] **Step 2: Write the failing tests** (append to `refBuilder.test.ts`)

```ts
import { isSearch, searchQuery } from './refBuilder'  // add to the existing import list

const type = (s: RefBuilderState, text: string, extent: BookExtent = james): RefBuilderState => {
  let st = s
  for (const ch of text) st = applyKey(st, ch, false, extent).state
  return st
}

test('initialBuilder carries prior: null', () => {
  expect(initialBuilder().prior).toBeNull()
})

test('letters that cannot be a book enter the search stage with the typed text', () => {
  const st = type(initialBuilder(), 'prod')
  expect(isSearch(st)).toBe(true)
  expect(searchQuery(st)).toBe('prod')
  expect(renderBuilder(st)).toBe('prod')
  expect(toParsedRef(st)).toBeNull()
  expect(bookCompletion(st)).toBeNull()
  expect(refGhost(st)).toBeNull()
})

test('"pro" is still a book prefix (Proverbs); "prod" is the first search keystroke', () => {
  expect(isSearch(type(initialBuilder(), 'pro'))).toBe(false)
  expect(bookCompletion(type(initialBuilder(), 'pro'))).toBe('Proverbs')
  expect(isSearch(type(initialBuilder(), 'prod'))).toBe(true)
})

test('Backspace out of search restores the state the search started from', () => {
  const st = type(initialBuilder(), 'prod')
  const back = applyKey(st, 'Backspace', false, james).state
  expect(isSearch(back)).toBe(false)
  expect(back).toMatchObject({ stage: 'book', bookQuery: 'pro', book: null })
  expect(bookCompletion(back)).toBe('Proverbs')
})

test('Backspace inside search pops one character until the entry point', () => {
  const st = type(initialBuilder(), 'prodigal')
  const once = applyKey(st, 'Backspace', false, james).state
  expect(isSearch(once)).toBe(true)
  expect(searchQuery(once)).toBe('prodiga')
})

test('a letter right after a committed book reverts to a search of what was typed', () => {
  // "the " commits 1 Thessalonians (prefix); the next letter means the operator is typing
  // words, so the search is for "the l", not "1 Thessalonians l".
  const committed = type(initialBuilder(), 'the ')
  expect(committed).toMatchObject({ stage: 'chapter', book: '1 Thessalonians', chapter: null })
  const st = applyKey(committed, 'l', false, james).state
  expect(isSearch(st)).toBe(true)
  expect(searchQuery(st)).toBe('the l')
  // and Backspace brings the committed book back
  const back = applyKey(st, 'Backspace', false, james).state
  expect(back).toMatchObject({ stage: 'chapter', book: '1 Thessalonians', chapter: null })
})

test('"john t" searches for john t (typed alias preserved: "jhn t")', () => {
  expect(searchQuery(type(initialBuilder(), 'john t'))).toBe('john t')
  expect(searchQuery(type(initialBuilder(), 'jhn t'))).toBe('jhn t')
})

test('a letter after chapter digits stays ignored (no search from "John 3x")', () => {
  const st = type(initialBuilder(), 'john 3x')
  expect(isSearch(st)).toBe(false)
  expect(st).toMatchObject({ stage: 'chapter', book: 'John', chapter: 3 })
})

test('a quote forces search even on a book word', () => {
  const st = type(initialBuilder(), '"john')
  expect(isSearch(st)).toBe(true)
  expect(searchQuery(st)).toBe('"john')
})

test('"." in the book stage stays ignored (jn. 3:16 keeps working)', () => {
  const st = type(initialBuilder(), 'jn.')
  expect(isSearch(st)).toBe(false)
  expect(st.bookQuery).toBe('jn')
})

test('a letter no book starts with is already a search; the space then appends', () => {
  expect(isSearch(type(initialBuilder(), 'x'))).toBe(true)
  expect(searchQuery(type(initialBuilder(), 'x '))).toBe('x ')
  // a leading space on an empty entry still does nothing
  expect(type(initialBuilder(), ' ')).toEqual(initialBuilder())
})

test('digits alone never search ("1 " keeps the numbered-book path)', () => {
  const st = type(initialBuilder(), '1 ')
  expect(isSearch(st)).toBe(false)
  expect(st.bookQuery).toBe('1 ')
  expect(isSearch(type(st, 'jo'))).toBe(false)
  expect(bookCompletion(type(st, 'jo'))).toBe('1 John')
})

test('in search every printable appends, including spaces, digits and punctuation', () => {
  const st = type(initialBuilder(), "god's love 3")
  expect(searchQuery(st)).toBe("god's love 3")
})

test('Tab is not swallowed in search', () => {
  const r = applyKey(type(initialBuilder(), 'prod'), 'Tab', false, james)
  expect(r.preventDefault).toBe(false)
})

test('commitBook keeps the typed book text (nothing downstream reads it)', () => {
  const st = type(initialBuilder(), 'jhn ')
  expect(st).toMatchObject({ stage: 'chapter', book: 'John', bookQuery: 'jhn' })
  expect(renderBuilder(st)).toBe('John')
  expect(bookCompletion(st)).toBeNull()
})
```

Also update the three existing assertions that say `bookQuery: ''` after a commit to the typed text (e.g. `{ stage: 'chapter', book: 'James', bookQuery: 'jam' }` — read each test to see what was typed), and the `initialBuilder()` `toEqual` to include `prior: null`.

- [ ] **Step 3: Run to verify the new tests fail**

Run: `npx vitest run src/shared/scripture/refBuilder.test.ts`
Expected: FAIL — `isSearch` not exported, etc.

- [ ] **Step 4: Implement**

In `src/shared/scripture/refBuilder.ts`:

```ts
export type BuilderStage = 'book' | 'chapter' | 'verse' | 'endVerse' | 'search'
export interface RefBuilderState {
  stage: BuilderStage
  bookQuery: string
  book: string | null
  chapter: number | null
  startVerse: number | null
  endVerse: number | null
  /** Search stage only: the state the entry was in before the keystroke that turned it
   * into a text search. Backspace returns to it once the query shrinks back to where the
   * search began (`prior`'s rendered length), so "prod"⌫ ghosts Proverbs again and
   * "john t"⌫ is John, committed, awaiting a chapter. Null in every other stage. */
  prior: RefBuilderState | null
}

export function initialBuilder(): RefBuilderState {
  return { stage: 'book', bookQuery: '', book: null, chapter: null, startVerse: null, endVerse: null, prior: null }
}

/** The entry is a text search, not a reference. In this stage `bookQuery` holds the query
 * (so `renderBuilder` shows it unchanged) and every other field is null. */
export function isSearch(s: RefBuilderState): boolean {
  return s.stage === 'search'
}
export function searchQuery(s: RefBuilderState): string {
  return s.stage === 'search' ? s.bookQuery : ''
}

function enterSearch(prior: RefBuilderState, query: string): RefBuilderState {
  return { ...initialBuilder(), stage: 'search', bookQuery: query, prior }
}
```

`renderBuilder`: unchanged (search stage has `book === null`, so it returns `bookQuery`).
`toParsedRef`: unchanged (book null → null).
`bookCompletion`: the existing `if (s.stage !== 'book' || s.book !== null) return null` already covers search.
`fromParsedRef`, `railSelect` base objects: add `prior: null` wherever a literal state is built (`fromParsedRef` here; `selection.ts` uses `...initialBuilder()` so it's covered).

`commitBook` keeps the typed text:
```ts
function commitBook(s: RefBuilderState, book: string): RefBuilderState {
  // `bookQuery` is kept (not cleared): it is what the operator typed, and if the next key is
  // a letter the entry becomes a text search of THAT ("the l"), not of the committed name
  // ("1 Thessalonians l"). Nothing reads it while `book` is set — bookCompletion guards on
  // `book === null` and renderBuilder prefers `book`.
  return { ...s, stage: 'chapter', book, chapter: null }
}
```

`applyKey`:
```ts
export function applyKey(s, key, _shift, extent): Applied {
  if (key === 'Backspace') return { state: backspace(s), preventDefault: true }
  if (key === 'Tab') {
    const b = bookCompletion(s)
    if (b === null) return { state: s, preventDefault: false }
    return { state: commitBook(s, b), preventDefault: true }
  }
  if (key.length !== 1) return { state: s, preventDefault: false }
  return { state: printable(s, key, extent), preventDefault: true }
}
```
(unchanged — Tab in search hits `bookCompletion === null` → not swallowed.)

`printable`, book stage:
```ts
    case 'book': {
      if (key === ' ') {
        const b = bookCompletion(s)
        if (b !== null) return commitBook(s, b)
        if (/\d/.test(s.bookQuery)) return { ...s, bookQuery: s.bookQuery + ' ' }
        // Letters with no completion can't reach here (they entered search on the letter);
        // an empty entry just ignores the space, as today.
        return s
      }
      if (isAlnum(key)) {
        const q = s.bookQuery + key
        // Letters that no book starts with: the operator is typing words, not a reference.
        // Digits-only queries stay on the numbered-book path ("1" → "1 jo").
        if (/[a-z]/i.test(q) && matchBook(q) === null) return enterSearch(s, q)
        return { ...s, bookQuery: q }
      }
      if (key === '.') return s // "jn." — a dotted abbreviation, not a search
      // Any other printable (a quote above all) is the explicit "I mean text" escape:
      // `"john` searches verses for john instead of ghosting the gospel.
      return enterSearch(s, s.bookQuery + key)
    }
```
Chapter stage — add, before the existing digit/space/colon handling:
```ts
    case 'chapter': {
      if (s.chapter === null && /^[a-z]$/i.test(key)) {
        // A letter right after the book committed: "john t" / "the l" — words, not a
        // chapter. Search what was TYPED plus this key; the committed state is `prior`.
        return enterSearch(s, `${s.bookQuery || s.book} ${key}`)
      }
      ...existing...
    }
```
Search stage:
```ts
    case 'search':
      return { ...s, bookQuery: s.bookQuery + key }
```
`backspace`, new first case:
```ts
    case 'search': {
      const q = s.bookQuery.slice(0, -1)
      const prior = s.prior ?? initialBuilder()
      // The query shrinks back to where the search began → the pre-search state returns.
      // `entryLen` is what the entry showed from `prior` plus the committed-book space when
      // the search was entered from the chapter stage (`"the "` → length 4).
      const entryLen = prior.stage === 'chapter' ? (prior.bookQuery || prior.book || '').length + 1 : prior.bookQuery.length
      if (q.length <= entryLen) return prior
      return { ...s, bookQuery: q }
    }
```
Existing `chapter`-stage backspace with `chapter === null` keeps `bookQuery: s.book ?? ''` (the display stays on the committed name, as today).

- [ ] **Step 5: Run the builder + selection suites**

Run: `npx vitest run src/shared/scripture/`
Expected: PASS. If `selection.test.ts` has whole-state `toEqual`s that now lack `prior`, add `prior: null` there.

- [ ] **Step 6: Typecheck (the `prior` field touches literal states elsewhere)**

Run: `npm run typecheck`
Expected: PASS. If `SermonMode.tsx` or `selection.ts` build a state literal without `prior`, add `prior: null` (or spread `initialBuilder()`).

- [ ] **Step 7: Commit**

```bash
git add src/shared/scripture/refBuilder.ts src/shared/scripture/refBuilder.test.ts src/shared/scripture/selection.ts src/shared/scripture/selection.test.ts
git commit -m "feat(scripture): search stage in the reference builder"
```

---

### Task 3: `verse_fts` index — schema, install/uninstall, backfill

**Files:**
- Modify: `src/main/schema.ts`
- Modify: `src/main/biblesRepo.ts`
- Modify: `src/main/db.ts`
- Modify: `src/main/biblesRepo.test.ts`

**Interfaces:**
- Produces: `VERSE_FTS_COLUMNS`, `BiblesRepo.ensureSearchIndex(): void`. `verse_fts` rows `(version_id, book, chapter, verse, text)`; `verse_vocab` (`term`, `doc`).

- [ ] **Step 1: Write failing tests** (append to `biblesRepo.test.ts`; `beforeEach` already creates `db`/`repo`)

```ts
const ftsCount = (versionId: string): number =>
  (db.prepare('SELECT count(*) AS n FROM verse_fts WHERE version_id = ?').get(versionId) as { n: number }).n

test('install writes one verse_fts row per verse; uninstall removes them', () => {
  repo.install(kjv)
  expect(ftsCount('kjv')).toBe(3)
  repo.uninstall('kjv')
  expect(ftsCount('kjv')).toBe(0)
})

test('verse_fts MATCH finds verse text for the right version only', () => {
  repo.install(kjv)
  repo.install(esv)
  const rows = db
    .prepare('SELECT version_id AS v, book, chapter, verse FROM verse_fts WHERE verse_fts MATCH ? AND version_id = ?')
    .all('"heaven"', 'kjv') as { v: string; book: string }[]
  expect(rows).toEqual([{ v: 'kjv', book: 'Genesis', chapter: 1, verse: 1 }])
})

test('ensureSearchIndex backfills a version installed before the index existed', () => {
  repo.install(kjv)
  db.exec("DELETE FROM verse_fts WHERE version_id = 'kjv'") // simulate a pre-index install
  expect(ftsCount('kjv')).toBe(0)
  repo.ensureSearchIndex()
  expect(ftsCount('kjv')).toBe(3)
  repo.ensureSearchIndex() // idempotent
  expect(ftsCount('kjv')).toBe(3)
})

test('verse_vocab lists the indexed terms', () => {
  repo.install(kjv)
  const terms = (db.prepare('SELECT term FROM verse_vocab').all() as { term: string }[]).map((r) => r.term)
  expect(terms).toContain('beginning')
  expect(terms).toContain('word')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/biblesRepo.test.ts`
Expected: FAIL — no such table `verse_fts`.

- [ ] **Step 3: Schema**

In `src/main/schema.ts`, after `SONG_FTS_COLUMNS`:
```ts
// verse_fts column order — biblesRepo's INSERT is positional against this list.
export const VERSE_FTS_COLUMNS = ['version_id', 'book', 'chapter', 'verse', 'text'] as const;
```
and inside `SCHEMA` after `idx_verses_chapter`:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS verse_fts USING fts5(
  version_id UNINDEXED, book UNINDEXED, chapter UNINDEXED, verse UNINDEXED, text,
  tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE IF NOT EXISTS verse_vocab USING fts5vocab(verse_fts, 'row');
```

- [ ] **Step 4: Repo write paths + backfill**

In `src/main/biblesRepo.ts`:
```ts
import { VERSE_FTS_COLUMNS } from './schema'

export interface BiblesRepo {
  ...existing...
  /** Backfill verse_fts for any version installed before the index existed. Called once at
   * startup from openDb — not lazily on first search, where a half-second stall would land
   * on the first keystroke mid-service. Idempotent. */
  ensureSearchIndex(): void
}

  const insertFts = db.prepare(
    `INSERT INTO verse_fts (${VERSE_FTS_COLUMNS.join(', ')}) VALUES (?,?,?,?,?)`
  )
  const deleteFts = db.prepare('DELETE FROM verse_fts WHERE version_id = ?')

  // inside install's transaction, next to insertVerse:
              insertVerse.run(bible.id, book.name, chapter.n, verse.n, verse.text)
              insertFts.run(bible.id, book.name, chapter.n, verse.n, verse.text)
  // inside uninstall's transaction, before deleteVerses:
        deleteFts.run(id)

    ensureSearchIndex() {
      const versions = db.prepare('SELECT id FROM bible_versions').all() as { id: string }[]
      for (const { id } of versions) {
        const have = (db.prepare('SELECT count(*) AS n FROM verse_fts WHERE version_id = ?').get(id) as { n: number }).n
        if (have > 0) continue
        try {
          db.transaction(() => {
            const rows = db
              .prepare('SELECT book, chapter, verse, text FROM verses WHERE version_id = ?')
              .all(id) as { book: string; chapter: number; verse: number; text: string }[]
            for (const r of rows) insertFts.run(id, r.book, r.chapter, r.verse, r.text)
          })()
        } catch (err) {
          // Leave this version unsearchable rather than failing boot.
          console.error(`verse_fts backfill failed for ${id}`, err)
        }
      }
    },
```

In `src/main/db.ts`, after the `music_key` migration:
```ts
import { createBiblesRepo } from './biblesRepo';
...
  createBiblesRepo(db).ensureSearchIndex();
  return db;
```
(`createBiblesRepo` only prepares statements; constructing a throwaway instance here is cheap and keeps `index.ts` untouched.)

- [ ] **Step 5: Run**

Run: `npx vitest run src/main/biblesRepo.test.ts src/main/bibleInstaller.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/schema.ts src/main/biblesRepo.ts src/main/db.ts src/main/biblesRepo.test.ts
git commit -m "feat(bibles): verse_fts index with install-time writes and startup backfill"
```

---

### Task 4: Verse scorer

**Files:**
- Create: `src/shared/search/verseScore.ts`
- Create: `src/shared/search/verseScore.test.ts`

**Interfaces:**
- Produces:
```ts
export interface VerseHit { book: string; chapter: number; verse: number; text: string }
export interface VerseSignals { score: number; phrase: number; covWeight: number; tf: number }
export function parseVerseQuery(q: string): { tokens: string[]; phrase: boolean }
export function scoreVerse(qts: string[], phrase: boolean, text: string): VerseSignals
export function rankVerses(q: string, rows: VerseHit[], limit?: number): VerseHit[]
export const verseKey = (v: { book: string; chapter: number; verse: number }) => `${v.book}:${v.chapter}:${v.verse}`
```
- Consumes: `norm`, `textSignals` from `./fuzzy`; `BOOKS` from `../scripture/books` (canonical index).

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/search/verseScore.test.ts
import { expect, test } from 'vitest';
import { parseVerseQuery, rankVerses, scoreVerse, verseKey, type VerseHit } from './verseScore';

const v = (book: string, chapter: number, verse: number, text: string): VerseHit => ({ book, chapter, verse, text });

test('parseVerseQuery: tokens via norm; surrounding quotes mean phrase', () => {
  expect(parseVerseQuery('For God so loved')).toEqual({ tokens: ['for', 'god', 'so', 'loved'], phrase: false });
  expect(parseVerseQuery('"in the beginning"')).toEqual({ tokens: ['in', 'the', 'beginning'], phrase: true });
  expect(parseVerseQuery('"john')).toEqual({ tokens: ['john'], phrase: false });
  expect(parseVerseQuery('   ')).toEqual({ tokens: [], phrase: false });
});

test('scoreVerse gates on every token matching (prefix/fuzzy count)', () => {
  expect(scoreVerse(['zaccheus', 'rich'], false, 'a man named Zaccheus, and he was rich').score).toBeGreaterThan(0);
  expect(scoreVerse(['zacchaeus'], false, 'a man named Zaccheus').score).toBeGreaterThan(0); // lev 1
  expect(scoreVerse(['prodigal', 'son'], false, 'the younger son went into a far country').score).toBe(0);
});

test('phrase queries additionally require the run', () => {
  expect(scoreVerse(['in', 'the', 'beginning'], true, 'In the beginning God created').phrase).toBe(3);
  expect(scoreVerse(['in', 'the', 'beginning'], true, 'the beginning was in God').score).toBe(0);
});

test('rankVerses: phrase run beats scattered words, then canonical order', () => {
  const rows = [
    v('Proverbs', 8, 23, 'I was set up from everlasting, from the beginning, or ever the earth was. In'),
    v('John', 1, 1, 'In the beginning was the Word, and the Word was with God.'),
    v('Genesis', 1, 1, 'In the beginning God created the heaven and the earth.'),
  ];
  const out = rankVerses('in the beginning', rows).map(verseKey);
  // phrase run of 3 in Genesis and John; Proverbs has the words but only a run of 2 → last
  // Genesis and John tie on phrase/cov/tf → canonical order puts Genesis first
  expect(out).toEqual(['Genesis:1:1', 'John:1:1', 'Proverbs:8:23']);
});

test('rankVerses: exact repeats (tf) lift a verse before canonical order decides', () => {
  const rows = [
    v('Isaiah', 65, 17, 'For, behold, I create new heavens and a new earth: and the former shall not be remembered.'),
    v('Revelation', 21, 1, 'And I saw a new heaven and a new earth: for the first heaven and the first earth were passed away.'),
  ];
  // both carry the 6-word run ("heavens" prefix-matches "heaven"); Revelation repeats
  // heaven/earth exactly → higher tf → first despite canonical order
  expect(rankVerses('new heaven and a new earth', rows).map(verseKey)).toEqual(['Revelation:21:1', 'Isaiah:65:17']);
});

test('rankVerses is independent of input order; single names list canonically', () => {
  const rows = [
    v('Luke', 19, 5, 'Zaccheus, make haste, and come down; for to day I must abide at thy house.'),
    v('Luke', 19, 8, 'And Zaccheus stood, and said unto the Lord; Behold, Lord, the half of my goods I give to the poor.'),
    v('Luke', 19, 2, 'And, behold, there was a man named Zaccheus, which was the chief among the publicans, and he was rich.'),
  ];
  const a = rankVerses('zaccheus', rows).map(verseKey);
  const b = rankVerses('zaccheus', [...rows].reverse()).map(verseKey);
  expect(a).toEqual(b);
  expect(a).toEqual(['Luke:19:2', 'Luke:19:5', 'Luke:19:8']);
});

test('rankVerses respects limit and drops non-matches', () => {
  const rows = [v('John', 11, 35, 'Jesus wept.'), v('John', 3, 16, 'For God so loved the world')];
  const out = rankVerses('jesus', rows, 1);
  expect(out.map(verseKey)).toEqual(['John:11:35']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/search/verseScore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/shared/search/verseScore.ts
import { norm, textSignals } from './fuzzy';
import { BOOKS } from '../scripture/books';

export interface VerseHit { book: string; chapter: number; verse: number; text: string }
export interface VerseSignals { score: number; phrase: number; covWeight: number; tf: number }

export const verseKey = (v: { book: string; chapter: number; verse: number }): string => `${v.book}:${v.chapter}:${v.verse}`;

const BOOK_INDEX = new Map(BOOKS.map((b, i) => [b.name, i]));
const bookIndex = (name: string): number => BOOK_INDEX.get(name) ?? Number.MAX_SAFE_INTEGER;

/** Tokens via the shared normaliser; a query wrapped in double quotes is a phrase query
 * (the words must appear in order). A lone leading quote — the entry's "force text search"
 * escape — is just stripped. */
export function parseVerseQuery(q: string): { tokens: string[]; phrase: boolean } {
  const raw = (q || '').trim();
  const phrase = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
  const tokens = norm(raw).split(' ').filter(Boolean);
  return { tokens, phrase };
}

/** Flat primary score (every token matches or the verse is out), plus the sub-signals that
 * order the plateau — same shape as scoreQuote. One segment: a verse is one unit. */
export function scoreVerse(qts: string[], phrase: boolean, text: string): VerseSignals {
  if (!qts.length) return { score: 0, phrase: 0, covWeight: 0, tf: 0 };
  const words = norm(text).split(' ').filter(Boolean);
  const s = textSignals([words], qts);
  if (s.matched < qts.length) return { score: 0, phrase: 0, covWeight: 0, tf: 0 };
  if (phrase && s.phrase < qts.length) return { score: 0, phrase: 0, covWeight: 0, tf: 0 };
  return { score: 300 + s.matched * 12, phrase: s.phrase, covWeight: s.covWeight, tf: s.tf };
}

/** Order: score ↓, phrase run ↓, covWeight ↓, tf ↓, then canonical (book, chapter, verse) ↑
 * so the result never depends on FTS return order. bm25 is deliberately NOT a tie-break:
 * its length normalisation would rank "Zaccheus, make haste" over the verse the story
 * starts on; it only decides which candidates survive the repo's LIMIT. */
export function rankVerses(q: string, rows: VerseHit[], limit = 50): VerseHit[] {
  const { tokens, phrase } = parseVerseQuery(q);
  if (!tokens.length) return [];
  return rows
    .map((r) => ({ r, s: scoreVerse(tokens, phrase, r.text) }))
    .filter((x) => x.s.score > 0)
    .sort((a, b) => {
      if (b.s.score !== a.s.score) return b.s.score - a.s.score;
      if (b.s.phrase !== a.s.phrase) return b.s.phrase - a.s.phrase;
      if (b.s.covWeight !== a.s.covWeight) return b.s.covWeight - a.s.covWeight;
      if (b.s.tf !== a.s.tf) return b.s.tf - a.s.tf;
      const bi = bookIndex(a.r.book) - bookIndex(b.r.book);
      if (bi) return bi;
      if (a.r.chapter !== b.r.chapter) return a.r.chapter - b.r.chapter;
      return a.r.verse - b.r.verse;
    })
    .slice(0, limit)
    .map((x) => x.r);
}
```

- [ ] **Step 4: Run**

Run: `npx vitest run src/shared/search/verseScore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/search/verseScore.ts src/shared/search/verseScore.test.ts
git commit -m "feat(search): verse scorer with deterministic canonical tie-break"
```

---

### Task 5: `biblesRepo.search` with vocabulary typo expansion

**Files:**
- Modify: `src/main/biblesRepo.ts`
- Modify: `src/main/biblesRepo.test.ts`
- Modify: `src/shared/types.ts` (add `VerseSearchResult`)

**Interfaces:**
- Produces: `BiblesRepo.search(q: string, versionId: string, limit?: number): VerseSearchResult` where
```ts
export interface VerseSearchResult { hits: VerseHit[]; total: number; versionId: string }
```
  (`VerseHit` re-exported from `src/shared/types.ts` via `export type { VerseHit } from './search/verseScore'`.)
- Consumes: `andGroupsMatch`, `FTS_CANDIDATE_LIMIT` (Task 1); `rankVerses`, `parseVerseQuery` (Task 4); `matchDist`, `matchTol` from `fuzzy.ts`.

- [ ] **Step 1: Failing tests** (append to `biblesRepo.test.ts`)

```ts
const lukeKjv: NormalizedBible = {
  id: 'kjv2', abbr: 'KJV', name: 'KJV (Luke)', language: 'en',
  books: [{ name: 'Luke', chapters: [{ n: 19, verses: [
    { n: 2, text: 'And, behold, there was a man named Zaccheus, which was the chief among the publicans, and he was rich.' },
    { n: 5, text: 'Zaccheus, make haste, and come down; for to day I must abide at thy house.' },
    { n: 10, text: 'For the Son of man is come to seek and to save that which was lost.' }
  ] }] }, { name: 'John', chapters: [{ n: 11, verses: [{ n: 35, text: 'Jesus wept.' }] }] }]
}

test('search: prefix match, total, version filter', () => {
  repo.install(kjv)
  repo.install(esv)
  const r = repo.search('begin', 'kjv')
  expect(r.versionId).toBe('kjv')
  expect(r.total).toBe(2)
  expect(r.hits.map((h) => `${h.book} ${h.chapter}:${h.verse}`)).toEqual(['Genesis 1:1', 'John 1:1'])
  expect(repo.search('heavens', 'kjv').total).toBe(0) // "heavens" is ESV-only
})

test('search: AND across words', () => {
  repo.install(kjv)
  expect(repo.search('beginning word', 'kjv').hits.map((h) => h.book)).toEqual(['John'])
  expect(repo.search('beginning zebra', 'kjv').total).toBe(0)
})

test('search: quoted phrase requires the run', () => {
  repo.install(kjv)
  expect(repo.search('"the beginning was"', 'kjv').hits.map((h) => h.book)).toEqual(['John'])
  expect(repo.search('"beginning the"', 'kjv').total).toBe(0)
})

test('search: a misspelt word that no term starts with is expanded via the vocabulary', () => {
  repo.install(lukeKjv)
  expect(repo.search('zacchaeus', 'kjv2').hits.map((h) => h.verse)).toEqual([2, 5])
  expect(repo.search('wepts', 'kjv2').hits.map((h) => h.book)).toEqual(['John'])
})

test('search: a word with prefix matches is NOT fuzzed (no pollution)', () => {
  repo.install(lukeKjv)
  // "los" prefixes "lost" → only Luke 19:10; it must not also fuzz to "son"/"for"
  expect(repo.search('los', 'kjv2').hits.map((h) => h.verse)).toEqual([10])
})

test('search: empty / punctuation-only query returns nothing', () => {
  repo.install(kjv)
  expect(repo.search('', 'kjv')).toEqual({ hits: [], total: 0, versionId: 'kjv' })
  expect(repo.search('"', 'kjv')).toEqual({ hits: [], total: 0, versionId: 'kjv' })
})

test('search: vocabulary cache is refreshed by a later install', () => {
  repo.install(kjv)
  expect(repo.search('zacchaeus', 'kjv2').total).toBe(0) // kjv2 not installed; also warms the vocab cache
  repo.install(lukeKjv)
  expect(repo.search('zacchaeus', 'kjv2').total).toBe(2)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/biblesRepo.test.ts`
Expected: FAIL — `repo.search is not a function`.

- [ ] **Step 3: Types**

In `src/shared/types.ts` near `BookExtent`:
```ts
export type { VerseHit } from './search/verseScore';
export interface VerseSearchResult { hits: import('./search/verseScore').VerseHit[]; total: number; versionId: string }
```
(If the file's style prefers a plain import at the top, use `import type { VerseHit } from './search/verseScore'` and `hits: VerseHit[]`.)

- [ ] **Step 4: Implement `search`**

In `src/main/biblesRepo.ts`:
```ts
import type { BookExtent, ChapterData, InstalledVersion, NormalizedBible, VerseSearchResult } from '../shared/types'
import { andGroupsMatch, FTS_CANDIDATE_LIMIT } from './ftsQuery'
import { matchDist, matchTol } from '../shared/search/fuzzy'
import { parseVerseQuery, rankVerses, type VerseHit } from '../shared/search/verseScore'

export interface BiblesRepo {
  ...
  /** Ranked verse-text search over one version. See the bible-quick-find spec: AND across
   * words, typo expansion via the vocabulary, bm25 as a tie-break, canonical order last. */
  search(q: string, versionId: string, limit?: number): VerseSearchResult
}

  // --- inside createBiblesRepo ---
  // bm25 orders the CUT only (best candidates survive the LIMIT); the scorer's ladder
  // decides the final order and ends in canonical order — see verseScore.ts.
  const selectHits = db.prepare(
    `SELECT book, chapter, verse, text FROM verse_fts
     WHERE verse_fts MATCH ? AND version_id = ? ORDER BY bm25(verse_fts) LIMIT ${FTS_CANDIDATE_LIMIT}`
  )
  const countHits = db.prepare('SELECT count(*) AS n FROM verse_fts WHERE verse_fts MATCH ? AND version_id = ?')
  const selectVocab = db.prepare('SELECT term FROM verse_vocab')

  // Vocabulary of every indexed term, loaded on first search and dropped when the index
  // changes (install / uninstall / backfill). Shared across versions — fts5vocab can't be
  // filtered by an UNINDEXED column — which only means a KJV spelling can expand a typo
  // while searching WEB; the MATCH itself is still version-filtered.
  let vocab: string[] | null = null
  const invalidateVocab = (): void => { vocab = null }
  const getVocab = (): string[] => (vocab ??= (selectVocab.all() as { term: string }[]).map((r) => r.term))

  // A typed word that no vocabulary term starts with is a likely typo: expand it to the
  // terms within edit tolerance. Words that DO have prefix matches are left alone — fuzzing
  // "los" into "son"/"for" would pollute a perfectly good prefix query.
  const expandToken = (tok: string): string[] => {
    const terms = getVocab()
    if (terms.some((t) => t.startsWith(tok))) return [tok]
    if (tok.length < 3) return [tok]
    const tol = matchTol(tok.length)
    const near = terms.filter((t) => matchDist(tok, t) <= tol)
    return [tok, ...near]
  }
```
Call `invalidateVocab()` at the end of `install`, `uninstall`, and after each backfilled version in `ensureSearchIndex`.

```ts
    search(q, versionId, limit = 50) {
      const { tokens } = parseVerseQuery(q)
      if (!tokens.length) return { hits: [], total: 0, versionId }
      const groups = tokens.map(expandToken)
      const match = andGroupsMatch(groups)
      const rows = selectHits.all(match, versionId) as VerseHit[]
      const ranked = rankVerses(q, rows)
      const hits = ranked.slice(0, limit)
      const total = phrase && rows.length < FTS_CANDIDATE_LIMIT
        ? ranked.length // the scorer's phrase gate dropped candidates; exact when the cut wasn't hit
        : (countHits.get(match, versionId) as { n: number }).n
      return { hits, total, versionId }
    },
```
(`const { tokens, phrase } = parseVerseQuery(q)` at the top of `search` — `phrase` feeds the `total` choice above. `limit` only caps `hits`; `total` is the full count.)

- [ ] **Step 5: Run**

Run: `npx vitest run src/main/biblesRepo.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/biblesRepo.ts src/main/biblesRepo.test.ts src/shared/types.ts
git commit -m "feat(bibles): ranked verse search with vocabulary typo expansion"
```

---

### Task 6: Gold-query ranking test over the bundled KJV

**Files:**
- Create: `src/main/bibleSearchRanking.test.ts`

**Interfaces:**
- Consumes: `BIBLE_MANIFEST`, `normalizeGetBible` (`bibleSource.ts`), `createBiblesRepo`, `openTestDb`.

- [ ] **Step 1: Write the test**

```ts
// src/main/bibleSearchRanking.test.ts
// The quality guard for verse search: real KJV, real index, ~25 operator queries with the
// verse an operator means. Keep this green when touching verseScore / biblesRepo.search.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, expect, test } from 'vitest'
import { openTestDb } from './testDb'
import { createBiblesRepo, type BiblesRepo } from './biblesRepo'
import { BIBLE_MANIFEST, normalizeGetBible } from './bibleSource'
import { verseKey } from '../shared/search/verseScore'

let repo: BiblesRepo

beforeAll(() => {
  const entry = BIBLE_MANIFEST.find((e) => e.id === 'kjv')!
  const raw = JSON.parse(readFileSync(join(__dirname, '../../resources/bibles/kjv.json'), 'utf-8'))
  repo = createBiblesRepo(openTestDb())
  repo.install(normalizeGetBible(raw, entry))
}, 60_000)

const top = (q: string, n = 3): string[] => repo.search(q, 'kjv').hits.slice(0, n).map(verseKey)

// [query, expected top-1]  — famous phrases, names, places, typos
const TOP1: [string, string][] = [
  ['for god so loved', 'John:3:16'],
  ['god so loved the world', 'John:3:16'],
  ['jesus wept', 'John:11:35'],
  ['the lord is my shepherd', 'Psalm:23:1'],
  ['"in the beginning"', 'Genesis:1:1'],
  ['in the beginning was the word', 'John:1:1'],
  ['be still and know', 'Psalm:46:10'],
  ['faith hope charity', '1 Corinthians:13:13'],
  ['blessed are the poor in spirit', 'Matthew:5:3'],
  ['our father which art in heaven', 'Matthew:6:9'],
  ['new heaven and a new earth', 'Revelation:21:1'],
  ['zaccheus', 'Luke:19:2'],
  ['zacchaeus', 'Luke:19:2'],           // modern spelling → vocab expansion
  ['jesus wepts', 'John:11:35'],        // typo expansion
  ['emmaus', 'Luke:24:13'],
  ['nicodemus', 'John:3:1'],
  ['goliath', '1 Samuel:17:4'],
  ['bethlehem of judaea', 'Matthew:2:1'],
  ['armour of god', 'Ephesians:6:11'],
  ['fruit of the spirit', 'Galatians:5:22'],
  ['fiery furnace', 'Daniel:3:6'],
  ['lazarus come forth', 'John:11:43'],
]

for (const [q, want] of TOP1) {
  test(`top-1: "${q}" → ${want}`, () => {
    expect(top(q, 1)[0]).toBe(want)
  })
}

// [query, one of these in top-3]
const TOP3: [string, string[]][] = [
  // single names list canonically — first mention leads
  ['lazarus', ['Luke:16:20']],
  ['mustard seed', ['Matthew:13:31', 'Matthew:17:20']],
]

test('a plain place name returns every mention, in canonical order', () => {
  const r = repo.search('bethlehem', 'kjv')
  expect(r.total).toBeGreaterThanOrEqual(8)
  expect(r.hits[0].book).toBe('Genesis') // Genesis 35:19, the first mention
})

for (const [q, any] of TOP3) {
  test(`top-3: "${q}" contains one of ${any.join(' | ')}`, () => {
    const got = top(q, 3)
    expect(got.some((k) => any.includes(k))).toBe(true)
  })
}

test('a word the KJV never uses returns nothing (passages layer covers it)', () => {
  expect(repo.search('prodigal', 'kjv').total).toBe(0)
})

test('a single-word query over 31k verses is fast enough for a keystroke', () => {
  const t0 = performance.now()
  repo.search('love', 'kjv')
  repo.search('lord', 'kjv')
  repo.search('zacchaeus', 'kjv')
  expect(performance.now() - t0).toBeLessThan(300) // CI-safe; real target is ~16 ms each
})
```

- [ ] **Step 2: Run and fix expectations honestly**

Run: `npx vitest run src/main/bibleSearchRanking.test.ts`
Expected: most PASS. For any failure, check whether the *scorer* is wrong or the *gold* is wrong (e.g. the KJV's exact wording: it says "faith, hope, charity" and "Zaccheus"; Psalm book name is `Psalm`). Fix the scorer if a phrase run or canonical tie isn't winning as the spec says; fix the gold only when the expected verse is genuinely not the best answer in KJV wording. Do not delete queries to get green — note any you had to relax in the commit body.

- [ ] **Step 3: Commit**

```bash
git add src/main/bibleSearchRanking.test.ts
git commit -m "test(bibles): gold-query ranking guard over the bundled KJV"
```

---

### Task 7: IPC — `bibles:search`

**Files:**
- Modify: `src/shared/ipc.ts` (CH list, near `biblesBookExtent`)
- Modify: `src/shared/types.ts` (`HelmApi.bibles`)
- Modify: `src/preload/index.ts:41-42`
- Modify: `src/main/ipc.ts:83-89`

**Interfaces:**
- Produces: `CH.biblesSearch = 'bibles:search'`; `window.helm.bibles.search(q: string, versionId: string): Promise<VerseSearchResult>`.

- [ ] **Step 1: Wire it**

`src/shared/ipc.ts` after `biblesBookExtent: 'bibles:bookExtent',`:
```ts
  biblesSearch: 'bibles:search',
```
`src/shared/types.ts` in `bibles: { ... }`:
```ts
    search(q: string, versionId: string): Promise<VerseSearchResult>;
```
`src/preload/index.ts` after `bookExtent`:
```ts
    search: (q, versionId) => ipcRenderer.invoke(CH.biblesSearch, q, versionId),
```
`src/main/ipc.ts` after the `biblesBookExtent` handler:
```ts
  ipcMain.handle(CH.biblesSearch, (_e, q: string, versionId: string) =>
    biblesRepo.search(q, versionId),
  );
```

- [ ] **Step 2: Typecheck + any ipc tests**

Run: `npm run typecheck && npx vitest run src/main/ipc* src/preload 2>/dev/null || npm run typecheck`
Expected: typecheck PASS. (If a test enumerates `CH` keys or the preload surface — `grep -rn "biblesBookExtent" src --include='*.test.*'` — add `biblesSearch` alongside.)

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipc.ts src/shared/types.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat(ipc): bibles:search"
```

---

### Task 8: Curated passages

**Files:**
- Create: `src/shared/scripture/passages.ts`
- Create: `src/shared/scripture/passages.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Passage { title: string; aliases: string[]; book: string; ch: number; from: number; to: number }
export const PASSAGES: Passage[]
export function matchPassages(q: string, limit?: number): Passage[]
```
- Consumes: `norm`, `textSignals` (`../search/fuzzy`), `BOOKS` (`./books`), `parseVerseQuery` (`../search/verseScore`).

- [ ] **Step 1: Failing tests**

```ts
// src/shared/scripture/passages.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { PASSAGES, matchPassages } from './passages'
import { BOOKS } from './books'

test('prodigal son → Luke 15:11-32 (phrase beats a scattered alias hit)', () => {
  expect(matchPassages('prodigal son')[0]).toMatchObject({ book: 'Luke', ch: 15, from: 11, to: 32 })
  expect(matchPassages('prodigal')[0].title).toBe('The Prodigal Son')
})

test('aliases and fuzzy spellings match', () => {
  expect(matchPassages('lords prayer')[0]).toMatchObject({ book: 'Matthew', ch: 6, from: 9 })
  expect(matchPassages('lost son')[0].title).toBe('The Prodigal Son')
  expect(matchPassages('beattitudes')[0].title).toBe('The Beatitudes')
  expect(matchPassages('armor of god')[0]).toMatchObject({ book: 'Ephesians', ch: 6 })
})

test('every query word must match; limit honoured; empty query → []', () => {
  expect(matchPassages('prodigal zebra')).toEqual([])
  expect(matchPassages('parable', 2)).toHaveLength(2)
  expect(matchPassages('')).toEqual([])
})

test('ties break by title length then canonical order, independent of table order', () => {
  const a = matchPassages('parable', 100).map((p) => p.title)
  const b = matchPassages('parable', 100).map((p) => p.title)
  expect(a).toEqual(b)
  expect(a.length).toBeGreaterThan(5)
})

test('every passage names a real book and a range inside the bundled KJV', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../../resources/bibles/kjv.json'), 'utf-8')) as {
    books: { name: string; chapters: { chapter: number; verses: { verse: number }[] }[] }[]
  }
  // KJV raw uses "Psalms"; the canonical name is "Psalm" (see books.ts)
  const byBook = new Map(raw.books.map((b) => [b.name === 'Psalms' ? 'Psalm' : b.name, b]))
  const names = new Set(BOOKS.map((b) => b.name))
  for (const p of PASSAGES) {
    expect(names.has(p.book), p.title).toBe(true)
    const b = byBook.get(p.book)!
    const chapter = b.chapters.find((c) => c.chapter === p.ch)
    expect(chapter, `${p.title}: ${p.book} ${p.ch}`).toBeTruthy()
    const last = chapter!.verses[chapter!.verses.length - 1].verse
    expect(p.from >= 1 && p.from <= p.to && p.to <= last, `${p.title}: ${p.book} ${p.ch}:${p.from}-${p.to} (max ${last})`).toBe(true)
  }
  expect(PASSAGES.length).toBeGreaterThanOrEqual(150)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/scripture/passages.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/shared/scripture/passages.ts
// Hand-curated "the story of…" / "the … chapter" map for the quick-find: things an
// operator names that aren't in the verse text ("prodigal son" never appears in the KJV).
// Matched in the renderer — static data, no IPC. Titles are display strings; aliases are
// extra ways people say it. Ranges are validated against the bundled KJV in passages.test.
import { norm, textSignals } from '../search/fuzzy'
import { parseVerseQuery } from '../search/verseScore'
import { BOOKS } from './books'

export interface Passage { title: string; aliases: string[]; book: string; ch: number; from: number; to: number }

const P = (title: string, book: string, ch: number, from: number, to: number, ...aliases: string[]): Passage =>
  ({ title, aliases, book, ch, from, to })

export const PASSAGES: Passage[] = [
  // --- Genesis / Pentateuch
  P('Creation', 'Genesis', 1, 1, 31, 'in the beginning', 'seven days', 'creation story'),
  P('Adam and Eve', 'Genesis', 2, 4, 25, 'garden of eden', 'eden'),
  P('The Fall', 'Genesis', 3, 1, 24, 'serpent', 'forbidden fruit', 'fall of man'),
  P('Cain and Abel', 'Genesis', 4, 1, 16, 'my brothers keeper'),
  P('Noah and the Flood', 'Genesis', 6, 9, 22, 'ark', 'flood', 'noahs ark'),
  P('The Rainbow Covenant', 'Genesis', 9, 8, 17, 'rainbow'),
  P('Tower of Babel', 'Genesis', 11, 1, 9, 'babel'),
  P('The Call of Abram', 'Genesis', 12, 1, 9, 'abraham called', 'go from your country'),
  P('Abraham Offers Isaac', 'Genesis', 22, 1, 19, 'sacrifice of isaac', 'binding of isaac', 'mount moriah'),
  P('Jacob\'s Ladder', 'Genesis', 28, 10, 22, 'jacobs dream', 'bethel'),
  P('Jacob Wrestles with God', 'Genesis', 32, 22, 32, 'jacob wrestles', 'peniel'),
  P('Joseph\'s Coat', 'Genesis', 37, 1, 36, 'coat of many colours', 'coat of many colors', 'joseph sold'),
  P('Joseph Reveals Himself', 'Genesis', 45, 1, 15, 'joseph brothers', 'you meant evil against me'),
  P('Moses and the Burning Bush', 'Exodus', 3, 1, 22, 'burning bush', 'i am that i am'),
  P('The Passover', 'Exodus', 12, 1, 28, 'passover lamb'),
  P('Crossing the Red Sea', 'Exodus', 14, 10, 31, 'red sea', 'parting of the sea'),
  P('Manna from Heaven', 'Exodus', 16, 1, 36, 'manna'),
  P('The Ten Commandments', 'Exodus', 20, 1, 17, 'ten commandments', 'decalogue', 'commandments'),
  P('The Golden Calf', 'Exodus', 32, 1, 35, 'golden calf'),
  P('The Priestly Blessing', 'Numbers', 6, 22, 27, 'the lord bless thee and keep thee', 'aaronic blessing'),
  P('The Bronze Serpent', 'Numbers', 21, 4, 9, 'brazen serpent', 'serpent on a pole'),
  P('Balaam\'s Donkey', 'Numbers', 22, 21, 35, 'balaam', 'talking donkey'),
  P('The Shema', 'Deuteronomy', 6, 4, 9, 'hear o israel', 'shema'),
  P('Choose Life', 'Deuteronomy', 30, 11, 20, 'choose life'),
  // --- History
  P('Be Strong and Courageous', 'Joshua', 1, 1, 9, 'be strong and of a good courage'),
  P('Rahab and the Spies', 'Joshua', 2, 1, 24, 'rahab'),
  P('The Walls of Jericho', 'Joshua', 6, 1, 27, 'jericho', 'walls fell'),
  P('As for Me and My House', 'Joshua', 24, 14, 15, 'as for me and my house'),
  P('Gideon\'s Fleece', 'Judges', 6, 36, 40, 'gideon fleece'),
  P('Gideon\'s Three Hundred', 'Judges', 7, 1, 25, 'gideon 300', 'three hundred men'),
  P('Samson and Delilah', 'Judges', 16, 4, 31, 'samson', 'delilah'),
  P('Ruth and Naomi', 'Ruth', 1, 1, 22, 'whither thou goest', 'ruth'),
  P('Hannah\'s Prayer', '1 Samuel', 1, 9, 28, 'hannah'),
  P('Samuel Called', '1 Samuel', 3, 1, 21, 'speak lord for thy servant heareth', 'samuel hears god'),
  P('David Anointed', '1 Samuel', 16, 1, 13, 'man looketh on the outward appearance', 'samuel anoints david'),
  P('David and Goliath', '1 Samuel', 17, 1, 58, 'goliath', 'five smooth stones'),
  P('David and Jonathan', '1 Samuel', 18, 1, 4, 'jonathan covenant'),
  P('David and Bathsheba', '2 Samuel', 11, 1, 27, 'bathsheba', 'uriah'),
  P('Nathan Confronts David', '2 Samuel', 12, 1, 14, 'thou art the man', 'nathan'),
  P('Solomon Asks for Wisdom', '1 Kings', 3, 5, 15, 'solomon wisdom', 'an understanding heart'),
  P('Solomon\'s Judgment', '1 Kings', 3, 16, 28, 'divide the child', 'two mothers'),
  P('Elijah and the Ravens', '1 Kings', 17, 1, 7, 'ravens', 'brook cherith'),
  P('Elijah and the Widow of Zarephath', '1 Kings', 17, 8, 24, 'zarephath', 'widows oil', 'cruse of oil'),
  P('Elijah on Mount Carmel', '1 Kings', 18, 20, 40, 'prophets of baal', 'mount carmel', 'fire from heaven'),
  P('The Still Small Voice', '1 Kings', 19, 9, 18, 'still small voice', 'elijah cave'),
  P('Elijah Taken Up', '2 Kings', 2, 1, 14, 'chariot of fire', 'elijah whirlwind', 'elisha mantle'),
  P('Naaman Healed', '2 Kings', 5, 1, 19, 'naaman', 'dip seven times', 'leprosy jordan'),
  P('The Axe Head Floats', '2 Kings', 6, 1, 7, 'axe head'),
  P('Horses and Chariots of Fire', '2 Kings', 6, 8, 23, 'open his eyes', 'more with us'),
  P('Hezekiah\'s Prayer', '2 Kings', 19, 14, 19, 'hezekiah'),
  P('Jabez', '1 Chronicles', 4, 9, 10, 'prayer of jabez'),
  P('If My People', '2 Chronicles', 7, 11, 22, 'if my people which are called by my name', 'heal their land'),
  P('Nehemiah Rebuilds the Wall', 'Nehemiah', 2, 11, 20, 'rebuild the wall'),
  P('Esther: For Such a Time as This', 'Esther', 4, 1, 17, 'for such a time as this', 'esther'),
  P('Job\'s Trials', 'Job', 1, 1, 22, 'the lord gave and the lord hath taken away', 'job'),
  P('I Know That My Redeemer Liveth', 'Job', 19, 23, 27, 'my redeemer liveth'),
  P('God Answers Job', 'Job', 38, 1, 41, 'where wast thou', 'out of the whirlwind'),
  // --- Psalms / Wisdom
  P('Psalm 1: Blessed Is the Man', 'Psalm', 1, 1, 6, 'blessed is the man', 'tree planted by the rivers'),
  P('Psalm 8: What Is Man', 'Psalm', 8, 1, 9, 'what is man'),
  P('Psalm 19: The Heavens Declare', 'Psalm', 19, 1, 14, 'heavens declare'),
  P('Psalm 22: My God, Why Hast Thou Forsaken Me', 'Psalm', 22, 1, 31, 'forsaken me'),
  P('Psalm 23: The Lord Is My Shepherd', 'Psalm', 23, 1, 6, 'shepherd psalm', 'valley of the shadow of death'),
  P('Psalm 24: The King of Glory', 'Psalm', 24, 1, 10, 'king of glory', 'lift up your heads'),
  P('Psalm 27: The Lord Is My Light', 'Psalm', 27, 1, 14, 'my light and my salvation'),
  P('Psalm 32: Blessed Is He Whose Transgression Is Forgiven', 'Psalm', 32, 1, 11, 'transgression forgiven'),
  P('Psalm 34: Taste and See', 'Psalm', 34, 1, 22, 'taste and see'),
  P('Psalm 37: Fret Not', 'Psalm', 37, 1, 11, 'fret not', 'delight thyself in the lord'),
  P('Psalm 40: He Brought Me Up Out of the Pit', 'Psalm', 40, 1, 5, 'horrible pit', 'new song'),
  P('Psalm 42: As the Deer', 'Psalm', 42, 1, 11, 'as the hart panteth', 'as the deer'),
  P('Psalm 46: God Is Our Refuge', 'Psalm', 46, 1, 11, 'be still and know', 'refuge and strength'),
  P('Psalm 51: Create in Me a Clean Heart', 'Psalm', 51, 1, 19, 'clean heart', 'have mercy upon me o god', 'davids repentance'),
  P('Psalm 84: How Amiable Are Thy Tabernacles', 'Psalm', 84, 1, 12, 'better is a day in thy courts'),
  P('Psalm 90: Teach Us to Number Our Days', 'Psalm', 90, 1, 17, 'number our days'),
  P('Psalm 91: He That Dwelleth in the Secret Place', 'Psalm', 91, 1, 16, 'secret place of the most high', 'shadow of the almighty'),
  P('Psalm 100: Make a Joyful Noise', 'Psalm', 100, 1, 5, 'joyful noise', 'enter into his gates'),
  P('Psalm 103: Bless the Lord, O My Soul', 'Psalm', 103, 1, 22, 'bless the lord o my soul', 'as far as the east is from the west'),
  P('Psalm 118: This Is the Day', 'Psalm', 118, 19, 29, 'this is the day which the lord hath made'),
  P('Psalm 119: Thy Word Is a Lamp', 'Psalm', 119, 105, 112, 'lamp unto my feet'),
  P('Psalm 121: I Will Lift Up Mine Eyes', 'Psalm', 121, 1, 8, 'lift up mine eyes unto the hills', 'my help cometh'),
  P('Psalm 127: Except the Lord Build the House', 'Psalm', 127, 1, 5, 'except the lord build the house', 'children are an heritage'),
  P('Psalm 133: How Good and How Pleasant', 'Psalm', 133, 1, 3, 'brethren dwell together in unity'),
  P('Psalm 139: Fearfully and Wonderfully Made', 'Psalm', 139, 1, 24, 'fearfully and wonderfully made', 'search me o god'),
  P('Psalm 150: Praise Ye the Lord', 'Psalm', 150, 1, 6, 'let every thing that hath breath'),
  P('Trust in the Lord with All Thine Heart', 'Proverbs', 3, 1, 12, 'trust in the lord', 'lean not unto thine own understanding'),
  P('The Virtuous Woman', 'Proverbs', 31, 10, 31, 'proverbs 31 woman', 'virtuous woman', 'wife of noble character'),
  P('A Time for Everything', 'Ecclesiastes', 3, 1, 8, 'to every thing there is a season', 'a time to be born'),
  P('Remember Thy Creator', 'Ecclesiastes', 12, 1, 14, 'remember now thy creator', 'fear god and keep his commandments'),
  // --- Prophets
  P('Isaiah\'s Call: Here Am I', 'Isaiah', 6, 1, 13, 'here am i send me', 'holy holy holy', 'isaiah vision'),
  P('Unto Us a Child Is Born', 'Isaiah', 9, 1, 7, 'unto us a child is born', 'prince of peace', 'wonderful counsellor'),
  P('They That Wait upon the Lord', 'Isaiah', 40, 27, 31, 'wait upon the lord', 'mount up with wings as eagles', 'comfort ye'),
  P('Fear Not, I Am with Thee', 'Isaiah', 41, 8, 13, 'fear thou not for i am with thee'),
  P('When Thou Passest Through the Waters', 'Isaiah', 43, 1, 7, 'through the waters', 'called thee by thy name'),
  P('The Suffering Servant', 'Isaiah', 53, 1, 12, 'suffering servant', 'by his stripes', 'wounded for our transgressions'),
  P('Come, Everyone That Thirsteth', 'Isaiah', 55, 1, 13, 'my ways are not your ways', 'ho every one that thirsteth'),
  P('The Spirit of the Lord Is upon Me', 'Isaiah', 61, 1, 3, 'beauty for ashes', 'spirit of the lord god is upon me'),
  P('Jeremiah\'s Call', 'Jeremiah', 1, 4, 10, 'before i formed thee'),
  P('The Potter and the Clay', 'Jeremiah', 18, 1, 12, 'potter', 'clay'),
  P('Plans to Prosper You', 'Jeremiah', 29, 10, 14, 'thoughts of peace', 'plans to prosper', 'expected end', 'jeremiah 29 11'),
  P('The New Covenant', 'Jeremiah', 31, 31, 34, 'new covenant', 'law in their inward parts'),
  P('Great Is Thy Faithfulness', 'Lamentations', 3, 22, 26, 'new every morning', 'great is thy faithfulness'),
  P('Valley of Dry Bones', 'Ezekiel', 37, 1, 14, 'dry bones'),
  P('A New Heart', 'Ezekiel', 36, 24, 28, 'heart of stone', 'heart of flesh'),
  P('The Fiery Furnace', 'Daniel', 3, 1, 30, 'shadrach meshach abednego', 'furnace', 'three hebrew children'),
  P('The Writing on the Wall', 'Daniel', 5, 1, 31, 'mene mene tekel', 'belshazzar', 'handwriting on the wall'),
  P('Daniel in the Lions\' Den', 'Daniel', 6, 1, 28, 'lions den', 'daniel lions'),
  P('Jonah and the Great Fish', 'Jonah', 1, 1, 17, 'jonah', 'whale', 'great fish'),
  P('Jonah\'s Prayer', 'Jonah', 2, 1, 10, 'belly of the fish'),
  P('What Doth the Lord Require', 'Micah', 6, 6, 8, 'do justly love mercy walk humbly'),
  P('The Just Shall Live by Faith', 'Habakkuk', 2, 1, 4, 'write the vision', 'just shall live by his faith'),
  P('Bring Ye All the Tithes', 'Malachi', 3, 6, 12, 'tithes', 'windows of heaven', 'storehouse'),
  // --- Gospels: birth & early
  P('The Annunciation', 'Luke', 1, 26, 38, 'gabriel mary', 'annunciation', 'hail thou that art highly favoured'),
  P('The Magnificat', 'Luke', 1, 46, 55, 'my soul doth magnify the lord', 'marys song'),
  P('The Nativity', 'Luke', 2, 1, 20, 'birth of jesus', 'christmas story', 'manger', 'shepherds', 'no room in the inn'),
  P('The Wise Men', 'Matthew', 2, 1, 12, 'magi', 'wise men', 'star in the east', 'gold frankincense myrrh'),
  P('Flight into Egypt', 'Matthew', 2, 13, 23, 'flight to egypt', 'herod slaughter'),
  P('The Boy Jesus in the Temple', 'Luke', 2, 41, 52, 'about my fathers business', 'jesus age twelve'),
  P('The Baptism of Jesus', 'Matthew', 3, 13, 17, 'baptism', 'this is my beloved son'),
  P('The Temptation of Jesus', 'Matthew', 4, 1, 11, 'temptation', 'wilderness forty days', 'man shall not live by bread alone'),
  P('Calling of the First Disciples', 'Matthew', 4, 18, 22, 'fishers of men', 'follow me'),
  P('Water into Wine', 'John', 2, 1, 11, 'wedding at cana', 'cana', 'first miracle'),
  P('Jesus Cleanses the Temple', 'John', 2, 13, 22, 'moneychangers', 'den of thieves', 'cleansing of the temple'),
  P('Nicodemus: Born Again', 'John', 3, 1, 21, 'born again', 'nicodemus', 'john 3 16', 'god so loved the world'),
  P('The Woman at the Well', 'John', 4, 1, 42, 'samaritan woman', 'living water', 'woman at the well'),
  P('The Pool of Bethesda', 'John', 5, 1, 15, 'bethesda', 'wilt thou be made whole', 'take up thy bed'),
  // --- Sermon on the Mount
  P('The Sermon on the Mount', 'Matthew', 5, 1, 48, 'sermon on the mount'),
  P('The Beatitudes', 'Matthew', 5, 1, 12, 'beatitudes', 'blessed are the poor in spirit', 'blessed are'),
  P('Salt and Light', 'Matthew', 5, 13, 16, 'salt of the earth', 'light of the world', 'city on a hill', 'let your light so shine'),
  P('Love Your Enemies', 'Matthew', 5, 38, 48, 'turn the other cheek', 'love your enemies', 'go the extra mile'),
  P('The Lord\'s Prayer', 'Matthew', 6, 9, 15, 'lords prayer', 'our father', 'our father which art in heaven', 'the lord prayer'),
  P('Treasures in Heaven', 'Matthew', 6, 19, 24, 'lay up treasures in heaven', 'no man can serve two masters', 'mammon'),
  P('Consider the Lilies', 'Matthew', 6, 25, 34, 'take no thought', 'lilies of the field', 'seek ye first', 'do not worry'),
  P('Judge Not', 'Matthew', 7, 1, 6, 'judge not', 'mote and beam', 'speck and plank'),
  P('Ask, Seek, Knock', 'Matthew', 7, 7, 12, 'ask and it shall be given', 'seek and ye shall find', 'golden rule'),
  P('The Narrow Gate', 'Matthew', 7, 13, 14, 'strait gate', 'narrow way'),
  P('Wise and Foolish Builders', 'Matthew', 7, 24, 29, 'house on the rock', 'house upon the sand', 'wise man built his house'),
  // --- Miracles
  P('The Centurion\'s Servant', 'Matthew', 8, 5, 13, 'centurion', 'speak the word only'),
  P('Jesus Calms the Storm', 'Mark', 4, 35, 41, 'calms the storm', 'peace be still', 'stilling the storm', 'storm on the sea'),
  P('The Gadarene Demoniac', 'Mark', 5, 1, 20, 'legion', 'swine', 'demoniac', 'gadarene', 'gerasene'),
  P('Jairus\' Daughter', 'Mark', 5, 21, 43, 'jairus', 'talitha cumi', 'damsel arise'),
  P('The Woman with the Issue of Blood', 'Mark', 5, 25, 34, 'hem of his garment', 'issue of blood', 'touched his garment'),
  P('Feeding the Five Thousand', 'John', 6, 1, 14, 'five loaves and two fishes', 'feeding of the 5000', 'five thousand', 'loaves and fishes'),
  P('Jesus Walks on Water', 'Matthew', 14, 22, 33, 'walks on water', 'peter walks on water', 'o thou of little faith'),
  P('The Canaanite Woman\'s Faith', 'Matthew', 15, 21, 28, 'syrophenician woman', 'crumbs from the masters table'),
  P('The Transfiguration', 'Matthew', 17, 1, 9, 'transfiguration', 'mount of transfiguration', 'moses and elias'),
  P('Healing of the Blind Man', 'John', 9, 1, 41, 'born blind', 'whereas i was blind now i see', 'pool of siloam'),
  P('Bartimaeus', 'Mark', 10, 46, 52, 'blind bartimaeus', 'son of david have mercy on me'),
  P('The Ten Lepers', 'Luke', 17, 11, 19, 'ten lepers', 'one returned to give thanks'),
  P('Raising of Lazarus', 'John', 11, 1, 44, 'lazarus', 'lazarus come forth', 'i am the resurrection and the life', 'jesus wept'),
  P('Peter\'s Great Catch', 'Luke', 5, 1, 11, 'launch out into the deep', 'miraculous catch of fish'),
  P('The Widow of Nain', 'Luke', 7, 11, 17, 'nain', 'widows son raised'),
  P('The Man Through the Roof', 'Mark', 2, 1, 12, 'paralytic', 'let down through the roof', 'thy sins be forgiven thee'),
  P('The Withered Hand', 'Mark', 3, 1, 6, 'withered hand', 'lawful on the sabbath'),
  // --- Parables
  P('The Sower', 'Matthew', 13, 1, 23, 'parable of the sower', 'sower', 'seed fell by the wayside', 'good ground'),
  P('The Wheat and the Tares', 'Matthew', 13, 24, 30, 'tares', 'wheat and tares', 'parable of the weeds'),
  P('The Mustard Seed', 'Matthew', 13, 31, 32, 'mustard seed', 'parable of the mustard seed'),
  P('The Hidden Treasure and the Pearl', 'Matthew', 13, 44, 46, 'pearl of great price', 'treasure hid in a field'),
  P('The Unmerciful Servant', 'Matthew', 18, 21, 35, 'seventy times seven', 'unforgiving servant', 'ten thousand talents'),
  P('The Labourers in the Vineyard', 'Matthew', 20, 1, 16, 'labourers in the vineyard', 'workers in the vineyard', 'penny a day'),
  P('The Wicked Husbandmen', 'Matthew', 21, 33, 46, 'wicked husbandmen', 'tenants', 'stone which the builders rejected'),
  P('The Wedding Feast', 'Matthew', 22, 1, 14, 'wedding garment', 'marriage feast', 'many are called but few are chosen'),
  P('The Ten Virgins', 'Matthew', 25, 1, 13, 'ten virgins', 'wise and foolish virgins', 'lamps oil bridegroom'),
  P('The Talents', 'Matthew', 25, 14, 30, 'parable of the talents', 'talents', 'well done thou good and faithful servant'),
  P('The Sheep and the Goats', 'Matthew', 25, 31, 46, 'sheep and goats', 'least of these', 'inasmuch as ye have done it'),
  P('The Good Samaritan', 'Luke', 10, 25, 37, 'good samaritan', 'who is my neighbour', 'samaritan'),
  P('Mary and Martha', 'Luke', 10, 38, 42, 'mary and martha', 'martha', 'one thing is needful'),
  P('The Friend at Midnight', 'Luke', 11, 5, 13, 'friend at midnight', 'importunity'),
  P('The Rich Fool', 'Luke', 12, 13, 21, 'rich fool', 'bigger barns', 'thou fool this night'),
  P('The Barren Fig Tree', 'Luke', 13, 6, 9, 'barren fig tree'),
  P('The Great Supper', 'Luke', 14, 15, 24, 'great supper', 'compel them to come in', 'highways and hedges'),
  P('Counting the Cost', 'Luke', 14, 25, 35, 'count the cost', 'take up his cross'),
  P('The Lost Sheep', 'Luke', 15, 1, 7, 'lost sheep', 'ninety and nine', 'leave the ninety nine'),
  P('The Lost Coin', 'Luke', 15, 8, 10, 'lost coin', 'ten pieces of silver'),
  P('The Prodigal Son', 'Luke', 15, 11, 32, 'prodigal son', 'prodigal', 'lost son', 'younger son', 'fatted calf', 'came to himself'),
  P('The Unjust Steward', 'Luke', 16, 1, 13, 'unjust steward', 'shrewd manager'),
  P('The Rich Man and Lazarus', 'Luke', 16, 19, 31, 'rich man and lazarus', 'dives', 'abrahams bosom'),
  P('The Persistent Widow', 'Luke', 18, 1, 8, 'unjust judge', 'persistent widow', 'importunate widow'),
  P('The Pharisee and the Publican', 'Luke', 18, 9, 14, 'pharisee and the publican', 'god be merciful to me a sinner', 'tax collector'),
  P('Zacchaeus', 'Luke', 19, 1, 10, 'zacchaeus', 'zaccheus', 'sycamore tree', 'wee little man'),
  P('The Pounds', 'Luke', 19, 11, 27, 'parable of the pounds', 'minas', 'occupy till i come'),
  P('The Good Shepherd', 'John', 10, 1, 18, 'good shepherd', 'i am the door', 'sheepfold'),
  P('The Vine and the Branches', 'John', 15, 1, 17, 'true vine', 'vine and branches', 'abide in me'),
  // --- Teaching moments
  P('Come unto Me', 'Matthew', 11, 25, 30, 'come unto me all ye that labour', 'my yoke is easy'),
  P('Peter\'s Confession', 'Matthew', 16, 13, 20, 'thou art the christ', 'upon this rock', 'who do men say that i am', 'caesarea philippi'),
  P('Take Up Your Cross', 'Matthew', 16, 21, 28, 'deny himself', 'take up his cross and follow me', 'what shall it profit a man'),
  P('The Greatest in the Kingdom', 'Matthew', 18, 1, 6, 'become as little children', 'millstone'),
  P('Jesus Blesses the Children', 'Mark', 10, 13, 16, 'suffer the little children', 'let the children come'),
  P('The Rich Young Ruler', 'Mark', 10, 17, 27, 'rich young ruler', 'eye of a needle', 'sell all that thou hast'),
  P('The Greatest Commandment', 'Matthew', 22, 34, 40, 'greatest commandment', 'love the lord thy god with all thy heart', 'love thy neighbour as thyself'),
  P('The Widow\'s Mite', 'Mark', 12, 41, 44, 'widows mite', 'two mites', 'widows offering'),
  P('Render unto Caesar', 'Matthew', 22, 15, 22, 'render unto caesar', 'tribute money'),
  P('The Woman Caught in Adultery', 'John', 8, 1, 11, 'cast the first stone', 'woman taken in adultery', 'go and sin no more'),
  P('I Am the Light of the World', 'John', 8, 12, 20, 'light of the world'),
  P('The Truth Shall Make You Free', 'John', 8, 31, 36, 'truth shall make you free'),
  P('The Bread of Life', 'John', 6, 25, 59, 'bread of life', 'i am the bread of life'),
  P('The Woman Who Anointed Jesus', 'Luke', 7, 36, 50, 'alabaster box', 'washed his feet with tears', 'sinful woman', 'her sins which are many are forgiven'),
  P('Mary Anoints Jesus', 'John', 12, 1, 8, 'spikenard', 'mary anoints', 'ointment'),
  P('The Woes to the Pharisees', 'Matthew', 23, 1, 39, 'woe unto you scribes and pharisees', 'whited sepulchres'),
  P('The Olivet Discourse', 'Matthew', 24, 1, 51, 'signs of the end', 'end times', 'olivet discourse', 'wars and rumours of wars'),
  // --- Passion week
  P('The Triumphal Entry', 'Matthew', 21, 1, 11, 'palm sunday', 'triumphal entry', 'hosanna', 'colt'),
  P('The Last Supper', 'Luke', 22, 7, 23, 'last supper', 'lords supper', 'this is my body', 'communion', 'upper room'),
  P('Jesus Washes the Disciples\' Feet', 'John', 13, 1, 17, 'washes feet', 'foot washing', 'towel and basin'),
  P('A New Commandment', 'John', 13, 31, 35, 'new commandment', 'love one another', 'by this shall all men know'),
  P('Let Not Your Heart Be Troubled', 'John', 14, 1, 14, 'in my fathers house are many mansions', 'i am the way the truth and the life', 'many mansions'),
  P('The Comforter Promised', 'John', 14, 15, 31, 'comforter', 'peace i leave with you', 'holy ghost teach you'),
  P('Jesus\' High Priestly Prayer', 'John', 17, 1, 26, 'high priestly prayer', 'that they all may be one'),
  P('Gethsemane', 'Matthew', 26, 36, 46, 'gethsemane', 'not my will but thine', 'let this cup pass', 'could ye not watch one hour'),
  P('The Betrayal and Arrest', 'Matthew', 26, 47, 56, 'judas kiss', 'betrayal', 'thirty pieces of silver', 'malchus ear'),
  P('Peter Denies Jesus', 'Luke', 22, 54, 62, 'peter denies', 'cock crow', 'denial', 'before the cock crow'),
  P('Jesus Before Pilate', 'John', 18, 28, 40, 'pilate', 'what is truth', 'barabbas', 'my kingdom is not of this world'),
  P('The Crucifixion', 'Luke', 23, 26, 49, 'crucifixion', 'calvary', 'golgotha', 'father forgive them', 'thief on the cross', 'it is finished', 'good friday'),
  P('The Seven Last Words', 'John', 19, 25, 30, 'woman behold thy son', 'i thirst', 'it is finished'),
  P('The Burial of Jesus', 'Matthew', 27, 57, 66, 'joseph of arimathaea', 'tomb', 'sealed the stone'),
  // --- Resurrection & after
  P('The Resurrection', 'Matthew', 28, 1, 10, 'resurrection', 'he is risen', 'empty tomb', 'easter', 'he is not here'),
  P('Mary Magdalene at the Tomb', 'John', 20, 11, 18, 'mary magdalene', 'rabboni', 'touch me not'),
  P('The Road to Emmaus', 'Luke', 24, 13, 35, 'emmaus', 'road to emmaus', 'did not our heart burn within us'),
  P('Doubting Thomas', 'John', 20, 24, 29, 'thomas', 'doubting thomas', 'my lord and my god', 'blessed are they that have not seen'),
  P('Feed My Sheep', 'John', 21, 15, 19, 'feed my sheep', 'lovest thou me', 'peter restored'),
  P('The Great Commission', 'Matthew', 28, 16, 20, 'great commission', 'go ye therefore', 'lo i am with you alway'),
  P('The Ascension', 'Acts', 1, 1, 11, 'ascension', 'ye shall receive power', 'taken up'),
  P('Pentecost', 'Acts', 2, 1, 21, 'pentecost', 'tongues of fire', 'rushing mighty wind', 'filled with the holy ghost'),
  P('Peter\'s Sermon at Pentecost', 'Acts', 2, 22, 41, 'repent and be baptized', 'three thousand souls'),
  P('The Early Church', 'Acts', 2, 42, 47, 'all things common', 'breaking of bread', 'fellowship'),
  P('The Lame Man at the Gate Beautiful', 'Acts', 3, 1, 10, 'silver and gold have i none', 'gate beautiful', 'rise up and walk'),
  P('Ananias and Sapphira', 'Acts', 5, 1, 11, 'ananias and sapphira', 'lied to the holy ghost'),
  P('Stephen\'s Martyrdom', 'Acts', 7, 54, 60, 'stephen stoned', 'stephen', 'lay not this sin to their charge'),
  P('Philip and the Ethiopian', 'Acts', 8, 26, 40, 'ethiopian eunuch', 'philip', 'understandest thou what thou readest'),
  P('The Road to Damascus', 'Acts', 9, 1, 19, 'road to damascus', 'damascus', 'saul conversion', 'why persecutest thou me', 'scales fell from his eyes'),
  P('Peter\'s Vision', 'Acts', 10, 9, 23, 'peters vision', 'sheet let down', 'what god hath cleansed', 'cornelius'),
  P('Peter Freed from Prison', 'Acts', 12, 1, 19, 'peter prison angel', 'rhoda', 'chains fell off'),
  P('Paul and Silas in Prison', 'Acts', 16, 16, 40, 'paul and silas', 'philippian jailer', 'what must i do to be saved', 'prison doors opened', 'midnight sang praises'),
  P('Paul at Mars Hill', 'Acts', 17, 16, 34, 'mars hill', 'areopagus', 'unknown god', 'in him we live and move'),
  P('Paul\'s Shipwreck', 'Acts', 27, 13, 44, 'shipwreck', 'paul shipwreck', 'malta', 'melita'),
  // --- Epistles
  P('The Righteous Shall Live by Faith', 'Romans', 1, 16, 17, 'not ashamed of the gospel', 'just shall live by faith'),
  P('All Have Sinned', 'Romans', 3, 21, 26, 'all have sinned', 'come short of the glory of god', 'justified freely'),
  P('Justified by Faith', 'Romans', 5, 1, 11, 'peace with god', 'while we were yet sinners', 'god commendeth his love'),
  P('Dead to Sin, Alive in Christ', 'Romans', 6, 1, 14, 'baptized into his death', 'newness of life', 'dead to sin'),
  P('The Wages of Sin', 'Romans', 6, 15, 23, 'wages of sin is death', 'gift of god is eternal life'),
  P('No Condemnation', 'Romans', 8, 1, 17, 'no condemnation', 'walk not after the flesh', 'abba father'),
  P('All Things Work Together', 'Romans', 8, 18, 30, 'all things work together for good', 'groanings which cannot be uttered', 'predestinate'),
  P('More Than Conquerors', 'Romans', 8, 31, 39, 'more than conquerors', 'if god be for us', 'nothing shall separate us'),
  P('Confess with Thy Mouth', 'Romans', 10, 8, 17, 'confess with thy mouth', 'whosoever shall call upon the name of the lord', 'faith cometh by hearing', 'how beautiful are the feet'),
  P('A Living Sacrifice', 'Romans', 12, 1, 8, 'living sacrifice', 'be not conformed to this world', 'renewing of your mind'),
  P('Love Without Hypocrisy', 'Romans', 12, 9, 21, 'overcome evil with good', 'bless them which persecute you', 'heap coals of fire'),
  P('The Message of the Cross', '1 Corinthians', 1, 18, 31, 'foolishness of god', 'preaching of the cross', 'not many wise men'),
  P('Your Body Is a Temple', '1 Corinthians', 6, 12, 20, 'temple of the holy ghost', 'bought with a price'),
  P('The Lord\'s Supper Instituted', '1 Corinthians', 11, 23, 34, 'as often as ye eat this bread', 'this do in remembrance of me', 'communion'),
  P('One Body, Many Members', '1 Corinthians', 12, 12, 31, 'body of christ', 'many members', 'spiritual gifts'),
  P('The Love Chapter', '1 Corinthians', 13, 1, 13, 'love chapter', 'charity suffereth long', 'love is patient', 'faith hope charity', 'faith hope love', 'though i speak with the tongues'),
  P('The Resurrection Chapter', '1 Corinthians', 15, 1, 58, 'resurrection chapter', 'o death where is thy sting', 'twinkling of an eye', 'last trump', 'be ye stedfast unmoveable'),
  P('Treasure in Earthen Vessels', '2 Corinthians', 4, 7, 18, 'earthen vessels', 'light affliction', 'things which are not seen'),
  P('A New Creature', '2 Corinthians', 5, 14, 21, 'new creature', 'ministry of reconciliation', 'ambassadors for christ', 'made him to be sin'),
  P('Cheerful Giver', '2 Corinthians', 9, 6, 15, 'cheerful giver', 'soweth sparingly', 'unspeakable gift'),
  P('My Grace Is Sufficient', '2 Corinthians', 12, 7, 10, 'thorn in the flesh', 'my grace is sufficient', 'strength made perfect in weakness'),
  P('Crucified with Christ', 'Galatians', 2, 15, 21, 'crucified with christ', 'nevertheless i live'),
  P('The Fruit of the Spirit', 'Galatians', 5, 16, 26, 'fruit of the spirit', 'works of the flesh', 'walk in the spirit'),
  P('Bear One Another\'s Burdens', 'Galatians', 6, 1, 10, 'bear ye one anothers burdens', 'whatsoever a man soweth', 'be not weary in well doing'),
  P('Saved by Grace', 'Ephesians', 2, 1, 10, 'by grace are ye saved', 'not of works', 'his workmanship'),
  P('One in Christ', 'Ephesians', 2, 11, 22, 'middle wall of partition', 'no more strangers', 'chief corner stone'),
  P('Unity in the Body', 'Ephesians', 4, 1, 16, 'one lord one faith one baptism', 'unity of the spirit', 'speaking the truth in love'),
  P('The New Man', 'Ephesians', 4, 17, 32, 'put on the new man', 'be ye kind one to another', 'let not the sun go down upon your wrath'),
  P('Husbands and Wives', 'Ephesians', 5, 22, 33, 'husbands love your wives', 'wives submit', 'marriage', 'two shall be one flesh'),
  P('The Armour of God', 'Ephesians', 6, 10, 20, 'armour of god', 'armor of god', 'whole armour', 'sword of the spirit', 'wiles of the devil', 'principalities and powers'),
  P('The Christ Hymn', 'Philippians', 2, 1, 11, 'let this mind be in you', 'every knee should bow', 'made himself of no reputation', 'kenosis'),
  P('Press Toward the Mark', 'Philippians', 3, 7, 14, 'press toward the mark', 'count all things but loss', 'forgetting those things which are behind'),
  P('Rejoice in the Lord Alway', 'Philippians', 4, 4, 9, 'rejoice in the lord alway', 'be careful for nothing', 'peace of god which passeth all understanding', 'whatsoever things are true'),
  P('I Can Do All Things', 'Philippians', 4, 10, 20, 'i can do all things through christ', 'my god shall supply all your need', 'content'),
  P('The Supremacy of Christ', 'Colossians', 1, 15, 23, 'image of the invisible god', 'firstborn of every creature', 'by him all things consist'),
  P('Set Your Affection on Things Above', 'Colossians', 3, 1, 17, 'things above', 'put on therefore', 'let the peace of god rule', 'whatsoever ye do in word or deed'),
  P('The Coming of the Lord', '1 Thessalonians', 4, 13, 18, 'caught up', 'rapture', 'dead in christ shall rise', 'trump of god', 'comfort one another with these words'),
  P('Rejoice Evermore, Pray Without Ceasing', '1 Thessalonians', 5, 12, 24, 'pray without ceasing', 'in every thing give thanks', 'quench not the spirit'),
  P('Fight the Good Fight', '1 Timothy', 6, 6, 19, 'godliness with contentment', 'love of money is the root of all evil', 'fight the good fight of faith'),
  P('Spirit of Power, Love, and a Sound Mind', '2 Timothy', 1, 3, 12, 'spirit of fear', 'sound mind', 'i know whom i have believed'),
  P('All Scripture Is Given by Inspiration', '2 Timothy', 3, 10, 17, 'all scripture is given by inspiration of god', 'perilous times', 'inspiration of god'),
  P('I Have Fought a Good Fight', '2 Timothy', 4, 1, 8, 'i have fought a good fight', 'finished my course', 'crown of righteousness', 'preach the word'),
  P('The Grace of God Hath Appeared', 'Titus', 2, 11, 15, 'grace of god that bringeth salvation', 'blessed hope'),
  P('Christ the Final Word', 'Hebrews', 1, 1, 14, 'god who at sundry times', 'express image of his person'),
  P('The Word Is Quick and Powerful', 'Hebrews', 4, 9, 16, 'word of god is quick and powerful', 'throne of grace', 'sharper than any twoedged sword', 'touched with the feeling of our infirmities'),
  P('Melchisedec', 'Hebrews', 7, 1, 28, 'melchisedec', 'melchizedek', 'order of melchisedec'),
  P('The Faith Chapter', 'Hebrews', 11, 1, 40, 'faith chapter', 'hall of faith', 'faith is the substance of things hoped for', 'by faith'),
  P('The Race Set Before Us', 'Hebrews', 12, 1, 13, 'cloud of witnesses', 'run with patience the race', 'author and finisher of our faith', 'whom the lord loveth he chasteneth'),
  P('Jesus Christ the Same Yesterday, Today, and Forever', 'Hebrews', 13, 1, 8, 'same yesterday and to day and for ever', 'entertained angels unawares', 'i will never leave thee'),
  P('Count It All Joy', 'James', 1, 1, 18, 'count it all joy', 'trying of your faith worketh patience', 'if any of you lack wisdom', 'every good gift'),
  P('Doers of the Word', 'James', 1, 19, 27, 'doers of the word', 'swift to hear slow to speak', 'pure religion'),
  P('Faith Without Works', 'James', 2, 14, 26, 'faith without works is dead'),
  P('The Tongue', 'James', 3, 1, 12, 'tongue', 'the tongue is a fire', 'bridle'),
  P('Draw Nigh to God', 'James', 4, 1, 10, 'draw nigh to god', 'resist the devil', 'humble yourselves'),
  P('The Prayer of Faith', 'James', 5, 13, 20, 'effectual fervent prayer', 'prayer of faith shall save the sick', 'anointing with oil', 'elijah prayed'),
  P('A Lively Hope', '1 Peter', 1, 3, 12, 'lively hope', 'incorruptible inheritance', 'trial of your faith'),
  P('A Royal Priesthood', '1 Peter', 2, 1, 12, 'chosen generation', 'royal priesthood', 'peculiar people', 'lively stones', 'sincere milk of the word'),
  P('Casting All Your Care', '1 Peter', 5, 5, 11, 'casting all your care upon him', 'roaring lion', 'be sober be vigilant'),
  P('Make Your Calling and Election Sure', '2 Peter', 1, 1, 11, 'add to your faith virtue', 'precious promises', 'calling and election sure'),
  P('The Day of the Lord', '2 Peter', 3, 1, 13, 'thief in the night', 'thousand years as one day', 'not willing that any should perish', 'elements shall melt'),
  P('Walk in the Light', '1 John', 1, 1, 10, 'walk in the light', 'if we confess our sins', 'fellowship one with another'),
  P('Love Not the World', '1 John', 2, 15, 17, 'love not the world', 'lust of the flesh', 'pride of life'),
  P('God Is Love', '1 John', 4, 7, 21, 'god is love', 'perfect love casteth out fear', 'beloved let us love one another', 'we love him because he first loved us'),
  P('Beloved, Thou Prosper', '3 John', 1, 1, 4, 'prosper and be in health', 'no greater joy'),
  P('Now unto Him That Is Able to Keep You', 'Jude', 1, 17, 25, 'keep you from falling', 'contend for the faith', 'doxology'),
  // --- Revelation
  P('The Alpha and Omega', 'Revelation', 1, 1, 20, 'alpha and omega', 'i am he that liveth and was dead', 'patmos'),
  P('Letters to the Seven Churches', 'Revelation', 2, 1, 29, 'seven churches', 'ephesus smyrna pergamos thyatira', 'first love'),
  P('Laodicea: Behold, I Stand at the Door', 'Revelation', 3, 14, 22, 'lukewarm', 'laodicea', 'i stand at the door and knock'),
  P('The Throne in Heaven', 'Revelation', 4, 1, 11, 'throne room', 'holy holy holy lord god almighty', 'four beasts', 'twenty four elders'),
  P('Worthy Is the Lamb', 'Revelation', 5, 1, 14, 'worthy is the lamb', 'lion of the tribe of juda', 'sealed book'),
  P('The Great Multitude', 'Revelation', 7, 9, 17, 'great multitude which no man could number', 'washed their robes', 'wipe away all tears'),
  P('The Marriage Supper of the Lamb', 'Revelation', 19, 1, 10, 'marriage supper of the lamb', 'alleluia', 'bride hath made herself ready'),
  P('The Rider on the White Horse', 'Revelation', 19, 11, 21, 'king of kings and lord of lords', 'white horse', 'faithful and true'),
  P('The Great White Throne', 'Revelation', 20, 11, 15, 'great white throne', 'book of life', 'lake of fire'),
  P('A New Heaven and a New Earth', 'Revelation', 21, 1, 8, 'new heaven and a new earth', 'new jerusalem', 'no more death', 'behold i make all things new'),
  P('The River of Life', 'Revelation', 22, 1, 21, 'river of water of life', 'tree of life', 'even so come lord jesus', 'behold i come quickly'),
]

const BOOK_INDEX = new Map(BOOKS.map((b, i) => [b.name, i]))
const bookIndex = (name: string): number => BOOK_INDEX.get(name) ?? Number.MAX_SAFE_INTEGER

interface Indexed { p: Passage; segs: string[][] }
// Title and each alias are separate segments: a phrase run can't bridge "lost sheep" +
// "lost coin" into a 3-word match.
const INDEX: Indexed[] = PASSAGES.map((p) => ({
  p,
  segs: [p.title, ...p.aliases].map((s) => norm(s).split(' ').filter(Boolean)),
}))

/** Every query word must match (prefix/fuzzy, same rules as verse search); order by phrase
 * run ↓, matched weight ↓, title length ↑, then canonical ↑ so the table's order never
 * leaks into the result. */
export function matchPassages(q: string, limit = 3): Passage[] {
  const { tokens } = parseVerseQuery(q)
  if (!tokens.length) return []
  return INDEX.map(({ p, segs }) => ({ p, s: textSignals(segs, tokens) }))
    .filter((x) => x.s.matched === tokens.length)
    .sort((a, b) => {
      if (b.s.phrase !== a.s.phrase) return b.s.phrase - a.s.phrase
      if (b.s.covWeight !== a.s.covWeight) return b.s.covWeight - a.s.covWeight
      if (a.p.title.length !== b.p.title.length) return a.p.title.length - b.p.title.length
      const bi = bookIndex(a.p.book) - bookIndex(b.p.book)
      if (bi) return bi
      if (a.p.ch !== b.p.ch) return a.p.ch - b.p.ch
      return a.p.from - b.p.from
    })
    .slice(0, limit)
    .map((x) => x.p)
}
```

- [ ] **Step 4: Run; fix any range the KJV test rejects**

Run: `npx vitest run src/shared/scripture/passages.test.ts`
Expected: PASS. If the KJV range check fails for an entry, correct that entry's `ch/from/to` against `resources/bibles/kjv.json` (don't delete it). The `PASSAGES.length >= 150` assertion documents the spec's floor; the table above has ~240 entries.

- [ ] **Step 5: Commit**

```bash
git add src/shared/scripture/passages.ts src/shared/scripture/passages.test.ts
git commit -m "feat(scripture): curated passages table for the quick-find"
```

---

### Task 9: Results rail — `highlightTokens` + `ScriptureSearchResults` + `SchedulePanel.search`

**Files:**
- Create: `src/shared/search/highlight.ts`, `src/shared/search/highlight.test.ts`
- Create: `src/renderer/operator/ScriptureSearchResults.tsx`, `src/renderer/operator/ScriptureSearchResults.test.tsx`
- Modify: `src/renderer/operator/SchedulePanel.tsx`
- Modify: `src/renderer/operator/SchedulePanel.test.tsx`

**Interfaces:**
- Produces:
```ts
// highlight.ts
export interface HighlightSeg { text: string; hit: boolean }
export function highlightTokens(text: string, qts: string[]): HighlightSeg[]

// ScriptureSearchResults.tsx
export interface PassageResultRow { key: string; title: string; meta: string }   // meta = "Luke 15:11–32"
export interface VerseResultRow { key: string; ref: string; text: string }        // ref = "John 3:16"
export interface ScriptureSearchState {
  query: string;            // raw query (for the empty-state copy and for highlighting tokens)
  tokens: string[];         // parseVerseQuery(query).tokens
  abbr: string;             // primary version abbr, '' when none installed
  total: number;
  passages: PassageResultRow[];
  verses: VerseResultRow[];
  highlighted: number;      // index into [...passages, ...verses]
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;      // click / Enter
  onActivate: (index: number) => void;  // double-click → take live
  noVersion: boolean;
}
export function ScriptureSearchResults(props: { theme: Theme; search: ScriptureSearchState }): JSX.Element
```
- `SchedulePanelProps.search?: ScriptureSearchState | null` — when set (and track is scripture) the schedule header/list/Clear-all are replaced by `<ScriptureSearchResults>`; the entry, ghost and `+ Add` stay.

- [ ] **Step 1: Failing tests — highlight**

```ts
// src/shared/search/highlight.test.ts
import { expect, test } from 'vitest';
import { highlightTokens } from './highlight';

test('marks whole words that match a token exactly or by prefix/fuzzy, keeps punctuation', () => {
  expect(highlightTokens('Jesus wept.', ['jesus'])).toEqual([
    { text: 'Jesus', hit: true },
    { text: ' wept.', hit: false }
  ]);
  expect(highlightTokens('a man named Zaccheus, which', ['zacchaeus'])).toEqual([
    { text: 'a man named ', hit: false },
    { text: 'Zaccheus', hit: true },
    { text: ', which', hit: false }
  ]);
});

test('no tokens → one unmarked segment; "son" does not mark "person"', () => {
  expect(highlightTokens('a person', [])).toEqual([{ text: 'a person', hit: false }]);
  expect(highlightTokens('a person', ['son'])).toEqual([{ text: 'a person', hit: false }]);
});
```

- [ ] **Step 2: Implement highlight**

```ts
// src/shared/search/highlight.ts
import { matchDist, matchTol, norm } from './fuzzy';

export interface HighlightSeg { text: string; hit: boolean }

// "Does this word count for any query token" — the same asymmetric `matchDist` the scorer
// uses (prefix anchored on the TOKEN), so what is bold is exactly what scored.
const isHit = (w: string, qts: string[]): boolean => qts.some((t) => matchDist(t, w) <= matchTol(t.length));

/** Split `text` into runs, marking the words a query token matches (exact / anchored
 * prefix / within edit tolerance). Adjacent runs with the same flag are merged. */
export function highlightTokens(text: string, qts: string[]): HighlightSeg[] {
  if (!qts.length) return [{ text, hit: false }];
  const out: HighlightSeg[] = [];
  const push = (t: string, hit: boolean): void => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += t;
    else out.push({ text: t, hit });
  };
  const re = /[A-Za-z0-9'’`]+/g;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    push(text.slice(i, start), false);
    const w = norm(m[0]);
    push(m[0], w !== '' && isHit(w, qts));
    i = start + m[0].length;
  }
  push(text.slice(i), false);
  return out;
}
```

Run: `npx vitest run src/shared/search/highlight.test.ts` → PASS.

- [ ] **Step 3: Failing tests — results component**

```tsx
// src/renderer/operator/ScriptureSearchResults.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScriptureSearchResults, type ScriptureSearchState } from './ScriptureSearchResults'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

const T = themeFor('classic', 'dark')
const state = (over: Partial<ScriptureSearchState> = {}): ScriptureSearchState => ({
  query: 'zaccheus',
  tokens: ['zaccheus'],
  abbr: 'KJV',
  total: 3,
  passages: [{ key: 'p:Luke:19:1', title: 'Zacchaeus', meta: 'Luke 19:1–10' }],
  verses: [
    { key: 'v:Luke:19:2', ref: 'Luke 19:2', text: 'And, behold, there was a man named Zaccheus, which was the chief among the publicans, and he was rich.' },
    { key: 'v:Luke:19:5', ref: 'Luke 19:5', text: 'Zaccheus, make haste, and come down.' }
  ],
  highlighted: 0,
  onHover: vi.fn(),
  onPick: vi.fn(),
  onActivate: vi.fn(),
  noVersion: false,
  ...over
})

describe('ScriptureSearchResults', () => {
  it('shows the total with the version, the PASSAGES group, and the VERSES group', () => {
    render(<ScriptureSearchResults theme={T} search={state()} />)
    expect(screen.getByText('3 VERSES · KJV')).toBeTruthy()
    expect(screen.getByText('PASSAGES')).toBeTruthy()
    expect(screen.getByText('Zacchaeus')).toBeTruthy()
    expect(screen.getByText('Luke 19:1–10')).toBeTruthy()
    expect(screen.getByText('Luke 19:2')).toBeTruthy()
  })

  it('bolds matched words in verse text', () => {
    render(<ScriptureSearchResults theme={T} search={state()} />)
    const marks = document.querySelectorAll('[data-hit]')
    expect(marks.length).toBeGreaterThanOrEqual(2)
    expect(marks[0].textContent).toBe('Zaccheus')
  })

  it('marks the highlighted row across the combined list (passages first)', () => {
    render(<ScriptureSearchResults theme={T} search={state({ highlighted: 1 })} />)
    const row = screen.getByText('Luke 19:2').closest('button') as HTMLButtonElement
    expect(row.getAttribute('data-highlighted')).toBe('true')
    const pas = screen.getByText('Zacchaeus').closest('button') as HTMLButtonElement
    expect(pas.getAttribute('data-highlighted')).toBeNull()
  })

  it('click picks, double-click activates, hover reports the combined index', () => {
    const s = state()
    render(<ScriptureSearchResults theme={T} search={s} />)
    const row = screen.getByText('Luke 19:5').closest('button') as HTMLButtonElement
    fireEvent.mouseEnter(row)
    fireEvent.click(row)
    fireEvent.doubleClick(row)
    expect(s.onHover).toHaveBeenCalledWith(2)
    expect(s.onPick).toHaveBeenCalledWith(2)
    expect(s.onActivate).toHaveBeenCalledWith(2)
  })

  it('empty states: no hits, and no version installed', () => {
    const { rerender } = render(<ScriptureSearchResults theme={T} search={state({ passages: [], verses: [], total: 0, query: 'xyzzy' })} />)
    expect(screen.getByText(/No verses match “xyzzy”/)).toBeTruthy()
    rerender(<ScriptureSearchResults theme={T} search={state({ passages: [], verses: [], total: 0, noVersion: true, abbr: '' })} />)
    expect(screen.getByText(/Install a Bible/)).toBeTruthy()
  })

  it('singular count copy', () => {
    render(<ScriptureSearchResults theme={T} search={state({ total: 1, verses: state().verses.slice(0, 1) })} />)
    expect(screen.getByText('1 VERSE · KJV')).toBeTruthy()
  })
})
```

- [ ] **Step 4: Implement the component**

```tsx
// src/renderer/operator/ScriptureSearchResults.tsx
import type { CSSProperties, JSX } from 'react';
import type { Theme } from '../../shared/theme';
import { highlightTokens } from '../../shared/search/highlight';
import { INSTALL_HINT } from '../../shared/scripture/labels';
import { ListEmpty } from './ListEmpty';

export interface PassageResultRow { key: string; title: string; meta: string }
export interface VerseResultRow { key: string; ref: string; text: string }

export interface ScriptureSearchState {
  query: string;
  tokens: string[];
  abbr: string;
  total: number;
  passages: PassageResultRow[];
  verses: VerseResultRow[];
  /** Index into the combined list: passages first, then verses. */
  highlighted: number;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
  onActivate: (index: number) => void;
  noVersion: boolean;
}

const headerStyle = (T: Theme): CSSProperties => ({
  fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600, padding: '0 14px 6px', flexShrink: 0
});

const rowStyle = (T: Theme, highlighted: boolean): CSSProperties => ({
  display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%', textAlign: 'left',
  padding: '8px 11px', borderRadius: '11px', cursor: 'pointer', userSelect: 'none', gap: '2px',
  background: highlighted ? T.panel2 : 'transparent',
  boxShadow: highlighted ? `inset 0 0 0 1.5px ${T.scripture}` : 'none'
});

interface RowProps {
  index: number;
  title: string;
  body?: string;
  bodySegs?: { text: string; hit: boolean }[];
  theme: Theme;
  highlighted: boolean;
  onHover: (i: number | null) => void;
  onPick: (i: number) => void;
  onActivate: (i: number) => void;
}

/** Declared at module scope, NOT inside ScriptureSearchResults — an inline component is a
 * new type every render, so React would remount the list on each keystroke/hover and the
 * second half of a double-click would land on a detached node (see SongSearchRail's Row). */
function Row({ index, title, body, bodySegs, theme: T, highlighted, onHover, onPick, onActivate }: RowProps): JSX.Element {
  return (
    <button
      style={rowStyle(T, highlighted)}
      data-highlighted={highlighted || undefined}
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPick(index)}
      onDoubleClick={() => onActivate(index)}
    >
      <div style={{ fontWeight: 600, fontSize: '13px', color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
      {body !== undefined && (
        <div style={{ fontSize: '11px', color: T.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{body}</div>
      )}
      {bodySegs && (
        <div style={{ fontSize: '11.5px', color: T.dim, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {bodySegs.map((s, i) => (s.hit ? <b key={i} data-hit style={{ color: T.text, fontWeight: 700 }}>{s.text}</b> : <span key={i}>{s.text}</span>))}
        </div>
      )}
    </button>
  );
}

export const SEARCH_VERSE_ROWS = 10;

export function ScriptureSearchResults({ theme: T, search: s }: { theme: Theme; search: ScriptureSearchState }): JSX.Element {
  const count = `${s.total} ${s.total === 1 ? 'VERSE' : 'VERSES'}${s.abbr ? ` · ${s.abbr}` : ''}`;
  const verses = s.verses.slice(0, SEARCH_VERSE_ROWS);
  const nothing = s.passages.length === 0 && verses.length === 0;
  return (
    <>
      <div style={headerStyle(T)}>{count}</div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {s.noVersion && nothing && <ListEmpty>{INSTALL_HINT}</ListEmpty>}
        {!s.noVersion && nothing && <ListEmpty>No verses match “{s.query.trim()}”.</ListEmpty>}
        {s.passages.length > 0 && <div style={{ ...headerStyle(T), padding: '4px 4px 2px' }}>PASSAGES</div>}
        {s.passages.map((p, i) => (
          <Row key={p.key} index={i} title={p.title} body={p.meta} theme={T} highlighted={s.highlighted === i}
            onHover={s.onHover} onPick={s.onPick} onActivate={s.onActivate} />
        ))}
        {s.passages.length > 0 && verses.length > 0 && <div style={{ ...headerStyle(T), padding: '8px 4px 2px' }}>VERSES</div>}
        {verses.map((v, j) => {
          const i = s.passages.length + j;
          return (
            <Row key={v.key} index={i} title={v.ref} bodySegs={highlightTokens(v.text, s.tokens)} theme={T}
              highlighted={s.highlighted === i} onHover={s.onHover} onPick={s.onPick} onActivate={s.onActivate} />
          );
        })}
      </div>
    </>
  );
}
```

Run: `npx vitest run src/renderer/operator/ScriptureSearchResults.test.tsx` → PASS.

- [ ] **Step 5: SchedulePanel gets the `search` prop** (+ test)

Append to `SchedulePanel.test.tsx`:
```tsx
  it('renders search results in place of the schedule while searching', () => {
    render(
      <SchedulePanel
        {...baseProps}
        value="zacch"
        search={{
          query: 'zacch', tokens: ['zacch'], abbr: 'KJV', total: 1, passages: [],
          verses: [{ key: 'v', ref: 'Luke 19:2', text: 'a man named Zaccheus' }],
          highlighted: 0, onHover: vi.fn(), onPick: vi.fn(), onActivate: vi.fn(), noVersion: false
        }}
      />
    )
    expect(screen.getByText('1 VERSE · KJV')).toBeTruthy()
    expect(screen.queryByText('SCRIPTURE SCHEDULE')).toBeNull()
    expect(screen.queryByText('John 3:16')).toBeNull() // the schedule row is not shown
    expect(screen.getByPlaceholderText(/Add verse/)).toBeTruthy() // entry stays
  })
```
In `SchedulePanel.tsx`: import `ScriptureSearchResults, type ScriptureSearchState`; add to props
```ts
  /** Non-null while the entry is a text search (refBuilder `search` stage): the schedule
   * header/list are replaced by the results rail; the entry and `+ Add` stay. */
  search?: ScriptureSearchState | null;
```
and in the JSX wrap the `SCRIPTURE SCHEDULE` header div + the rows list div in `{search ? <ScriptureSearchResults theme={T} search={search} /> : ( <> ...existing header + list... </> )}`. Update the placeholder to `Add verse — John 3:16, or search a word`.

Run: `npx vitest run src/renderer/operator/SchedulePanel.test.tsx` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/search/highlight.ts src/shared/search/highlight.test.ts src/renderer/operator/ScriptureSearchResults.tsx src/renderer/operator/ScriptureSearchResults.test.tsx src/renderer/operator/SchedulePanel.tsx src/renderer/operator/SchedulePanel.test.tsx
git commit -m "feat(operator): scripture search results rail"
```

---

### Task 10: Wire search into SermonMode

**Files:**
- Modify: `src/renderer/operator/SermonMode.tsx`
- Modify: `src/renderer/operator/SermonMode.test.tsx`

**Interfaces:**
- Consumes: `isSearch`, `searchQuery`, `fromParsedRef` (Task 2); `window.helm.bibles.search` (Task 7); `matchPassages` (Task 8); `ScriptureSearchState` (Task 9); `parseVerseQuery` (Task 4); `formatRef`.

- [ ] **Step 1: Failing tests** (append to `SermonMode.test.tsx`; extend `installHelmStub`'s `bibles` with a `search` vi.fn and update the `entry()` helper's exact placeholder)

First, in `installHelmStub`, add an option and stub:
```ts
    // What `bibles.search` resolves to for any query (Task 10). Default: no hits.
    verseSearch?: (q: string) => { hits: { book: string; chapter: number; verse: number; text: string }[]; total: number }
...
  const search = vi.fn((q: string, versionId: string) =>
    Promise.resolve({ ...(opts.verseSearch?.(q) ?? { hits: [], total: 0 }), versionId })
  )
  // inside bibles: { ... }
      search,
```
and return `search` from the stub. Change the helper:
```ts
const entry = (): HTMLElement => screen.getByPlaceholderText('Add verse — John 3:16, or search a word')
```
(and the `waitFor(... getByPlaceholderText('Add verse — John 3:16'))` lines → use `entry()`).

Then:
```tsx
describe('SermonMode — verse text search from the entry', () => {
  const LUKE_19: ChapterData = {
    book: 'Luke', chapter: 19, verseCount: 10,
    verses: { 2: { kjv: 'And, behold, there was a man named Zaccheus' }, 5: { kjv: 'Zaccheus, make haste' } }
  }
  const hits = (q: string) =>
    q.startsWith('zac')
      ? { hits: [
          { book: 'Luke', chapter: 19, verse: 2, text: 'And, behold, there was a man named Zaccheus' },
          { book: 'Luke', chapter: 19, verse: 5, text: 'Zaccheus, make haste' }
        ], total: 2 }
      : { hits: [], total: 0 }

  it('typing a non-book word shows verse results instead of the schedule', async () => {
    const { resolveChapter, search } = installHelmStub(NOTHING_LIVE, [], { verseSearch: hits })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(entry()).toBeTruthy())
    fireEvent.focus(entry())
    typeInEntry('zacch')
    await waitFor(() => expect(screen.getByText('2 VERSES · KJV')).toBeTruthy())
    expect(search).toHaveBeenLastCalledWith('zacch', 'kjv')
    expect(screen.getByText('Luke 19:2')).toBeTruthy()
    expect(screen.getByText('PASSAGES')).toBeTruthy() // curated "Zacchaeus" passage
  })

  it('ArrowDown moves the highlight without moving the cursor; Enter picks and sets the entry', async () => {
    const { resolveChapter, show } = installHelmStub(NOTHING_LIVE, [], { verseSearch: hits }, { book: 'Luke', ch: 19, data: LUKE_19 })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(entry()).toBeTruthy())
    fireEvent.focus(entry())
    typeInEntry('zacch')
    await waitFor(() => expect(screen.getByText('Luke 19:5')).toBeTruthy())
    const showCalls = show.mock.calls.length
    fireEvent.keyDown(entry(), { key: 'ArrowDown' }) // passage → Luke 19:2
    fireEvent.keyDown(entry(), { key: 'ArrowDown' }) // → Luke 19:5
    expect(show.mock.calls.length).toBe(showCalls) // highlight only, cursor untouched
    const row = screen.getByText('Luke 19:5').closest('button') as HTMLButtonElement
    expect(row.getAttribute('data-highlighted')).toBe('true')
    fireEvent.keyDown(entry(), { key: 'Enter' })
    await waitFor(() => expect(entryValue()).toBe('Luke 19:5'))
    expect(screen.queryByText('2 VERSES · KJV')).toBeNull() // results gone, schedule back
  })

  it('Enter on a passage hit sets a range in the entry and + Add names it', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [], { verseSearch: () => ({ hits: [], total: 0 }) })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(entry()).toBeTruthy())
    fireEvent.focus(entry())
    typeInEntry('prodigal')
    await waitFor(() => expect(screen.getByText('The Prodigal Son')).toBeTruthy())
    expect(screen.getByText('+ Add Luke 15:11–32')).toBeTruthy()
    fireEvent.keyDown(entry(), { key: 'Enter' })
    await waitFor(() => expect(entryValue()).toBe('Luke 15:11-32'))
  })

  it('Shift+Enter on a verse hit goes live with that verse', async () => {
    const { resolveChapter, goLive } = installHelmStub(NOTHING_LIVE, [], { verseSearch: hits }, { book: 'Luke', ch: 19, data: LUKE_19 })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(entry()).toBeTruthy())
    fireEvent.focus(entry())
    typeInEntry('zacch')
    await waitFor(() => expect(screen.getByText('Luke 19:2')).toBeTruthy())
    fireEvent.keyDown(entry(), { key: 'ArrowDown' })
    fireEvent.keyDown(entry(), { key: 'Enter', shiftKey: true })
    await waitFor(() => expect(goLive).toHaveBeenCalled())
    expect(goLive.mock.calls[0][0]).toBe('scr:Luke:19:2')
  })

  it('Escape clears a search and brings the schedule back', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [], { verseSearch: hits })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(entry()).toBeTruthy())
    fireEvent.focus(entry())
    typeInEntry('zacch')
    await waitFor(() => expect(screen.getByText('2 VERSES · KJV')).toBeTruthy())
    fireEvent.keyDown(entry(), { key: 'Escape' })
    expect(entryValue()).toBe('')
    expect(screen.queryByText('2 VERSES · KJV')).toBeNull()
    expect(screen.getByText('SCRIPTURE SCHEDULE')).toBeTruthy()
  })

  it('a reference keeps working exactly as before (no search for "ma")', async () => {
    const { resolveChapter, search } = installHelmStub(NOTHING_LIVE, [], { verseSearch: hits })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(entry()).toBeTruthy())
    fireEvent.focus(entry())
    typeInEntry('ma')
    await waitFor(() => expect((document.querySelector('[data-ghost-text]') as HTMLElement | null)?.textContent).toBe('tthew'))
    expect(search).not.toHaveBeenCalled()
  })
})
```
(The test for the passage "Enter sets range" reads `+ Add Luke 15:11–32` — `formatRef` emits an en-dash; `renderBuilder` of a range emits a hyphen `Luke 15:11-32`. Both as written.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx -t "verse text search"`
Expected: FAIL (no results rail, `search` never called).

- [ ] **Step 3: Implement in `SermonMode.tsx`**

Imports:
```ts
import { initialBuilder, applyKey, renderBuilder, fromParsedRef, toParsedRef, refGhost, EMPTY_EXTENT, isSearch, searchQuery, type RefBuilderState } from '../../shared/scripture/refBuilder';
import { matchPassages, type Passage } from '../../shared/scripture/passages';
import { parseVerseQuery } from '../../shared/search/verseScore';
import type { ScriptureSearchState } from './ScriptureSearchResults';
import type { VerseHit, VerseSearchResult } from '../../shared/types';
```

State + effect (place after the `bookExtents` effect, before `curExtent`):
```ts
  // --- Verse text search (refBuilder `search` stage). Results carry the query they were
  // fetched for so a slow round-trip can't label stale hits under a newer query.
  const query = isSearch(builder) ? searchQuery(builder) : null;
  const [verseRes, setVerseRes] = useState<{ q: string; res: VerseSearchResult } | null>(null);
  // Highlight is keyed by the query it was set for, so a new query reads as 0 without a
  // reset effect (the repo's lint rejects set-state-in-effect) and a shrinking list is
  // clamped below on the same render.
  const [hiState, setHiState] = useState<{ q: string | null; i: number }>({ q: null, i: 0 });
  const primaryVersion = versions[0] ?? null;

  useEffect(() => {
    if (query === null || !primaryVersion) return;
    let live = true;
    void window.helm.bibles
      .search(query, primaryVersion)
      .then((res) => {
        if (live) setVerseRes({ q: query, res });
      })
      .catch((err: unknown) => {
        console.error(err);
        if (live) setVerseRes({ q: query, res: { hits: [], total: 0, versionId: primaryVersion } });
      });
    return () => {
      live = false;
    };
  }, [query, primaryVersion]);

  const passageHits: Passage[] = query !== null ? matchPassages(query) : [];
  const verseHits: VerseHit[] = query !== null && verseRes && verseRes.q === query ? verseRes.res.hits : [];
  const verseTotal = query !== null && verseRes && verseRes.q === query ? verseRes.res.total : 0;
  const resultCount = passageHits.length + verseHits.length;
  const highlighted = hiState.q === query ? hiState.i : 0;
  const hi = resultCount ? Math.min(highlighted, resultCount - 1) : 0;
  const setHighlighted = (i: number): void => setHiState({ q: query, i });

  // The reference a picked result stands for (passages first, then verses).
  const resultRef = (i: number): ParsedRef | null => {
    if (i < passageHits.length) {
      const p = passageHits[i];
      return { book: p.book, ch: p.ch, from: p.from, to: p.to };
    }
    const v = verseHits[i - passageHits.length];
    return v ? { book: v.book, ch: v.chapter, from: v.verse, to: v.verse } : null;
  };
```
Pick / activate:
```ts
  // Enter/click on a hit: the entry becomes that reference (so + Add / Go live / Shift+Enter
  // work on it exactly as if typed) and the cursor jumps to its first verse.
  const pickResult = (i: number): void => {
    const p = resultRef(i);
    if (!p) return;
    setBuilder(fromParsedRef(p));
    jumpTo(p.book, p.ch, p.from);
    requestRailScroll(p.from, 'start');
  };
  // Shift+Enter / double-click: pick, then put its first verse on screen.
  const activateResult = (i: number): void => {
    const p = resultRef(i);
    if (!p) return;
    pickResult(i);
    const wanted = beginTake();
    if (chapter && chapter.book === p.book && chapter.chapter === p.ch) {
      goLiveWithChapter(p, chapter);
      return;
    }
    window.helm.bibles
      .getChapter(p.book, p.ch)
      .then((c) => {
        if (wanted()) goLiveWithChapter(p, c);
      })
      .catch(console.error);
  };
```
(`goLiveWithChapter` is declared later in the file today — move `pickResult`/`activateResult` below it, next to `activateVerse`, to keep the compiler-memo ordering note honoured.)

`addRef` while searching:
```ts
  const picked = query !== null ? resultRef(hi) : null;
  const addRef = picked ?? addTarget(builder, cursor);
  const addLabel = `+ Add ${formatRef(addRef)}`;
  const canAdd = query === null || picked !== null;
```
and pass `canAdd={canAdd}` to `SchedulePanel` (replacing the bare `canAdd`). `builderUnresolved` stays as is (search stage → true), which keeps the blind Enter/Shift+Enter refusals for the *non-search* half-typed case.

Keyboard — at the top of `onEntryKeyDown`:
```ts
    if (query !== null) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (resultCount) setHighlighted(Math.max(0, Math.min(resultCount - 1, hi + (e.key === 'ArrowDown' ? 1 : -1))));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!resultCount) return;
        if (e.shiftKey) activateResult(hi);
        else pickResult(hi);
        return;
      }
      // Escape / Backspace / printable fall through to the existing handling below.
    }
```

Search state for the panel:
```ts
  const searchState: ScriptureSearchState | null =
    query === null
      ? null
      : {
          query,
          tokens: parseVerseQuery(query).tokens,
          abbr: primaryVersion ? abbrOf(primaryVersion) : '',
          total: verseTotal,
          passages: passageHits.map((p) => ({ key: `p:${p.book}:${p.ch}:${p.from}`, title: p.title, meta: formatRef({ book: p.book, ch: p.ch, from: p.from, to: p.to }) })),
          verses: verseHits.map((v) => ({ key: `v:${v.book}:${v.chapter}:${v.verse}`, ref: formatRef({ book: v.book, ch: v.chapter, from: v.verse, to: v.verse }), text: v.text })),
          highlighted: hi,
          onHover: (i) => { if (i !== null) setHighlighted(i); },
          onPick: pickResult,
          onActivate: activateResult,
          noVersion: !primaryVersion || !manifest.some((m) => m.id === primaryVersion && m.installed)
        };
```
Pass `search={searchState}` to `<SchedulePanel>`.

Also: the `previewBook`/`previewCh` rail preview uses `builder.book ?? scrBook` — in search stage `book` is null so the rail keeps showing the cursor's chapter. Fine.

- [ ] **Step 4: Run the SermonMode suite, then the whole renderer suite**

Run: `npx vitest run src/renderer/operator/SermonMode.test.tsx`
Expected: PASS (new + existing; if an existing test used the old exact placeholder, it now goes through `entry()`).

Run: `npx vitest run src/renderer`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: clean. Typical fixes: move `pickResult`/`activateResult` below `goLiveWithChapter`; avoid reading refs during render; no `setState` inside an effect body for the highlight.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/SermonMode.tsx src/renderer/operator/SermonMode.test.tsx
git commit -m "feat(operator): verse text search from the scripture entry"
```

---

### Task 11: Full verification, manual smoke, docs, PR

**Files:**
- Modify: `docs/superpowers/roadmap.md` (note under #3/#7 that verse search now exists; one line each)

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: all green (including the new gold-query test; it installs the KJV once, ~2–5 s).

- [ ] **Step 2: Lint + typecheck + build**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 3: Manual smoke in the real app** (use the `run` skill / the playwright `_electron` recipe in memory `helm-electron-playwright-driving`)

Checklist — in Sermon → Scripture:
1. Type `jn 3 16` → behaves exactly as before (ghost, commit, `+ Add John 3:16`).
2. Type `zacch` → results rail: `PASSAGES: Zacchaeus · Luke 19:1–10`, `VERSES` with Luke 19:2, bold `Zaccheus`. ↓↓ moves the highlight; hero/projector untouched. Enter → entry reads `Luke 19:2`, rail scrolls to verse 2.
3. Type `prodigal son` → `0 VERSES · KJV`, passage `The Prodigal Son`. Enter → `Luke 15:11-32` in the entry, rail highlights 11–32, `+ Add Luke 15:11–32`.
4. Type `the l` → search `the l` (entry shows `1 Thessalonians` for one keystroke, then `the l`). Backspace ×2 → `1 Thessalonians` committed.
5. Type `"john` → searches verses for john rather than ghosting the gospel.
6. Type `zacchaeus` (modern spelling) → still finds Luke 19:2.
7. Shift+Enter on a highlighted hit while output is black → goes live with that verse.
8. Escape once → entry cleared, schedule back; Escape again → blur.
9. Startup on an existing userData (pre-index KJV): first search works (backfill ran at boot); check the main log for no `verse_fts backfill failed`.

- [ ] **Step 4: Roadmap note + commit**

In `docs/superpowers/roadmap.md`, under issue #3 and #7 lines, append ` — verse text search shipped via the scripture entry (spec 2026-08-23-bible-quick-find); extraction/pre-service reuse still open.` Commit:
```bash
git add docs/superpowers/roadmap.md
git commit -m "docs(roadmap): note verse search landed in the scripture entry"
```

- [ ] **Step 5: Open the PR**

```bash
git push -u origin bible-quick-find
gh pr create --title "feat(scripture): verse text search from the entry (bible quick-find)" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-08-23-bible-quick-find-design.md.

- refBuilder gains a `search` stage: the entry stays a reference typeahead until what's typed can't be a book (or a quote forces text); Backspace restores the pre-search state.
- `verse_fts` (FTS5) + `fts5vocab` in main; AND across words, bm25 as tie-break, JS scorer with canonical-order last; typo expansion via the vocabulary only when no term starts with the word.
- Curated passages table (~240 entries) for stories/chapters not in the text ("prodigal son" → Luke 15:11–32).
- Results rail replaces the schedule while searching; ↑/↓ highlight, Enter sets the entry to the hit and jumps the cursor, Shift+Enter / double-click go live; matched words bolded.
- Startup backfill for already-installed Bibles.
- Gold-query ranking test over the bundled KJV.

Follow-ups (not here): OR/partial fallback on zero hits, names dataset, cross-version search, bolding in song/quote rails.
EOF
)"
```

---

## Self-review notes (done while writing)

- Spec coverage: entry transitions (T2), index/backfill (T3), scorer ladder (T4), vocab expansion + AND + phrase + total (T5), gold set (T6), IPC (T7), passages (T8), rail + bolding + counts + empty states (T9), keyboard/pick/activate/`+ Add` label/placeholder (T10), roadmap/PR (T11). Error handling: IPC failure → empty results (T10 effect catch), backfill failure logged (T3), no version → `noVersion` (T10).
- Type consistency: `VerseHit {book, chapter, verse, text}` everywhere; `VerseSearchResult {hits, total, versionId}`; `rankVerses(q, rows, limit)` (no bm25 map — bm25 only orders the candidate cut); `ScriptureSearchState` shape identical in T9 and T10; `isSearch/searchQuery` names match T2/T10; `andGroupsMatch/orPrefixMatch/FTS_CANDIDATE_LIMIT` match T1/T5.
- Known judgment calls for the implementer: the `total` for phrase queries (T5 note), highlight reset without set-state-in-effect (T10), entry-length rule for Backspace restore (T2 `entryLen`).
