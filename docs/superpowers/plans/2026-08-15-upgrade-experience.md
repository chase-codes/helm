# In-App Upgrade Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manual "Check for updates" in a Settings sidebar footer with definite answers (up to date / downloading % / ready / error / unsupported-on-macOS), while background update checks stay exactly as silent as today. Issue #62.

**Architecture:** One extended state machine. `UpdateStatus` gains manual-only states; `createUpdater` keeps an internal `manual` flag deciding whether rich states broadcast (manual check) or collapse to today's silent `idle | available | ready` (background). The manual check flows through the existing `updates:status` broadcast — no request/response channel. A new `UpdateFooter` component in the Settings sidebar is the only place rich states render; the header `UpdatePill` is untouched.

**Tech Stack:** Electron + electron-updater, React 19 inline-style components, vitest (+ jsdom / @testing-library/react for renderer tests).

**Spec:** `docs/superpowers/specs/2026-08-15-upgrade-experience-design.md`

## Global Constraints

- Branch: `upgrade-experience` (already created off `origin/main`; spec committed).
- Commit style (CLAUDE.md): concise conventional-commit subjects, **no** `Co-Authored-By` / `Claude-Session` trailers.
- Tests: `npm test` runs vitest once (`vitest run --passWithNoTests`); scope a single file with `npx vitest run <path>`. Typecheck: `npm run typecheck`. Lint: `npm run lint`.
- macOS is unsupported for in-app updates until signing lands: main passes `supported: process.platform !== 'darwin'`. A manual check on an unsupported or dev (null-driver) build reports `unsupported` **without touching the network**.
- Background checks must never broadcast `checking`, `downloading`, `upToDate`, `error`, or `unsupported`.
- Exact user-facing copy (use verbatim):
  - "Check for updates" / "Checking…" / "Downloading… {n}%" / "You’re up to date" / "Couldn’t check for updates" / "Retry" / "Restart to update"
  - "Update ready — installs once output displays are closed"
  - "In-app updates aren’t available on macOS yet." + link text "Download the latest from the Helm site" → `https://chase-codes.github.io/helm/`
- The header `UpdatePill.tsx` must not change behavior (renders only on `ready` with zero outputs).

---

### Task 1: Updater state machine (shared types + main updater)

**Files:**
- Modify: `src/shared/types.ts:167-168` (UpdateState/UpdateStatus), `:217` (CH updates channels)
- Modify: `src/main/updater.ts`
- Test: `src/main/updater.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks rely on these exact names):
  - `UpdateState = 'idle' | 'available' | 'ready' | 'checking' | 'downloading' | 'upToDate' | 'error' | 'unsupported'`
  - `UpdateStatus { state: UpdateState; version: string | null; percent?: number; message?: string }`
  - `CH.updatesCheck === 'updates:check'`
  - `createUpdater(driver, deps)` where `deps` gains optional `supported?: boolean` (default `true`)
  - Returned `Updater` gains `check(): void` (manual check; results arrive via broadcast)

- [ ] **Step 1: Extend the shared types**

In `src/shared/types.ts` replace lines 167–168:

```ts
export type UpdateState =
  | 'idle' | 'available' | 'ready'          // background-visible
  | 'checking' | 'downloading'              // manual-only
  | 'upToDate' | 'error' | 'unsupported'    // manual-only, terminal
export interface UpdateStatus {
  state: UpdateState
  version: string | null
  percent?: number   // downloading only
  message?: string   // error only
}
```

In the `CH` object (line 217), extend the updates row:

```ts
  updatesGetStatus: 'updates:getStatus', updatesInstall: 'updates:install',
  updatesCheck: 'updates:check',
  updatesStatus: 'updates:status',           // main → all windows
