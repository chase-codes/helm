# Book-name typeahead in the scripture ref builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As the operator types a book name into the scripture entry field, show the book that space would commit as dimmed ghost text inline, and re-rank `matchBook`'s prefix branch so the ghost is genuinely the likeliest book (`ma` → Matthew, not Malachi).

**Architecture:** The commit rule that currently sits inline in `printable()`'s book case is extracted into an exported `bookCompletion(state)`. Both the keystroke handler (space, Tab) and the ghost renderer call it, so the display and the commit **cannot** disagree — the invariant is structural, not conventional. A pure `refGhost(state)` decides *what the ghost says* (inline tail vs. `→ Book` arrow) with no DOM involved; `SchedulePanel` decides only how it *looks*, as an absolutely-positioned overlay span that never enters the input's `value`.

**Tech Stack:** TypeScript, React 18, Electron, vitest (+ jsdom + @testing-library/react), playwright-core for the real-app driver.

**Source spec:** `docs/superpowers/specs/2026-08-05-scripture-book-typeahead-design.md` — read it before starting. It is the source of truth and was written from measured behaviour.

## Global Constraints

- **THE INVARIANT:** *A ghost is visible if and only if pressing space (or Tab) commits it.* Enforced by both paths calling the single exported `bookCompletion()`. **If you find yourself writing a second rule for what to display, stop — that is the bug this design exists to prevent.**
- **The ghost never enters the input's `value`.** The entry is a controlled `<input>` fed by `value={renderBuilder(builder)}`. Parsing, caret, selection and `onEntryChange` stay untouched. The ghost is a sibling overlay `<span>`.
- **Task 1 lands before Task 2.** `src/main/bibleSource.ts:65,78` uses `matchBook` to map book names from downloaded bibles onto canonical names; a silent remap there mis-files installed scripture, which is far worse than anything in the entry field. Pin it before touching the ranking.
- **Verification standard — all of these, not a subset:** `npm test` (575 passing on `main` (measured at 58c727d); keep it green), `npm run typecheck` (must be clean), and a real-app driver in `scratch/` (Electron + `playwright-core`, house pattern in `scratch/verify-bug008.mjs`).
- **`scratch/` stays untracked** — never `git add` anything under `scratch/`. The existing drivers there are untracked too.
- **House rules (`CLAUDE.md`):** concise conventional-commit subjects; add a body only when it genuinely adds clarity. **No `Co-Authored-By` and no `Claude-Session` trailers.**
- **Out of scope, do not touch while you are in these files:** BUG-010 / BUG-011 / BUG-012 (pre-existing defects in this same entry field, see `docs/superpowers/bugs.md`); chapter/verse-stage hints; Tab-cycling through alternatives; usage-based ranking. All considered and rejected — the spec says why.
- **Branch:** `feat/scripture-book-typeahead` (already checked out, spec is its only commit). Do not merge or rebase.

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/main/bibleSource.test.ts` | Modify | Pins that all 66 bundled-KJV book names resolve by **exact alias**, so the ranking provably cannot reach them |
| `src/shared/scripture/books.ts` | Modify | Gains `RANKED_BOOKS` — the curated tie-break list, separate from the alias table |
| `src/shared/scripture/refs.ts` | Modify | `matchBook`'s prefix branch: "first in canonical order" → "best-ranked, ties by canonical order". Exact-alias branch unchanged |
| `src/shared/scripture/refs.test.ts` | Modify | Ranking tests |
| `src/shared/scripture/refBuilder.ts` | Modify | Exports `bookCompletion()` (the extracted commit rule), `refGhost()` + `RefGhost` type; `applyKey` gains a `Tab` branch |
| `src/shared/scripture/refBuilder.test.ts` | Modify | The table-driven invariant property test, numbered-book cases, Tab cases |
| `src/renderer/operator/SchedulePanel.tsx` | Modify | Renders the ghost overlay span over the entry input |
| `src/renderer/operator/SchedulePanel.test.tsx` | Modify | Both ghost forms render; absent with no completion; `aria-hidden` |
| `src/renderer/operator/SermonMode.tsx` | Modify | Computes `refGhost(builder)`, passes it down as a prop |
| `scratch/verify-typeahead.mjs` | Create (**untracked**) | Real-app driver: type `ma`, see the Matthew ghost, press space, land on Matthew |
| `docs/superpowers/roadmap.md` | Modify | Mark the item shipped; note the roadmap's own `jo` example was wrong |

---

### Task 1: Pin `bibleSource` before the ranking moves

`normalizeGetBible` calls `matchBook(b.name)` on every book name in a downloaded bible and stores the result as the canonical name. If the ranking change silently remapped any of those, installed scripture would be mis-filed — a far worse failure than anything in the entry field.

The safety argument is that all 66 bundled-KJV book names — **including** the variants `Psalms` and `Song of Songs` — are declared exact aliases (`books.ts:27,30`), so they resolve on the exact-alias branch and the ranking cannot reach them. **This task pins that argument rather than trusting it:** the test asserts both that all 66 map to their canonical names *and* that each resolves via `matchBookExact`, which is the branch the ranking does not touch.

**Files:**
- Modify/Test: `src/main/bibleSource.test.ts` (append; the file already reads the bundled KJV at line 81)

**Interfaces:**
- Consumes: `matchBook`, `matchBookExact` from `src/shared/scripture/refs.ts` (both already exported)
- Produces: nothing consumed by later tasks — this is a safety net that must stay green through Task 2

- [ ] **Step 1: Write the pinning test**

Append to `src/main/bibleSource.test.ts`. Add `matchBook, matchBookExact` to the imports at the top of the file:

```ts
import { matchBook, matchBookExact } from '../shared/scripture/refs'
```

```ts
// Book-name typeahead re-ranks matchBook's PREFIX branch (refs.ts). normalizeGetBible
// maps downloaded book names through matchBook, so a silent remap here would mis-file
// installed scripture. The safety argument is that every bundled-KJV name — including
// the variants "Psalms" and "Song of Songs" — is an EXACT alias, a branch the ranking
// does not touch. Pin the argument, not just the outcome.
test('every bundled-KJV book name resolves by exact alias, out of the ranking’s reach', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../resources/bibles/kjv.json'), 'utf-8'))
  const names: string[] = raw.books.map((b: { name: string }) => b.name)
  expect(names).toHaveLength(66)

  for (const name of names) {
    // Resolves at all, and by the exact-alias branch specifically.
    expect(matchBookExact(name), `"${name}" must be an exact alias`).not.toBeNull()
    // ...and the exact branch is what matchBook returns for it, so prefix ranking
    // can never change the answer.
    expect(matchBook(name), `"${name}" must map via exact alias`).toBe(matchBookExact(name))
  }

  // The two names that are NOT the canonical spelling — the whole reason this test exists.
  expect(matchBook('Psalms')).toBe('Psalm')
  expect(matchBook('Song of Songs')).toBe('Song of Solomon')

  // 66 distinct canonical names out, no collisions.
  expect(new Set(names.map((n) => matchBook(n))).size).toBe(66)
})
```

- [ ] **Step 2: Run it and verify it PASSES against today's code**

Run: `npx vitest run src/main/bibleSource.test.ts`
Expected: PASS.

This is the one test in the plan that is written green on purpose. It is a **characterisation test** — it pins existing behaviour that Task 2 must not change. If it fails now, stop: the safety argument in the spec is wrong and the ranking work must be re-thought before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/main/bibleSource.test.ts
git commit -m "test(bibles): pin that every bundled-KJV book name resolves by exact alias"
```

