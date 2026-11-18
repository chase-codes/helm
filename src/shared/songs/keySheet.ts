import { cell, parseCsv, toCsv } from '../csv'
import { normalizeKey, type KeyRejectReason, type MusicKey } from './musicKey'
import { buildSongIndex, type MatchStage } from './matchSong'
import type { MusicKeyChange, MusicKeyRestore, MusicKeyRow } from '../types'

// The song keys spreadsheet: what `Export songs without a key…` writes and what
// `+ Import keys from a spreadsheet` reads back (song keys spec, Phase 2). Pure: main reads
// and writes the file, this decides what is in it and what each row of it means.

// ---------------------------------------------------------------------------------------
// Export.

export const EXPORT_FILE_NAME = 'Song keys to fill in.csv'

/** The export: Title, Author, CCLI, First line, Key (blank), in the No key tab's order. A
 * legacy value is not a key, so its Key cell is blank too, and a `Was` column carries the
 * old text, only when some row has one. */
// Spreadsheet formula guard. Excel and Sheets run a cell that starts with = + - @ (or a tab
// or CR) as a formula, so a song title like "-Interlude-" or a lyric line from the web could
// execute on open. Such cells get a leading apostrophe, which the spreadsheet treats as
// "this is text"; the import strips it again, whether or not the spreadsheet kept it.
const FORMULA_START = /^[=+\-@\t\r]/
export const guardCell = (s: string): string => (FORMULA_START.test(s) ? `'${s}` : s)
export const unguardCell = (s: string): string => (s.startsWith("'") && FORMULA_START.test(s.slice(1)) ? s.slice(1) : s)

export function keysExportCsv(rows: readonly MusicKeyRow[]): string {
  const legacy = (r: MusicKeyRow): string => (r.keySource === 'legacy' ? r.key : '')
  const anyWas = rows.some((r) => legacy(r) !== '')
  const header = ['Title', 'Author', 'CCLI', 'First line', 'Key', ...(anyWas ? ['Was'] : [])]
  return toCsv(
    header,
    rows.map((r) =>
      [r.title, r.author, r.ccli, r.firstLine, '', ...(anyWas ? [legacy(r)] : [])].map(guardCell)
    )
  )
}

// ---------------------------------------------------------------------------------------
// Import: the header row.

export type SheetColumn = 'title' | 'author' | 'ccli' | 'firstLine' | 'key'

/** Header names, folded (lower case, letters and digits only). Ours, then Planning
 * Center's, Elvanto's and WorshipTools' wherever a column maps. */
const HEADER_NAMES: Record<SheetColumn, readonly string[]> = {
  title: ['title', 'song', 'songtitle', 'songname', 'name'],
  author: ['author', 'authors', 'artist', 'artists', 'writer', 'writers', 'songwriter', 'songwriters'],
  ccli: ['ccli', 'cclino', 'cclinumber', 'cclisong', 'cclisongno', 'cclisongnumber', 'songnumber', 'cclisongid', 'ccliid'],
  firstLine: ['firstline', 'firstlyric', 'firstlyrics'],
  key: ['key', 'defaultkey', 'churchkey', 'songkey', 'startingkey', 'musickey']
}

const foldHeader = (h: string): string => h.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')

export type SheetColumns = Partial<Record<SheetColumn, number>>

/** Which column holds what, by header name, in any order. The first column that names a
 * field wins. */
export function mapHeader(header: readonly string[]): SheetColumns {
  const out: SheetColumns = {}
  header.forEach((h, i) => {
    const f = foldHeader(h)
    if (!f) return
    for (const col of Object.keys(HEADER_NAMES) as SheetColumn[]) {
      if (out[col] === undefined && HEADER_NAMES[col].includes(f)) out[col] = i
    }
  })
  return out
}

export const NO_TITLE_COLUMN =
  'This file has no Title column. The first row should name the columns, like Title and Key.'
export const NO_KEY_COLUMN =
  'This file has no Key column. The first row should name the columns, like Title and Key.'
export const SAVE_AS_CSV = 'Save it as CSV first (File → Save As → CSV), then import that.'
export const EMPTY_SHEET = 'This file is empty. Export songs without a key, fill in the Key column, and import that.'

/** One data row: its line in the spreadsheet (1 is the header), and the cells we use. */
export interface SheetRow {
  line: number
  title: string
  author: string
  ccli: string
  firstLine: string
  cell: string
}

/** A whole file's text to rows, or the one plain sentence that says what is wrong. */
export function readKeySheet(text: string): { rows: SheetRow[] } | { error: string } {
  const all = parseCsv(text)
  if (!all.length) return { error: EMPTY_SHEET }
  const cols = mapHeader(all[0])
  if (cols.title === undefined && cols.ccli === undefined) return { error: NO_TITLE_COLUMN }
  if (cols.key === undefined) return { error: NO_KEY_COLUMN }
  const at = (row: string[], i: number | undefined): string =>
    i === undefined ? '' : unguardCell(cell(row, i).trim())
  return {
    rows: all.slice(1).map((r, i) => ({
      line: i + 2,
      title: at(r, cols.title),
      author: at(r, cols.author),
      ccli: at(r, cols.ccli),
      firstLine: at(r, cols.firstLine),
      cell: at(r, cols.key)
    }))
  }
}

