import { describe, expect, it } from 'vitest'
import { parseCsv } from '../csv'
import type { MusicKeyRow } from '../types'
import {
  NO_KEY_COLUMN,
  NO_TITLE_COLUMN,
  EMPTY_SHEET,
  buildKeyImportReview,
  guardCell,
  unguardCell,
  initiallyChecked,
  keyImportBatch,
  keysExportCsv,
  mapHeader,
  readKeySheet,
  type KeyImportRow,
  type SheetRow
} from './keySheet'

const row = (id: string, title: string, extra: Partial<MusicKeyRow> = {}): MusicKeyRow => ({
  id,
  title,
  author: '',
  firstLine: `${title} first line`,
  ccli: '',
  key: '',
  keySource: '',
  liveDays: 0,
  lastLiveAt: null,
  skippedAt: null,
  ...extra
})
const sheet = (rows: Partial<SheetRow>[]): SheetRow[] =>
  rows.map((r, i) => ({ line: i + 2, title: '', author: '', ccli: '', firstLine: '', cell: '', ...r }))

describe('mapHeader', () => {
  it('maps our own export', () => {
    expect(mapHeader(['Title', 'Author', 'CCLI', 'First line', 'Key'])).toEqual({ title: 0, author: 1, ccli: 2, firstLine: 3, key: 4 })
  })
  it('matches names in any order, ignoring case, spaces and punctuation', () => {
    expect(mapHeader(['  CCLI #', 'Church Key', 'ARTIST', 'Song Title'])).toEqual({ ccli: 0, key: 1, author: 2, title: 3 })
    expect(mapHeader(['ccli_number', 'default-key', 'Song', 'Writer'])).toEqual({ ccli: 0, key: 1, title: 2, author: 3 })
  })
  it.each([
    [['Name', 'Song Key'], { title: 0, key: 1 }],
    [['Song Number', 'Starting Key'], { ccli: 0, key: 1 }],
    [['CCLI Song Number', 'Authors', 'Key'], { ccli: 0, author: 1, key: 2 }],
    [['Title', 'Key', 'Key'], { title: 0, key: 1 }], // the first one wins
    [['', 'Title', '', 'Key', ''], { title: 1, key: 3 }] // blank columns
  ])('%j', (header, out) => {
    expect(mapHeader(header)).toEqual(out)
  })
})

describe('readKeySheet', () => {
  it('reads the cells it needs, with spreadsheet line numbers', () => {
    const r = readKeySheet('Key,Title,Notes\r\nG , Way Maker ,x\r\n\r\nD,Oceans\r\n')
    expect(r).toEqual({
      rows: [
        { line: 2, title: 'Way Maker', author: '', ccli: '', firstLine: '', cell: 'G' },
        { line: 3, title: 'Oceans', author: '', ccli: '', firstLine: '', cell: 'D' }
      ]
    })
  })
  it('says plainly when there is no Title (or CCLI) column', () => {
    expect(readKeySheet('Song keys\nWay Maker')).toEqual({ error: NO_TITLE_COLUMN })
    expect(NO_TITLE_COLUMN).toBe('This file has no Title column. The first row should name the columns, like Title and Key.')
  })
  it('accepts CCLI without a title', () => {
    expect(readKeySheet('CCLI,Key\n7115744,Bb')).toMatchObject({ rows: [{ ccli: '7115744', cell: 'Bb' }] })
  })
  it('needs a Key column', () => {
    expect(readKeySheet('Title,Author\nX,Y')).toEqual({ error: NO_KEY_COLUMN })
  })
  it('an empty file', () => {
    expect(readKeySheet('﻿\r\n\r\n')).toEqual({ error: EMPTY_SHEET })
  })
})

