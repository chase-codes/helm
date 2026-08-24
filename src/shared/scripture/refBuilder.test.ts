import { expect, test } from 'vitest'
import type { BookExtent } from '../types'
import {
  EMPTY_EXTENT,
  initialBuilder,
  clampChapter,
  clampVerse,
  reclamp,
  renderBuilder,
  toParsedRef,
  fromParsedRef,
  applyKey,
  setStart,
  setEnd,
  bookCompletion,
  refGhost,
  isSearch,
  searchQuery,
  type RefBuilderState,
  type RefGhost
} from './refBuilder'

const james: BookExtent = { chapters: 5, verseCounts: [27, 26, 18, 17, 20] }

test('initialBuilder starts empty at the book stage', () => {
  expect(initialBuilder()).toEqual({
    stage: 'book',
    bookQuery: '',
    book: null,
    chapter: null,
    startVerse: null,
    endVerse: null,
    prior: null
  })
})

test('clampChapter clamps to [1, chapters]; passes through when the extent is unknown', () => {
  expect(clampChapter(3, james)).toBe(3)
  expect(clampChapter(9, james)).toBe(5)
  expect(clampChapter(0, james)).toBe(1)
  expect(clampChapter(3, EMPTY_EXTENT)).toBe(3) // #17: not yet fetched ≠ zero chapters
  expect(clampChapter(0, EMPTY_EXTENT)).toBe(1)
})

test('clampVerse clamps to [1, verseCount(chapter)]; passes through when unknown', () => {
  expect(clampVerse(10, 1, james)).toBe(10)
  expect(clampVerse(99, 1, james)).toBe(27)
  expect(clampVerse(5, 2, james)).toBe(5)
  expect(clampVerse(0, 1, james)).toBe(1)
  expect(clampVerse(5, 9, james)).toBe(5) // chapter out of range: no count to clamp to
  expect(clampVerse(5, 1, EMPTY_EXTENT)).toBe(5)
})

test('reclamp: digits typed before the extent landed clamp once it does', () => {
  const st = type(
    applyKey(type(initialBuilder(), 'james', EMPTY_EXTENT), ' ', false, EMPTY_EXTENT).state,
    '12:99',
    EMPTY_EXTENT
  )
  expect(renderBuilder(st)).toBe('James 12:99')
  const clamped = reclamp(st, james)
  expect(clamped.chapter).toBe(5)
  expect(clamped.startVerse).toBe(20) // James 5 has 20 verses
  expect(reclamp(clamped, james)).toBe(clamped) // identity when nothing changes
  expect(reclamp(st, EMPTY_EXTENT)).toBe(st) // unknown extent: nothing to clamp against
})

test('Delete drops the trailing token like Backspace (#18)', () => {
  const st = type(applyKey(type(initialBuilder(), 'james', james), ' ', false, james).state, '3', james)
  const r = applyKey(st, 'Delete', false, james)
  expect(r.preventDefault).toBe(true)
  expect(r.state.chapter).toBeNull()
})

test('renderBuilder renders each stage', () => {
  const at = (s: Partial<RefBuilderState>): string => renderBuilder({ ...initialBuilder(), ...s })
  expect(at({ stage: 'book', bookQuery: 'Jame' })).toBe('Jame')
  expect(at({ stage: 'book', bookQuery: '' })).toBe('')
  expect(at({ stage: 'chapter', book: 'James', chapter: null })).toBe('James')
  expect(at({ stage: 'chapter', book: 'James', chapter: 1 })).toBe('James 1')
  expect(at({ stage: 'verse', book: 'James', chapter: 1, startVerse: null })).toBe('James 1:')
  expect(at({ stage: 'verse', book: 'James', chapter: 1, startVerse: 1 })).toBe('James 1:1')
  expect(at({ stage: 'endVerse', book: 'James', chapter: 1, startVerse: 1, endVerse: null })).toBe(
    'James 1:1-'
  )
  expect(at({ stage: 'endVerse', book: 'James', chapter: 1, startVerse: 1, endVerse: 10 })).toBe(
    'James 1:1-10'
  )
})

test('toParsedRef requires book + chapter', () => {
  expect(toParsedRef({ ...initialBuilder(), stage: 'book', bookQuery: 'jam' })).toBeNull()
  expect(
    toParsedRef({ ...initialBuilder(), stage: 'chapter', book: 'James', chapter: null })
  ).toBeNull()
})

test('toParsedRef: chapter with no verse commits from=to=1', () => {
  expect(toParsedRef({ ...initialBuilder(), stage: 'chapter', book: 'James', chapter: 3 })).toEqual(
    { book: 'James', ch: 3, from: 1, to: 1 }
  )
})

test('toParsedRef: single verse and range', () => {
  expect(
    toParsedRef({ ...initialBuilder(), stage: 'verse', book: 'James', chapter: 1, startVerse: 5 })
  ).toEqual({ book: 'James', ch: 1, from: 5, to: 5 })
  expect(
    toParsedRef({
      ...initialBuilder(),
      stage: 'endVerse',
      book: 'James',
      chapter: 1,
      startVerse: 1,
      endVerse: 10
    })
  ).toEqual({ book: 'James', ch: 1, from: 1, to: 10 })
})