```

- [ ] **Step 2: Write the failing tests**

Append to `src/main/updater.test.ts` (inside `describe('createUpdater', ...)`). Also import the status type at the top: `import type { UpdateStatus } from '../shared/types'`.

```ts
  it('manual check reports checking, downloading progress, then ready', () => {
    const driver = fakeDriver()
    const statuses: UpdateStatus[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    u.start()
    u.check()
    driver.emit('update-available', { version: '0.4.0' })
    driver.emit('download-progress', { percent: 42 })
    driver.emit('update-downloaded', { version: '0.4.0' })
    expect(statuses).toEqual([
      { state: 'checking', version: null },
      { state: 'downloading', version: '0.4.0', percent: 0 },
      { state: 'downloading', version: '0.4.0', percent: 42 },
      { state: 'ready', version: '0.4.0' }
    ])
  })

  it('background events never broadcast the manual-only states', () => {
    const driver = fakeDriver()
    const statuses: UpdateStatus[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    u.start()
    driver.emit('update-not-available')
    driver.emit('update-available', { version: '0.4.0' })
    driver.emit('download-progress', { percent: 10 })
    driver.emit('update-downloaded', { version: '0.4.0' })
    expect(statuses).toEqual([
      { state: 'available', version: '0.4.0' },
      { state: 'ready', version: '0.4.0' }
    ])
  })

  it('manual check reports up to date; a later background not-available stays silent', () => {
    const driver = fakeDriver()
    const statuses: UpdateStatus[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    u.start()
    u.check()
    driver.emit('update-not-available')
    expect(statuses).toEqual([
      { state: 'checking', version: null },
      { state: 'upToDate', version: null }
    ])
    statuses.length = 0
    driver.emit('update-not-available') // background recheck later
    expect(statuses).toEqual([])
  })

  it('manual check surfaces error events; background errors stay silent', () => {
    const driver = fakeDriver()
    const statuses: UpdateStatus[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    u.start()
    u.check()
    driver.emit('error', { message: 'offline' })
    expect(u.status()).toEqual({ state: 'error', version: null, message: 'offline' })
    statuses.length = 0
    driver.emit('error', { message: 'offline' }) // background failure later
    expect(statuses).toEqual([])
  })

  it('manual check surfaces a rejected checkForUpdates', async () => {
    const driver = fakeDriver()
    driver.checkForUpdates = vi.fn(() => Promise.reject(new Error('net down')))
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: () => {},
      schedule: () => {}
    })
    u.start() // startup check also rejects — background, must stay silent
    u.check()
    await new Promise((r) => setTimeout(r, 0))
    expect(u.status()).toEqual({ state: 'error', version: null, message: 'net down' })
  })

  it('a background error after download does not forget the ready update', () => {
    const driver = fakeDriver()
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: () => {},
      schedule: () => {}
    })
    u.start()
    driver.emit('update-downloaded', { version: '0.4.0' })
    driver.emit('error')
    expect(u.status()).toEqual({ state: 'ready', version: '0.4.0' })
  })

  it('manual check while ready re-broadcasts ready without a network hit', () => {
    const driver = fakeDriver()
    const statuses: UpdateStatus[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    u.start()
    driver.emit('update-downloaded', { version: '0.4.0' })
    statuses.length = 0
    u.check()
    expect(statuses).toEqual([{ state: 'ready', version: '0.4.0' }])
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1) // startup only
  })

  it('manual check reports unsupported on unsupported platforms and dev builds', () => {
    const driver = fakeDriver()
    const statuses: UpdateStatus[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      supported: false,
      schedule: () => {}
    })
    u.start()
    u.check()
    expect(statuses).toEqual([{ state: 'unsupported', version: null }])
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1) // startup only — manual never hits network

    const dev = createUpdater(null, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    dev.check()
    expect(statuses.at(-1)).toEqual({ state: 'unsupported', version: null })
  })
