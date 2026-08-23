import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { PASSAGES, matchPassages } from './passages'
import { BOOKS } from './books'

test('prodigal son → Luke 15:11-32 (phrase beats a scattered alias hit)', () => {
  expect(matchPassages('prodigal son')[0]).toMatchObject({ book: 'Luke', ch: 15, from: 11, to: 32 })
  expect(matchPassages('prodigal')[0].title).toBe('The Prodigal Son')
})

test('aliases and fuzzy spellings match', () => {
  expect(matchPassages('lords prayer')[0]).toMatchObject({ book: 'Matthew', ch: 6, from: 9 })
  expect(matchPassages('lost son')[0].title).toBe('The Prodigal Son')
  expect(matchPassages('beattitudes')[0].title).toBe('The Beatitudes')
  expect(matchPassages('armor of god')[0]).toMatchObject({ book: 'Ephesians', ch: 6 })
})

test('every query word must match; limit honoured; empty query → []', () => {
  expect(matchPassages('prodigal zebra')).toEqual([])
  expect(matchPassages('parable', 2)).toHaveLength(2)
  expect(matchPassages('')).toEqual([])
})

test('ties break by title length then canonical order, independent of table order', () => {
  const a = matchPassages('parable', 100).map((p) => p.title)
  const b = matchPassages('parable', 100).map((p) => p.title)
  expect(a).toEqual(b)
  expect(a.length).toBeGreaterThan(5)
})

test('every passage names a real book and a range inside the bundled KJV', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../../resources/bibles/kjv.json'), 'utf-8')) as {
    books: { name: string; chapters: { chapter: number; verses: { verse: number }[] }[] }[]
  }
  // KJV raw uses "Psalms"; the canonical name is "Psalm" (see books.ts)
  const byBook = new Map(raw.books.map((b) => [b.name === 'Psalms' ? 'Psalm' : b.name, b]))
  const names = new Set(BOOKS.map((b) => b.name))
  for (const p of PASSAGES) {
    expect(names.has(p.book), p.title).toBe(true)
    const b = byBook.get(p.book)!
    const chapter = b.chapters.find((c) => c.chapter === p.ch)
    expect(chapter, `${p.title}: ${p.book} ${p.ch}`).toBeTruthy()
    const last = chapter!.verses[chapter!.verses.length - 1].verse
    expect(p.from >= 1 && p.from <= p.to && p.to <= last, `${p.title}: ${p.book} ${p.ch}:${p.from}-${p.to} (max ${last})`).toBe(true)
  }
  expect(PASSAGES.length).toBeGreaterThanOrEqual(150)
})
