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

// Ported from the prototype's pickVersion (line 1002): toggles `id` in/out of the
// selected-versions list. Selected -> removed, but never below 1 (compare needs at
// least a primary). Not selected -> appended if fewer than 2 are picked, else replaces
// the compare slot (index 1) so the primary (index 0) is always preserved.
export function pickVersion(versions: string[], id: string): string[] {
  const v = versions.slice()
  const i = v.indexOf(id)
  if (i >= 0) {
    if (v.length > 1) v.splice(i, 1)
    return v
  }
  if (v.length >= 2) return [v[0], id]
  v.push(id)
  return v
}
