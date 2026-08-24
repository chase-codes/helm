import type { BookExtent } from '../types'
import { matchBook, matchBookExact, type ParsedRef } from './refs'
import { norm } from '../search/fuzzy'

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

export const EMPTY_EXTENT: BookExtent = { chapters: 0, verseCounts: [] }

export function initialBuilder(): RefBuilderState {
  return {
    stage: 'book',
    bookQuery: '',
    book: null,
    chapter: null,
    startVerse: null,
    endVerse: null,
    prior: null
  }
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

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

/** An extent with no chapters is UNKNOWN (not yet fetched), not "a book with no chapters":
 * the clamps pass digits through unchanged rather than collapsing them to 0 → null (#17,
 * BUG-010). The caller re-clamps with `reclamp` once the real extent lands. */
export function clampChapter(n: number, extent: BookExtent): number {
  if (extent.chapters === 0) return Math.max(n, 1)
  return clamp(n, 1, extent.chapters)
}
export function clampVerse(n: number, chapter: number, extent: BookExtent): number {
  const max = extent.verseCounts[chapter - 1]
  if (extent.chapters === 0 || max === undefined) return Math.max(n, 1)
  return clamp(n, 1, max)
}

/** Clamp every numeric field of a builder against `extent`, in dependency order (a clamped
 * chapter changes which verse count the verses clamp to). Identity when nothing changes,
 * so it is safe as a setState updater. Used when a book's extent arrives after the digits
 * were typed, and on paste (#19b: "Genesis 99:1" must not reach the projector as-is). */
export function reclamp(s: RefBuilderState, extent: BookExtent): RefBuilderState {
  if (extent.chapters === 0 || s.book === null) return s
  const chapter = s.chapter === null ? null : clampChapter(s.chapter, extent)
  const startVerse =
    s.startVerse === null || chapter === null
      ? s.startVerse
      : clampVerse(s.startVerse, chapter, extent)
  const endVerse =
    s.endVerse === null || chapter === null ? s.endVerse : clampVerse(s.endVerse, chapter, extent)
  if (chapter === s.chapter && startVerse === s.startVerse && endVerse === s.endVerse) return s
  return { ...s, chapter, startVerse, endVerse }
}

export function renderBuilder(s: RefBuilderState): string {
  if (s.book === null) return s.bookQuery
  let out = s.book
  if (s.chapter === null) return out
  out += ` ${s.chapter}`
  if (s.stage === 'chapter') return out
  out += ':'
  if (s.startVerse !== null) out += s.startVerse
  if (s.stage !== 'endVerse') return out
  out += '-'
  if (s.endVerse !== null) out += s.endVerse
  return out
}

export function toParsedRef(s: RefBuilderState): ParsedRef | null {
  if (s.book === null || s.chapter === null) return null
  const from0 = s.startVerse ?? 1
  const end0 = s.endVerse ?? from0
  return { book: s.book, ch: s.chapter, from: Math.min(from0, end0), to: Math.max(from0, end0) }
}

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
  // `renderBuilder`'s transparent ghost spacer is `s.bookQuery`, and it only renders that
  // while `s.book === null` — so the guard here must match, or a (currently unreachable)
  // state with both a resolved book AND a leftover bookQuery would show a ghost aligned
  // under the wrong spacer (see Finding 4).
  if (s.stage !== 'book' || s.book !== null) return null
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

export function fromParsedRef(p: ParsedRef): RefBuilderState {
  const isRange = p.to > p.from
  return {
    stage: isRange ? 'endVerse' : 'verse',
    bookQuery: '',
    book: p.book,
    chapter: p.ch,
    startVerse: p.from,
    endVerse: isRange ? p.to : null,
    prior: null
  }
}

type Applied = { state: RefBuilderState; preventDefault: boolean }
const isDigit = (k: string): boolean => k >= '0' && k <= '9'
const isAlnum = (k: string): boolean => /^[a-z0-9]$/i.test(k)

export function applyKey(
  s: RefBuilderState,
  key: string,
  _shift: boolean,
  extent: BookExtent
): Applied {
  // Delete alongside Backspace (#18): the builder has no caret, so forward-delete is the
  // same "drop the trailing token" — better than the browser deleting text the controlled
  // input then snaps back.
  if (key === 'Backspace' || key === 'Delete') return { state: backspace(s), preventDefault: true }
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

/** Commit a resolved book and move to the chapter stage. Shared by space and Tab so the
 * two accept keys cannot drift apart.
 *
 * `bookQuery` is kept (not cleared): it is what the operator typed, and if the next key is
 * a letter the entry becomes a text search of THAT ("acts l"), not of the committed name
 * ("Acts l"). Nothing reads it while `book` is set — bookCompletion guards on
 * `book === null` and renderBuilder prefers `book`. */
function commitBook(s: RefBuilderState, book: string): RefBuilderState {
  return { ...s, stage: 'chapter', book, chapter: null }
}

function printable(s: RefBuilderState, key: string, extent: BookExtent): RefBuilderState {
  switch (s.stage) {
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
    case 'chapter': {
      if (s.chapter === null && /^[a-z]$/i.test(key)) {
        // A letter right after the book committed: "john t" / "acts l" — words, not a
        // chapter. Search what was TYPED plus this key; the committed state is `prior`.
        return enterSearch(s, `${s.bookQuery || s.book} ${key}`)
      }
      if (isDigit(key)) {
        const c = clampChapter((s.chapter ?? 0) * 10 + Number(key), extent)
        return { ...s, chapter: c || null }
      }
      if ((key === ' ' || key === ':') && s.chapter !== null) return { ...s, stage: 'verse' }
      return s
    }
    case 'verse': {
      if (isDigit(key) && s.chapter !== null) {
        const v = clampVerse((s.startVerse ?? 0) * 10 + Number(key), s.chapter, extent)
        return { ...s, startVerse: v || null }
      }
      if ((key === ' ' || key === '-') && s.startVerse !== null) return { ...s, stage: 'endVerse' }
      return s
    }
    case 'endVerse': {
      if (isDigit(key) && s.chapter !== null) {
        const v = clampVerse((s.endVerse ?? 0) * 10 + Number(key), s.chapter, extent)
        return { ...s, endVerse: v || null }
      }
      return s
    }
    case 'search':
      return { ...s, bookQuery: s.bookQuery + key }
  }
}

function backspace(s: RefBuilderState): RefBuilderState {
  switch (s.stage) {
    case 'search': {
      const q = s.bookQuery.slice(0, -1)
      const prior = s.prior ?? initialBuilder()
      // The query shrinks back to where the search began → the pre-search state returns.
      // `entryLen` is what the entry showed from `prior` plus the committed-book space when
      // the search was entered from the chapter stage (`"acts "` → length 5).
      const entryLen =
        prior.stage === 'chapter'
          ? (prior.bookQuery || prior.book || '').length + 1
          : prior.bookQuery.length
      if (q.length <= entryLen) return prior
      return { ...s, bookQuery: q }
    }
    case 'book':
      return s.bookQuery ? { ...s, bookQuery: s.bookQuery.slice(0, -1) } : s
    case 'chapter':
      if (s.chapter === null)
        return { ...s, stage: 'book', book: null, bookQuery: s.book ?? '', chapter: null }
      return { ...s, chapter: Math.floor(s.chapter / 10) || null }
    case 'verse':
      if (s.startVerse === null) return { ...s, stage: 'chapter' }
      return { ...s, startVerse: Math.floor(s.startVerse / 10) || null }
    case 'endVerse':
      if (s.endVerse === null) return { ...s, stage: 'verse' }
      return { ...s, endVerse: Math.floor(s.endVerse / 10) || null }
  }
}

export function setStart(s: RefBuilderState, v: number, extent: BookExtent): RefBuilderState {
  if (s.chapter === null) return s
  const start = clampVerse(v, s.chapter, extent)
  return { ...s, stage: 'verse', startVerse: start || null, endVerse: null }
}

export function setEnd(s: RefBuilderState, v: number, extent: BookExtent): RefBuilderState {
  if (s.chapter === null || s.startVerse === null) return s
  const e = clampVerse(v, s.chapter, extent)
  if (!e) return s
  return {
    ...s,
    stage: 'endVerse',
    startVerse: Math.min(s.startVerse, e),
    endVerse: Math.max(s.startVerse, e)
  }
}
