// Song keys: the canonical key set and the one cleaning path every key goes through.
// Spec: docs/superpowers/specs/2026-11-17-song-keys-design.md (appendices A and B).

export const MUSIC_KEYS = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'F#',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
  'Cm',
  'C#m',
  'Dm',
  'Ebm',
  'Em',
  'Fm',
  'F#m',
  'Gm',
  'G#m',
  'Am',
  'Bbm',
  'Bm'
] as const

export type MusicKey = (typeof MUSIC_KEYS)[number]

/** Where a song's key came from. '' (no key) is stored as an empty source. */
export type MusicKeySource =
  'typed' | 'title' | 'import' | 'csv' | 'pco' | 'chart' | 'detected' | 'legacy'

export type KeyRejectReason = 'not-a-key' | 'two-keys' | 'capo-ambiguous' | 'ambiguous-slash'

export type NormalizeResult =
  | { kind: 'key'; key: MusicKey; endKey?: MusicKey }
  | { kind: 'empty' }
  | { kind: 'reject'; reason: KeyRejectReason }

export type NormalizeMode = 'field' | 'title'

export type TitleKeyFlag = 'two-keys' | 'modulation' | 'single-letter'

export interface TitleKeyResult {
  /** The title with the key suffix removed, or the cleaned original when nothing was removed. */
  title: string
  key?: MusicKey
  endKey?: MusicKey
  flag?: TitleKeyFlag
}

export const isMusicKey = (s: string): s is MusicKey =>
  (MUSIC_KEYS as readonly string[]).includes(s)

// ---------------------------------------------------------------------------------------
// Appendix A: pitch-class arithmetic.

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

interface ParsedKey {
  pc: number
  minor: boolean
}

const mod12 = (n: number): number => ((n % 12) + 12) % 12

/** MUSIC_KEYS lists the majors then the minors, each in pitch-class order 0–11. */
const canonical = ({ pc, minor }: ParsedKey): MusicKey => MUSIC_KEYS[(minor ? 12 : 0) + mod12(pc)]

/** The canonical key for a pitch class (any integer, taken mod 12) and mode. */
export const keyOfPitch = (pc: number, minor: boolean): MusicKey => canonical({ pc, minor })

/** A canonical key's pitch class (0–11) and mode. */
export function pitchOfKey(k: MusicKey): { pc: number; minor: boolean } {
  const i = MUSIC_KEYS.indexOf(k)
  return { pc: i % 12, minor: i >= 12 }
}

// ---------------------------------------------------------------------------------------
// Appendix B1: the core grammar.

const MINOR_WORDS = new Set(['min', 'minor', '-minor'])
const MAJOR_WORDS = new Set(['maj', 'major'])

/**
 * Root, optional accidental, optional quality, spaces allowed between parts. Anything else
 * (a second accidental, `7`, `sus`, a word) fails. Title mode needs an upper-case root.
 */
function parseCore(s: string, mode: NormalizeMode): ParsedKey | null {
  const root = s.charAt(0)
  const letter = root.toUpperCase()
  if (!(letter in LETTER_PC)) return null
  if (mode === 'title' && root !== letter) return null
  let pc = LETTER_PC[letter]
  let rest = s.slice(1).trimStart()

  const word = /^-?(sharp|flat)/i.exec(rest)
  if (rest.startsWith('#')) {
    pc += 1
    rest = rest.slice(1)
  } else if (word) {
    pc += word[1].toLowerCase() === 'sharp' ? 1 : -1
    rest = rest.slice(word[0].length)
  } else if (rest.startsWith('b') || rest.startsWith('B')) {
    pc -= 1
    rest = rest.slice(1)
  }
  rest = rest.trimStart()

  // Case matters for the bare letter only: `m` is minor, `M` is major.
  if (rest === '' || rest === 'M') return { pc: mod12(pc), minor: false }
  if (rest === 'm') return { pc: mod12(pc), minor: true }
  const lower = rest.toLowerCase()
  if (MINOR_WORDS.has(lower)) return { pc: mod12(pc), minor: true }
  if (MAJOR_WORDS.has(lower)) return { pc: mod12(pc), minor: false }
  return null
}

