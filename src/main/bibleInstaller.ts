import { readFile } from 'node:fs/promises'
import type { BiblesRepo } from './biblesRepo'
import {
  BIBLE_MANIFEST,
  bundledKjvPath,
  downloadAndNormalize,
  normalizeGetBible
} from './bibleSource'
import type { BibleInstallProgress, BibleManifestEntry } from '../shared/types'

export interface BibleInstaller {
  manifest(): BibleManifestEntry[]
  install(id: string): void
  uninstall(id: string): BibleManifestEntry[]
  installBundledKjvIfMissing(): Promise<void>
}

// Injected so the installer's control flow (in-flight guard, progress phases, error
// handling) can be unit-tested with fakes — no real network fetch or Electron `app`
// required. Production callers rely on the defaults below.
export interface InstallerDeps {
  download: typeof downloadAndNormalize
  readBundledKjvRaw: () => Promise<unknown>
}

const defaultDeps: InstallerDeps = {
  download: downloadAndNormalize,
  readBundledKjvRaw: async () => JSON.parse(await readFile(bundledKjvPath(), 'utf-8')) as unknown
}

export function createBibleInstaller(
  repo: BiblesRepo,
  broadcast: (p: BibleInstallProgress) => void,
  deps: Partial<InstallerDeps> = {}
): BibleInstaller {
  const { download, readBundledKjvRaw } = { ...defaultDeps, ...deps }
  const inFlight = new Set<string>()

  function manifest(): BibleManifestEntry[] {
    return BIBLE_MANIFEST.map((entry) => ({
      id: entry.id,
      abbr: entry.abbr,
      name: entry.name,
      bundled: entry.bundled,
      installed: repo.isInstalled(entry.id)
    }))
  }

  function install(id: string): void {
    if (inFlight.has(id)) return
    inFlight.add(id)
    void (async () => {
      try {
        broadcast({ id, phase: 'downloading' })
        const bible = await download(id)
        broadcast({ id, phase: 'installing' })
        repo.install(bible)
        broadcast({ id, phase: 'done' })
      } catch (err) {
        broadcast({ id, phase: 'error', error: err instanceof Error ? err.message : String(err) })
      } finally {
        inFlight.delete(id)
      }
    })()
  }

  function uninstall(id: string): BibleManifestEntry[] {
    repo.uninstall(id)
    return manifest()
  }

  async function installBundledKjvIfMissing(): Promise<void> {
    if (repo.isInstalled('kjv')) return
    const entry = BIBLE_MANIFEST.find((e) => e.id === 'kjv')
    if (!entry) return
    try {
      broadcast({ id: 'kjv', phase: 'installing' })
      const raw = await readBundledKjvRaw()
      const bible = normalizeGetBible(raw, entry)
      repo.install(bible)
      broadcast({ id: 'kjv', phase: 'done' })
    } catch (err) {
      // A corrupt or missing bundled KJV must never crash boot — log and move on.
      console.error('installBundledKjvIfMissing failed:', err)
      broadcast({
        id: 'kjv',
        phase: 'error',
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  return { manifest, install, uninstall, installBundledKjvIfMissing }
}
