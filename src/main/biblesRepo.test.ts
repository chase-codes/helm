import { beforeEach, expect, test } from 'vitest'
import type Database from 'better-sqlite3'
import { openTestDb } from './testDb'
import { createBiblesRepo, type BiblesRepo } from './biblesRepo'
import type { NormalizedBible } from '../shared/types'

let db: Database.Database
let repo: BiblesRepo

const kjv: NormalizedBible = {
  id: 'kjv',
  abbr: 'KJV',
  name: 'King James Version',
  language: 'en',
  books: [
    {
      name: 'Genesis',
      chapters: [
        {
          n: 1,
          verses: [
            { n: 1, text: 'In the beginning God created the heaven and the earth.' },
            { n: 2, text: 'And the earth was without form, and void.' }
          ]
        }
      ]
    },
    {
      name: 'John',
      chapters: [{ n: 1, verses: [{ n: 1, text: 'In the beginning was the Word.' }] }]
    }
  ]
}

const esv: NormalizedBible = {
  id: 'esv',
  abbr: 'ESV',
  name: 'English Standard Version',
  language: 'en',
  books: [
    {
      name: 'Genesis',
      chapters: [
        {
          n: 1,
          verses: [
            { n: 1, text: 'In the beginning, God created the heavens and the earth.' },
            { n: 2, text: 'The earth was without form and void.' }
          ]
        }
      ]
    }
  ]
}

beforeEach(() => {
  db = openTestDb()
  repo = createBiblesRepo(db)
})

test('install then installed() lists the version', () => {
  repo.install(kjv)
  const list = repo.installed()
  expect(list).toHaveLength(1)
  expect(list[0]).toEqual({ id: 'kjv', abbr: 'KJV', name: 'King James Version', language: 'en' })
})

test('isInstalled reflects install state', () => {
  expect(repo.isInstalled('kjv')).toBe(false)
  repo.install(kjv)
  expect(repo.isInstalled('kjv')).toBe(true)
})

test('getChapter returns verseCount and texts keyed by version', () => {
  repo.install(kjv)
  const ch = repo.getChapter('Genesis', 1)
  expect(ch.book).toBe('Genesis')
  expect(ch.chapter).toBe(1)
  expect(ch.verseCount).toBe(2)
  expect(ch.verses[1].kjv).toBe('In the beginning God created the heaven and the earth.')
  expect(ch.verses[2].kjv).toBe('And the earth was without form, and void.')
})

test('installing a second version merges into the same chapter map', () => {
  repo.install(kjv)
  repo.install(esv)
  const ch = repo.getChapter('Genesis', 1)
  expect(ch.verseCount).toBe(2)
  expect(ch.verses[1].kjv).toContain('heaven')
  expect(ch.verses[1].esv).toContain('heavens')
})

// verseCount 0 is the "absent" signal SermonMode reads (#19): no bible, or a chapter the
// installed bibles don't have. Consumers decide which; the repo just reports no rows.
test('getChapter with no data returns verseCount 0 and empty map', () => {
  const ch = repo.getChapter('Revelation', 22)
  expect(ch.verseCount).toBe(0)
  expect(ch.verses).toEqual({})
})

test('uninstall removes rows from both tables', () => {
  repo.install(kjv)
  repo.uninstall('kjv')
  expect(repo.installed()).toHaveLength(0)
  expect(repo.isInstalled('kjv')).toBe(false)
  const n = (
    db.prepare('SELECT COUNT(*) AS n FROM verses WHERE version_id = ?').get('kjv') as { n: number }
  ).n
  expect(n).toBe(0)
})

test('install is transactional: a fixture with a duplicate verse PK rolls back entirely', () => {
  const broken: NormalizedBible = {
    id: 'broken',
    abbr: 'BRK',
    name: 'Broken Version',
    language: 'en',
    books: [
      {
        name: 'Genesis',
        chapters: [
          {
            n: 1,
            verses: [
              { n: 1, text: 'first' },
              { n: 1, text: 'duplicate verse number' }
            ]
          }
        ]
      }
    ]
  }
  expect(() => repo.install(broken)).toThrow()
  expect(repo.installed()).toHaveLength(0)
  expect(repo.isInstalled('broken')).toBe(false)
  const n = (
    db.prepare('SELECT COUNT(*) AS n FROM verses WHERE version_id = ?').get('broken') as {
      n: number
    }
  ).n
  expect(n).toBe(0)
})

const multi: NormalizedBible = {
  id: 'kjvx',
  abbr: 'KJVX',
  name: 'KJV Extra',
  language: 'en',
  books: [
    {
      name: 'James',
      chapters: [
        {
          n: 1,
          verses: [
            { n: 1, text: 'a' },
            { n: 2, text: 'b' },
            { n: 3, text: 'c' }
          ]
        },
        {
          n: 2,
          verses: [
            { n: 1, text: 'd' },
            { n: 2, text: 'e' }
          ]
        }
      ]
    }
  ]
}

