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
