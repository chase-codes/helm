import { beforeEach, expect, test, vi } from 'vitest'
import { createBibleInstaller } from './bibleInstaller'
import type { BiblesRepo } from './biblesRepo'
import type { BibleInstallProgress, NormalizedBible } from '../shared/types'

function fakeRepo(installedIds: string[] = []): BiblesRepo & { installCalls: NormalizedBible[] } {
  const installed = new Set(installedIds)
  const installCalls: NormalizedBible[] = []
  return {
    installed: () => [],
    isInstalled: (id) => installed.has(id),
    install: (bible) => {
      installCalls.push(bible)
      installed.add(bible.id)
    },
    uninstall: (id) => {
      installed.delete(id)
    },
    getChapter: () => ({ book: '', chapter: 0, verseCount: 0, verses: {} }),
    bookExtent: () => ({ chapters: 0, verseCounts: [] }),
    installCalls
  }
}

const kjvBible: NormalizedBible = {
  id: 'kjv',
  abbr: 'KJV',
  name: 'King James Version',
  language: 'en',
  books: [{ name: 'Genesis', chapters: [{ n: 1, verses: [{ n: 1, text: 'In the beginning.' }] }] }]
}

// getbible-shaped raw payload, matching bibleSource.test.ts's fixture conventions.
const kjvRaw = {
  translation: 'King James Version',
  abbreviation: 'kjv',
  lang: 'en',
  books: [
    {
      nr: 1,
      name: 'Genesis',
      chapters: [{ chapter: 1, verses: [{ verse: 1, text: 'In the beginning.' }] }]
    }
  ]
}

let broadcasts: BibleInstallProgress[]
function capture(): (p: BibleInstallProgress) => void {
  broadcasts = []
  return (p) => broadcasts.push(p)
}

beforeEach(() => {
  broadcasts = []
})

test('manifest() marks kjv bundled and reflects installed state from the repo', () => {
  const repo = fakeRepo(['kjv'])
  const installer = createBibleInstaller(repo, capture())
  const manifest = installer.manifest()
  const kjv = manifest.find((e) => e.id === 'kjv')!
  expect(kjv.bundled).toBe(true)
  expect(kjv.installed).toBe(true)
  const web = manifest.find((e) => e.id === 'web')!
  expect(web.bundled).toBeUndefined()
  expect(web.installed).toBe(false)
})

test('install() broadcasts downloading -> installing -> done and installs the downloaded bible', async () => {
  const repo = fakeRepo()
  const broadcast = capture()
  const download = vi.fn().mockResolvedValue(kjvBible)
  const installer = createBibleInstaller(repo, broadcast, { download })

  installer.install('kjv')
  await vi.waitFor(() => expect(broadcasts).toHaveLength(3))

  expect(broadcasts.map((p) => p.phase)).toEqual(['downloading', 'installing', 'done'])
  expect(broadcasts.every((p) => p.id === 'kjv')).toBe(true)
  expect(repo.installCalls).toEqual([kjvBible])
})

test('install() rejects a double-install of an in-flight id', async () => {
  const repo = fakeRepo()
  const broadcast = capture()
  let resolveDownload: (b: NormalizedBible) => void
  const download = vi.fn(
    () =>
      new Promise<NormalizedBible>((resolve) => {
        resolveDownload = resolve
      })
  )
  const installer = createBibleInstaller(repo, broadcast, { download })

  installer.install('kjv')
  installer.install('kjv') // should be a no-op: id already in flight

  expect(download).toHaveBeenCalledTimes(1)
  resolveDownload!(kjvBible)
  await vi.waitFor(() => expect(repo.installCalls).toHaveLength(1))
})

test('install() broadcasts an error phase (with message) instead of throwing when download fails', async () => {
  const repo = fakeRepo()
  const broadcast = capture()
  const download = vi.fn().mockRejectedValue(new Error('network down'))
  const installer = createBibleInstaller(repo, broadcast, { download })

  expect(() => installer.install('web')).not.toThrow()
  await vi.waitFor(() => expect(broadcasts.at(-1)?.phase).toBe('error'))

  expect(broadcasts.map((p) => p.phase)).toEqual(['downloading', 'error'])
  expect(broadcasts[1].error).toBe('network down')
  expect(repo.installCalls).toHaveLength(0)
})

test('install() allows retrying an id after it finished (in-flight guard clears)', async () => {
  const repo = fakeRepo()
  const broadcast = capture()
  const download = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValueOnce(kjvBible)
  const installer = createBibleInstaller(repo, broadcast, { download })

  installer.install('kjv')
  await vi.waitFor(() => expect(broadcasts.at(-1)?.phase).toBe('error'))

  installer.install('kjv')
  await vi.waitFor(() => expect(broadcasts.at(-1)?.phase).toBe('done'))

  expect(download).toHaveBeenCalledTimes(2)
  expect(repo.installCalls).toEqual([kjvBible])
})

test('uninstall() removes from the repo and returns the refreshed manifest', () => {
  const repo = fakeRepo(['kjv'])
  const installer = createBibleInstaller(repo, capture())
  const manifest = installer.uninstall('kjv')
  expect(repo.isInstalled('kjv')).toBe(false)
  expect(manifest.find((e) => e.id === 'kjv')!.installed).toBe(false)
})

test('installBundledKjvIfMissing() is a no-op when kjv is already installed', async () => {
  const repo = fakeRepo(['kjv'])
  const readBundledKjvRaw = vi.fn()
  const installer = createBibleInstaller(repo, capture(), { readBundledKjvRaw })

  await installer.installBundledKjvIfMissing()

  expect(readBundledKjvRaw).not.toHaveBeenCalled()
  expect(repo.installCalls).toHaveLength(0)
})

test('installBundledKjvIfMissing() reads, normalizes, and installs the bundled file', async () => {
  const repo = fakeRepo()
  const broadcast = capture()
  const readBundledKjvRaw = vi.fn().mockResolvedValue(kjvRaw)
  const installer = createBibleInstaller(repo, broadcast, { readBundledKjvRaw })

  await installer.installBundledKjvIfMissing()

  expect(repo.installCalls).toHaveLength(1)
  expect(repo.installCalls[0].id).toBe('kjv')
  expect(repo.installCalls[0].books[0].name).toBe('Genesis')
  expect(broadcasts.map((p) => p.phase)).toEqual(['installing', 'done'])
})

test('installBundledKjvIfMissing() logs and continues (never throws) on a corrupt/missing bundle', async () => {
  const repo = fakeRepo()
  const broadcast = capture()
  const readBundledKjvRaw = vi.fn().mockRejectedValue(new Error('ENOENT'))
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const installer = createBibleInstaller(repo, broadcast, { readBundledKjvRaw })

  await expect(installer.installBundledKjvIfMissing()).resolves.toBeUndefined()

  expect(repo.installCalls).toHaveLength(0)
  expect(consoleError).toHaveBeenCalled()
  expect(broadcasts.at(-1)?.phase).toBe('error')
  consoleError.mockRestore()
})