test('bookExtent returns chapter count and per-chapter verse counts', () => {
  repo.install(multi)
  const ext = repo.bookExtent('James', 'kjvx')
  expect(ext).toEqual({ chapters: 2, verseCounts: [3, 2] })
})

test('bookExtent returns {0, []} for an unknown book', () => {
  repo.install(multi)
  expect(repo.bookExtent('Nahum', 'kjvx')).toEqual({ chapters: 0, verseCounts: [] })
})

test('bookExtentAnyVersion resolves the first installed version', () => {
  repo.install(multi)
  expect(repo.bookExtentAnyVersion('James')).toEqual({ chapters: 2, verseCounts: [3, 2] })
})

test('bookExtentAnyVersion returns {0, []} when no version is installed', () => {
  expect(repo.bookExtentAnyVersion('James')).toEqual({ chapters: 0, verseCounts: [] })
})

const ftsCount = (versionId: string): number =>
  (db.prepare('SELECT count(*) AS n FROM verse_fts WHERE version_id = ?').get(versionId) as { n: number }).n

test('install writes one verse_fts row per verse; uninstall removes them', () => {
  repo.install(kjv)
  expect(ftsCount('kjv')).toBe(3)
  repo.uninstall('kjv')
  expect(ftsCount('kjv')).toBe(0)
})

test('verse_fts MATCH finds verse text for the right version only', () => {
  repo.install(kjv)
  repo.install(esv)
  const rows = db
    .prepare('SELECT version_id AS v, book, chapter, verse FROM verse_fts WHERE verse_fts MATCH ? AND version_id = ?')
    .all('"heaven"', 'kjv') as { v: string; book: string }[]
  expect(rows).toEqual([{ v: 'kjv', book: 'Genesis', chapter: 1, verse: 1 }])
})

test('ensureSearchIndex backfills a version installed before the index existed', () => {
  repo.install(kjv)
  db.exec("DELETE FROM verse_fts WHERE version_id = 'kjv'") // simulate a pre-index install
  expect(ftsCount('kjv')).toBe(0)
  repo.ensureSearchIndex()
  expect(ftsCount('kjv')).toBe(3)
  repo.ensureSearchIndex() // idempotent
  expect(ftsCount('kjv')).toBe(3)
})

test('verse_vocab lists the indexed terms', () => {
  repo.install(kjv)
  const terms = (db.prepare('SELECT term FROM verse_vocab').all() as { term: string }[]).map((r) => r.term)
  expect(terms).toContain('beginning')
  expect(terms).toContain('word')
})

const lukeKjv: NormalizedBible = {
  id: 'kjv2', abbr: 'KJV', name: 'KJV (Luke)', language: 'en',
  books: [{ name: 'Luke', chapters: [{ n: 19, verses: [
    { n: 2, text: 'And, behold, there was a man named Zaccheus, which was the chief among the publicans, and he was rich.' },
    { n: 5, text: 'Zaccheus, make haste, and come down; for to day I must abide at thy house.' },
    { n: 10, text: 'For the Son of man is come to seek and to save that which was lost.' }
  ] }] }, { name: 'John', chapters: [{ n: 11, verses: [{ n: 35, text: 'Jesus wept.' }] }] }]
}

test('search: prefix match, total, version filter', () => {
  repo.install(kjv)
  repo.install(esv)
  const r = repo.search('begin', 'kjv')
  expect(r.versionId).toBe('kjv')
  expect(r.total).toBe(2)
  expect(r.hits.map((h) => `${h.book} ${h.chapter}:${h.verse}`)).toEqual(['Genesis 1:1', 'John 1:1'])
  expect(repo.search('heavens', 'kjv').total).toBe(0) // "heavens" is ESV-only
})

test('search: AND across words', () => {
  repo.install(kjv)
  expect(repo.search('beginning word', 'kjv').hits.map((h) => h.book)).toEqual(['John'])
  expect(repo.search('beginning zebra', 'kjv').total).toBe(0)
})

test('search: quoted phrase requires the run', () => {
  repo.install(kjv)
  expect(repo.search('"the beginning was"', 'kjv').hits.map((h) => h.book)).toEqual(['John'])
  expect(repo.search('"beginning the"', 'kjv').total).toBe(0)
})

test('search: a misspelt word that no term starts with is expanded via the vocabulary', () => {
  repo.install(lukeKjv)
  expect(repo.search('zacchaeus', 'kjv2').hits.map((h) => h.verse)).toEqual([2, 5])
  expect(repo.search('wepts', 'kjv2').hits.map((h) => h.book)).toEqual(['John'])
})

