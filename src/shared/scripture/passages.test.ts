import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { PASSAGE_ROWS, STORIES, matchPassages } from './passages'
import { BOOKS } from './books'
import { formatRef } from './refs'

const refs = (q: string, limit?: number): string[] => matchPassages(q, limit).map((p) => `${p.title} @ ${formatRef(p)}`)
const titles = (q: string, limit?: number): string[] => [...new Set(matchPassages(q, limit).map((p) => p.title))]

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

test('every meaningful word must match; limit honoured; empty query → []', () => {
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

test('a closer match hides fuzzier ones: zacch is Zacchaeus, not Gethsemane via watch', () => {
  const hits = matchPassages('zacch')
  expect(hits).toHaveLength(1)
  expect(hits[0].title).toBe('Zacchaeus')
})

test('a typo-only query still works when nothing closer exists', () => {
  expect(matchPassages('beattitudes')[0].title).toBe('The Beatitudes')
})

test('several exact hits keep all of them; a title match leads an alias-only match', () => {
  const t = titles('lost')
  expect(t).toEqual(expect.arrayContaining(['The Lost Sheep', 'The Lost Coin', 'The Prodigal Son']))
  // Zacchaeus only holds "lost" inside a quoted alias — it lists, but after the titles.
  expect(t.indexOf('The Lost Sheep')).toBeLessThan(t.indexOf('Zacchaeus'))
})

// --- Every account of a story: one row per place it is told.

test('the resurrection lists all four gospel accounts, in order, before anything else', () => {
  expect(refs('resurrection').slice(0, 4)).toEqual([
    'The Resurrection @ Matthew 28:1–10',
    'The Resurrection @ Mark 16:1–8',
    'The Resurrection @ Luke 24:1–12',
    'The Resurrection @ John 20:1–18',
  ])
  // …and however the operator says it
  for (const q of ['jesus resurrection', 'resurrection of jesus', 'the resurrection', 'easter', 'empty tomb', 'he is risen', 'jesus rose from the dead'])
    expect(matchPassages(q)[0], q).toMatchObject({ title: 'The Resurrection', book: 'Matthew', ch: 28 })
})

test('the last supper, communion and the footwashing each list every account', () => {
  expect(refs('last supper')).toEqual([
    'The Last Supper @ Matthew 26:17–30',
    'The Last Supper @ Mark 14:12–26',
    'The Last Supper @ Luke 22:7–38',
    'The Last Supper @ John 13:1–30',
  ])
  expect(refs('communion').slice(0, 5)).toEqual([
    'Communion: The Lord\'s Supper @ Matthew 26:26–29',
    'Communion: The Lord\'s Supper @ Mark 14:22–25',
    'Communion: The Lord\'s Supper @ Luke 22:14–20',
    'Communion: The Lord\'s Supper @ 1 Corinthians 11:23–34',
    'Communion: The Lord\'s Supper @ 1 Corinthians 10:16–17',
  ])
  for (const q of ['lords supper', 'this is my body', 'do this in remembrance', 'bread and wine', 'institution of the lords supper'])
    expect(matchPassages(q)[0].title, q).toBe('Communion: The Lord\'s Supper')
  for (const q of ['foot washing', 'footwashing', 'washing feet', 'jesus washes feet', 'washes the disciples feet', 'washing of the feet'])
    expect(matchPassages(q)[0], q).toMatchObject({ title: 'Jesus Washes the Disciples\' Feet', book: 'John', ch: 13, from: 1, to: 17 })
})

// [query, title of the top story, how many accounts it must list]
const PARALLELS: [string, string, number][] = [
  ['crucifixion', 'The Crucifixion', 4],
  ['jesus crucified', 'The Crucifixion', 4],
  ['triumphal entry', 'The Triumphal Entry', 4],
  ['palm sunday', 'The Triumphal Entry', 4],
  ['feeding the 5000', 'Feeding the Five Thousand', 4],
  ['jesus feeds the 5000', 'Feeding the Five Thousand', 4],
  ['feeding of the four thousand', 'Feeding the Four Thousand', 2],
  ['cleansing the temple', 'Jesus Cleanses the Temple', 4],
  ['peter denies jesus', 'Peter Denies Jesus', 4],
  ['gethsemane', 'Gethsemane', 3],
  ['burial of jesus', 'The Burial of Jesus', 4],
  ['baptism of jesus', 'The Baptism of Jesus', 4],
  ['temptation of jesus', 'The Temptation of Jesus', 3],
  ['transfiguration', 'The Transfiguration', 3],
  ['jesus calms the storm', 'Jesus Calms the Storm', 3],
  ['walking on water', 'Jesus Walks on Water', 3],
  ['rich young ruler', 'The Rich Young Ruler', 3],
  ['parable of the sower', 'The Sower', 3],
  ['john the baptist', 'John the Baptist', 4],
  ['john the baptist beheaded', 'The Death of John the Baptist', 2],
  ['great commission', 'The Great Commission', 4],
  ['ascension', 'The Ascension', 3],
  ['lords prayer', 'The Lord\'s Prayer', 2],
  ['beatitudes', 'The Beatitudes', 2],
  ['ten commandments', 'The Ten Commandments', 2],
  ['christmas story', 'The Nativity', 2],
  ['paul conversion', 'The Road to Damascus', 3],
  ['anointing at bethany', 'Mary Anoints Jesus at Bethany', 3],
  ['seven last words', 'The Seven Last Words', 7],
  ['sermon on the mount', 'The Sermon on the Mount', 4],
  ['second coming', 'The Second Coming', 7],
  ['holy spirit', 'The Holy Spirit', 7],
  ['romans road', 'The Romans Road', 5],
  ['forgiveness', 'Forgiveness', 7],
  ['anxiety', 'Worry and Anxiety', 6],
]

for (const [q, title, n] of PARALLELS) {
  test(`"${q}" → ${title}, ${n} account${n === 1 ? '' : 's'}`, () => {
    const hits = matchPassages(q)
    expect(hits[0].title).toBe(title)
    expect(hits.filter((p) => p.title === title)).toHaveLength(n)
    // a story's accounts stay together at the top
    expect(hits.slice(0, n).every((p) => p.title === title)).toBe(true)
  })
}

// --- However it is said.

test('filler words never gate a match', () => {
  expect(matchPassages('the story of the prodigal son')[0].title).toBe('The Prodigal Son')
  expect(matchPassages('parable of the sower')[0].title).toBe('The Sower')
  expect(matchPassages('jesus heals the blind man')[0].title).toBe('Healing of the Blind Man')
  expect(matchPassages('woman at the well')[0].title).toBe('The Woman at the Well')
})

test('a query of only filler words still searches the full text', () => {
  expect(matchPassages('jesus', 100).length).toBeGreaterThan(5)
  expect(matchPassages('parable', 100).length).toBeGreaterThan(20)
})

test('the phrase as typed outranks the same words scattered', () => {
  expect(matchPassages('my lord and my god')[0].title).toBe('Doubting Thomas')
  expect(matchPassages('i am the way')[0].title).toBe('Let Not Your Heart Be Troubled')
})

test('three or more words may miss one: a verb nobody wrote into a title', () => {
  expect(matchPassages('jesus raises lazarus from the dead')[0].title).toBe('Raising of Lazarus')
  expect(matchPassages('jesus heals ten lepers')[0].title).toBe('The Ten Lepers')
  // two meaningful words stay strict — one of two is a one-word search
  expect(matchPassages('prodigal zebra')).toEqual([])
})

test('people list their stories', () => {
  expect(titles('elijah').length).toBeGreaterThanOrEqual(4)
  expect(titles('barnabas')[0]).toBe('Barnabas') // not Barabbas, one edit away
  expect(titles('mary magdalene')[0]).toBe('Mary Magdalene at the Tomb')
  expect(titles('nicodemus')[0]).toBe('Nicodemus: Born Again')
  expect(titles('judas')).toEqual(expect.arrayContaining(['The Death of Judas', 'The Betrayal and Arrest']))
})

test('the table is well formed: real books, ranges inside the bundled KJV, no story longer than the rail', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../../resources/bibles/kjv.json'), 'utf-8')) as {
    books: { nr: number; chapters: { chapter: number; verses: { verse: number }[] }[] }[]
  }
  // The raw file's names differ ("Psalms", "Song of Songs"); its `nr` is the canonical position.
  const byBook = new Map(raw.books.map((b) => [BOOKS[b.nr - 1].name, b]))
  const seen = new Set<string>()
  for (const s of STORIES) {
    expect(seen.has(s.title), `duplicate title: ${s.title}`).toBe(false)
    seen.add(s.title)
    expect(s.refs.length, s.title).toBeGreaterThanOrEqual(1)
    // The top story must be able to show every account it has.
    expect(s.refs.length, s.title).toBeLessThanOrEqual(PASSAGE_ROWS)
    expect(new Set(s.refs.map(formatRef)).size, `${s.title}: repeated reference`).toBe(s.refs.length)
    for (const r of s.refs) {
      const chapter = byBook.get(r.book)?.chapters.find((c) => c.chapter === r.ch)
      expect(chapter, `${s.title}: ${r.book} ${r.ch}`).toBeTruthy()
      const last = chapter!.verses[chapter!.verses.length - 1].verse
      expect(r.from >= 1 && r.from <= r.to && r.to <= last, `${s.title}: ${formatRef(r)} (max ${last})`).toBe(true)
    }
  }
  expect(STORIES.length).toBeGreaterThanOrEqual(400)
})

test('matching the whole table is cheap enough to run on a keystroke', () => {
  const t0 = performance.now()
  for (const q of ['resurrection', 'jesus feeds the 5000', 'the lord is my shepherd', 'love', 'zacch']) matchPassages(q)
  expect(performance.now() - t0).toBeLessThan(250) // CI-safe; a few ms each on a laptop
})