// ---------------------------------------------------------------------------------------
// Appendix B1: normalizeKey.

/** Step 1: NFKC, ASCII accidentals and dashes, trimmed, single spaces. */
function cleanText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/♭/g, 'b')
    .replace(/[♯＃]/g, '#')
    .replace(/[–—→]/g, '-')
    .trim()
    .replace(/\s+/g, ' ')
}

const EMPTY_RE = /^(?:n\/a|na|none|unknown|tbd|\?+|-+)$/i
const KEY_PREFIX_RE = /^key(?: of |: | - | )/i

// Step 6 capo forms. The first two say which side is the shape; the third does not.
const CAPO_FIRST_RE = /^capo ?(\d+) ?[,:]? ?(.+?)(?: shapes?)?$/i
const SHAPES_FIRST_RE = /^(.+?) shapes?,? capo ?(\d+)$/i
const CAPO_AFTER_RE = /^(.+?)(?: ?\(capo ?(\d+)\)|,? capo ?(\d+))$/i
const MAX_CAPO = 11

const MODULATION_SPLIT_RE = / ?- ?| to | ?> ?/i
const TWO_KEYS_SPLIT_RE = / ?[,;&] ?| or /i

const key = (k: ParsedKey, end?: ParsedKey): NormalizeResult => {
  const start = canonical(k)
  if (!end) return { kind: 'key', key: start }
  const endKey = canonical(end)
  return endKey === start ? { kind: 'key', key: start } : { kind: 'key', key: start, endKey }
}
const reject = (reason: KeyRejectReason): NormalizeResult => ({ kind: 'reject', reason })

function capoShift(shape: string, n: string, mode: NormalizeMode): NormalizeResult | null {
  const parsed = parseCore(shape, mode)
  if (!parsed) return null
  const capo = Number(n)
  if (capo > MAX_CAPO) return reject('not-a-key')
  return key({ pc: mod12(parsed.pc + capo), minor: parsed.minor })
}

/** Step 6. Returns null when the string is not a capo phrase with a parseable key. */
function parseCapo(s: string, mode: NormalizeMode): NormalizeResult | null {
  const capoFirst = CAPO_FIRST_RE.exec(s)
  if (capoFirst) {
    const r = capoShift(capoFirst[2], capoFirst[1], mode)
    if (r) return r
  }
  const shapesFirst = SHAPES_FIRST_RE.exec(s)
  if (shapesFirst) {
    const r = capoShift(shapesFirst[1], shapesFirst[2], mode)
    if (r) return r
  }
  const after = CAPO_AFTER_RE.exec(s)
  if (after && !/\bshapes?\b/i.test(after[1]) && parseCore(after[1], mode)) {
    const capo = Number(after[2] ?? after[3])
    return reject(capo > MAX_CAPO ? 'not-a-key' : 'capo-ambiguous')
  }
  return null
}

