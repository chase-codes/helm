import { extractKeyFromTitle, normalizeCcli } from './musicKey'

// Matching an outside row (a spreadsheet row now; PCO and chart files later) to a Helm song.
// Song keys spec, Appendix C. Pure; the example pairs table is matchSong.test.ts.
//
// Speed: the index is built once per import. CCLI and normalised title are hash lookups.
// The fuzzy stage only scores a song that shares tokens with the row: both of its tests
// need at least 60% of the shorter title's tokens in the longer one (the containment test
// needs all of them), so a song sharing fewer can never be a candidate. An inverted index
// (token → songs) counts the shared tokens per song in one pass over the row's posting
// lists, and Jaro-Winkler runs only on songs that clear the 60% bar. The prefilter is
// exact, not a heuristic: it drops only songs the appendix's rules would reject anyway.
// Cost per row is the length of its tokens' posting lists, not the library size.

export interface MatchableSong {
  id: string
  title: string
  author: string
  ccli: string
  /** The first lyric line, when known: breaks a title tie the authors could not (below). */
  firstLine?: string
}

export type MatchStage = 'ccli' | 'title' | 'fuzzy'

export type MatchResult<S extends MatchableSong> =
  | { kind: 'one'; song: S; by: MatchStage }
  /** Best first; never more than MAX_CANDIDATES. */
  | { kind: 'pick'; candidates: S[]; by: MatchStage }
  | { kind: 'none' }

export const MAX_CANDIDATES = 3
const JW_MIN = 0.9
const CONTAIN_MIN = 0.6

/** Steps 2 and 3 of the title normalisation, shared with authors: NFKD without combining
 * marks, lower case, apostrophes and backticks gone, `&` as "and". */
const fold = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’‘'`]/g, '')
    .replace(/&/g, ' and ')

/** Appendix C, "Normalised title". */
export function normalizeTitle(title: string): string {
  return fold(extractKeyFromTitle(title).title)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(?:the|a|an) /, '')
}

/** Appendix C, "Normalised authors": each name's last token, as a set of surnames. */
export function authorSurnames(author: string): Set<string> {
  const out = new Set<string>()
  for (const name of fold(author).split(/[,;/]|\band\b|\bwith\b/)) {
    const tokens = name.replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    const last = tokens[tokens.length - 1]
    if (last) out.add(last)
  }
  return out
}

/** Jaro-Winkler similarity (prefix scale 0.1, prefix up to 4), 0–1. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  const la = a.length
  const lb = b.length
  if (!la || !lb) return 0
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const aHit = new Uint8Array(la)
  const bHit = new Uint8Array(lb)
  let matches = 0
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range)
    const hi = Math.min(lb - 1, i + range)
    for (let j = lo; j <= hi; j++) {
      if (!bHit[j] && a[i] === b[j]) {
        aHit[i] = 1
        bHit[j] = 1
        matches++
        break
      }
    }
  }
  if (!matches) return 0
  let half = 0
  for (let i = 0, j = 0; i < la; i++) {
    if (!aHit[i]) continue
    while (!bHit[j]) j++
    if (a[i] !== b[j]) half++
    j++
  }
  const m = matches
  const jaro = (m / la + m / lb + (m - half / 2) / m) / 3
  let prefix = 0
  while (prefix < 4 && prefix < la && prefix < lb && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

interface Entry<S> {
  song: S
  title: string
  firstLine: string
  tokens: string[]
  surnames: Set<string>
}

export interface SongIndex<S extends MatchableSong> {
  match(row: { title: string; author?: string; ccli?: string; firstLine?: string }): MatchResult<S>
}

/** A first line folded like a title, for the tie-break: exact after folding, never fuzzy. */
const foldLine = (s: string | undefined): string => (s ? fold(s).replace(/[^a-z0-9]+/g, ' ').trim() : '')

const uniqueTokens = (t: string): string[] => (t ? [...new Set(t.split(' '))] : [])

const overlaps = (a: Set<string>, b: Set<string>): boolean => {
  for (const x of a) if (b.has(x)) return true
  return false
}

