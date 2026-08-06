import { expect, test } from 'vitest'
import { matchBook, matchBookExact, parseRef, formatRef } from './refs'
import { BOOKS, RANKED_BOOKS } from './books'

test('exact aliases win', () => {
  expect(matchBook('jn')).toBe('John')
  expect(matchBook('ps')).toBe('Psalm')
  expect(matchBook('1 jn')).toBe('1 John')
  expect(matchBook('1jn')).toBe('1 John')
})
test('prefix fallback resolves unambiguous prefixes', () => {
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

test('matchBookExact matches exact aliases only, no prefix', () => {
  expect(matchBookExact('jn')).toBe('John')
  expect(matchBookExact('1john')).toBe('1 John')
  expect(matchBookExact('1 john')).toBe('1 John')
  expect(matchBookExact('2 cor')).toBe('2 Corinthians')
  // prefix-only inputs that matchBook would resolve must NOT resolve here
  expect(matchBookExact('1')).toBeNull()
  expect(matchBookExact('gene')).toBeNull()
  expect(matchBookExact('zzz')).toBeNull()
})

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
  // A true two-unranked tie: both prefix-match "ze", neither is in RANKED_BOOKS, so
  // canonical order decides — Zephaniah (35) before Zechariah (37).
  expect(matchBook('ze')).toBe('Zephaniah')
})

test('every RANKED_BOOKS entry names a real book', () => {
  const names = new Set(BOOKS.map((b) => b.name))
  for (const n of RANKED_BOOKS) expect(names.has(n), `"${n}" is not a book name`).toBe(true)
  expect(new Set(RANKED_BOOKS).size).toBe(RANKED_BOOKS.length) // no duplicates
})