/** Appendix B1. */
export function normalizeKey(raw: string, mode: NormalizeMode = 'field'): NormalizeResult {
  // 1. Clean.
  let s = cleanText(raw)
  // 2. One pair of enclosing brackets.
  const enclosed = /^\(([^()]*)\)$|^\[([^[\]]*)\]$/.exec(s)
  if (enclosed) s = (enclosed[1] ?? enclosed[2]).trim()
  // 3. A leading "key of" and friends.
  s = s.replace(KEY_PREFIX_RE, '').trim()
  // 4. Blank and placeholder values.
  if (s === '' || EMPTY_RE.test(s)) return { kind: 'empty' }
  // 5. Core parse of the whole string.
  const core = parseCore(s, mode)
  if (core) return key(core)
  // 6. Capo. A title never extracts one.
  if (/\bcapo\b/i.test(s)) {
    if (mode === 'title') return reject('not-a-key')
    const capo = parseCapo(s, mode)
    if (capo) return capo
  }
  // 7. Slash: an enharmonic spelling pair, or ambiguous.
  const slash = s.split('/')
  if (slash.length === 2) {
    const [a, b] = slash.map((p) => parseCore(p.trim(), mode))
    if (a && b) {
      return a.pc === b.pc && a.minor === b.minor ? key(a) : reject('ambiguous-slash')
    }
  }
  // 8. Modulation.
  const mod = s.split(MODULATION_SPLIT_RE)
  if (mod.length === 2) {
    const [a, b] = mod.map((p) => parseCore(p.trim(), mode))
    if (a && b) return key(a, b)
  }
  // 9. Two or more keys. Never extracted, in either mode.
  const parts = s.split(TWO_KEYS_SPLIT_RE)
  if (parts.length >= 2 && parts.every((p) => parseCore(p.trim(), mode))) {
    return reject('two-keys')
  }
  // 10.
  return reject('not-a-key')
}

// ---------------------------------------------------------------------------------------
// Appendix B3: extractKeyFromTitle.

const TITLE_BRACKET_RE = /\s*[([]([^()[\]]{1,16})[)\]]$/
// `\b` keeps a word ending in "key" ("Monkey D") from reading as the keyword.
const TITLE_KEYWORD_RE =
  /\s*(?:[-–—,]\s*)?\bkey(?: of|:)?\s+(\S+(?:\s+(?:major|minor|flat|sharp))?)$/i

/** Appendix B3. */
export function extractKeyFromTitle(title: string): TitleKeyResult {
  const cleaned = title.replace(/\s+/g, ' ').trim()
  const bracket = TITLE_BRACKET_RE.exec(cleaned)
  const match = bracket ?? TITLE_KEYWORD_RE.exec(cleaned)
  if (!match) return { title: cleaned }

  const content = match[1]
  const result = normalizeKey(content, 'title')
  if (result.kind === 'reject' && result.reason === 'two-keys') {
    return { title: cleaned, flag: 'two-keys' }
  }
  if (result.kind !== 'key') return { title: cleaned }

  if (result.endKey) {
    return { title: cleaned, key: result.key, endKey: result.endKey, flag: 'modulation' }
  }
  const stripped = cleaned.slice(0, match.index).trim()
  const out: TitleKeyResult = { title: stripped === '' ? cleaned : stripped, key: result.key }
  // Only a bare bracketed letter is flagged: "(A)" could be a version or "female";
  // "Key of A" says what it is.
  if (bracket && /^[A-G]$/.test(cleanText(content))) out.flag = 'single-letter'
  return out
}

// ---------------------------------------------------------------------------------------
// Appendix B4: CCLI numbers.

/** Appendix B4: a digit string without leading zeros, or ''. */
export function normalizeCcli(raw: string): string {
  const digits = raw
    .replace(/ccli|song|#|no\.|number|:/gi, '')
    .replace(/,(?=\d{3}(?!\d))/g, '')
    .replace(/\s+/g, '')
  if (!/^\d{1,8}$/.test(digits) || /^0+$/.test(digits)) return ''
  return digits.replace(/^0+/, '')
}

const COPYRIGHT_CCLI_RE = /CCLI\s*(?:song)?\s*(?:#|no\.?|number)?\s*:?\s*([\d,]{3,10})/i

/** Appendix B4 copyright fallback: finds "CCLI # 12345" inside a copyright line, or ''. */
export function ccliFromCopyright(copyright: string): string {
  const match = COPYRIGHT_CCLI_RE.exec(copyright)
  // A trailing comma is punctuation after the number ("CCLI # 12345, all rights reserved").
  return match ? normalizeCcli(match[1].replace(/,+$/, '')) : ''
}
