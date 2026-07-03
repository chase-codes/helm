import { Slide, SlideColumn } from '../types'

export function keyForScripture(book: string, ch: number, v: number): string {
  return `scr:${book}:${ch}:${v}`
}

export function verseCols(
  textByVersion: Record<string, string>,
  selected: string[],
  abbrOf: (id: string) => string
): SlideColumn[] {
  return selected
    .filter((id) => textByVersion[id])
    .map((id) => ({ version: abbrOf(id), text: textByVersion[id] }))
}

export function buildScriptureSlide(ref: string, columns: SlideColumn[]): Slide {
  return { kind: 'scripture', accent: '#6f9cf0', ref, label: ref, columns }
}
