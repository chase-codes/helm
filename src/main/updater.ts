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
  on(
    event: string,
    cb: (info?: { version?: string; percent?: number; message?: string }) => void
  ): unknown
}

export interface Updater {
  start(): void
  status(): UpdateStatus
  check(): void
  install(): boolean
}

const RECHECK_MS = 4 * 60 * 60 * 1000

export function createUpdater(
  driver: UpdaterDriver | null,
  deps: {
    outputCount: () => number
    broadcast: (s: UpdateStatus) => void
    supported?: boolean
    schedule?: (fn: () => void, ms: number) => void
  }
): Updater {
  const schedule = deps.schedule ?? ((fn, ms) => setInterval(fn, ms))
  const supported = deps.supported ?? true
  let status: UpdateStatus = { state: 'idle', version: null }
  // Manual checks broadcast the rich states (checking/downloading/upToDate/
  // error/unsupported); background checks collapse to silent idle/available/
  // ready — an offline church machine must never notice the updater.
  let manual = false
  const set = (s: UpdateStatus): void => {
    status = s
    deps.broadcast(s)
  }
  // Terminal outcome of a manual check: broadcast it and drop back to silent.
  const settle = (s: UpdateStatus): void => {
    manual = false
    set(s)
  }
  const runCheck = (): void => {
    void driver?.checkForUpdates().catch((err: unknown) => {
      // electron-updater both rejects and emits 'error'; whichever lands first
      // settles the manual check, the other is a no-op (manual already false).
      if (manual)
        settle({
          state: 'error',
          version: null,
          message: err instanceof Error ? err.message : 'Update check failed'
        })
    })
  }
  return {
    status: () => status,
    start() {
      if (!driver) return
      driver.autoDownload = true
      driver.on('update-available', (info) =>
        // During a manual check, jump straight to downloading at 0% —
        // autoDownload means the download is already starting, and a flash of
        // 'available' would re-show the check button in the footer.
        set(
          manual
            ? { state: 'downloading', version: info?.version ?? null, percent: 0 }
            : { state: 'available', version: info?.version ?? null }
        )
      )
      driver.on('download-progress', (info) => {
        if (manual)
          set({ state: 'downloading', version: status.version, percent: info?.percent ?? 0 })
      })
      driver.on('update-not-available', () => {
        if (manual) settle({ state: 'upToDate', version: null })
      })
      driver.on('update-downloaded', (info) =>
        settle({ state: 'ready', version: info?.version ?? null })
      )
      driver.on('error', (info) => {
        if (manual)
          settle({ state: 'error', version: null, message: info?.message ?? 'Update check failed' })
        // Background failure: only walk back a stale 'available' claim. A
        // downloaded update must not be forgotten because a later poll failed,
        // and a settled manual result must not be wiped by the twin
        // event/rejection of the same failure.
        else if (status.state === 'available') set({ state: 'idle', version: null })
      })
      runCheck()
      schedule(runCheck, RECHECK_MS)
    },
    check() {
      // Unsigned macOS (and dev builds) can't apply updates — say so up front
      // rather than surfacing a misleading 404 from the missing latest-mac.yml.
      if (!supported || !driver) {
        set({ state: 'unsupported', version: null })
        return
      }
      if (status.state === 'ready') {
        set(status) // the definite answer already exists — re-broadcast it
        return
      }
      manual = true
      set({ state: 'checking', version: null })
      runCheck()
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
