import { expect, test } from 'vitest'
import type { BookExtent } from '../types'
import {
  EMPTY_EXTENT,
  initialBuilder,
  clampChapter,
  clampVerse,
  renderBuilder,
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