---

### Task 2: Rank `matchBook`'s prefix branch by likelihood

Today `matchBook`'s prefix branch returns the first match in canonical Genesis→Revelation order, which is frequently not the likeliest book: `ma` → Malachi (meant: Matthew), `jo` → Joshua (meant: John). Shipping a truthful preview against that ranking would *advertise* the defect rather than fix it.

The rank lives in a separate exported list of book names, **not** as a field on every `T(...)` entry — retuning it later touches one list, and the alias table stays readable.

**Files:**
- Modify: `src/shared/scripture/books.ts` (append after `BOOKS`)
- Modify: `src/shared/scripture/refs.ts:11-17` (`matchBook` only)
- Test: `src/shared/scripture/refs.test.ts`

**Interfaces:**
- Consumes: `BOOKS` from `books.ts`, `norm` from `../search/fuzzy`
- Produces:
  - `export const RANKED_BOOKS: readonly string[]` in `books.ts`
  - `matchBook(token: string): string | null` — unchanged signature, prefix branch now picks the best-ranked match. **The exact-alias branch is unchanged.**

- [ ] **Step 1: Write the failing ranking tests**

Append to `src/shared/scripture/refs.test.ts`. Add `RANKED_BOOKS` and `BOOKS` to the imports:

```ts
import { BOOKS, RANKED_BOOKS } from './books'
```

```ts
test('ambiguous prefixes resolve to the likelier book, not canonical order', () => {
  expect(matchBook('ma')).toBe('Matthew') // was Malachi
  expect(matchBook('jo')).toBe('John') // was Joshua
  expect(matchBook('mar')).toBe('Mark') // only one prefix match; unaffected either way
})

test('the exact-alias branch still wins over ranking', () => {
  expect(matchBook('job')).toBe('Job') // not John, though John outranks Job
  expect(matchBook('1 jo')).toBe('1 John')
  expect(matchBook('so')).toBe('Song of Solomon')
  expect(matchBook('re')).toBe('Revelation')
  for (const b of BOOKS) expect(matchBook(b.name)).toBe(b.name) // every full canonical name
})

test('ranking invents no matches: pe stays null', () => {
  // Peter is only reachable numbered ("1 pe"); no bare "pe" alias exists.
  expect(matchBook('pe')).toBeNull()
})

test('unranked prefix matches keep canonical order among themselves', () => {
  expect(matchBook('hab')).toBe('Habakkuk')
  expect(matchBook('zep')).toBe('Zephaniah')
  expect(matchBook('gene')).toBe('Genesis')
})

test('every RANKED_BOOKS entry names a real book', () => {
  const names = new Set(BOOKS.map((b) => b.name))
  for (const n of RANKED_BOOKS) expect(names.has(n), `"${n}" is not a book name`).toBe(true)
  expect(new Set(RANKED_BOOKS).size).toBe(RANKED_BOOKS.length) // no duplicates
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/shared/scripture/refs.test.ts`
Expected: FAIL — `matchBook('ma')` returns `'Malachi'`, `matchBook('jo')` returns `'Joshua'`, and the `RANKED_BOOKS` import does not resolve.

- [ ] **Step 3: Add `RANKED_BOOKS` to `books.ts`**

Append after the `BOOKS` array (after line 75):

```ts
/** Tie-break order for AMBIGUOUS typed prefixes — earlier wins. Everything unlisted keeps
 * canonical order relative to itself, and sorts after everything listed. Only ever consulted
 * when a prefix matches more than one book, so it cannot touch exact aliases.
 * A judgement call, expected to be tuned: it is deliberately static and in one list, so
 * retuning is a one-line change. Not learned from usage — that would make the same keystrokes
 * resolve differently week to week and cold-start empty on a fresh install. */
export const RANKED_BOOKS: readonly string[] = [
  'John',
  'Matthew',
  'Mark',
  'Luke',
  'Acts',
  'Romans',
  'Psalm',
  'Proverbs',
  'Genesis',
  'Exodus',
  'Isaiah',
  'Hebrews',
  'James',
  'Ephesians',
  'Philippians',
  'Galatians',
  'Colossians',
  'Revelation'
]
```