test('toParsedRef normalizes an inverted range', () => {
  expect(
    toParsedRef({
      ...initialBuilder(),
      stage: 'endVerse',
      book: 'James',
      chapter: 1,
      startVerse: 8,
      endVerse: 3
    })
  ).toEqual({ book: 'James', ch: 1, from: 3, to: 8 })
})

test('fromParsedRef loads single and range refs', () => {
  expect(fromParsedRef({ book: 'John', ch: 3, from: 16, to: 16 })).toEqual({
    stage: 'verse',
    bookQuery: '',
    book: 'John',
    chapter: 3,
    startVerse: 16,
    endVerse: null,
    prior: null
  })
  expect(fromParsedRef({ book: 'Genesis', ch: 1, from: 1, to: 10 })).toEqual({
    stage: 'endVerse',
    bookQuery: '',
    book: 'Genesis',
    chapter: 1,
    startVerse: 1,
    endVerse: 10,
    prior: null
  })
})

test('round-trip toParsedRef(fromParsedRef(p)) === p', () => {
  for (const p of [
    { book: 'John', ch: 3, from: 16, to: 16 },
    { book: 'Genesis', ch: 1, from: 1, to: 10 }
  ])
    expect(toParsedRef(fromParsedRef(p))).toEqual(p)
})

// Helper: feed a string of single-char keys through applyKey.
function type(s: RefBuilderState, keys: string, extent: BookExtent = james): RefBuilderState {
  let st = s
  for (const k of keys) st = applyKey(st, k, false, extent).state
  return st
}

test('space swallowed at every stage', () => {
  expect(applyKey(initialBuilder(), ' ', false, james).preventDefault).toBe(true)
})

test('book: prefix completion advances (jame -> James)', () => {
  const st = applyKey(type(initialBuilder(), 'jame', james), ' ', false, james).state
  expect(st).toMatchObject({ stage: 'chapter', book: 'James', bookQuery: 'jame' })
})

test('book: unresolved space stays in book', () => {
  // Digits never trigger a search (a separate rule keeps "1 " on the numbered-book path),
  // so an unmatched digit query is the case that still just sits in the book stage.
  const st = applyKey(type(initialBuilder(), '99', james), ' ', false, james).state
  expect(st.stage).toBe('book')
  expect(st.book).toBeNull()
})

test('book: numbered book via exact alias advances (1john -> 1 John)', () => {
  const st = applyKey(type(initialBuilder(), '1john', james), ' ', false, james).state
  expect(st).toMatchObject({ stage: 'chapter', book: '1 John' })
})

test('book: bare "1" + space does NOT jump to 1 Samuel; inserts a literal space', () => {
  const st = applyKey(type(initialBuilder(), '1', james), ' ', false, james).state
  expect(st.stage).toBe('book')
  expect(st.book).toBeNull()
  expect(st.bookQuery).toBe('1 ')
})

test('chapter digits clamp to max', () => {
  let st = applyKey(type(initialBuilder(), 'jame', james), ' ', false, james).state // -> chapter
  st = type(st, '9', james)
  expect(st.chapter).toBe(5) // clamped from 9 to 5
})

test('full typed range James 1:1-10 with clamping', () => {
  let st = applyKey(type(initialBuilder(), 'james', james), ' ', false, james).state
  st = applyKey(type(st, '1', james), ' ', false, james).state // chapter 1 -> verse
  st = applyKey(type(st, '1', james), ' ', false, james).state // start 1 -> endVerse
  st = type(st, '10', james)
  expect(renderBuilder(st)).toBe('James 1:1-10')
  expect(toParsedRef(st)).toEqual({ book: 'James', ch: 1, from: 1, to: 10 })
})

test('colon and hyphen advance like space', () => {
  let st = applyKey(type(initialBuilder(), 'james', james), ' ', false, james).state
  st = type(st, '1', james)
  st = applyKey(st, ':', false, james).state // -> verse
  expect(st.stage).toBe('verse')
  st = type(st, '2', james)
  st = applyKey(st, '-', false, james).state // -> endVerse
  expect(st.stage).toBe('endVerse')
})

test('verse clamps to chapter verse count', () => {
  let st = applyKey(type(initialBuilder(), 'james', james), ' ', false, james).state
  st = applyKey(type(st, '1', james), ' ', false, james).state // chapter 1 -> verse
  st = type(st, '99', james)
  expect(st.startVerse).toBe(27) // James 1 has 27 verses
})

test('typing an inverted end renders inverted but commits normalized', () => {
  let st = applyKey(type(initialBuilder(), 'james', james), ' ', false, james).state
  st = applyKey(type(st, '1', james), ' ', false, james).state // chapter 1 -> verse
  st = applyKey(type(st, '8', james), ' ', false, james).state // start 8 -> endVerse
  st = type(st, '3', james)
  expect(renderBuilder(st)).toBe('James 1:8-3')
  expect(toParsedRef(st)).toEqual({ book: 'James', ch: 1, from: 3, to: 8 })
})