describe('buildKeyImportReview', () => {
  const songs = [
    row('wm', 'Way Maker'),
    row('oc', 'Oceans', { key: 'D', keySource: 'typed' }),
    row('gg', 'Goodness Of God', { key: 'capo 2 G', keySource: 'legacy' }),
    row('cs1', 'Cornerstone', { author: 'Edward Mote' }),
    row('cs2', 'Cornerstone', { author: 'Reuben Morgan' }),
    row('iw', 'It Is Well'),
    row('gy', 'Great Are You Lord', { key: 'Ab', keySource: 'typed' })
  ]

  it('sorts rows into the five groups and counts what it leaves out', () => {
    const review = buildKeyImportReview(
      sheet([
        { title: 'Way Maker', cell: 'Bb' }, // Ready
        { title: 'Oceans', cell: 'E' }, // Already has a different key
        { title: 'Goodness of God', cell: 'A' }, // Ready: a legacy value is not a key
        { title: 'Cornerstone', author: 'Hillsong', cell: 'C' }, // Pick one
        { title: 'It Is Well With My Soul', cell: 'D' }, // Pick one (fuzzy)
        { title: 'Holy Forever', cell: 'G' }, // Not found
        { title: 'Way Maker', cell: 'G or A' }, // Not a key
        { title: 'Way Maker', cell: 'A (capo 2)' },
        { title: 'Way Maker', cell: 'D - E' },
        { title: 'Way Maker', cell: 'G7' },
        { title: 'Way Maker', cell: 'G/D' },
        { title: 'Great Are You Lord', cell: 'G#' }, // the same key: left out
        { title: 'Oceans', cell: '' }, // blank: left out
        { title: 'Oceans', cell: 'N/A' } // a placeholder is blank too
      ]),
      songs
    )
    const g = (line: number): KeyImportRow | undefined => review.rows.find((r) => r.line === line)
    expect(g(2)).toMatchObject({ group: 'ready', key: 'Bb', by: 'title', candidates: [{ id: 'wm' }] })
    expect(g(3)).toMatchObject({ group: 'different', key: 'E', candidates: [{ id: 'oc', key: 'D' }] })
    expect(g(4)).toMatchObject({ group: 'ready', key: 'A', candidates: [{ id: 'gg' }] })
    expect(g(5)).toMatchObject({ group: 'pick', key: 'C', by: 'title' })
    expect(g(5)!.candidates.map((c) => c.id).sort()).toEqual(['cs1', 'cs2'])
    expect(g(6)).toMatchObject({ group: 'pick', key: 'D', by: 'fuzzy', candidates: [{ id: 'iw' }] })
    expect(g(7)).toMatchObject({ group: 'not-found', key: 'G', candidates: [] })
    expect(g(8)).toMatchObject({ group: 'not-a-key', problem: 'two-keys', cell: 'G or A' })
    expect(g(9)).toMatchObject({ group: 'not-a-key', problem: 'capo-ambiguous' })
    expect(g(10)).toMatchObject({ group: 'not-a-key', problem: 'key-change' })
    expect(g(11)).toMatchObject({ group: 'not-a-key', problem: 'not-a-key' })
    expect(g(12)).toMatchObject({ group: 'not-a-key', problem: 'ambiguous-slash' })
    expect(g(13)).toBeUndefined()
    expect(review.same).toBe(1)
    expect(review.blank).toBe(2)
    expect(review.rows).toHaveLength(11)
  })

  it('Appendix C 15 and 16: G# is the Ab it already has; A against a typed G is a different key', () => {
    const gy = [row('gy', 'Great Are You Lord', { key: 'G', keySource: 'typed' })]
    expect(buildKeyImportReview(sheet([{ title: 'Great Are You Lord', cell: 'A' }]), gy).rows[0]).toMatchObject({ group: 'different' })
    const ab = [row('gy', 'Great Are You Lord', { key: 'Ab', keySource: 'typed' })]
    expect(buildKeyImportReview(sheet([{ title: 'Great Are You Lord', cell: 'G#' }]), ab)).toEqual({ rows: [], blank: 0, same: 1 })
  })

  it('copies per leader: when one copy already has the key, the row is left out', () => {
    const copies = [row('g', 'Song (G)', { ccli: '123', key: 'G', keySource: 'title' }), row('bb', 'Song (Bb)', { ccli: '123', key: 'Bb', keySource: 'title' })]
    expect(buildKeyImportReview(sheet([{ title: 'Song', ccli: '123', cell: 'G' }]), copies)).toMatchObject({ rows: [], same: 1 })
    expect(buildKeyImportReview(sheet([{ title: 'Song', ccli: '123', cell: 'A' }]), copies).rows[0]).toMatchObject({ group: 'pick', by: 'ccli' })
  })

  it('only Ready starts checked', () => {
    const review = buildKeyImportReview(
      sheet([
        { title: 'Way Maker', cell: 'Bb' },
        { title: 'Oceans', cell: 'E' },
        { title: 'Cornerstone', cell: 'C' }
      ]),
      songs
    )
    expect([...initiallyChecked(review.rows).entries()].map(([line, s]) => [line, s.id])).toEqual([[2, 'wm']])
  })
})