- [ ] **Step 4: Change `matchBook`'s prefix branch in `refs.ts`**

Replace the import on line 2 and the body of `matchBook` (lines 11-17):

```ts
import { BOOKS, RANKED_BOOKS } from './books'
```

```ts
const RANK = new Map(RANKED_BOOKS.map((name, i) => [name, i]))
const rankOf = (name: string): number => RANK.get(name) ?? Number.MAX_SAFE_INTEGER

export function matchBook(token: string): string | null {
  const t = norm(token)
  if (!t) return null
  for (const b of BOOKS) if (b.aliases.includes(t)) return b.name
  // Prefix fallback: best-ranked match, ties broken by canonical order (strict `<` keeps
  // the earlier, i.e. canonical, book when ranks are equal — including equal-unranked).
  let best: string | null = null
  for (const b of BOOKS) {
    if (!b.aliases.some((a) => a.startsWith(t))) continue
    if (best === null || rankOf(b.name) < rankOf(best)) best = b.name
  }
  return best
}
```

`matchBookExact` (lines 18-23) is **not** touched.

- [ ] **Step 5: Run the ranking tests and the Task 1 safety net**

Run: `npx vitest run src/shared/scripture/refs.test.ts src/main/bibleSource.test.ts`
Expected: PASS, both files. The `bibleSource` pin must still be green — if it is not, revert and re-read the spec's Testing item 1.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all green. Two existing assertions are worth watching: `refs.test.ts` "prefix fallback in canon order" (`gene`, `song of sol` — both unique prefix matches, unaffected) and `refBuilder.test.ts` "book: prefix completion advances (jame -> James)" (`jame` matches only James).

- [ ] **Step 7: Update the stale test name**

The existing `refs.test.ts` test named `'prefix fallback in canon order'` no longer describes the branch. Rename it:

```ts
test('prefix fallback resolves unambiguous prefixes', () => {
  expect(matchBook('gene')).toBe('Genesis')
  expect(matchBook('song of sol')).toBe('Song of Solomon')
})
```

- [ ] **Step 8: Commit**

```bash
git add src/shared/scripture/books.ts src/shared/scripture/refs.ts src/shared/scripture/refs.test.ts
git commit -m "feat(scripture): rank ambiguous book prefixes by likelihood"
```

---

### Task 3: `bookCompletion` + `refGhost` — the invariant made structural

The commit decision currently lives inline in `printable`'s book case (`refBuilder.ts:89-90`). Extract it so the keystroke handler and the renderer are **the same function**.

