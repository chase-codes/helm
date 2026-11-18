import { decodeCp1252 } from './songs/cp1252'

// Spreadsheet text in and out: the song keys CSV round-trip (song keys spec, Phase 2).
// Pure, so main and the tests share it. Reads what Excel, Google Sheets and Numbers write:
// a UTF-8 BOM or none, Windows-1252 from Excel's plain "CSV", UTF-16 from Excel's "Unicode
// Text", quoted fields with commas, quotes and line breaks inside, CRLF or LF, and the
// delimiter European Excel uses (semicolon) or a tab.

export type CsvDelimiter = ',' | ';' | '\t'

/** Bytes to text. A BOM says which encoding; otherwise UTF-8, falling back to
 * Windows-1252 when the bytes are not valid UTF-8 (Excel's plain "CSV" on Windows). */
export function decodeSheetBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return decodeCp1252(body)
  }
}

/** A zip (xlsx, numbers, ods) starts with "PK\x03\x04": not text, whatever its name. */
export const isZipBytes = (bytes: Uint8Array): boolean =>
  bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04

/** The delimiter of the first non-blank line, counted outside quotes. A tie or nothing
 * found is a comma. */
export function sniffDelimiter(text: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false
  let seen = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') quoted = !quoted
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (seen) break
    } else if (!quoted && (c === ',' || c === ';' || c === '\t')) {
      counts[c]++
      seen = true
    } else if (c.trim()) seen = true
  }
  if (counts['\t'] > counts[','] && counts['\t'] >= counts[';']) return '\t'
  if (counts[';'] > counts[',']) return ';'
  return ','
}

/**
 * RFC 4180, leniently: a field is quoted when it starts with `"`, a doubled `""` inside is
 * one quote, and a quoted field may hold the delimiter and line breaks. A stray quote in
 * an unquoted field is kept as text. CRLF, LF and a lone CR all end a row. Rows that are
 * blank (every cell empty) are dropped wherever they are, so trailing blank rows go too;
 * rows are not padded (see `cell`).
 */
export function parseCsv(input: string, delimiter: CsvDelimiter = sniffDelimiter(input)): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  const n = text.length
  const endField = (): void => {
    row.push(field)
    field = ''
  }
  const endRow = (): void => {
    endField()
    if (row.some((c) => c.trim() !== '')) rows.push(row)
    row = []
  }
  while (i < n) {
    const c = text[i]
    if (c === '"' && field === '') {
      // A quoted field: up to the closing quote, `""` being one quote.
      i++
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"'
            i += 2
          } else {
            i++
            break
          }
        } else field += text[i++]
      }
      // Anything between the closing quote and the delimiter is kept (lenient).
      while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') field += text[i++]
      continue
    }
    if (c === delimiter) {
      endField()
      i++
    } else if (c === '\r' || c === '\n') {
      endRow()
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1
    } else {
      field += c
      i++
    }
  }
  if (field !== '' || row.length) endRow()
  return rows
}

/** A row's cell, '' past the end of a short (ragged) row. */
export const cell = (row: readonly string[], i: number): string => (i >= 0 && i < row.length ? row[i] : '')

/** One field, quoted when it holds the delimiter, a quote, a line break, or space at
 * either end (which a spreadsheet would otherwise trim). */
export function csvField(value: string, delimiter: CsvDelimiter = ','): string {
  const needs = value.includes(delimiter) || /["\r\n]/.test(value) || value !== value.trim()
  return needs ? `"${value.replace(/"/g, '""')}"` : value
}

/** A whole file as Excel opens it cleanly: a UTF-8 BOM (so accents survive), CRLF line
 * endings, one header row. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string => cells.map((c) => csvField(c)).join(',')
  return '﻿' + [header, ...rows].map(line).join('\r\n') + '\r\n'
}