describe('keyImportBatch', () => {
  const review = buildKeyImportReview(
    sheet([
      { title: 'Way Maker', cell: 'Bb' },
      { title: 'Oceans', cell: 'E' },
      { title: 'Way Maker', cell: 'C' } // the same song again: the first checked row wins
    ]),
    [
      row('wm', 'Way Maker', { key: 'capo 2 G', keySource: 'legacy', skippedAt: 99 }),
      row('oc', 'Oceans', { key: 'D', keySource: 'typed' })
    ]
  )
  it('writes Ready with source csv, and the restore is each song exactly as it was', () => {
    const checked = initiallyChecked(review.rows)
    expect(keyImportBatch(review.rows, checked)).toEqual({
      changes: [{ id: 'wm', key: 'Bb', source: 'csv' }],
      restores: [{ id: 'wm', key: 'capo 2 G', source: 'legacy', skippedAt: 99 }]
    })
  })
  it('a different key is written only when its row is checked', () => {
    const checked = initiallyChecked(review.rows)
    checked.set(3, review.rows.find((r) => r.line === 3)!.candidates[0])
    checked.set(4, review.rows.find((r) => r.line === 4)!.candidates[0])
    expect(keyImportBatch(review.rows, checked)).toEqual({
      changes: [{ id: 'wm', key: 'Bb', source: 'csv' }, { id: 'oc', key: 'E', source: 'csv' }],
      restores: [
        { id: 'wm', key: 'capo 2 G', source: 'legacy', skippedAt: 99 },
        { id: 'oc', key: 'D', source: 'typed', skippedAt: null }
      ]
    })
  })
  it('a hand-picked song already in that key writes nothing', () => {
    const checked = new Map([[2, row('x', 'Elsewhere', { key: 'Bb', keySource: 'typed' })]])
    expect(keyImportBatch(review.rows, checked).changes).toEqual([])
  })
})