```

Also widen the fake driver's info type (both the `Handler` alias and `emit`) so `percent`/`message` compile:

```ts
type Handler = (info?: { version?: string; percent?: number; message?: string }) => void
```

and in `fakeDriver`'s return type: `{ emit: (ev: string, info?: { version?: string; percent?: number; message?: string }) => void }`.

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `npx vitest run src/main/updater.test.ts`
Expected: the new tests FAIL (`u.check is not a function`, type errors on `supported`); the 5 existing tests still pass.

- [ ] **Step 4: Implement the updater**

Replace `src/main/updater.ts` with:

```ts
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
```

Note the pre-existing test `errors reset to idle without throwing` still passes: it errors from the `available` state, which is exactly the case the background branch still resets.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/updater.test.ts`
Expected: all pass (5 existing + 8 new).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/updater.ts src/main/updater.test.ts
git commit -m "feat(updates): manual check() with rich manual-only states"
```

---

### Task 2: IPC, preload, and app version

**Files:**
- Modify: `src/shared/types.ts` (CH + HelmApi)
- Modify: `src/main/ipc.ts:1,152-153`
- Modify: `src/main/index.ts:228-231`
- Modify: `src/preload/index.ts:114-118`

**Interfaces:**
- Consumes: `CH.updatesCheck`, `Updater.check()` from Task 1.
- Produces (Task 3 relies on these):
  - `CH.appGetVersion === 'app:getVersion'`
  - `window.helm.updates.check(): Promise<void>`
  - `window.helm.app.version(): Promise<string>`

- [ ] **Step 1: Add the version channel + HelmApi typings**

In `src/shared/types.ts`, add to `CH` (next to the updates channels added in Task 1):

```ts
  appGetVersion: 'app:getVersion',
```

In the `HelmApi` interface, extend the `updates` block and add an `app` block after it:

```ts
  updates: {
    getStatus(): Promise<UpdateStatus>;
    check(): Promise<void>;
    install(): Promise<boolean>;
    onStatus(cb: (s: UpdateStatus) => void): () => void;
  };
  app: {
    version(): Promise<string>;
  };
```

- [ ] **Step 2: Register the main handlers**

In `src/main/ipc.ts` line 1, import `app`:

```ts
import { app, ipcMain } from 'electron';
```

Next to the existing updates handlers (lines 152–153):

```ts
  ipcMain.handle(CH.updatesCheck, () => updater.check());
  ipcMain.handle(CH.appGetVersion, () => app.getVersion());
```

- [ ] **Step 3: Pass the supported flag from main**

In `src/main/index.ts:228`, add `supported` to the `createUpdater` deps:

```ts
  const updater = createUpdater(app.isPackaged ? autoUpdater : null, {
    outputCount: () => presentation.outputCount(),
    broadcast: broadcastUpdateStatus,
    // Unsigned mac builds can't apply updates (no latest-mac.yml is even
    // published) — manual checks report 'unsupported' instead of a 404.
    supported: process.platform !== 'darwin'
  })
```

- [ ] **Step 4: Expose the renderer API**

In `src/preload/index.ts` (lines 114–118), extend `updates` and add `app`:

```ts
  updates: {
    getStatus: () => ipcRenderer.invoke(CH.updatesGetStatus),
    check: () => ipcRenderer.invoke(CH.updatesCheck),
    install: () => ipcRenderer.invoke(CH.updatesInstall),
    onStatus: sub(CH.updatesStatus),
  },
  app: {
    version: () => ipcRenderer.invoke(CH.appGetVersion),
  },
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run src/main`
Expected: clean typecheck, all main tests pass. (This wiring layer has no unit tests of its own, matching every other channel.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/ipc.ts src/main/index.ts src/preload/index.ts
git commit -m "feat(updates): updates:check + app:getVersion IPC"
```

---

### Task 3: UpdateFooter component

**Files:**
- Create: `src/renderer/operator/UpdateFooter.tsx`
- Test: `src/renderer/operator/UpdateFooter.test.tsx`

**Interfaces:**
- Consumes: `window.helm.updates.{getStatus,check,install,onStatus}`, `window.helm.app.version()`, `window.helm.displays.{get,onStatus}`, `UpdateStatus` type, `ThemeCtx`.
- Produces: `export function UpdateFooter(): JSX.Element` (no props) — Task 4 mounts it.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/operator/UpdateFooter.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, cleanup, act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateFooter } from './UpdateFooter'
import type { DisplayStatus, UpdateStatus } from '../../shared/types'

afterEach(cleanup)

let updateCb: (s: UpdateStatus) => void = () => {}
let displaysCb: (d: DisplayStatus) => void = () => {}

