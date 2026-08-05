import { expect, test } from 'vitest'
import type { BookExtent } from '../types'
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

const james: BookExtent = { chapters: 5, verseCounts: [27, 26, 18, 17, 20] }

test('initialBuilder starts empty at the book stage', () => {
  expect(initialBuilder()).toEqual({
    stage: 'book',
    bookQuery: '',
    book: null,
    chapter: null,
    startVerse: null,
    endVerse: null
  })
})

test('clampChapter clamps to [1, chapters]; 0 when no chapters', () => {
  expect(clampChapter(3, james)).toBe(3)
  expect(clampChapter(9, james)).toBe(5)
  expect(clampChapter(0, james)).toBe(1)
  expect(clampChapter(3, EMPTY_EXTENT)).toBe(0)
})

test('clampVerse clamps to [1, verseCount(chapter)]; 0 when unknown', () => {
  expect(clampVerse(10, 1, james)).toBe(10)
  expect(clampVerse(99, 1, james)).toBe(27)
  expect(clampVerse(5, 2, james)).toBe(5)
  expect(clampVerse(0, 1, james)).toBe(1)
  expect(clampVerse(5, 9, james)).toBe(0) // chapter out of range
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
    endVerse: null
  })
  expect(fromParsedRef({ book: 'Genesis', ch: 1, from: 1, to: 10 })).toEqual({
    stage: 'endVerse',
    bookQuery: '',
    book: 'Genesis',
    chapter: 1,
    startVerse: 1,
    endVerse: 10
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
function type(s: RefBuilderState, keys: string, extent: BookExtent): RefBuilderState {
  let st = s
  for (const k of keys) st = applyKey(st, k, false, extent).state
  return st
}

test('space swallowed at every stage', () => {
  expect(applyKey(initialBuilder(), ' ', false, james).preventDefault).toBe(true)
})

test('book: prefix completion advances (jame -> James)', () => {
  const st = applyKey(type(initialBuilder(), 'jame', james), ' ', false, james).state
  expect(st).toMatchObject({ stage: 'chapter', book: 'James', bookQuery: '' })
})

test('book: unresolved space stays in book', () => {
  const st = applyKey(type(initialBuilder(), 'zz', james), ' ', false, james).state
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

test('no extent: cannot advance past chapter clamp', () => {
  const st = type(
    applyKey(type(initialBuilder(), 'james', EMPTY_EXTENT), ' ', false, EMPTY_EXTENT).state,
    '3',
    EMPTY_EXTENT
  )
  expect(st.chapter).toBeNull() // clampChapter(3, EMPTY) === 0 -> null
})

const base: RefBuilderState = {
  stage: 'verse',
  bookQuery: '',
  book: 'James',
  chapter: 1,
  startVerse: 3,
  endVerse: null
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