test('backspace deletes within the verse numeric token then steps back to chapter', () => {
  let st: RefBuilderState = {
    ...initialBuilder(),
    stage: 'verse',
    book: 'James',
    chapter: 1,
    startVerse: 12
  }
  st = applyKey(st, 'Backspace', false, james).state // 12 -> 1 (Math.floor(12/10))
  expect(st.startVerse).toBe(1)
  expect(st.stage).toBe('verse')
  st = applyKey(st, 'Backspace', false, james).state // 1 -> null, stays in verse stage
  expect(st.startVerse).toBeNull()
  expect(st.stage).toBe('verse')
  st = applyKey(st, 'Backspace', false, james).state // empty startVerse -> step back to chapter
  expect(st.stage).toBe('chapter')
})

test('backspace deletes within the endVerse numeric token then steps back to verse', () => {
  let st: RefBuilderState = {
    ...initialBuilder(),
    stage: 'endVerse',
    book: 'James',
    chapter: 1,
    startVerse: 3,
    endVerse: 8
  }
  st = applyKey(st, 'Backspace', false, james).state // 8 -> null (single digit)
  expect(st.endVerse).toBeNull()
  expect(st.stage).toBe('endVerse')
  st = applyKey(st, 'Backspace', false, james).state // empty endVerse -> step back to verse
  expect(st.stage).toBe('verse')
})

test('backspace deletes within a numeric token then steps back', () => {
  let st = applyKey(type(initialBuilder(), 'james', james), ' ', false, james).state
  st = type(st, '12', james) // chapter clamps: 1 -> 12 -> clamp 5
  expect(st.chapter).toBe(5)
  st = applyKey(st, 'Backspace', false, james).state // 5 -> null? Math.floor(5/10)=0 -> null
  expect(st.chapter).toBeNull()
  st = applyKey(st, 'Backspace', false, james).state // empty chapter -> step back to book
  expect(st.stage).toBe('book')
  expect(st.book).toBeNull()
  expect(st.bookQuery).toBe('James')
})

test('no extent: digits are kept, not swallowed (#17)', () => {
  const st = type(
    applyKey(type(initialBuilder(), 'james', EMPTY_EXTENT), ' ', false, EMPTY_EXTENT).state,
    '3',
    EMPTY_EXTENT
  )
  expect(st.chapter).toBe(3)
})

const base: RefBuilderState = {
  stage: 'verse',
  bookQuery: '',
  book: 'James',
  chapter: 1,
  startVerse: 3,
  endVerse: null,
  prior: null
}

test('setStart sets a fresh single-verse selection', () => {
  expect(setStart(base, 7, james)).toMatchObject({ stage: 'verse', startVerse: 7, endVerse: null })
})

test('setStart clamps to chapter verse count', () => {
  expect(setStart(base, 99, james).startVerse).toBe(27)
})

test('setEnd builds an ascending range', () => {
  expect(setEnd({ ...base, startVerse: 3 }, 9, james)).toMatchObject({
    stage: 'endVerse',
    startVerse: 3,
    endVerse: 9
  })
})

test('setEnd normalizes when the end is below the start', () => {
  expect(setEnd({ ...base, startVerse: 8 }, 3, james)).toMatchObject({
    startVerse: 3,
    endVerse: 8
  })
})

test('setStart/setEnd no-op without a chapter/start', () => {
  const noChapter: RefBuilderState = { ...initialBuilder(), book: 'James' }
  expect(setStart(noChapter, 5, james)).toBe(noChapter)
  const noStart: RefBuilderState = { ...base, startVerse: null }
  expect(setEnd(noStart, 5, james)).toBe(noStart)
})

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

test('Tab commits the book when a ghost is showing', () => {
  const r = applyKey(atBook('ma'), 'Tab', false, EMPTY_EXTENT)
  expect(r.state).toMatchObject({ stage: 'chapter', book: 'Matthew', bookQuery: 'ma' })
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

test('Shift+Tab still commits the ghost — deliberate, not a bug: applyKey ignores _shift on', () => {
  // the Tab branch, so Shift+Tab does not move focus backwards while a ghost is showing.
  // This pins that choice so a future reader doesn't "fix" it into an unhandled shift.
  const r = applyKey(atBook('ma'), 'Tab', true, EMPTY_EXTENT)
  expect(r.state).toMatchObject({ stage: 'chapter', book: 'Matthew', bookQuery: 'ma' })
  expect(r.preventDefault).toBe(true)
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

// --- Search stage -----------------------------------------------------------------------

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
  // "acts " commits Acts (prefix); the next letter means the operator is typing words, so
  // the search is for "acts l", not "Acts l".
  const committed = type(initialBuilder(), 'acts ')
  expect(committed).toMatchObject({ stage: 'chapter', book: 'Acts', chapter: null })
  const st = applyKey(committed, 'l', false, james).state
  expect(isSearch(st)).toBe(true)
  expect(searchQuery(st)).toBe('acts l')
  // and Backspace brings the committed book back
  const back = applyKey(st, 'Backspace', false, james).state
  expect(back).toMatchObject({ stage: 'chapter', book: 'Acts', chapter: null })
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
