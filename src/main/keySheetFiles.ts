import { readFileSync, statSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import type { SongsRepo } from './songsRepo'
import type { KeysExportResult, KeysImportResult } from '../shared/types'
import { decodeSheetBytes, isZipBytes } from '../shared/csv'
import {
  EXPORT_FILE_NAME,
  SAVE_AS_CSV,
  buildKeyImportReview,
  keysExportCsv,
  readKeySheet
} from '../shared/songs/keySheet'

// The song keys spreadsheet's files (song keys spec, Phase 2): main owns the save and open
// dialogs, as the song-library and media imports do, and the disk. What goes into the file
// and what each row means is keySheet.ts, which is pure.

export interface KeySheetDeps {
  /** Parent for the dialogs, so they are modal to the operator window (mediaImport's seam). */
  getParentWindow?: () => Electron.BrowserWindow | null
  /** Where the save dialog starts (the Documents folder). */
  defaultDir?: () => string
  pickSave?: (defaultPath: string) => Promise<string | null>
  pickOpen?: () => Promise<string | null>
  readFile?: (path: string) => Uint8Array
  writeFile?: (path: string, text: string) => void
  fileSize?: (path: string) => number
}

export interface KeySheetFiles {
  exportNoKey(): Promise<KeysExportResult>
  importSheet(): Promise<KeysImportResult>
}

/** A songs list is a few hundred kilobytes; anything near this is not one. */
const MAX_BYTES = 20 * 1024 * 1024

const WORKBOOKS: Record<string, string> = { '.xlsx': 'Excel', '.xlsm': 'Excel', '.xls': 'Excel', '.numbers': 'Numbers', '.ods': 'OpenOffice' }

/** The plain sentence for a workbook chosen instead of a CSV. */
export const workbookMessage = (app: string): string => `Helm can't open ${app} files. ${SAVE_AS_CSV}`

const electronDialog = (): typeof import('electron').dialog =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('electron') as typeof import('electron')).dialog

export function createKeySheetFiles(repo: SongsRepo, deps: KeySheetDeps = {}): KeySheetFiles {
  const parent = (): Electron.BrowserWindow | null => deps.getParentWindow?.() ?? null
  const pickSave =
    deps.pickSave ??
    (async (defaultPath: string): Promise<string | null> => {
      const opts: Electron.SaveDialogOptions = {
        defaultPath,
        filters: [{ name: 'CSV (opens in Excel, Numbers and Google Sheets)', extensions: ['csv'] }]
      }
      const p = parent()
      const r = p ? await electronDialog().showSaveDialog(p, opts) : await electronDialog().showSaveDialog(opts)
      return r.canceled || !r.filePath ? null : r.filePath
    })
  const pickOpen =
    deps.pickOpen ??
    (async (): Promise<string | null> => {
      const opts: Electron.OpenDialogOptions = {
        properties: ['openFile'],
        filters: [
          { name: 'Spreadsheet saved as CSV', extensions: ['csv', 'tsv', 'txt'] },
          { name: 'All files', extensions: ['*'] }
        ]
      }
      const p = parent()
      const r = p ? await electronDialog().showOpenDialog(p, opts) : await electronDialog().showOpenDialog(opts)
      return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
    })
  const defaultDir =
    deps.defaultDir ??
    ((): string => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as typeof import('electron')
      return app.getPath('documents')
    })
  const readFile = deps.readFile ?? ((p: string): Uint8Array => readFileSync(p))
  const writeFile = deps.writeFile ?? ((p: string, text: string): void => writeFileSync(p, text, 'utf8'))
  const fileSize = deps.fileSize ?? ((p: string): number => statSync(p).size)

  return {
    async exportNoKey() {
      const rows = repo.keyList({ tab: 'none' })
      const path = await pickSave(join(defaultDir(), EXPORT_FILE_NAME))
      if (!path) return { canceled: true }
      try {
        writeFile(path, keysExportCsv(rows))
      } catch (e) {
        return { error: `Couldn't save ${basename(path)}: ${(e as Error).message}` }
      }
      return { saved: rows.length, fileName: basename(path) }
    },

    async importSheet() {
      const path = await pickOpen()
      if (!path) return { canceled: true }
      const fileName = basename(path)
      const workbook = WORKBOOKS[extname(path).toLowerCase()]
      if (workbook) return { error: workbookMessage(workbook) }
      let bytes: Uint8Array
      try {
        if (fileSize(path) > MAX_BYTES) return { error: `${fileName} is too big to be a list of songs.` }
        bytes = readFile(path)
      } catch (e) {
        return { error: `Couldn't open ${fileName}: ${(e as Error).message}` }
      }
      // A workbook renamed to .csv is still a zip inside.
      if (isZipBytes(bytes)) return { error: workbookMessage('Excel') }
      const sheet = readKeySheet(decodeSheetBytes(bytes))
      if ('error' in sheet) return sheet
      return { fileName, ...buildKeyImportReview(sheet.rows, repo.keyList({ tab: 'all' })) }
    }
  }
}
