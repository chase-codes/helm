import { expect, test } from 'vitest'
import { railSelect, addTarget, type Cursor } from './selection'
import { initialBuilder, type RefBuilderState } from './refBuilder'
import type { BookExtent } from '../types'

const GENESIS: BookExtent = { chapters: 50, verseCounts: Array(50).fill(31) }
const cursor: Cursor = { book: 'Genesis', ch: 1, v: 5 }
const here = { book: 'Genesis', ch: 1 }

const built = (over: Partial<RefBuilderState>): RefBuilderState => ({
  ...initialBuilder(),
  stage: 'verse',
  book: 'Genesis',
  chapter: 1,
  ...over
})

test('plain tap moves the cursor to the tapped verse', () => {
  const r = railSelect(initialBuilder(), cursor, here, 9, false, GENESIS)
  expect(r.cursor).toEqual({ book: 'Genesis', ch: 1, v: 9 })
})

test('plain tap clears a pending builder range', () => {
  const pending = built({ startVerse: 2, endVerse: 4, stage: 'endVerse' })
  const r = railSelect(pending, cursor, here, 9, false, GENESIS)
  expect(r.builder).toEqual(initialBuilder())
})

test('plain tap in a previewed chapter moves the cursor across chapters', () => {
  const typed = built({ book: 'Romans', chapter: 8, startVerse: null })
  const r = railSelect(typed, cursor, { book: 'Romans', ch: 8 }, 28, false, GENESIS)
  expect(r.cursor).toEqual({ book: 'Romans', ch: 8, v: 28 })
  expect(r.builder).toEqual(initialBuilder())
})

test('shift-tap anchors the range at the cursor, not at the builder start', () => {
  const stale = built({ startVerse: 20, endVerse: null })
  const r = railSelect(stale, cursor, here, 9, true, GENESIS)
  expect(r.builder.book).toBe('Genesis')
  expect(r.builder.chapter).toBe(1)
  expect(r.builder.startVerse).toBe(5)
  expect(r.builder.endVerse).toBe(9)
})

test('shift-tap does not move the cursor', () => {
  const r = railSelect(initialBuilder(), cursor, here, 9, true, GENESIS)
  expect(r.cursor).toEqual(cursor)
})

test('shift-tap backwards still yields an ordered range', () => {
  const r = railSelect(initialBuilder(), cursor, here, 2, true, GENESIS)
  expect(r.builder.startVerse).toBe(2)
  expect(r.builder.endVerse).toBe(5)
})

test('shift-tap in a chapter the cursor is not in starts a fresh anchor there', () => {
  const typed = built({ book: 'Romans', chapter: 8, startVerse: null })
  const r = railSelect(typed, cursor, { book: 'Romans', ch: 8 }, 28, true, GENESIS)
  expect(r.cursor).toEqual(cursor)
  expect(r.builder.book).toBe('Romans')
  expect(r.builder.chapter).toBe(8)
  expect(r.builder.startVerse).toBe(28)
  expect(r.builder.endVerse).toBeNull()
})

test('addTarget falls back to the cursor when the builder is empty', () => {
  expect(addTarget(initialBuilder(), cursor)).toEqual({ book: 'Genesis', ch: 1, from: 5, to: 5 })
})

test('addTarget prefers a typed reference over the cursor', () => {
  const typed = built({ book: 'Romans', chapter: 8, startVerse: 28 })
  expect(addTarget(typed, cursor)).toEqual({ book: 'Romans', ch: 8, from: 28, to: 28 })
})

test('addTarget returns a shift-tapped range', () => {
  const range = built({ startVerse: 5, endVerse: 9, stage: 'endVerse' })
  expect(addTarget(range, cursor)).toEqual({ book: 'Genesis', ch: 1, from: 5, to: 9 })
})