function installHelmStub(): void {
  updateCb = () => {}
  displaysCb = () => {}
  ;(window as unknown as { helm: unknown }).helm = {
    updates: {
      getStatus: vi.fn(() => Promise.resolve<UpdateStatus>({ state: 'idle', version: null })),
      check: vi.fn(() => Promise.resolve()),
      install: vi.fn(() => Promise.resolve(true)),
      onStatus: vi.fn((cb: (s: UpdateStatus) => void) => {
        updateCb = cb
        return () => {}
      })
    },
    displays: {
      get: vi.fn(() => Promise.resolve<DisplayStatus>({ outputs: 0, displays: [], released: false })),
      onStatus: vi.fn((cb: (d: DisplayStatus) => void) => {
        displaysCb = cb
        return () => {}
      })
    },
    app: {
      version: vi.fn(() => Promise.resolve('0.3.0'))
    }
  }
}

beforeEach(() => {
  installHelmStub()
})

describe('UpdateFooter', () => {
  it('shows the version and a check button when idle, and checks on click', async () => {
    render(<UpdateFooter />)
    await act(async () => {})
    expect(screen.getByText('Helm 0.3.0')).toBeTruthy()
    screen.getByRole('button', { name: 'Check for updates' }).click()
    expect(window.helm.updates.check).toHaveBeenCalled()
  })

  it('shows checking and downloading progress', async () => {
    render(<UpdateFooter />)
    await act(async () => updateCb({ state: 'checking', version: null }))
    expect(screen.getByText('Checking…')).toBeTruthy()
    await act(async () => updateCb({ state: 'downloading', version: '0.4.0', percent: 42 }))
    expect(screen.getByText('Downloading… 42%')).toBeTruthy()
  })

  it('shows up to date with the check button again', async () => {
    render(<UpdateFooter />)
    await act(async () => updateCb({ state: 'upToDate', version: null }))
    expect(screen.getByText('You’re up to date')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy()
  })

  it('shows the error with its message and a retry button', async () => {
    render(<UpdateFooter />)
    await act(async () => updateCb({ state: 'error', version: null, message: 'net down' }))
    expect(screen.getByText(/Couldn’t check for updates — net down/)).toBeTruthy()
    screen.getByRole('button', { name: 'Retry' }).click()
    expect(window.helm.updates.check).toHaveBeenCalled()
  })

  it('shows the macOS-unsupported message with the download link', async () => {
    render(<UpdateFooter />)
    await act(async () => updateCb({ state: 'unsupported', version: null }))
    expect(screen.getByText('In-app updates aren’t available on macOS yet.')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Download the latest from the Helm site' })
    expect(link.getAttribute('href')).toBe('https://chase-codes.github.io/helm/')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('offers restart when ready with no outputs up', async () => {
    render(<UpdateFooter />)
    await act(async () => updateCb({ state: 'ready', version: '0.4.0' }))
    screen.getByRole('button', { name: 'Restart to update' }).click()
    expect(window.helm.updates.install).toHaveBeenCalled()
  })

  it('explains the deferral when ready while outputs are up', async () => {
    render(<UpdateFooter />)
    await act(async () => {
      updateCb({ state: 'ready', version: '0.4.0' })
      displaysCb({ outputs: 1, displays: [], released: false })
    })
    expect(screen.getByText('Update ready — installs once output displays are closed')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/operator/UpdateFooter.test.tsx`
Expected: FAIL — module `./UpdateFooter` not found.

- [ ] **Step 3: Implement the component**

Create `src/renderer/operator/UpdateFooter.tsx`:

```tsx
import { useContext, useEffect, useState, type CSSProperties, type JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import type { UpdateStatus } from '../../shared/types'

const SITE_URL = 'https://chase-codes.github.io/helm/'

/**
 * Settings-sidebar footer: current version plus a manual "Check for updates".
 * The only surface that renders the manual-only updater states (checking /
 * downloading / upToDate / error / unsupported) — the header UpdatePill stays
 * ready-only so no update chrome ever appears mid-service. This is also where
 * the outputs-up install deferral is explained rather than hidden.
 */
export function UpdateFooter(): JSX.Element {
  const T = useContext(ThemeCtx)
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle', version: null })
  const [outputs, setOutputs] = useState(0)
  const [version, setVersion] = useState('')

  useEffect(() => {
    // A pushed onStatus event is always at least as fresh as the in-flight
    // initial fetch, so once one arrives, ignore the fetch's stale result.
    let gotPush = false
    const off = window.helm.updates.onStatus((s) => {
      gotPush = true
      setStatus(s)
    })
    void window.helm.updates.getStatus().then((s) => {
      if (!gotPush) setStatus(s)
    })
    return off
  }, [])

  useEffect(() => {
    let gotPush = false
    const off = window.helm.displays.onStatus((d) => {
      gotPush = true
      setOutputs(d.outputs)
    })
    void window.helm.displays.get().then((d) => {
      if (!gotPush) setOutputs(d.outputs)
    })
    return off
  }, [])

  useEffect(() => {
    let live = true
    void window.helm.app.version().then((v) => {
      if (live) setVersion(v)
    })
    return () => {
      live = false
    }
  }, [])

  const wrapStyle: CSSProperties = {
    marginTop: 'auto',
    paddingTop: '10px',
    borderTop: `1px solid ${T.hairline}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  }
  const versionStyle: CSSProperties = { fontSize: '11px', color: T.faint, padding: '0 12px' }
  const noteStyle: CSSProperties = {
    fontSize: '11.5px',
    color: T.dim,
    lineHeight: 1.35,
    padding: '0 12px'
  }
  const btnStyle: CSSProperties = {
    margin: '0 12px',
    height: '26px',
    borderRadius: '7px',
    background: T.panel3,
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '11.5px',
    fontWeight: 600,
    color: T.dim,
    whiteSpace: 'nowrap'
  }
  const linkStyle: CSSProperties = { ...noteStyle, color: T.accent, textDecoration: 'underline' }

  const checkBtn = (label: string): JSX.Element => (
    <button style={btnStyle} onClick={() => void window.helm.updates.check()}>
      {label}
    </button>
  )

  let body: JSX.Element
  switch (status.state) {
    case 'checking':
      body = <span style={noteStyle}>Checking…</span>
      break
    case 'downloading':
      body = <span style={noteStyle}>Downloading… {Math.round(status.percent ?? 0)}%</span>
      break
    case 'upToDate':
      body = (
        <>
          <span style={noteStyle}>You’re up to date</span>
          {checkBtn('Check for updates')}
        </>
      )
      break
    case 'error':
      body = (
        <>
          <span style={noteStyle}>
            Couldn’t check for updates{status.message ? ` — ${status.message}` : ''}
          </span>
          {checkBtn('Retry')}
        </>
      )
      break
    case 'unsupported':
      body = (
        <>
          <span style={noteStyle}>In-app updates aren’t available on macOS yet.</span>
          <a href={SITE_URL} target="_blank" rel="noreferrer" style={linkStyle}>
            Download the latest from the Helm site
          </a>
        </>
      )
      break
    case 'ready':
      body =
        outputs > 0 ? (
          <span style={noteStyle}>Update ready — installs once output displays are closed</span>
        ) : (
          <button style={btnStyle} onClick={() => void window.helm.updates.install()}>
            Restart to update
          </button>
        )
      break
    default: // idle | available — nothing manual in flight, offer the check
      body = checkBtn('Check for updates')
  }

  return (
    <div style={wrapStyle}>
      <div style={versionStyle}>{version ? `Helm ${version}` : ''}</div>
      {body}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/UpdateFooter.test.tsx`
Expected: all 8 pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/UpdateFooter.tsx src/renderer/operator/UpdateFooter.test.tsx
git commit -m "feat(updates): Settings footer with manual check UI"
```

---

### Task 4: Mount the footer in SettingsModal

**Files:**
- Modify: `src/renderer/operator/SettingsModal.tsx:456-467` (nav column render) + imports
- Test: `src/renderer/operator/SettingsModal.test.tsx` (extend helm stub + one new test)

**Interfaces:**
- Consumes: `UpdateFooter` from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Extend the SettingsModal test stub and add the failing test**

In `src/renderer/operator/SettingsModal.test.tsx`, the `beforeEach` helm stub currently has only `bibles` and `message`. Mounting `UpdateFooter` makes the modal touch `updates`, `displays`, and `app` on mount — add them to the stub object:

```ts
    updates: {
      getStatus: vi.fn().mockResolvedValue({ state: 'idle', version: null }),
      check: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(true),
      onStatus: vi.fn().mockReturnValue(() => {})
    },
    displays: {
      get: vi.fn().mockResolvedValue({ outputs: 0, displays: [], released: false }),
      onStatus: vi.fn().mockReturnValue(() => {})
    },
    app: {
      version: vi.fn().mockResolvedValue('0.3.0')
    }
```

Add a test to the existing `describe('SettingsModal nav', ...)`:

```tsx
  it('renders the update footer at the bottom of the nav', async () => {
    renderModal()
    await act(async () => {})
    expect(screen.getByText('Helm 0.3.0')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy()
  })
```

(Import `act` from `@testing-library/react` if the file doesn't already.)

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `npx vitest run src/renderer/operator/SettingsModal.test.tsx`
Expected: new test FAILS (no "Helm 0.3.0"); the existing nav test still passes.

- [ ] **Step 3: Mount the footer**

In `src/renderer/operator/SettingsModal.tsx`, import the component (with the other component imports around line 11–14):

```ts
import { UpdateFooter } from './UpdateFooter'
```

In the nav column (line 456), after the `SECTIONS.map` buttons and before the closing `</div>`:

```tsx
            <div style={navStyle}>
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  style={{ ...navItemStyle(section === s.id), gap: '8px' }}
                  onClick={() => setSection(s.id)}
                >
                  <s.Icon size={15} />
                  {s.label}
                </button>
              ))}
              <UpdateFooter />
            </div>
```

`navStyle` is already `display: flex; flexDirection: column`, and `UpdateFooter`'s wrapper uses `marginTop: 'auto'`, so the footer pins to the bottom of the sidebar.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SettingsModal.test.tsx src/renderer/operator/UpdatePill.test.tsx`
Expected: all pass (UpdatePill included, proving the header path is untouched).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/SettingsModal.tsx src/renderer/operator/SettingsModal.test.tsx
git commit -m "feat(updates): mount update footer in Settings sidebar"
```

---

### Task 5: Full verification + macOS signing follow-up issue

**Files:**
- None modified (verification + repo hygiene).

**Interfaces:** n/a.

- [ ] **Step 1: Full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: everything green. Fix anything that isn't before proceeding.

- [ ] **Step 2: File the macOS signing prerequisite issue**

The spec routes around signing but requires it to be tracked. Create it:

```bash
gh issue create \
  --title "macOS code signing + notarization (prerequisite for Mac in-app updates)" \
  --label "area:distribution" \
  --body "The mac app bundle is unsigned (\`notarize: false\`, no identity in CI), which is why:

- electron-updater cannot apply updates on macOS, so #62's in-app update flow reports 'unsupported' on Mac (the build deliberately publishes no \`latest-mac.yml\` — see \`electron-builder.yml\`)
- first open shows the Gatekeeper 'damaged, move to Trash' warning

Needs an Apple Developer ID cert + notarization wired into the release workflow. Once landed: flip \`supported\` in \`src/main/index.ts\` to include darwin, add the zip target + \`latest-mac.yml\` publishing back to \`electron-builder.yml\`, and remove the 'unsupported' copy path in \`UpdateFooter\`.

Split out of #62, where this was identified as the hard prerequisite for the macOS half."
```

- [ ] **Step 3: Manual smoke check (dev)**

Run: `npm run dev`, open Settings. Expected: footer shows `Helm <version>` and "Check for updates"; clicking it shows "In-app updates aren’t available on macOS yet." with the site link (dev = null driver → unsupported), and the link opens the browser. Close the app.

- [ ] **Step 4: Note the release-gated verification**

Windows end-to-end (background download → pill; manual check → downloading % → restart) can only be proven from a released build after merge — record this in the PR description as a post-release verification item, alongside "macOS packaged dmg shows the unsupported message".
