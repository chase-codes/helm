import type { UpdateStatus } from '../shared/types'

/**
 * Minimal surface of electron-updater's AppUpdater that we drive. Kept as an
 * interface so tests inject a fake and dev mode injects null (electron-updater
 * throws when the app isn't packaged).
 */
export interface UpdaterDriver {
  autoDownload: boolean
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
  on(event: string, cb: (info?: { version?: string }) => void): unknown
}

export interface Updater {
  start(): void
  status(): UpdateStatus
  install(): boolean
}

const RECHECK_MS = 4 * 60 * 60 * 1000

export function createUpdater(
  driver: UpdaterDriver | null,
  deps: {
    outputCount: () => number
    broadcast: (s: UpdateStatus) => void
    schedule?: (fn: () => void, ms: number) => void
  }
): Updater {
  const schedule = deps.schedule ?? ((fn, ms) => setInterval(fn, ms))
  let status: UpdateStatus = { state: 'idle', version: null }
  const set = (s: UpdateStatus): void => {
    status = s
    deps.broadcast(s)
  }
  const check = (): void => {
    // Failures land in the 'error' handler / rejected promise; both are
    // swallowed — an offline church machine must never notice the updater.
    void driver?.checkForUpdates().catch(() => {})
  }
  return {
    status: () => status,
    start() {
      if (!driver) return
      driver.autoDownload = true
      driver.on('update-available', (info) => set({ state: 'available', version: info?.version ?? null }))
      driver.on('update-downloaded', (info) => set({ state: 'ready', version: info?.version ?? null }))
      driver.on('error', () => set({ state: 'idle', version: null }))
      check()
      schedule(check, RECHECK_MS)
    },
    install() {
      // Restarting mid-service is the one unforgivable updater sin: refuse
      // while any output window (live or test) is up.
      if (!driver || status.state !== 'ready' || deps.outputCount() > 0) return false
      driver.quitAndInstall()
      return true
    }
  }
}
