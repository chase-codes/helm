import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { BIBLE_MANIFEST, normalizeGetBible } from './bibleSource'

const kjvEntry = BIBLE_MANIFEST.find((e) => e.id === 'kjv')!

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
  const raw = JSON.parse(readFileSync(join(__dirname, '../../resources/bibles/kjv.json'), 'utf-8'))
  const bible = normalizeGetBible(raw, kjvEntry)
  expect(bible.books).toHaveLength(66)
  const john = bible.books.find((b) => b.name === 'John')!
  expect(john.chapters[2].verses[15].text).toContain('For God so loved the world')
})