// ---------------------------------------------------------------------------------------
// Import: the review.

/** The review's groups, in display order (docs/ux-vocabulary.md, "Song keys"). */
export type KeyImportGroup = 'ready' | 'pick' | 'different' | 'not-a-key' | 'not-found'
export const KEY_IMPORT_GROUPS: readonly KeyImportGroup[] = ['ready', 'pick', 'different', 'not-a-key', 'not-found']

/** Why a cell is not one key: the reject reasons, and a key change, which a song's single
 * key cannot hold. */
export type KeyCellProblem = KeyRejectReason | 'key-change'

export interface KeyImportRow {
  line: number
  /** As the sheet has them. */
  title: string
  author: string
  ccli: string
  cell: string
  group: KeyImportGroup
  /** The sheet's key; absent in Not a key. */
  key?: MusicKey
  problem?: KeyCellProblem
  /** How the song was found (Ready, Pick one, Already has a different key). */
  by?: MatchStage
  /** Ready / Already has a different key: the one song. Pick one: up to three, best first.
   * Not a key / Not found: none. */
  candidates: MusicKeyRow[]
}

export interface KeyImportReview {
  rows: KeyImportRow[]
  /** Rows left out without a look: a blank key cell, or the key the song already has. */
  blank: number
  same: number
}

/** A song's canonical key, or '' (none, or a legacy value, which is waiting for a person). */
export const keyOf = (s: MusicKeyRow): string => (s.keySource === 'legacy' ? '' : s.key)

/**
 * Each row through normalizeKey and Appendix C. A blank cell, or the key the song already
 * has, is left out and counted. A song's different key is never overwritten unless the
 * person checks that row: it lands in Already has a different key, unchecked.
 */
export function buildKeyImportReview(sheet: readonly SheetRow[], songs: readonly MusicKeyRow[]): KeyImportReview {
  const index = buildSongIndex(songs)
  const rows: KeyImportRow[] = []
  let blank = 0
  let same = 0
  for (const r of sheet) {
    const base = { line: r.line, title: r.title, author: r.author, ccli: r.ccli, cell: r.cell }
    const parsed = normalizeKey(r.cell, 'field')
    if (parsed.kind === 'empty') {
      blank++
      continue
    }
    if (parsed.kind === 'reject' || parsed.endKey) {
      const problem: KeyCellProblem = parsed.kind === 'reject' ? parsed.reason : 'key-change'
      rows.push({ ...base, group: 'not-a-key', problem, candidates: [] })
      continue
    }
    const key = parsed.key
    const m = index.match(r)
    if (m.kind === 'none') {
      rows.push({ ...base, group: 'not-found', key, candidates: [] })
      continue
    }
    if (m.kind === 'one') {
      const current = keyOf(m.song)
      if (current === key) same++
      else rows.push({ ...base, group: current ? 'different' : 'ready', key, by: m.by, candidates: [m.song] })
      continue
    }
    // Several: if one of them already has this key, that is the one the sheet means.
    if (m.candidates.some((c) => keyOf(c) === key)) same++
    else rows.push({ ...base, group: 'pick', key, by: m.by, candidates: m.candidates })
  }
  return { rows, blank, same }
}

/** What the review has checked: a sheet line, and the song it sets. */
export type KeyImportChecked = ReadonlyMap<number, MusicKeyRow>

/** The rows a review starts with checked: Ready, and only Ready. */
export const initiallyChecked = (rows: readonly KeyImportRow[]): Map<number, MusicKeyRow> =>
  new Map(rows.filter((r) => r.group === 'ready').map((r) => [r.line, r.candidates[0]]))

/**
 * The one batch an apply writes (source 'csv'), and the restore its Undo writes: each song's
 * key, source and skip time exactly as they were. A song already in the sheet's key is not
 * written; a song checked on two rows takes the first.
 */
export function keyImportBatch(
  rows: readonly KeyImportRow[],
  checked: KeyImportChecked
): { changes: MusicKeyChange[]; restores: MusicKeyRestore[] } {
  const changes: MusicKeyChange[] = []
  const restores: MusicKeyRestore[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const song = checked.get(r.line)
    if (!song || !r.key || seen.has(song.id) || keyOf(song) === r.key) continue
    seen.add(song.id)
    changes.push({ id: song.id, key: r.key, source: 'csv' })
    restores.push({ id: song.id, key: song.key, source: song.keySource, skippedAt: song.skippedAt })
  }
  return { changes, restores }
}
