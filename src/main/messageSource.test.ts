import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createFixtureMessageSource, normalizeIndex, normalizeSermon } from './messageSource'

const indexFixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/message-index.sample.json'), 'utf-8')
) as unknown
const sermonFixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/message-sermon.sample.json'), 'utf-8')
) as unknown

test('normalizeIndex maps the sample index fixture to SermonIndexEntry[]', () => {
  const entries = normalizeIndex(indexFixture)
  expect(entries).toHaveLength(2)
  expect(entries[0]).toEqual({
    id: '65-1204',
    tapeNo: '65-1204',
    title: 'The Rapture',
    date: 'December 4, 1965',
    durationS: 9430
  })
  expect(typeof entries[0].tapeNo).toBe('string')
})

test('normalizeIndex throws when raw is not an array', () => {
  expect(() => normalizeIndex(null)).toThrow(/expected an array/)
  expect(() => normalizeIndex({})).toThrow(/expected an array/)
})

test('normalizeIndex throws when an entry is missing id or tapeNo', () => {
  expect(() => normalizeIndex([{ tapeNo: '65-1204' }])).toThrow(/missing a string "id"/)
  expect(() => normalizeIndex([{ id: '65-1204' }])).toThrow(/missing a string "tapeNo"/)
})

test('normalizeSermon maps the sample sermon fixture to SermonPayload', () => {
  const sermon = normalizeSermon(sermonFixture)
  expect(sermon.paragraphs.length).toBeGreaterThan(0)
  expect(typeof sermon.paragraphs[0].label).toBe('string')
  expect(sermon.paragraphs[0].label).toBe('E-1')
  expect(sermon.timing).toEqual([])
})

test('normalizeSermon throws on malformed payloads', () => {
  expect(() => normalizeSermon({})).toThrow(/paragraphs/)
  expect(() => normalizeSermon(null)).toThrow(/paragraphs/)
  expect(() => normalizeSermon({ paragraphs: [{ label: 'E-1' }] })).toThrow(
    /missing a string "text"/
  )
})

test('normalizeSermon coerces a non-string label to a string', () => {
  const sermon = normalizeSermon({ paragraphs: [{ label: 76, text: 'Now, the Rapture...' }] })
  expect(sermon.paragraphs[0].label).toBe('76')
})

test('createFixtureMessageSource().fetchSermon resolves the fixture regardless of id', async () => {
  const source = createFixtureMessageSource()
  const sermon = await source.fetchSermon('anything')
  expect(sermon.paragraphs[0].label).toBe('E-1')
  expect(sermon.timing).toEqual([])
})

test('createFixtureMessageSource().fetchIndex resolves the fixture index', async () => {
  const source = createFixtureMessageSource()
  const entries = await source.fetchIndex()
  expect(entries.map((e) => e.tapeNo)).toContain('65-1204')
})

test('createFixtureMessageSource().audioUrl returns a stable placeholder string', async () => {
  const source = createFixtureMessageSource()
  const url = await source.audioUrl({
    id: '65-1204',
    tapeNo: '65-1204',
    title: 'The Rapture',
    date: 'December 4, 1965',
    durationS: 9430
  })
  expect(url).toContain('65-1204')
})