/** Built once per import; `match` is then cheap per row (see the note at the top). */
export function buildSongIndex<S extends MatchableSong>(songs: readonly S[]): SongIndex<S> {
  const entries: Entry<S>[] = songs.map((song) => {
    const title = normalizeTitle(song.title)
    return { song, title, firstLine: foldLine(song.firstLine), tokens: uniqueTokens(title), surnames: authorSurnames(song.author) }
  })
  const byCcli = new Map<string, number[]>()
  const byTitle = new Map<string, number[]>()
  const byToken = new Map<string, number[]>()
  const push = (m: Map<string, number[]>, k: string, i: number): void => {
    const list = m.get(k)
    if (list) list.push(i)
    else m.set(k, [i])
  }
  entries.forEach((e, i) => {
    const ccli = normalizeCcli(e.song.ccli)
    if (ccli) push(byCcli, ccli, i)
    if (e.title) push(byTitle, e.title, i)
    for (const t of e.tokens) push(byToken, t, i)
  })
  // Reused across rows: shared-token counts, and which slots this row touched.
  const shared = new Int32Array(entries.length)

  const fuzzy = (title: string): S[] => {
    const tokens = uniqueTokens(title)
    if (!tokens.length) return []
    const touched: number[] = []
    for (const t of tokens) {
      for (const i of byToken.get(t) ?? []) {
        if (shared[i] === 0) touched.push(i)
        shared[i]++
      }
    }
    const scored: { i: number; score: number }[] = []
    for (const i of touched) {
      const n = shared[i]
      shared[i] = 0
      const e = entries[i]
      const shorter = Math.min(tokens.length, e.tokens.length)
      if (n < CONTAIN_MIN * shorter) continue
      const jw = jaroWinkler(title, e.title)
      const contained = n === shorter && shorter >= 2
      if (jw >= JW_MIN || contained) scored.push({ i, score: jw })
    }
    scored.sort((a, b) => b.score - a.score || entries[a.i].title.localeCompare(entries[b.i].title))
    return scored.slice(0, MAX_CANDIDATES).map((s) => entries[s.i].song)
  }

  /** Several songs for one row: those sharing a surname with the row first. */
  const pick = (idx: number[], surnames: Set<string>, by: MatchStage): MatchResult<S> => {
    const ranked = [...idx].sort((a, b) => Number(overlaps(entries[b].surnames, surnames)) - Number(overlaps(entries[a].surnames, surnames)))
    return { kind: 'pick', candidates: ranked.slice(0, MAX_CANDIDATES).map((i) => entries[i].song), by }
  }

  return {
    match(row) {
      const surnames = authorSurnames(row.author ?? '')
      // 1. CCLI exact. Several are copies per leader: a person picks.
      const ccli = normalizeCcli(row.ccli ?? '')
      const viaCcli = ccli ? byCcli.get(ccli) : undefined
      if (viaCcli?.length === 1) return { kind: 'one', song: entries[viaCcli[0]].song, by: 'ccli' }
      if (viaCcli && viaCcli.length > 1) return pick(viaCcli, surnames, 'ccli')
      // 2. Normalised title exact; authors only break a tie.
      const title = normalizeTitle(row.title)
      if (!title) return { kind: 'none' }
      const viaTitle = byTitle.get(title)
      if (viaTitle?.length === 1) return { kind: 'one', song: entries[viaTitle[0]].song, by: 'title' }
      if (viaTitle && viaTitle.length > 1) {
        const kept = viaTitle.filter((i) => overlaps(entries[i].surnames, surnames))
        if (kept.length === 1) return { kind: 'one', song: entries[kept[0]].song, by: 'title' }
        // Beyond the appendix: a row that carries a first line (our own export does) settles
        // a tie when exactly one of the songs left begins with it, so two "Amazing Grace"s
        // with no authors still come back Ready. Without one, or with no single hit, a
        // person picks, as the appendix says.
        const line = foldLine(row.firstLine)
        if (line) {
          const byLine = (kept.length > 1 ? kept : viaTitle).filter((i) => entries[i].firstLine === line)
          if (byLine.length === 1) return { kind: 'one', song: entries[byLine[0]].song, by: 'title' }
        }
        return pick(viaTitle, surnames, 'title')
      }
      // 3. Fuzzy: never automatic.
      const near = fuzzy(title)
      if (near.length) return { kind: 'pick', candidates: near, by: 'fuzzy' }
      // 4.
      return { kind: 'none' }
    }
  }
}
