import { norm } from '../search/fuzzy'
import { BOOKS, RANKED_BOOKS } from './books'

export interface ParsedRef {
  book: string
  ch: number
  from: number
  to: number
}

const RANK = new Map(RANKED_BOOKS.map((name, i) => [name, i]))
const rankOf = (name: string): number => RANK.get(name) ?? Number.MAX_SAFE_INTEGER

export function matchBook(token: string): string | null {
  const t = norm(token)
  if (!t) return null
  // Exact alias wins before prefix fallback — the same pass as matchBookExact, expressed
  // through it so the two can never drift (bookCompletion's digit clause relies on that).
  const exact = matchBookExact(token)
  if (exact !== null) return exact
  // Prefix fallback: best-ranked match, ties broken by canonical order (strict `<` keeps
  // the earlier, i.e. canonical, book when ranks are equal — including equal-unranked).
  let best: string | null = null
  for (const b of BOOKS) {
    if (!b.aliases.some((a) => a.startsWith(t))) continue
    if (best === null || rankOf(b.name) < rankOf(best)) best = b.name
  }
  return best
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
