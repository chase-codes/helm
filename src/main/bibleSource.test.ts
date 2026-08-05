import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { BIBLE_MANIFEST, normalizeGetBible } from './bibleSource'
import { matchBook, matchBookExact } from '../shared/scripture/refs'

const kjvEntry = BIBLE_MANIFEST.find((e) => e.id === 'kjv')!
const kjvRaw = JSON.parse(readFileSync(join(__dirname, '../../resources/bibles/kjv.json'), 'utf-8'))

const fixture = {
  translation: 'Test Version',
  abbreviation: 'tst',
  lang: 'en',
  books: [
    {
      nr: 19,
      name: 'Psalms',
      chapters: [
        {
          chapter: 23,
          verses: [
            { verse: 1, text: 'The LORD is my shepherd; I shall not want.  ' },
            { verse: 2, text: 'He maketh me to lie down in green pastures.\t' }
          ]
        }
      ]
    },
    {
      nr: 66,
      name: 'Revelation',
      chapters: [{ chapter: 1, verses: [{ verse: 1, text: 'The Revelation of Jesus Christ' }] }]
    }
  ]
}

test('BIBLE_MANIFEST lists kjv/web/asv/darby with getbible urls, kjv marked bundled', () => {
  const ids = BIBLE_MANIFEST.map((e) => e.id)
  expect(ids).toEqual(['kjv', 'web', 'asv', 'darby'])
  for (const e of BIBLE_MANIFEST) {
    expect(e.url).toBe(`https://api.getbible.net/v2/${e.id}.json`)
  }
  expect(kjvEntry.bundled).toBe(true)
  expect(BIBLE_MANIFEST.filter((e) => e.id !== 'kjv').every((e) => !e.bundled)).toBe(true)
})

test('normalizeGetBible maps getbible book names to canonical names', () => {
  const bible = normalizeGetBible(fixture, kjvEntry)
  expect(bible.books.map((b) => b.name)).toEqual(['Psalm', 'Revelation'])
})

test('normalizeGetBible preserves chapter and verse numbers', () => {
  const bible = normalizeGetBible(fixture, kjvEntry)
  const psalm = bible.books.find((b) => b.name === 'Psalm')!
  expect(psalm.chapters).toHaveLength(1)
  expect(psalm.chapters[0].n).toBe(23)
  expect(psalm.chapters[0].verses.map((v) => v.n)).toEqual([1, 2])
})

test('normalizeGetBible strips trailing whitespace from verse text', () => {
  const bible = normalizeGetBible(fixture, kjvEntry)
  const psalm = bible.books.find((b) => b.name === 'Psalm')!
  expect(psalm.chapters[0].verses[0].text).toBe('The LORD is my shepherd; I shall not want.')
  expect(psalm.chapters[0].verses[1].text).toBe('He maketh me to lie down in green pastures.')
})

test('normalizeGetBible sets id/abbr/name from the manifest entry and language from the payload', () => {
  const bible = normalizeGetBible(fixture, kjvEntry)
  expect(bible.id).toBe('kjv')
  expect(bible.abbr).toBe('KJV')
  expect(bible.name).toBe('King James Version')
  expect(bible.language).toBe('en')
})

test('normalizeGetBible throws listing unmapped book names', () => {
  const broken = {
    ...fixture,
    books: [...fixture.books, { nr: 99, name: 'Not A Real Book', chapters: [] }]
  }
  expect(() => normalizeGetBible(broken, kjvEntry)).toThrow(/Not A Real Book/)
})

test('normalizeGetBible on the bundled kjv.json produces all 66 books with expected text', () => {
  const bible = normalizeGetBible(kjvRaw, kjvEntry)
  expect(bible.books).toHaveLength(66)
  const john = bible.books.find((b) => b.name === 'John')!
  expect(john.chapters[2].verses[15].text).toContain('For God so loved the world')
})

// Book-name typeahead re-ranks matchBook's PREFIX branch (refs.ts). normalizeGetBible
// maps downloaded book names through matchBook, so a silent remap here would mis-file
// installed scripture. The safety argument is that every bundled-KJV name — including
// the variants "Psalms" and "Song of Songs" — is an EXACT alias, a branch the ranking
// does not touch. Pin the argument, not just the outcome.
test('every bundled-KJV book name resolves by exact alias, out of the ranking\'s reach', () => {
  const names: string[] = kjvRaw.books.map((b: { name: string }) => b.name)
  expect(names).toHaveLength(66)

  for (const name of names) {
    // Resolves at all, and by the exact-alias branch specifically.
    expect(matchBookExact(name), `"${name}" must be an exact alias`).not.toBeNull()
    // Both branches agree on the 66 bundled names: exact-alias returns them unchanged.
    expect(matchBook(name), `"${name}" must map via exact alias`).toBe(matchBookExact(name))
  }

  // The two names that are NOT the canonical spelling — the whole reason this test exists.
  expect(matchBook('Psalms')).toBe('Psalm')
  expect(matchBook('Song of Songs')).toBe('Song of Solomon')

  // The one token where the two branches disagree: 'jud' is an exact alias of
  // Jude, but 'judges' also prefix-matches it and comes first canonically. So
  // this pins the ORDER — exact before prefix — which is what puts the 66 names
  // above out of the ranking's reach. Neither book is in RANKED_BOOKS, so the
  // prefix branch's answer here is unchanged by Task 2.
  expect(matchBook('jud')).toBe('Jude')
  expect(matchBookExact('jud')).toBe('Jude')

  // 66 distinct canonical names out, no collisions.
  expect(new Set(names.map((n) => matchBook(n))).size).toBe(66)
})
