import { describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { openTestDb } from './testDb'
import { createSongsRepo, type SongsRepo } from './songsRepo'
import { createKeySheetFiles, workbookMessage, type KeySheetDeps, type KeySheetFiles } from './keySheetFiles'
import type { KeysImportResult } from '../shared/types'
import { NO_TITLE_COLUMN, SAVE_AS_CSV } from '../shared/songs/keySheet'

const setup = (): { repo: SongsRepo } => {
  const repo = createSongsRepo(openTestDb())
  return { repo }
}
const files = (repo: SongsRepo, deps: KeySheetDeps): KeySheetFiles => createKeySheetFiles(repo, { defaultDir: () => '/docs', ...deps })

describe('exportNoKey', () => {
  it('saves the No key songs, in that order, to the file the person picks', async () => {
    const { repo } = setup()
    repo.add({ title: 'Oceans', author: 'Hillsong United', ccli: '6428767', text: 'Verse 1\nYou call me out upon the waters' })
    const kept = repo.add({ title: 'Kept', text: 'Verse 1\nhas a key' })
    repo.setMusicKey(kept.id, 'G', 'typed')
    repo.add({ title: 'Amazing Grace', text: 'Verse 1\nAmazing grace, how sweet the sound' })
    const pickSave = vi.fn(async (p: string) => (p === join('/docs', 'Song keys to fill in.csv') ? '/usb/Song keys to fill in.csv' : null))
    const writeFile = vi.fn()
    const r = await files(repo, { pickSave, writeFile }).exportNoKey()
    expect(r).toEqual({ saved: 2, fileName: 'Song keys to fill in.csv' })
    expect(writeFile).toHaveBeenCalledWith(
      '/usb/Song keys to fill in.csv',
      '﻿Title,Author,CCLI,First line,Key\r\n' +
        'Amazing Grace,,,"Amazing grace, how sweet the sound",\r\n' +
        'Oceans,Hillsong United,6428767,You call me out upon the waters,\r\n'
    )
  })
  it('a cancelled dialog writes nothing', async () => {
    const { repo } = setup()
    const writeFile = vi.fn()
    expect(await files(repo, { pickSave: async () => null, writeFile }).exportNoKey()).toEqual({ canceled: true })
    expect(writeFile).not.toHaveBeenCalled()
  })
  it('a failed write says so', async () => {
    const { repo } = setup()
    const r = await files(repo, {
      pickSave: async () => '/ro/x.csv',
      writeFile: () => {
        throw new Error('read-only')
      }
    }).exportNoKey()
    expect(r).toEqual({ error: "Couldn't save x.csv: read-only" })
  })
})

describe('importSheet', () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
  const importing = (repo: SongsRepo, path: string, bytes: Uint8Array): Promise<KeysImportResult> =>
    files(repo, { pickOpen: async () => path, readFile: () => bytes, fileSize: () => bytes.length }).importSheet()

  it('reads, matches and reviews the chosen file; writes nothing', async () => {
    const { repo } = setup()
    const wm = repo.add({ title: 'Way Maker', text: 'Verse 1\nYou are here' })
    const r = await importing(repo, '/home/keys.csv', enc('﻿Title;Key\r\nWay Maker;Bb\r\nNo Such Song;G\r\nWay Maker;\r\n'))
    expect(r).toMatchObject({
      fileName: 'keys.csv',
      blank: 1,
      same: 0,
      rows: [
        { line: 2, group: 'ready', key: 'Bb', candidates: [{ id: wm.id, title: 'Way Maker' }] },
        { line: 3, group: 'not-found', key: 'G' }
      ]
    })
    expect(repo.get(wm.id)?.key).toBeUndefined()
  })
  it('an xlsx (or a workbook renamed .csv) says to save it as CSV', async () => {
    const { repo } = setup()
    const readFile = vi.fn()
    const r = await files(repo, { pickOpen: async () => '/home/Keys.XLSX', readFile }).importSheet()
    expect(r).toEqual({ error: workbookMessage('Excel') })
    expect(workbookMessage('Excel')).toBe(`Helm can't open Excel files. ${SAVE_AS_CSV}`)
    expect(SAVE_AS_CSV).toBe('Save it as CSV first (File → Save As → CSV), then import that.')
    expect(readFile).not.toHaveBeenCalled()
    expect(await importing(repo, '/home/keys.csv', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toEqual({ error: workbookMessage('Excel') })
    expect(await files(repo, { pickOpen: async () => '/a/b.numbers' }).importSheet()).toEqual({ error: workbookMessage('Numbers') })
  })
  it('no Title column: the plain sentence', async () => {
    const { repo } = setup()
    expect(await importing(repo, '/k.csv', enc('Song keys\nWay Maker'))).toEqual({ error: NO_TITLE_COLUMN })
  })
  it('a cancelled dialog', async () => {
    const { repo } = setup()
    expect(await files(repo, { pickOpen: async () => null }).importSheet()).toEqual({ canceled: true })
  })
  it('a file it cannot read, or one far too big', async () => {
    const { repo } = setup()
    const missing = await files(repo, {
      pickOpen: async () => '/gone.csv',
      fileSize: () => {
        throw new Error('ENOENT')
      }
    }).importSheet()
    expect(missing).toEqual({ error: "Couldn't open gone.csv: ENOENT" })
    const big = await files(repo, { pickOpen: async () => '/big.csv', fileSize: () => 50 * 1024 * 1024 }).importSheet()
    expect(big).toEqual({ error: 'big.csv is too big to be a list of songs.' })
  })
})
