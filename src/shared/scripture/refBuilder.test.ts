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