test('search: a word with prefix matches is NOT fuzzed (no pollution)', () => {
  repo.install(lukeKjv)
  // "los" prefixes "lost" → only Luke 19:10; it must not also fuzz to "son"/"for"
  expect(repo.search('los', 'kjv2').hits.map((h) => h.verse)).toEqual([10])
})

test('search: empty / punctuation-only query returns nothing', () => {
  repo.install(kjv)
  expect(repo.search('', 'kjv')).toEqual({ hits: [], total: 0, versionId: 'kjv' })
  expect(repo.search('"', 'kjv')).toEqual({ hits: [], total: 0, versionId: 'kjv' })
})

test('search: vocabulary cache is refreshed by a later install', () => {
  repo.install(kjv)
  expect(repo.search('zacchaeus', 'kjv2').total).toBe(0) // kjv2 not installed; also warms the vocab cache
  repo.install(lukeKjv)
  expect(repo.search('zacchaeus', 'kjv2').total).toBe(2)
})

const weptVsWent: NormalizedBible = {
  id: 'kjv3', abbr: 'KJV', name: 'KJV (wept/went)', language: 'en',
  books: [{ name: 'John', chapters: [{ n: 11, verses: [
    { n: 35, text: 'Jesus wept.' }
  ] }] }, { name: 'Matthew', chapters: [{ n: 4, verses: [
    { n: 23, text: 'And Jesus went about all Galilee.' }
  ] }] }]
}

test('search: a typo expands to only the nearest-tier vocabulary terms', () => {
  repo.install(weptVsWent)
  // "wepts" is 1 edit from "wept", 2 from "went" — only the 1-away term should join the
  // OR group, so a fixture holding both must return only the "wept" verse.
  expect(repo.search('wepts', 'kjv3').hits.map((h) => `${h.book} ${h.chapter}:${h.verse}`)).toEqual(['John 11:35'])
})

const bethlehemKjv: NormalizedBible = {
  id: 'kjv4', abbr: 'KJV', name: 'KJV (Bethlehem)', language: 'en',
  books: [{ name: 'Genesis', chapters: [{ n: 35, verses: [
    { n: 19, text: 'And Rachel died, and was buried in the way to Ephrath, which is Beth\u2013lehem.' }
  ] }] }]
}

test('search: an en-dash compound name is indexed solid; the returned text keeps the dash', () => {
  repo.install(bethlehemKjv)
  const hits = repo.search('bethlehem', 'kjv4').hits
  expect(hits.map((h) => `${h.book} ${h.chapter}:${h.verse}`)).toEqual(['Genesis 35:19'])
  expect(hits[0].text).toBe('And Rachel died, and was buried in the way to Ephrath, which is Beth\u2013lehem.')
})

test('search: total counts SCORED hits, not the coarser FTS candidates', () => {
  repo.install(kjv)
  // FTS's `"wo"*` prefix-matches "word" in John 1:1, but the scorer gives no prefix
  // credit below 3 characters — so the gate rejects the only candidate. The header must
  // say 0, not 1: a total with an empty list under it is a lie the operator can see.
  const r = repo.search('beginning wo', 'kjv')
  expect(r.hits).toEqual([])
  expect(r.total).toBe(0)
})

test('search: limit pages the hits; total stays the full scored count', () => {
  repo.install(lukeKjv)
  const all = repo.search('"which was"', 'kjv2')
  expect(all.hits.map((h) => h.verse)).toEqual([2, 10])
  const one = repo.search('"which was"', 'kjv2', 1)
  expect(one.hits).toHaveLength(1)
  expect(one.total).toBe(2) // rankVerses' own default limit must not cap the count
})

test('search: a query with no token of 3+ characters matches nothing', () => {
  repo.install(kjv)
  expect(repo.search('th', 'kjv')).toEqual({ hits: [], total: 0, versionId: 'kjv' })
})

// The FTS gate must tokenize the way norm() does: "Lord's" is one term "lords", not
// "lord"/"s". A pre-norm index split it, so possessive queries only survived via typo
// expansion ("lords" fuzzed to "lord"), polluting retrieval and ranking.
test('indexes verses norm()-tokenized so possessives hit the FTS gate', () => {
  repo.install({
    id: 'kjv2', abbr: 'KJV', name: 'KJV', language: 'en',
    books: [{ name: 'Psalms', chapters: [{ n: 118, verses: [{ n: 23, text: "This is the LORD'S doing; it is marvellous in our eyes." }] }] }]
  })
  const n = (db.prepare(`SELECT count(*) AS n FROM verse_fts WHERE verse_fts MATCH '"lords"'`).get() as { n: number }).n
  expect(n).toBe(1)
})
