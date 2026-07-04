import type { BookExtent } from '../types'
import { matchBook, matchBookExact, type ParsedRef } from './refs'

export type BuilderStage = 'book' | 'chapter' | 'verse' | 'endVerse'
export interface RefBuilderState {
  stage: BuilderStage
  bookQuery: string
  book: string | null
  chapter: number | null
  startVerse: number | null
  endVerse: number | null
}

export const EMPTY_EXTENT: BookExtent = { chapters: 0, verseCounts: [] }

export function initialBuilder(): RefBuilderState {
  return {
    stage: 'book',
    bookQuery: '',
    book: null,
    chapter: null,
    startVerse: null,
    endVerse: null
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

export function clampChapter(n: number, extent: BookExtent): number {
  return clamp(n, 1, extent.chapters)
}
export function clampVerse(n: number, chapter: number, extent: BookExtent): number {
  return clamp(n, 1, extent.verseCounts[chapter - 1] ?? 0)
}

export function renderBuilder(s: RefBuilderState): string {
  if (s.book === null) return s.bookQuery
  let out = s.book
  if (s.chapter === null) return out
  out += ` ${s.chapter}`
  if (s.stage === 'chapter') return out
  out += ':'
  if (s.startVerse !== null) out += s.startVerse
  if (s.stage !== 'endVerse') return out
  out += '-'
  if (s.endVerse !== null) out += s.endVerse
  return out
}

export function toParsedRef(s: RefBuilderState): ParsedRef | null {
  if (s.book === null || s.chapter === null) return null
  const from0 = s.startVerse ?? 1
  const end0 = s.endVerse ?? from0
  return { book: s.book, ch: s.chapter, from: Math.min(from0, end0), to: Math.max(from0, end0) }
}

export function fromParsedRef(p: ParsedRef): RefBuilderState {
  const isRange = p.to > p.from
  return {
    stage: isRange ? 'endVerse' : 'verse',
    bookQuery: '',
    book: p.book,
    chapter: p.ch,
    startVerse: p.from,
    endVerse: isRange ? p.to : null
  }
}

type Applied = { state: RefBuilderState; preventDefault: boolean }
const isDigit = (k: string): boolean => k >= '0' && k <= '9'
const isAlnum = (k: string): boolean => /^[a-z0-9]$/i.test(k)

export function applyKey(
  s: RefBuilderState,
  key: string,
  _shift: boolean,
  extent: BookExtent
): Applied {
  if (key === 'Backspace') return { state: backspace(s), preventDefault: true }
  if (key.length !== 1) return { state: s, preventDefault: false }
  return { state: printable(s, key, extent), preventDefault: true }
}

function printable(s: RefBuilderState, key: string, extent: BookExtent): RefBuilderState {
  switch (s.stage) {
    case 'book': {
      if (key === ' ') {
        const q = s.bookQuery
        const b = matchBook(q)
        if (b !== null && (!/\d/.test(q) || matchBookExact(q) !== null)) {
          return { ...s, stage: 'chapter', book: b, bookQuery: '', chapter: null }
        }
        if (/\d/.test(q)) return { ...s, bookQuery: q + ' ' }
        return s
      }
      if (isAlnum(key)) return { ...s, bookQuery: s.bookQuery + key }
      return s
    }
    case 'chapter': {
      if (isDigit(key)) {
        const c = clampChapter((s.chapter ?? 0) * 10 + Number(key), extent)
        return { ...s, chapter: c || null }
      }
      if ((key === ' ' || key === ':') && s.chapter !== null) return { ...s, stage: 'verse' }
      return s
    }
    case 'verse': {
      if (isDigit(key) && s.chapter !== null) {
        const v = clampVerse((s.startVerse ?? 0) * 10 + Number(key), s.chapter, extent)
        return { ...s, startVerse: v || null }
      }
      if ((key === ' ' || key === '-') && s.startVerse !== null) return { ...s, stage: 'endVerse' }
      return s
    }
    case 'endVerse': {
      if (isDigit(key) && s.chapter !== null) {
        const v = clampVerse((s.endVerse ?? 0) * 10 + Number(key), s.chapter, extent)
        return { ...s, endVerse: v || null }
      }
      return s
    }
  }
}

function backspace(s: RefBuilderState): RefBuilderState {
  switch (s.stage) {
    case 'book':
      return s.bookQuery ? { ...s, bookQuery: s.bookQuery.slice(0, -1) } : s
    case 'chapter':
      if (s.chapter === null)
        return { ...s, stage: 'book', book: null, bookQuery: s.book ?? '', chapter: null }
      return { ...s, chapter: Math.floor(s.chapter / 10) || null }
    case 'verse':
      if (s.startVerse === null) return { ...s, stage: 'chapter' }
      return { ...s, startVerse: Math.floor(s.startVerse / 10) || null }
    case 'endVerse':
      if (s.endVerse === null) return { ...s, stage: 'verse' }
      return { ...s, endVerse: Math.floor(s.endVerse / 10) || null }
  }
}

export function setStart(s: RefBuilderState, v: number, extent: BookExtent): RefBuilderState {
  if (s.chapter === null) return s
  const start = clampVerse(v, s.chapter, extent)
  return { ...s, stage: 'verse', startVerse: start || null, endVerse: null }
}

export function setEnd(s: RefBuilderState, v: number, extent: BookExtent): RefBuilderState {
  if (s.chapter === null || s.startVerse === null) return s
  const e = clampVerse(v, s.chapter, extent)
  if (!e) return s
  return {
    ...s,
    stage: 'endVerse',
    startVerse: Math.min(s.startVerse, e),
    endVerse: Math.max(s.startVerse, e)
  }
}
