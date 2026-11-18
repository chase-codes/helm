import { describe, expect, it } from 'vitest'
import { cell, csvField, decodeSheetBytes, isZipBytes, parseCsv, sniffDelimiter, toCsv } from './csv'

describe('parseCsv', () => {
  it('reads plain rows with CRLF or LF', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseCsv('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']])
  })
  it('strips a BOM', () => {
    expect(parseCsv('﻿Title,Key\nX,G')[0]).toEqual(['Title', 'Key'])
  })
  it('reads quoted fields with commas, doubled quotes and line breaks inside', () => {
    const text = 'Title,Key\r\n"Hallelujah, What a Saviour",G\r\n"The ""Real"" One",A\r\n"Two\r\nlines",D\r\n'
    expect(parseCsv(text)).toEqual([
      ['Title', 'Key'],
      ['Hallelujah, What a Saviour', 'G'],
      ['The "Real" One', 'A'],
      ['Two\r\nlines', 'D']
    ])
  })
  it('keeps an empty quoted field and a stray quote inside an unquoted one', () => {
    expect(parseCsv('a,"",c\nHe said "hi",x')).toEqual([['a', '', 'c'], ['He said "hi"', 'x']])
  })
  it('drops blank rows, trailing ones included, and keeps ragged rows as they are', () => {
    const rows = parseCsv('Title,Author,Key\nX\n\n,,\nY,Z,G,,\n\n\n')
    expect(rows).toEqual([['Title', 'Author', 'Key'], ['X'], ['Y', 'Z', 'G', '', '']])
    expect(cell(rows[1], 2)).toBe('')
  })
  it('sniffs a semicolon (European Excel) and a tab', () => {
    expect(parseCsv('Title;Key\n"Oceans; live";D')).toEqual([['Title', 'Key'], ['Oceans; live', 'D']])
    expect(parseCsv('Title\tKey\nOceans, live\tD')).toEqual([['Title', 'Key'], ['Oceans, live', 'D']])
  })
})

describe('sniffDelimiter', () => {
  it.each([
    ['Title,Author,Key\n', ','],
    ['Title;Author;Key\n', ';'],
    ['Title\tAuthor\tKey\n', '\t'],
    ['"Title, with comma";Key\n', ';'],
    ['Title\n', ','],
    ['\n\nTitle;Key', ';']
  ] as const)('%j → %j', (text, d) => {
    expect(sniffDelimiter(text)).toBe(d)
  })
})

describe('decodeSheetBytes', () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
  it('reads UTF-8 with or without a BOM', () => {
    expect(decodeSheetBytes(enc('﻿Café'))).toBe('Café')
    expect(decodeSheetBytes(enc('Café'))).toBe('Café')
  })
  it('falls back to Windows-1252 (Excel’s plain CSV)', () => {
    expect(decodeSheetBytes(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x92]))).toBe('Café ’')
  })
  it('reads UTF-16 LE with a BOM (Excel’s Unicode Text)', () => {
    const body = [...'Key\tG'].flatMap((c) => [c.charCodeAt(0), 0])
    expect(decodeSheetBytes(new Uint8Array([0xff, 0xfe, ...body]))).toBe('Key\tG')
  })
  it('knows a zip when it sees one', () => {
    expect(isZipBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true)
    expect(isZipBytes(enc('Title,Key'))).toBe(false)
  })
})

describe('writing', () => {
  it('quotes only what needs it', () => {
    expect(csvField('Oceans')).toBe('Oceans')
    expect(csvField('Hallelujah, What a Saviour')).toBe('"Hallelujah, What a Saviour"')
    expect(csvField('The "Real" One')).toBe('"The ""Real"" One"')
    expect(csvField('Two\nlines')).toBe('"Two\nlines"')
    expect(csvField(' padded')).toBe('" padded"')
  })
  it('writes a BOM, CRLF and a header, and reads back the same', () => {
    const rows = [['Oceans, live', 'D'], ['"Q"', ''], ['Line\r\nbreak', 'G']]
    const text = toCsv(['Title', 'Key'], rows)
    expect(text.startsWith('﻿Title,Key\r\n')).toBe(true)
    expect(text.endsWith('\r\n')).toBe(true)
    expect(parseCsv(text)).toEqual([['Title', 'Key'], ...rows])
  })
})
