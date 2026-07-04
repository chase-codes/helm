import { norm } from '../search/fuzzy'
import { BOOKS } from './books'

export interface ParsedRef {
  book: string
  ch: number
  from: number
  to: number
}

export function matchBook(token: string): string | null {
  const t = norm(token)
  if (!t) return null
  for (const b of BOOKS) if (b.aliases.includes(t)) return b.name
  for (const b of BOOKS) if (b.aliases.some((a) => a.startsWith(t))) return b.name
  return null
}
export function matchBookExact(token: string): string | null {
  const t = norm(token)
  if (!t) return null
  for (const b of BOOKS) if (b.aliases.includes(t)) return b.name
  return null
}
export function parseRef(raw: string): ParsedRef | null {
  const m = (raw || '')
    .trim()
    .match(/^([1-3]?\s?[a-zA-Z][a-zA-Z ]*?)\.?\s*(\d+)(?::\s*(\d+)\s*(?:[-–]\s*(\d+))?)?$/)
  if (!m) return null
  const book = matchBook(m[1])
  if (!book) return null
  const ch = parseInt(m[2])
  const from = m[3] ? parseInt(m[3]) : 1
  const to = m[4] ? parseInt(m[4]) : from
  if (to < from) return null
  return { book, ch, from, to }
}
export function formatRef(p: ParsedRef): string {
  return `${p.book} ${p.ch}:${p.from}` + (p.to > p.from ? `–${p.to}` : '')
}
