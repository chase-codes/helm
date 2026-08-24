// The quality guard for verse search: real KJV, real index, ~25 operator queries with the
// verse an operator means. Keep this green when touching verseScore / biblesRepo.search.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, expect, test } from 'vitest'
import { openTestDb } from './testDb'
import { createBiblesRepo, type BiblesRepo } from './biblesRepo'
import { BIBLE_MANIFEST, normalizeGetBible } from './bibleSource'
import { verseKey } from '../shared/search/verseScore'

let repo: BiblesRepo

beforeAll(() => {
  const entry = BIBLE_MANIFEST.find((e) => e.id === 'kjv')!
  const raw = JSON.parse(readFileSync(join(__dirname, '../../resources/bibles/kjv.json'), 'utf-8'))
  repo = createBiblesRepo(openTestDb())
  repo.install(normalizeGetBible(raw, entry))
}, 60_000)

const top = (q: string, n = 3): string[] => repo.search(q, 'kjv').hits.slice(0, n).map(verseKey)

// [query, expected top-1]  — famous phrases, names, places, typos
const TOP1: [string, string][] = [
  ['for god so loved', 'John:3:16'],
  ['god so loved the world', 'John:3:16'],
  ['jesus wept', 'John:11:35'],
  ['the lord is my shepherd', 'Psalm:23:1'],
  ['"in the beginning"', 'Genesis:1:1'],
  ['in the beginning was the word', 'John:1:1'],
  ['be still and know', 'Psalm:46:10'],
  ['faith hope charity', '1 Corinthians:13:13'],
  ['blessed are the poor in spirit', 'Matthew:5:3'],
  ['our father which art in heaven', 'Matthew:6:9'],
  ['new heaven and a new earth', 'Revelation:21:1'],
  ['zaccheus', 'Luke:19:2'],
  ['zacchaeus', 'Luke:19:2'],           // modern spelling → vocab expansion
  ['jesus wepts', 'John:11:35'],        // typo expansion; nearest-tier only ("wept", not "went")
  ['emmaus', 'Luke:24:13'],
  ['nicodemus', 'John:3:1'],
  ['goliath', '1 Samuel:17:4'],
  ['bethlehem of judaea', 'Matthew:2:1'],
  ['armour of god', 'Ephesians:6:11'],
  ['fruit of the spirit', 'Galatians:5:22'],
  ['fiery furnace', 'Daniel:3:6'],
  ['lazarus come forth', 'John:11:43'],
]

for (const [q, want] of TOP1) {
  test(`top-1: "${q}" → ${want}`, () => {
    expect(top(q, 1)[0]).toBe(want)
  })
}

// [query, one of these in top-3]
const TOP3: [string, string[]][] = [
  // single names list canonically — first mention leads
  ['lazarus', ['Luke:16:20']],
  ['mustard seed', ['Matthew:13:31', 'Matthew:17:20']],
]

test('a plain place name returns every mention, in canonical order', () => {
  const r = repo.search('bethlehem', 'kjv')
  expect(r.total).toBeGreaterThanOrEqual(50)
  // Genesis 35:19, the first mention — this getbible KJV writes it "Beth–lehem" (en dash);
  // foldCompoundNames joins it before indexing/scoring so it's found like any other verse.
  expect(verseKey(r.hits[0])).toBe('Genesis:35:19')
})

for (const [q, any] of TOP3) {
  test(`top-3: "${q}" contains one of ${any.join(' | ')}`, () => {
    const got = top(q, 3)
    expect(got.some((k) => any.includes(k))).toBe(true)
  })
}

test('a word the KJV never uses returns nothing (passages layer covers it)', () => {
  expect(repo.search('prodigal', 'kjv').total).toBe(0)
})

test('a single-word query over 31k verses is fast enough for a keystroke', () => {
  const t0 = performance.now()
  repo.search('love', 'kjv')
  repo.search('lord', 'kjv')
  repo.search('zacchaeus', 'kjv')
  expect(performance.now() - t0).toBeLessThan(300) // CI-safe; real target is ~16 ms each
})
