import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MessagesRepo } from './messagesRepo'
import { createMessageSource, type MessageSource } from './messageSource'
import type { AudioDownloadProgress, MessageInstallProgress } from '../shared/types'

export interface MessageInstaller {
  installCorpus(): void
  downloadAudio(id: string): void
}

// A single broadcast callback carries both progress shapes — MessageInstallProgress for the
// corpus install, AudioDownloadProgress (identified by its `msgId` field) for per-tape audio
// downloads — mirroring the one-broadcast-per-installer shape of bibleInstaller.
export type MessageInstallerBroadcast = (p: MessageInstallProgress | AudioDownloadProgress) => void

// Injected so the installer's control flow (in-flight guards, progress phases, error handling)
// can be unit-tested with fakes — no real network fetch or Electron `app` required. Production
// callers rely on the defaults below.
export interface MessageInstallerDeps {
  source: MessageSource
  writeAudio: (tapeNo: string, bytes: ArrayBuffer) => Promise<string>
}

function libraryDir(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron')
  return join(app.getPath('userData'), 'library')
}

async function defaultWriteAudio(tapeNo: string, bytes: ArrayBuffer): Promise<string> {
  const dir = libraryDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${tapeNo}.m4a`)
  await writeFile(path, Buffer.from(bytes))
  return path
}

const defaultDeps: MessageInstallerDeps = {
  source: createMessageSource(),
  writeAudio: defaultWriteAudio
}

export function createMessageInstaller(
  repo: MessagesRepo,
  broadcast: MessageInstallerBroadcast,
  deps: Partial<MessageInstallerDeps> = {}
): MessageInstaller {
  const { source, writeAudio } = { ...defaultDeps, ...deps }
  let corpusInFlight = false
  const audioInFlight = new Set<string>()

  // NOT ATOMIC — TODO before slice 4a wires the real scraper into the (currently disabled,
  // unreachable in slice 4) "Install corpus" button: `repo.installIndex(index)` commits index
  // rows immediately, then each `fetchSermon`/`installSermon` happens one at a time in the
  // loop below. If the scrape fails partway (network error, bad entry, etc.), the already
  // committed index rows are left behind with no corresponding sermon content — and there is
  // no message-delete/uninstall API to clean them up, so they'd pollute the library forever.
  // Before this can be safely triggered from the UI again, make it atomic: buffer every
  // fetched sermon payload in memory first, and only after the *entire* fetchIndex +
  // fetchSermon* sequence succeeds, commit `installIndex` and all `installSermon` calls
  // together inside a single DB transaction.
  function installCorpus(): void {
    if (corpusInFlight) return
    corpusInFlight = true
    void (async () => {
      try {
        broadcast({ phase: 'downloading' })
        const index = await source.fetchIndex()
        repo.installIndex(index)
        for (let i = 0; i < index.length; i++) {
          const entry = index[i]
          broadcast({ phase: 'installing', count: i + 1, total: index.length })
          const payload = await source.fetchSermon(entry.id)
          repo.installSermon(entry.id, payload.paragraphs, payload.timing)
        }
        broadcast({ phase: 'done' })
      } catch (err) {
        broadcast({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
      } finally {
        corpusInFlight = false
      }
    })()
  }

  function downloadAudio(id: string): void {
    if (audioInFlight.has(id)) return
    audioInFlight.add(id)
    void (async () => {
      try {
        broadcast({ msgId: id, phase: 'downloading' })
        const entry = repo.list().find((m) => m.id === id)
        if (!entry) {
          throw new Error(`downloadAudio: unknown message id "${id}"`)
        }
        const url = await source.audioUrl(entry)
        const res = await fetch(url)
        if (!res.ok) {
          throw new Error(`downloadAudio: failed to fetch audio (${res.status})`)
        }
        const bytes = await res.arrayBuffer()
        const path = await writeAudio(entry.tapeNo, bytes)
        repo.setAudioPath(id, path)
        broadcast({ msgId: id, phase: 'done' })
      } catch (err) {
        broadcast({
          msgId: id,
          phase: 'error',
          error: err instanceof Error ? err.message : String(err)
        })
      } finally {
        audioInFlight.delete(id)
      }
    })()
  }

  return { installCorpus, downloadAudio }
}