**Files:**
- Modify: `src/shared/scripture/refBuilder.ts` (add exports; rewrite `printable`'s `case 'book'` space branch)
- Test: `src/shared/scripture/refBuilder.test.ts`

**Interfaces:**
- Consumes: `matchBook`, `matchBookExact` from `./refs`; `norm` from `../search/fuzzy`; `RefBuilderState` (already defined, `refBuilder.ts:5-12`)
- Produces:
  - `export function bookCompletion(s: RefBuilderState): string | null` — the book name that space (or Tab) would commit right now
  - `export type RefGhost = { kind: 'tail'; text: string } | { kind: 'alias'; book: string }`
  - `export function refGhost(s: RefBuilderState): RefGhost | null` — returns `null` exactly when `bookCompletion` does

- [ ] **Step 1: Write the failing tests — the invariant first**

Append to `src/shared/scripture/refBuilder.test.ts`. Extend the import block at the top with `bookCompletion, refGhost` and `type RefGhost`:

```ts
import {
  EMPTY_EXTENT,
  initialBuilder,
  clampChapter,
  clampVerse,
  renderBuilder,
  toParsedRef,
  fromParsedRef,
  applyKey,
  setStart,
  setEnd,
  bookCompletion,
  refGhost,
  type RefBuilderState,
  type RefGhost
} from './refBuilder'
```

```ts
// --- Book-name typeahead ---------------------------------------------------------------
// THE INVARIANT: a ghost is visible if and only if pressing space commits a book.
// This is the test that keeps the feature honest as the code changes. It fails if anyone
// reintroduces a separate rule for what to display.

const atBook = (bookQuery: string): RefBuilderState => ({ ...initialBuilder(), bookQuery })

test('INVARIANT: refGhost is non-null exactly when space commits a book', () => {
  const queries = [
    '', 'g', 'ge', 'gen', 'gene', 'genesis',
    'j', 'jo', 'joh', 'john', 'jhn', 'jn', 'job', 'jame', 'james',
    'm', 'ma', 'mar', 'mark', 'mat', 'matthew', 'mal',
    'p', 'pe', 'ps', 'psalm', 'psalms',
    'r', 're', 'rev', 'ro',
    's', 'so', 'song', 'song of sol',
    't', 'ti', 'tit',
    'c', 'co', 'col',
    '1', '1 ', '1 j', '1j', '1 jo', '1jo', '1 john', '2 jo', '3 jo', '1 sa', '1sam',
    'x', 'xyz', 'zzz', 'q', '  ', '9', '1 x'
  ]
  for (const q of queries) {
    const s = atBook(q)
    const after = applyKey(s, ' ', false, EMPTY_EXTENT).state
    const spaceCommits = after.stage === 'chapter' && after.book !== null
    const ghost = refGhost(s)
    expect(
      ghost !== null,
      `"${q}": ghost=${JSON.stringify(ghost)} but space ${spaceCommits ? 'DOES' : 'does NOT'} commit`
    ).toBe(spaceCommits)
    // ...and when it does commit, the ghost names the book it commits.
    if (spaceCommits) expect(bookCompletion(s), `"${q}"`).toBe(after.book)
  }
})

test('INVARIANT holds past the book stage: no ghost once a book is resolved', () => {
  const resolved: RefBuilderState = {
    ...initialBuilder(),
    stage: 'chapter',
    book: 'John',
    chapter: 3
  }
  expect(bookCompletion(resolved)).toBeNull()
  expect(refGhost(resolved)).toBeNull()
  expect(refGhost({ ...resolved, stage: 'verse', startVerse: 16 })).toBeNull()
  expect(refGhost({ ...resolved, stage: 'endVerse', startVerse: 16, endVerse: 18 })).toBeNull()
})

test('ghost: tail form when the query is a prefix of the book name', () => {
  expect(refGhost(atBook('gen'))).toEqual<RefGhost>({ kind: 'tail', text: 'esis' })
  expect(refGhost(atBook('ma'))).toEqual<RefGhost>({ kind: 'tail', text: 'tthew' })
  expect(refGhost(atBook('jo'))).toEqual<RefGhost>({ kind: 'tail', text: 'hn' })
  expect(refGhost(atBook('song of sol'))).toEqual<RefGhost>({ kind: 'tail', text: 'omon' })
})

test('ghost: alias form when the matching alias is not a prefix of the name', () => {
  expect(refGhost(atBook('jhn'))).toEqual<RefGhost>({ kind: 'alias', book: 'John' })
  expect(refGhost(atBook('jn'))).toEqual<RefGhost>({ kind: 'alias', book: 'John' })
  expect(refGhost(atBook('jb'))).toEqual<RefGhost>({ kind: 'alias', book: 'Job' })
  expect(refGhost(atBook('1sa'))).toEqual<RefGhost>({ kind: 'alias', book: '1 Samuel' })
})

test('ghost: the whole name typed leaves an empty tail — nothing is hidden', () => {
  // Space still commits, so the ghost must stay non-null (the invariant); there is simply
  // nothing left to complete, because the operator is already looking at the answer.
  expect(refGhost(atBook('genesis'))).toEqual<RefGhost>({ kind: 'tail', text: '' })
})

test('ghost: no match, no ghost', () => {
  expect(refGhost(atBook('xyz'))).toBeNull()
  expect(refGhost(atBook(''))).toBeNull()
  expect(refGhost(atBook('pe'))).toBeNull() // Peter is unreachable bare
})

test('ghost: numbered books stay silent until they resolve', () => {
  expect(refGhost(atBook('1'))).toBeNull() // space inserts a space, does not commit
  expect(refGhost(atBook('1 '))).toBeNull()
  expect(refGhost(atBook('1 j'))).toBeNull() // ambiguous: 1/2/3 John
  expect(refGhost(atBook('1 jo'))).toEqual<RefGhost>({ kind: 'tail', text: 'hn' }) // exact alias
  expect(bookCompletion(atBook('1 jo'))).toBe('1 John')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/shared/scripture/refBuilder.test.ts`
Expected: FAIL — `bookCompletion` and `refGhost` are not exported from `./refBuilder`.

- [ ] **Step 3: Implement `bookCompletion`, `refGhost` and the `printable` refactor**

In `src/shared/scripture/refBuilder.ts`, add `norm` to the imports at the top:

```ts
import { norm } from '../search/fuzzy'
```

Add after `renderBuilder` (i.e. after line 48):

```ts
/**
 * The book name that space (or Tab) would commit right now, or null.
 *
 * THE INVARIANT: this is the ONLY rule for whether a book commits, and it is also the only
 * rule for whether a ghost shows. `printable` calls it to decide whether to commit; the
 * renderer calls it (via `refGhost`) to decide what to preview. They cannot disagree,
 * because they are the same function. Do not write a second rule for the display.
 *
 * Numbered books are the reason for the digit clause: a bare "1" prefix-matches 1 Samuel,
 * but space there inserts a literal space rather than committing, so anything containing a
 * digit must be an EXACT alias ("1 jo") before it counts as a completion.
 */
export function bookCompletion(s: RefBuilderState): string | null {
  if (s.stage !== 'book') return null
  const q = s.bookQuery
  const b = matchBook(q)
  if (b === null) return null
  if (/\d/.test(q) && matchBookExact(q) === null) return null
  return b
}

/** Two forms, because a matching alias is not always a prefix of the book name:
 *  "gen" → tail "esis" (inline), "jhn" → alias "John" (rendered as an arrow).
 *  Both mean the same thing: space takes this. */
export type RefGhost = { kind: 'tail'; text: string } | { kind: 'alias'; book: string }

/** What the ghost says — decided in pure code, with no DOM. Returns null exactly when
 * `bookCompletion` does, which is what makes the invariant hold. The component decides only
 * how each form LOOKS. */
export function refGhost(s: RefBuilderState): RefGhost | null {
  const book = bookCompletion(s)
  if (book === null) return null
  const q = norm(s.bookQuery)
  const name = norm(book)
  // Tail measured on the NORMALIZED name, not the raw query: `norm` can shorten the raw
  // text (it collapses runs of spaces, which the numbered-book path can produce), so
  // slicing the display string by the raw length would cut in the wrong place.
  if (name.startsWith(q)) return { kind: 'tail', text: name.slice(q.length) }
  return { kind: 'alias', book }
}
```

Then replace `printable`'s book-stage space branch (currently lines 87-95) so it uses the extracted rule:

```ts
    case 'book': {
      if (key === ' ') {
        const b = bookCompletion(s)
        if (b !== null) return commitBook(s, b)
        if (/\d/.test(s.bookQuery)) return { ...s, bookQuery: s.bookQuery + ' ' }
        return s
      }
      if (isAlnum(key)) return { ...s, bookQuery: s.bookQuery + key }
      return s
    }
```

And add the shared commit body next to `printable` (Task 4's Tab branch reuses it):

```ts
/** Commit a resolved book and move to the chapter stage. Shared by space and Tab so the
 * two accept keys cannot drift apart. */
function commitBook(s: RefBuilderState, book: string): RefBuilderState {
  return { ...s, stage: 'chapter', book, bookQuery: '', chapter: null }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/scripture/refBuilder.test.ts`
Expected: PASS, including the pre-existing book-stage tests (`jame` → James, bare `1` inserts a space, `1john` → 1 John) — the refactor must be behaviour-preserving for space.

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/scripture/refBuilder.ts src/shared/scripture/refBuilder.test.ts
git commit -m "feat(scripture): extract bookCompletion and derive the ghost from it"
```

---

### Task 4: Tab accepts the ghost

`applyKey` currently drops any key whose `length !== 1` except `Backspace` (`refBuilder.ts:79-80`), so Tab falls through with `preventDefault: false`. It gains a branch that commits **only** when a ghost is showing — with no ghost, Tab keeps its normal focus behaviour rather than being swallowed.

**Files:**
- Modify: `src/shared/scripture/refBuilder.ts:73-82` (`applyKey`)
- Test: `src/shared/scripture/refBuilder.test.ts`

**Interfaces:**
- Consumes: `bookCompletion`, `commitBook` from Task 3
- Produces: `applyKey(s, 'Tab', shift, extent)` → `{ state, preventDefault }` — unchanged signature

- [ ] **Step 1: Write the failing Tab tests**

Append to `src/shared/scripture/refBuilder.test.ts`:

```ts
test('Tab commits the book when a ghost is showing', () => {
  const r = applyKey(atBook('ma'), 'Tab', false, EMPTY_EXTENT)
  expect(r.state).toMatchObject({ stage: 'chapter', book: 'Matthew', bookQuery: '' })
  expect(r.preventDefault).toBe(true)
})

test('Tab commits the alias form too', () => {
  const r = applyKey(atBook('jhn'), 'Tab', false, EMPTY_EXTENT)
  expect(r.state).toMatchObject({ stage: 'chapter', book: 'John' })
  expect(r.preventDefault).toBe(true)
})

test('Tab with no ghost leaves focus alone', () => {
  for (const q of ['', 'xyz', '1', '1 j']) {
    const s = atBook(q)
    const r = applyKey(s, 'Tab', false, EMPTY_EXTENT)
    expect(r.state, `"${q}"`).toBe(s) // identity: nothing changed
    expect(r.preventDefault, `"${q}"`).toBe(false) // focus still moves
  }
})

test('Tab past the book stage never commits', () => {
  const s: RefBuilderState = { ...initialBuilder(), stage: 'chapter', book: 'John', chapter: 3 }
  const r = applyKey(s, 'Tab', false, EMPTY_EXTENT)
  expect(r.state).toBe(s)
  expect(r.preventDefault).toBe(false)
})

test('Tab and space commit identically wherever a ghost shows', () => {
  for (const q of ['gen', 'ma', 'jo', 'jhn', '1 jo', 'jame']) {
    const s = atBook(q)
    const viaTab = applyKey(s, 'Tab', false, EMPTY_EXTENT).state
    const viaSpace = applyKey(s, ' ', false, EMPTY_EXTENT).state
    expect(viaTab, `"${q}"`).toEqual(viaSpace)
  }
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/shared/scripture/refBuilder.test.ts -t Tab`
Expected: FAIL — Tab currently returns the state unchanged with `preventDefault: false` in every case, so the two commit tests fail.

- [ ] **Step 3: Add the Tab branch**

In `applyKey`, insert before the `key.length !== 1` guard:

```ts
export function applyKey(
  s: RefBuilderState,
  key: string,
  _shift: boolean,
  extent: BookExtent
): Applied {
  if (key === 'Backspace') return { state: backspace(s), preventDefault: true }
  if (key === 'Tab') {
    // Accept only what the operator can SEE. With no ghost, Tab is not swallowed — focus
    // moves as it normally would, rather than the field eating a key for nothing.
    const b = bookCompletion(s)
    if (b === null) return { state: s, preventDefault: false }
    return { state: commitBook(s, b), preventDefault: true }
  }
  if (key.length !== 1) return { state: s, preventDefault: false }
  return { state: printable(s, key, extent), preventDefault: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/scripture/refBuilder.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/scripture/refBuilder.ts src/shared/scripture/refBuilder.test.ts
git commit -m "feat(scripture): Tab accepts the book ghost, otherwise moves focus"
```

---

### Task 5: Render the ghost overlay

The entry field is a controlled `<input>` fed by `value={renderBuilder(builder)}` (`SermonMode.tsx:633` → `SchedulePanel.tsx:113-120`). **The ghost never enters `value`.** `SchedulePanel` wraps the input in a `position: relative` container and paints an absolutely-positioned span over it: a transparent copy of the typed text advances the dim text to exactly the right offset, so no text-width measuring is needed.

The field is JetBrains Mono at 13.5px with no padding (`global.css:25-32` clears input background/border, and the input sets no padding of its own). The ghost span must carry identical `fontFamily` and `fontSize`, or it will drift.

**Files:**
- Modify: `src/renderer/operator/SchedulePanel.tsx:18-30` (props) and `:112-120` (the input)
- Modify: `src/renderer/operator/SermonMode.tsx:628-644` (pass the prop)
- Test: `src/renderer/operator/SchedulePanel.test.tsx`

**Interfaces:**
- Consumes: `RefGhost`, `refGhost` from `../../shared/scripture/refBuilder` (Task 3)
- Produces: `SchedulePanelProps` gains `ghost?: RefGhost | null`

- [ ] **Step 1: Write the failing panel tests**

Append inside the existing `describe('SchedulePanel', ...)` block in `src/renderer/operator/SchedulePanel.test.tsx`:

```ts
  it('renders the tail ghost dimmed and aria-hidden, without touching the input value', () => {
    render(<SchedulePanel {...baseProps} value="gen" ghost={{ kind: 'tail', text: 'esis' }} />)
    const input = screen.getByPlaceholderText(/Add reading/) as HTMLInputElement
    expect(input.value).toBe('gen') // the ghost is NEVER in the value
    const ghost = document.querySelector('[data-ghost]') as HTMLElement
    expect(ghost).toBeTruthy()
    expect(ghost.getAttribute('aria-hidden')).toBe('true') // no double-reading the field
    expect(ghost.textContent).toBe('genesis') // transparent copy of "gen" + dim "esis"
    expect((ghost.querySelector('[data-ghost-text]') as HTMLElement).textContent).toBe('esis')
  })

  it('renders the alias ghost as an arrow to the book name', () => {
    render(<SchedulePanel {...baseProps} value="jhn" ghost={{ kind: 'alias', book: 'John' }} />)
    const input = screen.getByPlaceholderText(/Add reading/) as HTMLInputElement
    expect(input.value).toBe('jhn')
    const text = document.querySelector('[data-ghost-text]') as HTMLElement
    expect(text.textContent).toBe(' → John')
  })

  it('renders no ghost when there is no completion', () => {
    render(<SchedulePanel {...baseProps} value="xyz" ghost={null} />)
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })

  it('renders no ghost when the prop is omitted entirely', () => {
    render(<SchedulePanel {...baseProps} value="John 3:16" />)
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/renderer/operator/SchedulePanel.test.tsx`
Expected: FAIL — no `[data-ghost]` element exists; TypeScript also rejects the unknown `ghost` prop.

- [ ] **Step 3: Add the prop and the overlay to `SchedulePanel.tsx`**

Add the import at the top of the file:

```ts
import type { RefGhost } from '../../shared/scripture/refBuilder';
```

Add to `SchedulePanelProps` (after `onEntryKeyDown`):

```ts
  /** Book-name completion preview for the entry field. Non-null exactly when space (or Tab)
   * would commit a book — see `bookCompletion` in refBuilder. Rendered as a dim overlay,
   * never as part of `value`. */
  ghost?: RefGhost | null;
```

Add `ghost` to the destructured parameter list (after `onEntryKeyDown`).

Replace the `<input>` block (lines 112-119) with:

```tsx
              <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
                <input
                  style={{ flex: 1, minWidth: 0, fontSize: '13.5px', fontFamily: "'JetBrains Mono',monospace" }}
                  value={value}
                  onChange={(e) => onEntryChange(e.target.value)}
                  onKeyDown={onEntryKeyDown}
                  placeholder="Add reading — John 3:16"
                />
                {ghost && (
                  // A transparent copy of the typed text advances the dim completion to
                  // exactly the caret's offset — no text measuring, no scroll syncing (a
                  // book name plus a reference never gets long enough to scroll this field).
                  // Font must match the input exactly or the ghost drifts.
                  <span
                    data-ghost
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      display: 'flex',
                      alignItems: 'center',
                      pointerEvents: 'none',
                      whiteSpace: 'pre',
                      fontSize: '13.5px',
                      fontFamily: "'JetBrains Mono',monospace"
                    }}
                  >
                    <span style={{ color: 'transparent' }}>{value}</span>
                    <span data-ghost-text style={{ color: T.faint }}>
                      {ghost.kind === 'tail' ? ghost.text : ` → ${ghost.book}`}
                    </span>
                  </span>
                )}
              </div>
```

- [ ] **Step 4: Run the panel tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SchedulePanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire it up in `SermonMode.tsx`**

Add `refGhost` to the existing `refBuilder` import block (`SermonMode.tsx:6-14`), which currently reads `initialBuilder, applyKey, renderBuilder, fromParsedRef, toParsedRef, EMPTY_EXTENT, type RefBuilderState`.

Add near the other derived values, next to `builderUnresolved` (around line 437):

```ts
  // The completion the entry previews. Same function the space/Tab handler commits with,
  // so what the operator sees and what the keystroke does cannot disagree.
  const ghost = refGhost(builder);
```

Pass it in the `<SchedulePanel .../>` block, immediately after `onEntryKeyDown`:

```tsx
            ghost={ghost}
```

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/operator/SchedulePanel.tsx src/renderer/operator/SchedulePanel.test.tsx src/renderer/operator/SermonMode.tsx
git commit -m "feat(scripture): show the book completion as a dim overlay in the entry"
```

---

### Task 6: Real-app verification

Unit tests cannot show that the overlay actually **aligns** with the input — that is the whole point of this step. A driver in the house style (Electron + `playwright-core`, as `scratch/verify-bug008.mjs` / `scratch/verify-autofit.mjs`) types `ma`, sees the Matthew ghost, presses space, and lands on Matthew.

**Files:**
- Create: `scratch/verify-typeahead.mjs` — **leave untracked**, like every other driver in `scratch/`

**Interfaces:**
- Consumes: the running app's DOM (`[data-ghost]`, `[data-ghost-text]` from Task 5) — no module imports

- [ ] **Step 1: Build the app**

Run: `npm run build`
Expected: clean (it runs `typecheck` first). The driver launches the built app, so this must come first.

- [ ] **Step 2: Write the driver**

Create `scratch/verify-typeahead.mjs`:

```js
// Book-name typeahead real-app verification: the ghost must APPEAR in the entry field,
// must be visually aligned with the typed text (unit tests can't see this), and space must
// land on exactly the book the ghost named.
import { _electron as electron } from 'playwright-core';
import * as path from 'node:path';

const APP_DIR = '/Users/lem/repos/helm';
const SHOT_DIR = process.env.SCREENSHOT_DIR || '.';
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_DIR],
  cwd: APP_DIR,
  timeout: 30_000,
});
await sleep(6_000);
const page = app.windows().find((w) => w.url().includes('operator')) ?? (await app.firstWindow());

// --- Get to the Sermon mode scripture entry. ---
await page.getByText('Sermon', { exact: true }).click();
await sleep(800);
const entry = page.getByPlaceholder(/Add reading/);
check('scripture entry field is present', (await entry.count()) === 1);
await entry.click();
await sleep(200);

const ghost = page.locator('[data-ghost]');
const ghostText = page.locator('[data-ghost-text]');

// --- 1. No ghost on an empty field. ---
check('no ghost before typing', (await ghost.count()) === 0);

// --- 2. Type "ma": the ghost must offer Matthew, not Malachi. ---
await page.keyboard.type('ma');
await sleep(300);
check('a ghost appears while typing', (await ghost.count()) === 1);
check('the ghost completes "ma" to Matthew', (await ghostText.textContent()) === 'tthew',
  `text=${JSON.stringify(await ghostText.textContent())}`);
check('the input value still holds only what was typed',
  (await entry.inputValue()) === 'ma', `value=${await entry.inputValue()}`);
await page.screenshot({ path: path.join(SHOT_DIR, 'typeahead-1-ma-ghost.png') });

// --- 3. Alignment: the ghost's dim text must start where the typed text ends. ---
// Both boxes come from the live layout, so this catches font/padding drift that no unit
// test can see.
const boxes = await page.evaluate(() => {
  const g = document.querySelector('[data-ghost]');
  const t = document.querySelector('[data-ghost-text]');
  const i = document.querySelector('input[placeholder^="Add reading"]');
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const cs = getComputedStyle(g);
  const ics = getComputedStyle(i);
  return {
    ghost: r(g), text: r(t), input: r(i),
    font: { ghost: `${cs.fontFamily}|${cs.fontSize}|${cs.letterSpacing}`,
            input: `${ics.fontFamily}|${ics.fontSize}|${ics.letterSpacing}` },
  };
});
check('ghost overlay is left-aligned with the input', Math.abs(boxes.ghost.x - boxes.input.x) < 1,
  `ghost.x=${boxes.ghost.x} input.x=${boxes.input.x}`);
check('ghost overlay is vertically centred on the input',
  Math.abs((boxes.ghost.y + boxes.ghost.h / 2) - (boxes.input.y + boxes.input.h / 2)) < 1.5,
  `ghost=${boxes.ghost.y}+${boxes.ghost.h} input=${boxes.input.y}+${boxes.input.h}`);
check('dim text starts to the right of the typed text', boxes.text.x > boxes.input.x,
  `text.x=${boxes.text.x} input.x=${boxes.input.x}`);
check('ghost font matches the input exactly',
  boxes.font.ghost === boxes.font.input, `${boxes.font.ghost} vs ${boxes.font.input}`);

// --- 4. Space lands on exactly the book the ghost named. ---
await page.keyboard.press('Space');
await sleep(300);
check('space commits Matthew', (await entry.inputValue()) === 'Matthew',
  `value=${await entry.inputValue()}`);
check('the ghost is gone once the book is resolved', (await ghost.count()) === 0);
await page.screenshot({ path: path.join(SHOT_DIR, 'typeahead-2-committed.png') });

// --- 5. The alias form: "jhn" is not a prefix of John, so it renders as an arrow. ---
for (let i = 0; i < 20; i++) await page.keyboard.press('Backspace');
await sleep(300);
await page.keyboard.type('jhn');
await sleep(300);
check('alias ghost renders as an arrow to the book',
  (await ghostText.textContent())?.trim() === '→ John', `text=${await ghostText.textContent()}`);
await page.screenshot({ path: path.join(SHOT_DIR, 'typeahead-3-alias.png') });

// --- 6. Tab accepts too. ---
await page.keyboard.press('Tab');
await sleep(300);
check('Tab commits the ghosted book', (await entry.inputValue()) === 'John',
  `value=${await entry.inputValue()}`);

// --- 7. No match, no ghost — and no ghost for a bare numbered prefix. ---
for (let i = 0; i < 20; i++) await page.keyboard.press('Backspace');
await sleep(200);
await entry.click();
await page.keyboard.type('xyz');
await sleep(300);
check('no ghost for an unmatched query', (await ghost.count()) === 0);
for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
await page.keyboard.type('1 j');
await sleep(300);
check('no ghost for an ambiguous numbered prefix', (await ghost.count()) === 0,
  `value=${await entry.inputValue()}`);
await page.keyboard.type('o');
await sleep(300);
check('ghost appears once "1 jo" resolves', (await ghost.count()) === 1);
check('and it completes to 1 John', (await ghostText.textContent()) === 'hn',
  `text=${await ghostText.textContent()}`);
await page.screenshot({ path: path.join(SHOT_DIR, 'typeahead-4-numbered.png') });

await app.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
```

- [ ] **Step 3: Run the driver from the repo root**

Run: `node scratch/verify-typeahead.mjs`
Expected: every check PASS, exit 0.

If a locator misses (mode tab label, placeholder text), fix the *driver*, not the app — read the real DOM first with a screenshot or `page.content()`. If a check genuinely fails, the feature is wrong: go back to the task that owns it. **Do not weaken a check to make it pass.**

- [ ] **Step 4: Look at the screenshots**

Read `typeahead-1-ma-ghost.png` and `typeahead-3-alias.png`. Confirm by eye that the dim text sits inline with the typed text on the same baseline with no visible offset, and that it reads as dimmed rather than as a second cursor or a duplicate line. Numeric alignment checks catch drift; only the eye catches "technically aligned but looks wrong".

- [ ] **Step 5: Confirm `scratch/` is still untracked**

Run: `git status --short scratch/`
Expected: `?? scratch/verify-typeahead.mjs` listed among the other untracked drivers (`verify-bug008.mjs`, `verify-autofit.mjs`, …) — untracked, and **not** staged. Nothing to commit for this task.

---

### Task 7: Close out the roadmap item

The roadmap entry (`docs/superpowers/roadmap.md`, Sermon/Scripture section, "Book-name typeahead in the ref builder", lines 165-176) poses the design questions this work answered — and contains one factual error worth correcting rather than deleting: it offers `jo` → John as an example of *current* behaviour to be cycled through, but `BOOKS` is in canonical order, so `jo` gave **Joshua** before this change.

**Files:**
- Modify: `docs/superpowers/roadmap.md:165-176`

- [ ] **Step 1: Read the surrounding shipped entries**

Read `docs/superpowers/roadmap.md` around lines 14-17, 39-42, 88, 99 and 148 to match the house form: `- ~~**Title.**~~ ✅ **Shipped** (`<commit>`) — <what landed, in the same voice as the rest>`.

- [ ] **Step 2: Get the commit hash to cite**

Run: `git log --oneline -8`
Use the hash of the Task 5 commit (`feat(scripture): show the book completion as a dim overlay in the entry`) — that is the one that makes the feature visible.

- [ ] **Step 3: Rewrite the entry**

Replace the whole entry with the strikethrough form. Keep it to the register of its neighbours — what landed, what it rests on, what was left out and why:

```markdown
- ~~**Book-name typeahead in the ref builder.**~~ ✅ **Shipped** (`<hash>`) — the entry now
  shows the book space would commit as dim ghost text inline, in two forms: an inline tail
  (`gen`→`esis`) when the query prefixes the name, and an arrow (`jhn → John`) when the
  matching alias doesn't. The invariant — *a ghost is visible iff space (or Tab) commits it*
  — is structural, not conventional: the commit rule moved out of `printable` into an
  exported `bookCompletion` (`refBuilder.ts`) that both the keystroke handler and the
  renderer call, pinned by a table-driven property test. The ghost is an overlay span, never
  part of the input's `value`.
  Measuring the design turned up a second defect and pulled it into scope: `matchBook`'s
  prefix branch returned the first match in canonical order, so **the example in this entry
  was wrong** — `BOOKS` is in canonical order, so `jo` gave *Joshua*, not John, and `ma` gave
  *Malachi*. A preview would have advertised that on every keystroke, so the branch now
  prefers a curated `RANKED_BOOKS` list (`books.ts`) with canonical order as the tie-break;
  the exact-alias branch is untouched, pinned by a test that every bundled-KJV book name —
  including the variants `Psalms` and `Song of Songs` — resolves exactly, out of the
  ranking's reach (`bibleSource` maps downloaded book names through `matchBook`).
  Rejected, with reasons in the spec: chapter/verse-stage hints (a range display, not a
  completion, and it sits on the extent-fetch path where **BUG-010** already drops digits
  typed at speed), Tab-cycling through alternatives (one more letter disambiguates), and
  usage-based ranking (same keystrokes would resolve differently week to week, and cold-start
  empty on a fresh install). `ti` and `co` stay "wrong" — Timothy and Corinthians are
  numbered, so no ranking reaches them bare; the ghost at least makes that visible now.
  Spec: `docs/superpowers/specs/2026-08-05-scripture-book-typeahead-design.md`.
```

- [ ] **Step 4: Final verification**

Run: `npm test && npm run typecheck`
Expected: both clean. Confirm the test count has grown from the 575 baseline measured on `main`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/roadmap.md
git commit -m "docs(roadmap): book-name typeahead shipped; the jo example was wrong"
```

- [ ] **Step 6: Confirm nothing under `scratch/` was committed**

Run: `git status --short && git log --oneline --stat -7 | grep -c scratch/ || echo "clean"`
Expected: `clean` — no `scratch/` path in any commit, and `scratch/verify-typeahead.mjs` still listed as untracked.

---

## Notes for the implementer

**Order is not negotiable.** Task 1 before Task 2 (the safety pin before the ranking change). Task 3 before Tasks 4 and 5 (both consume `bookCompletion`).

**The one thing that would make this work worthless:** a second rule for what to display. If any task tempts you to compute the ghost from anything other than `bookCompletion`, the design has been broken — stop and re-read the spec's "The invariant" section.

**Known caveats, accepted, do not build around them:**
- **Horizontal scroll.** If typed text ever grew long enough to scroll the input, the ghost would not scroll with it. A book name plus a reference never gets that long in this field; accepted rather than building scroll-syncing.
- **The curated rank is a judgement call.** It will be wrong for some congregation. It is static and in one list, so retuning is a one-line change.
- **`ti` and `co` stay "wrong".** Titus and Colossians win because Timothy and Corinthians are numbered and unreachable bare, whatever the ranking.
