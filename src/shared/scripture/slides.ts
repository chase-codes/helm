import { Slide, SlideColumn } from '../types'
import { CANVAS_GOLD } from '../slideAccents'

export function keyForScripture(book: string, ch: number, v: number): string {
  return `scr:${book}:${ch}:${v}`
}

/** Inverse of keyForScripture. The chapter and verse are the LAST two segments so a book
 * name containing ':' can't break it (book names with spaces/digits — '1 John' — are the
 * common case and pass through untouched). */
export function parseScriptureKey(key: string | null): { book: string; ch: number; v: number } | null {
  if (!key || !key.startsWith('scr:')) return null
  const parts = key.split(':')
  if (parts.length < 4) return null
  const ch = Number(parts[parts.length - 2])
  const v = Number(parts[parts.length - 1])
  const book = parts.slice(1, -2).join(':')
  if (book === '' || !Number.isInteger(ch) || ch < 1 || !Number.isInteger(v) || v < 1) return null
  return { book, ch, v }
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
  // Canvas gold (SlideCanvas's default accent), not the operator-UI scripture blue: on
  // the dark slide background the blue was the dimmest element on the slide (#48).
  return { kind: 'scripture', accent: CANVAS_GOLD, ref, label: ref, columns }
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
