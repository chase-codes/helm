import { expect, test } from 'vitest'
import { matchBook, parseRef, formatRef } from './refs'

test('exact aliases win', () => {
  expect(matchBook('jn')).toBe('John')
  expect(matchBook('ps')).toBe('Psalm')
  expect(matchBook('1 jn')).toBe('1 John')
  expect(matchBook('1jn')).toBe('1 John')
})
test('prefix fallback in canon order', () => {
  expect(matchBook('gene')).toBe('Genesis')
  expect(matchBook('song of sol')).toBe('Song of Solomon')
})
test('unknown returns null', () => {
  expect(matchBook('zzz')).toBeNull()
})
test('parseRef full forms', () => {
  expect(parseRef('john 3:16')).toEqual({ book: 'John', ch: 3, from: 16, to: 16 })
  expect(parseRef('gen 1:1-10')).toEqual({ book: 'Genesis', ch: 1, from: 1, to: 10 })
  expect(parseRef('gen 1:1–10')).toEqual({ book: 'Genesis', ch: 1, from: 1, to: 10 }) // en dash
  expect(parseRef('1 sam 3:10')).toEqual({ book: '1 Samuel', ch: 3, from: 10, to: 10 })
  expect(parseRef('Psalm 23')).toEqual({ book: 'Psalm', ch: 23, from: 1, to: 1 })
  expect(parseRef('song of solomon 2:1')).toEqual({
    book: 'Song of Solomon',
    ch: 2,
    from: 1,
    to: 1
  })
})
test('parseRef rejects garbage', () => {
  expect(parseRef('')).toBeNull()
  expect(parseRef('3:16')).toBeNull()
  expect(parseRef('john')).toBeNull()
})
test('formatRef', () => {
  expect(formatRef({ book: 'John', ch: 3, from: 16, to: 16 })).toBe('John 3:16')
  expect(formatRef({ book: 'Genesis', ch: 1, from: 1, to: 10 })).toBe('Genesis 1:1–10')
})
