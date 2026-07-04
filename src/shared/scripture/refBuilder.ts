import type { BookExtent } from '../types'
import { type ParsedRef } from './refs'

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
  return { stage: 'book', bookQuery: '', book: null, chapter: null, startVerse: null, endVerse: null }
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
