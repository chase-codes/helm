import type { BookExtent } from '../types'

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
