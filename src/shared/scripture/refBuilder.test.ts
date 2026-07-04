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
  type RefBuilderState
} from './refBuilder'

const james: BookExtent = { chapters: 5, verseCounts: [27, 26, 18, 17, 20] }

test('initialBuilder starts empty at the book stage', () => {
  expect(initialBuilder()).toEqual({
    stage: 'book', bookQuery: '', book: null, chapter: null, startVerse: null, endVerse: null
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
  expect(at({ stage: 'endVerse', book: 'James', chapter: 1, startVerse: 1, endVerse: null })).toBe('James 1:1-')
  expect(at({ stage: 'endVerse', book: 'James', chapter: 1, startVerse: 1, endVerse: 10 })).toBe('James 1:1-10')
})

test('toParsedRef requires book + chapter', () => {
  expect(toParsedRef({ ...initialBuilder(), stage: 'book', bookQuery: 'jam' })).toBeNull()
  expect(toParsedRef({ ...initialBuilder(), stage: 'chapter', book: 'James', chapter: null })).toBeNull()
})

test('toParsedRef: chapter with no verse commits from=to=1', () => {
  expect(toParsedRef({ ...initialBuilder(), stage: 'chapter', book: 'James', chapter: 3 }))
    .toEqual({ book: 'James', ch: 3, from: 1, to: 1 })
})

test('toParsedRef: single verse and range', () => {
  expect(toParsedRef({ ...initialBuilder(), stage: 'verse', book: 'James', chapter: 1, startVerse: 5 }))
    .toEqual({ book: 'James', ch: 1, from: 5, to: 5 })
  expect(toParsedRef({ ...initialBuilder(), stage: 'endVerse', book: 'James', chapter: 1, startVerse: 1, endVerse: 10 }))
    .toEqual({ book: 'James', ch: 1, from: 1, to: 10 })
})

test('toParsedRef normalizes an inverted range', () => {
  expect(toParsedRef({ ...initialBuilder(), stage: 'endVerse', book: 'James', chapter: 1, startVerse: 8, endVerse: 3 }))
    .toEqual({ book: 'James', ch: 1, from: 3, to: 8 })
})

test('fromParsedRef loads single and range refs', () => {
  expect(fromParsedRef({ book: 'John', ch: 3, from: 16, to: 16 }))
    .toEqual({ stage: 'verse', bookQuery: '', book: 'John', chapter: 3, startVerse: 16, endVerse: null })
  expect(fromParsedRef({ book: 'Genesis', ch: 1, from: 1, to: 10 }))
    .toEqual({ stage: 'endVerse', bookQuery: '', book: 'Genesis', chapter: 1, startVerse: 1, endVerse: 10 })
})

test('round-trip toParsedRef(fromParsedRef(p)) === p', () => {
  for (const p of [
    { book: 'John', ch: 3, from: 16, to: 16 },
    { book: 'Genesis', ch: 1, from: 1, to: 10 }
  ]) expect(toParsedRef(fromParsedRef(p))).toEqual(p)
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
  const st = type(applyKey(type(initialBuilder(), 'james', EMPTY_EXTENT), ' ', false, EMPTY_EXTENT).state, '3', EMPTY_EXTENT)
  expect(st.chapter).toBeNull() // clampChapter(3, EMPTY) === 0 -> null
})