describe('keysExportCsv', () => {
  const rows = [
    row('a', 'Hallelujah, What a Saviour', { author: 'Philip Bliss', ccli: '22025', firstLine: 'Man of sorrows! what a name' }),
    row('b', 'Café "Live"', { author: 'Zoë', firstLine: 'Line one' })
  ]
  it('writes the five columns with a BOM and CRLF, Key blank, quoting as needed, in the order given', () => {
    expect(keysExportCsv(rows)).toBe(
      '﻿Title,Author,CCLI,First line,Key\r\n' +
        '"Hallelujah, What a Saviour",Philip Bliss,22025,Man of sorrows! what a name,\r\n' +
        '"Café ""Live""",Zoë,,Line one,\r\n'
    )
  })
  it('adds a Was column only when some row has an old value', () => {
    const text = keysExportCsv([...rows, row('c', 'Oceans', { key: 'capo 2 G', keySource: 'legacy' })])
    expect(parseCsv(text)).toEqual([
      ['Title', 'Author', 'CCLI', 'First line', 'Key', 'Was'],
      ['Hallelujah, What a Saviour', 'Philip Bliss', '22025', 'Man of sorrows! what a name', '', ''],
      ['Café "Live"', 'Zoë', '', 'Line one', '', ''],
      ['Oceans', '', '', 'Oceans first line', '', 'capo 2 G']
    ])
  })

  it('guards cells a spreadsheet would run as a formula, and the import reads them back as typed', () => {
    const risky = [
      row('x', '=HYPERLINK("http://example.com","x")', { author: '+Band', firstLine: '-Interlude-' }),
      row('y', '@Home', { firstLine: 'Plain line' })
    ]
    const parsed = parseCsv(keysExportCsv(risky))
    expect(parsed.slice(1).map((r) => r.slice(0, 4))).toEqual([
      ["'=HYPERLINK(\"http://example.com\",\"x\")", "'+Band", '', "'-Interlude-"],
      ["'@Home", '', '', 'Plain line']
    ])
    expect(guardCell('Amazing Grace')).toBe('Amazing Grace')
    expect(guardCell("It's Well")).toBe("It's Well")
    expect(unguardCell("'-Interlude-")).toBe('-Interlude-')
    // An apostrophe a title really starts with is left alone.
    expect(unguardCell("'Tis So Sweet")).toBe("'Tis So Sweet")
    const typed = parsed.map((r, i) => (i === 0 ? r : r.map((c, j) => (j === 4 ? 'G' : c))))
    const text = typed.map((r) => r.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n')
    const read = readKeySheet(text)
    if ('error' in read) throw new Error(read.error)
    expect(read.rows.map((r) => [r.title, r.author, r.firstLine])).toEqual([
      ['=HYPERLINK("http://example.com","x")', '+Band', '-Interlude-'],
      ['@Home', '', 'Plain line']
    ])
  })

  it('round trip: export, fill in every key, import: every row is Ready and the batch sets them all', () => {
    const library = [
      row('a', 'Hallelujah, What a Saviour', { author: 'Philip Bliss', ccli: '22025' }),
      row('b', 'Café "Live"'),
      row('c', 'Oceans', { key: 'capo 2 G', keySource: 'legacy' }),
      row('d', 'Cornerstone', { author: 'Edward Mote' }),
      row('e', 'Cornerstone', { author: 'Reuben Morgan' }),
      row('f', 'Goodness Of God (Ab)'),
      // Same title, no authors: only the first line tells them apart.
      row('g', 'Amazing Grace', { firstLine: 'Amazing grace how sweet the sound' }),
      row('h', 'Amazing Grace', { firstLine: 'My chains are gone' }),
      row('k', 'Kept', { key: 'G', keySource: 'typed' })
    ]
    const noKey = library.filter((r) => r.key === '' || r.keySource === 'legacy')
    const filled = ['A', 'Bb', 'D', 'C', 'Eb', 'Ab', 'G', 'F']
    // Fill in the Key column as a spreadsheet would: same rows, Key cell typed.
    const sheetRows = parseCsv(keysExportCsv(noKey))
    const typed = sheetRows.map((r, i) => (i === 0 ? r : r.map((c, j) => (j === 4 ? filled[i - 1] : c))))
    const text = typed.map((r) => r.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n')
    const read = readKeySheet(text)
    if ('error' in read) throw new Error(read.error)
    const review = buildKeyImportReview(read.rows, library)
    // The two Cornerstones are told apart by the exported authors, the two Amazing Graces
    // by the exported first lines.
    expect(review.rows.map((r) => r.group)).toEqual(Array(8).fill('ready'))
    expect(review.rows.map((r) => r.candidates[0].id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    const { changes } = keyImportBatch(review.rows, initiallyChecked(review.rows))
    expect(changes.map((c) => [c.id, c.key])).toEqual([
      ['a', 'A'], ['b', 'Bb'], ['c', 'D'], ['d', 'C'], ['e', 'Eb'], ['f', 'Ab'], ['g', 'G'], ['h', 'F']
    ])
  })
})
