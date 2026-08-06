import type { SongSection } from '../types'

const CHORUS = /chorus/i
const KIND_RE = { bridge: /bridge/i, tag: /tag|ending/i } as const

/** First chorus from anywhere else; from a chorus, the NEXT chorus (wrapping) so a
 * repeat press cycles Chorus 1 → Chorus 2 → … → Chorus 1. Null when the song has none. */
export function chorusJump(sections: SongSection[], current: number): number | null {
  const idxs = sections.flatMap((s, i) => (CHORUS.test(s.label) ? [i] : []))
  if (!idxs.length) return null
  const pos = idxs.indexOf(current)
  return pos === -1 ? idxs[0] : idxs[(pos + 1) % idxs.length]
}

/** First section whose label names a bridge / tag (tag also matches 'Ending'). */
export function labelJump(sections: SongSection[], kind: 'bridge' | 'tag'): number | null {
  const i = sections.findIndex((s) => KIND_RE[kind].test(s.label))
  return i === -1 ? null : i
}

/** Section labeled 'Verse N' — label match with a word boundary so Verse 1 ≠ Verse 11. */
export function verseJump(sections: SongSection[], n: number): number | null {
  const re = new RegExp(`^verse\\s*${n}\\b`, 'i')
  const i = sections.findIndex((s) => re.test(s.label))
  return i === -1 ? null : i
}
