import { expect, test } from 'vitest'
import { railSelect, addTarget, type Cursor } from './selection'
import { initialBuilder, type RefBuilderState } from './refBuilder'

const cursor: Cursor = { book: 'Genesis', ch: 1, v: 5 }
const here = { book: 'Genesis', ch: 1 }

const built = (over: Partial<RefBuilderState>): RefBuilderState => ({
  ...initialBuilder(),
  stage: 'verse',
  book: 'Genesis',
  chapter: 1,
  ...over
})

const empty = initialBuilder()

test('plain tap moves the cursor to the tapped verse', () => {
  const r = railSelect(empty, cursor, here, 9, false)
  expect(r.cursor).toEqual({ book: 'Genesis', ch: 1, v: 9 })
})

test('plain tap clears a pending builder range', () => {
  const pending = built({ startVerse: 2, endVerse: 4, stage: 'endVerse' })
  const r = railSelect(pending, cursor, here, 9, false)
  expect(r.builder).toEqual(initialBuilder())
})

test('plain tap in a previewed chapter moves the cursor across chapters', () => {
  const r = railSelect(empty, cursor, { book: 'Romans', ch: 8 }, 28, false)
  expect(r.cursor).toEqual({ book: 'Romans', ch: 8, v: 28 })
  expect(r.builder).toEqual(initialBuilder())
})

test('shift-tap anchors the range at the cursor', () => {
  const r = railSelect(empty, cursor, here, 9, true)
  expect(r.builder.book).toBe('Genesis')
  expect(r.builder.chapter).toBe(1)
  expect(r.builder.startVerse).toBe(5)
  expect(r.builder.endVerse).toBe(9)
})

test('shift-tap does not move the cursor', () => {
  const r = railSelect(empty, cursor, here, 9, true)
  expect(r.cursor).toEqual(cursor)
})

test('shift-tap backwards still yields an ordered range', () => {
  const r = railSelect(empty, cursor, here, 2, true)
  expect(r.builder.startVerse).toBe(2)
  expect(r.builder.endVerse).toBe(5)
})

test('shift-tap in a chapter the cursor is not in starts a fresh anchor there', () => {
  const r = railSelect(empty, cursor, { book: 'Romans', ch: 8 }, 28, true)
  expect(r.cursor).toEqual(cursor)
  expect(r.builder.book).toBe('Romans')
  expect(r.builder.chapter).toBe(8)
  expect(r.builder.startVerse).toBe(28)
  expect(r.builder.endVerse).toBeNull()
})

// The rail highlights `builder.startVerse` (SermonMode's `selectedRange`), so anchoring a
// shift-tap anywhere else than a typed start verse would contradict what the operator sees.
// Cursor at Genesis 1:1, operator types Genesis 1:5, shift-taps 9 -> Genesis 1:5-9, not 1-9.
test('shift-tap anchors at a start verse typed for the previewed chapter', () => {
  const atOne: Cursor = { book: 'Genesis', ch: 1, v: 1 }
  const typed = built({ startVerse: 5 })
  const r = railSelect(typed, atOne, here, 9, true)
  expect(r.cursor).toEqual(atOne)
  expect(r.builder.book).toBe('Genesis')
  expect(r.builder.chapter).toBe(1)
  expect(r.builder.startVerse).toBe(5)
  expect(r.builder.endVerse).toBe(9)
})

// Cursor in Genesis 1, operator types Romans 8:28 (the rail now previews Romans 8), then
// shift-taps 3. The typed 28 is the anchor, and the range comes out ordered: Romans 8:3-28.
test('shift-tap in a typed cross-chapter reference keeps its start verse', () => {
  const typed = built({ book: 'Romans', chapter: 8, startVerse: 28 })
  const r = railSelect(typed, cursor, { book: 'Romans', ch: 8 }, 3, true)
  expect(r.cursor).toEqual(cursor)
  expect(r.builder.book).toBe('Romans')
  expect(r.builder.chapter).toBe(8)
  expect(r.builder.startVerse).toBe(3)
  expect(r.builder.endVerse).toBe(28)
})

// The guard is book AND chapter: a start verse typed for a DIFFERENT chapter than the one
// on the rail is not an anchor, and the tap falls back to the cursor.
test('a start verse typed for another chapter does not anchor the tap', () => {
  const typed = built({ book: 'Romans', chapter: 8, startVerse: 28 })
  const r = railSelect(typed, cursor, here, 9, true)
  expect(r.builder.book).toBe('Genesis')
  expect(r.builder.chapter).toBe(1)
  expect(r.builder.startVerse).toBe(5)
  expect(r.builder.endVerse).toBe(9)
})

// A builder that has resolved the previewed book/chapter but names no verse yet
// ("Genesis 1:") falls through to the cursor, exactly as an empty builder does.
test('a builder with no start verse leaves the cursor as the anchor', () => {
  const r = railSelect(built({ startVerse: null }), cursor, here, 9, true)
  expect(r.builder.startVerse).toBe(5)
  expect(r.builder.endVerse).toBe(9)
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

// railSelect takes no BookExtent at all any more (clamping was removed in afa4a1d after an
// unloaded extent silently dropped rail taps). This pins that: a range forms from the raw
// tapped verse, with nothing to load first.
test('shift-tap forms the range with no book extent in play', () => {
  const r = railSelect(empty, cursor, here, 9, true)
  expect(r.builder.startVerse).toBe(5)
  expect(r.builder.endVerse).toBe(9)
})
