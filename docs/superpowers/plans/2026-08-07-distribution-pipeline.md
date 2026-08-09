# Distribution Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Helm to Windows users via GitHub Releases with in-app self-update, CI-built installers on every merge, and GitHub Issues for feedback — per `docs/superpowers/specs/2026-08-07-distribution-design.md`.

**Architecture:** Public repo `chase-codes/helm`. GitHub Actions builds the NSIS installer on every main push (smoke-test artifact) and publishes a **draft** GitHub Release on `v*` tags (human publishes = ship). `electron-updater` in the app checks Releases, downloads in background, and shows a quiet restart pill that is suppressed while any output window is up.

**Tech Stack:** electron-builder 26 (already configured), electron-updater, GitHub Actions (`windows-latest` + `ubuntu-latest`), GitHub issue forms.

## Global Constraints

- Repo becomes **public** — never commit secrets, tokens, or personal data.
- Commit style per CLAUDE.md: concise conventional-commit subjects, **no** `Co-Authored-By`/`Claude-Session` trailers.
- Windows-only distribution for now; do not add mac/linux CI jobs.
- User data (`%APPDATA%/Helm`: `helm.db`, `library/`) must never be touched by install/update/uninstall — do NOT set `deleteAppDataOnUninstall`.
- Updater must never auto-restart, never show error dialogs; failures log only.
- Existing main-process code style: factory functions with injected deps (`createX(deps)`), unit tests beside the file (`x.test.ts`), vitest.
- Node 22, npm (repo has `package-lock.json`).
- This machine is macOS; anything requiring Windows (`msiexec`, installer smoke tests) runs in CI on `windows-latest` or on Chase's Windows machine (Task 10 checklist).

---

### Task 1: Git identity + public GitHub repo

**Files:**
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Produces: remote `origin` = `https://github.com/chase-codes/helm.git`, branch `main` pushed. All later tasks assume this remote exists. `gh` CLI is already authenticated as `chase-codes` with `repo`+`workflow` scopes.

- [ ] **Step 1: Confirm public git identity with Chase**

Current identity is auto-generated (`LEM <lem@LEMs-MacBook-Pro.local>`) — wrong for public commits. Ask Chase (AskUserQuestion) which name/email to use. Offer: `chasewilsonmedia@gmail.com` vs the no-spam alias `chase-codes@users.noreply.github.com`; name suggestion "Chase". Then:

```bash
git config --global user.name "<chosen name>"
git config --global user.email "<chosen email>"
```

- [ ] **Step 2: Ignore session scratch, commit stray docs**

Append to `.gitignore`:

```
# Agent/session scratch — never ship
scratch/
```

```bash
git add .gitignore docs/superpowers/notes/
git commit -m "chore: ignore scratch/, commit outstanding session notes"
```

- [ ] **Step 3: Pre-publication secret scan**

```bash
git log --all -p | grep -inE '(api[_-]?key|secret|token|password)\s*[:=]' | grep -v -e 'GH_TOKEN' -e 'GITHUB_TOKEN' | head -30
```

Expected: no real credentials (test fixtures / variable names are fine — read anything that matches). If a real secret appears, STOP and tell Chase; history rewrite is a human decision.

- [ ] **Step 4: Create the public repo and push**

```bash
gh repo create chase-codes/helm --public --source=. --remote=origin \
  --description "Church presentation app — run the whole service from one seat." --push
git ls-remote origin main   # verify push landed
```

- [ ] **Step 5: Confirm on GitHub**

Run: `gh repo view chase-codes/helm --json name,visibility,defaultBranchRef`
Expected: `"visibility": "PUBLIC"`, default branch `main`.

---

### Task 2: Issue templates + README download section

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Modify: `README.md`

**Interfaces:**
- Produces: issue form `bug_report.yml` with field ids `version` and `os` — Task 7's prefill URL (`?template=bug_report.yml&version=...&os=...`) depends on these exact ids.

- [ ] **Step 1: Write the three template files**

`.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
name: Bug report
description: Something in Helm isn't working right
labels: [bug]
body:
  - type: input
    id: version
    attributes:
      label: Helm version
      description: Shown in Help → Report a Problem, or the installer filename
    validations:
      required: false
  - type: input
    id: os
    attributes:
      label: Windows version
    validations:
      required: false
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: What did you expect, and what happened instead?
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. Open the Songs tab
        2. ...
    validations:
      required: false
```

`.github/ISSUE_TEMPLATE/feature_request.yml`:

```yaml
name: Feature request
description: Something Helm should do
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: What are you trying to do?
      description: The situation during a service (or prep) where Helm falls short.
    validations:
      required: true
  - type: textarea
    id: idea
    attributes:
      label: What would help?
    validations:
      required: false
```

`.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
```

- [ ] **Step 2: Add Download section to README.md**

Add near the top (after the title/intro), adjusting to the README's existing tone:

```markdown
## Download (Windows)

**[Download Helm](https://github.com/chase-codes/helm/releases/latest/download/Helm-Setup.exe)** — installs per-user, no admin needed, and updates itself.

> **Note:** Until Helm's code-signing certificate is in place, Windows SmartScreen
> will show "Windows protected your PC" on first run. Click **More info → Run
> anyway**. This is expected for new unsigned apps and will go away in a future
> release.
```

(The link 404s until the first release exists — Task 9 makes it live.)

- [ ] **Step 3: Commit and push**

```bash
git add .github README.md
git commit -m "docs: issue templates and Windows download section"
git push
```

- [ ] **Step 4: Verify forms render**

Run: `gh api repos/chase-codes/helm/contents/.github/ISSUE_TEMPLATE --jq '.[].name'`
Expected: the three files. Then open `https://github.com/chase-codes/helm/issues/new/choose` (or `gh issue create --web`) and confirm both forms are listed and blank issues are disabled.

---

### Task 3: CI workflow — checks + installer artifact on every merge

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/fetch-bibles.mjs` (exists; writes `resources/bibles/kjv.json`, which is gitignored).
- Produces: workflow `CI` with jobs `checks` and `installer`; `installer` uploads artifact `helm-setup` containing `dist/Helm-Setup.exe`… **until Task 4 renames the artifact, the exe is `helm-0.1.0-setup.exe`, so glob `dist/*-setup.exe` / `dist/Helm-Setup.exe` — use the glob below which matches both.**

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test

  installer:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Cache bundled bibles
        id: bibles
        uses: actions/cache@v4
        with:
          path: resources/bibles
          key: bibles-${{ hashFiles('scripts/fetch-bibles.mjs') }}
      - name: Fetch bundled bibles
        if: steps.bibles.outputs.cache-hit != 'true'
        run: node scripts/fetch-bibles.mjs
      - run: npm run build
      - run: npx electron-builder --win --publish never
      - uses: actions/upload-artifact@v4
        with:
          name: helm-setup
          path: |
            dist/*-setup.exe
            dist/*Setup.exe
          retention-days: 14
```

Notes for the implementer: `npm ci` triggers the `postinstall` (`electron-builder install-app-deps`), which handles the `better-sqlite3` native rebuild on the Windows runner. `npmRebuild: false` in `electron-builder.yml` is intentional — leave it.

- [ ] **Step 2: Commit, push, watch the run**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: checks + Windows installer artifact on every merge"
git push
gh run watch --exit-status "$(gh run list --workflow CI --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: both jobs green. If `installer` fails, read the log (`gh run view --log-failed`), fix, push again — common first-run issues are electron-builder cache/download flakes (retry) and the bibles fetch (getbible.net hiccup → re-run).

- [ ] **Step 3: Verify the artifact exists**

Run: `gh run view "$(gh run list --workflow CI --limit 1 --json databaseId --jq '.[0].databaseId')" --json jobs | grep -i artifact` or `gh api repos/chase-codes/helm/actions/artifacts --jq '.artifacts[0].name'`
Expected: `helm-setup`.

---

### Task 4: electron-builder publish config, stable artifact name, electron-updater dep

**Files:**
- Modify: `electron-builder.yml`
- Modify: `package.json` / `package-lock.json` (new dependency)

**Interfaces:**
- Produces: `electron-updater` available as a runtime dependency (Task 5 imports `{ autoUpdater }` from it). Installer artifact now named `Helm-Setup.exe` (README evergreen link + Task 3's upload glob already match).

- [ ] **Step 1: Add publish config and stable artifact name**

In `electron-builder.yml`, replace the `nsis.artifactName` line and add a top-level `publish` block:

```yaml
nsis:
  artifactName: Helm-Setup.${ext}
  shortcutName: ${productName}
  uninstallDisplayName: ${productName}
  createDesktopShortcut: always
```

```yaml
publish:
  provider: github
  owner: chase-codes
  repo: helm
  releaseType: draft
```

- [ ] **Step 2: Install electron-updater**

```bash
npm install electron-updater
```

(Runtime dependency — it must ship in the app, not devDependencies.)

- [ ] **Step 3: Verify the app still builds**

Run: `npm run build`
Expected: clean typecheck + build.

- [ ] **Step 4: Commit and push**

```bash
git add electron-builder.yml package.json package-lock.json
git commit -m "feat(dist): GitHub Releases publish config, stable Helm-Setup.exe name, electron-updater"
git push
```

---

### Task 5: Updater module in main process (TDD)

**Files:**
- Create: `src/main/updater.ts`
- Test: `src/main/updater.test.ts`
- Modify: `src/shared/types.ts` (CH channels, `UpdateStatus`, `HelmApi.updates`)
- Modify: `src/main/ipc.ts` (two handlers, new `updater` param)
- Modify: `src/main/index.ts` (wire real `autoUpdater`)
- Modify: `src/preload/index.ts` (`updates` api)

**Interfaces:**
- Consumes: `presentation.outputCount(): number` from `src/main/stateStore.ts` (exists).
- Produces (Task 6 renderer depends on these exact names):
  - `src/shared/types.ts`: `type UpdateState = 'idle' | 'available' | 'ready'`; `interface UpdateStatus { state: UpdateState; version: string | null }`; CH entries `updatesGetStatus: 'updates:getStatus'`, `updatesInstall: 'updates:install'`, `updatesStatus: 'updates:status'`; `HelmApi.updates: { getStatus(): Promise<UpdateStatus>; install(): Promise<boolean>; onStatus(cb: (s: UpdateStatus) => void): () => void }`.
  - `createUpdater(driver: UpdaterDriver | null, deps): Updater` where `Updater = { start(): void; status(): UpdateStatus; install(): boolean }`. `install()` returns `false` when refused (output up / not ready).

- [ ] **Step 1: Add shared types and channels**

In `src/shared/types.ts`: add to the `CH` map (matching its existing `domain:action` naming):

```ts
updatesGetStatus: 'updates:getStatus',
updatesInstall: 'updates:install',
updatesStatus: 'updates:status',          // main → all windows
```

And the types + `HelmApi` section:

```ts
export type UpdateState = 'idle' | 'available' | 'ready'
export interface UpdateStatus { state: UpdateState; version: string | null }
```

```ts
updates: {
  getStatus(): Promise<UpdateStatus>;
  install(): Promise<boolean>;
  onStatus(cb: (s: UpdateStatus) => void): () => void;
};
```

- [ ] **Step 2: Write the failing tests**

`src/main/updater.test.ts` — a fake driver, following the repo's fake-deps test style:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createUpdater, type UpdaterDriver } from './updater'

type Handler = (info?: { version?: string }) => void

function fakeDriver(): UpdaterDriver & { emit: (ev: string, info?: { version?: string }) => void } {
  const handlers = new Map<string, Handler[]>()
  return {
    autoDownload: false,
    checkForUpdates: vi.fn(() => Promise.resolve(undefined)),
    quitAndInstall: vi.fn(),
    on(ev: string, cb: Handler) {
      handlers.set(ev, [...(handlers.get(ev) ?? []), cb])
      return this
    },
    emit(ev: string, info?: { version?: string }) {
      for (const h of handlers.get(ev) ?? []) h(info)
    }
  }
}

describe('createUpdater', () => {
  it('starts idle, checks on start, and reports ready after update-downloaded', () => {
    const driver = fakeDriver()
    const statuses: unknown[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    expect(u.status()).toEqual({ state: 'idle', version: null })
    u.start()
    expect(driver.autoDownload).toBe(true)
    expect(driver.checkForUpdates).toHaveBeenCalled()
    driver.emit('update-available', { version: '0.2.0' })
    expect(u.status()).toEqual({ state: 'available', version: '0.2.0' })
    driver.emit('update-downloaded', { version: '0.2.0' })
    expect(u.status()).toEqual({ state: 'ready', version: '0.2.0' })
    expect(statuses).toEqual([
      { state: 'available', version: '0.2.0' },
      { state: 'ready', version: '0.2.0' }
    ])
  })

  it('install() refuses while any output window is up', () => {
    const driver = fakeDriver()
    let outputs = 1
    const u = createUpdater(driver, { outputCount: () => outputs, broadcast: () => {}, schedule: () => {} })
    u.start()
    driver.emit('update-downloaded', { version: '0.2.0' })
    expect(u.install()).toBe(false)
    expect(driver.quitAndInstall).not.toHaveBeenCalled()
    outputs = 0
    expect(u.install()).toBe(true)
    expect(driver.quitAndInstall).toHaveBeenCalled()
  })

  it('install() refuses when no update is ready', () => {
    const driver = fakeDriver()
    const u = createUpdater(driver, { outputCount: () => 0, broadcast: () => {}, schedule: () => {} })
    u.start()
    expect(u.install()).toBe(false)
    expect(driver.quitAndInstall).not.toHaveBeenCalled()
  })

  it('errors reset to idle without throwing, and rechecks are scheduled', () => {
    const driver = fakeDriver()
    let tick: (() => void) | null = null
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: () => {},
      schedule: (fn) => { tick = fn }
    })
    u.start()
    driver.emit('update-available', { version: '0.2.0' })
    driver.emit('error')
    expect(u.status()).toEqual({ state: 'idle', version: null })
    tick!()
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('null driver (dev mode) is a no-op', () => {
    const u = createUpdater(null, { outputCount: () => 0, broadcast: () => {}, schedule: () => {} })
    u.start()
    expect(u.status()).toEqual({ state: 'idle', version: null })
    expect(u.install()).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/main/updater.test.ts`
Expected: FAIL — `./updater` doesn't exist.

- [ ] **Step 4: Implement `src/main/updater.ts`**

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/updater.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Wire IPC, preload, and index.ts**

`src/main/ipc.ts` — add `updater: Updater` as the last parameter of `registerIpc` (import `type { Updater } from './updater'`), and register:

```ts
ipcMain.handle(CH.updatesGetStatus, () => updater.status());
ipcMain.handle(CH.updatesInstall, () => updater.install());
```

`src/preload/index.ts` — add to the `api` object:

```ts
updates: {
  getStatus: () => ipcRenderer.invoke(CH.updatesGetStatus),
  install: () => ipcRenderer.invoke(CH.updatesInstall),
  onStatus: sub(CH.updatesStatus),
},
```

`src/main/index.ts` — inside `app.whenReady().then(() => { ... })`, after `registerIpc(...)` gains the new argument:

```ts
import { autoUpdater } from 'electron-updater'
import { createUpdater } from './updater'
import type { UpdateStatus } from '../shared/types'
```

```ts
const broadcastUpdateStatus = (s: UpdateStatus): void => {
  for (const w of BrowserWindow.getAllWindows())
    if (!w.isDestroyed()) w.webContents.send(CH.updatesStatus, s)
}
// electron-updater throws on unpacked builds — dev gets the no-op null driver.
const updater = createUpdater(app.isPackaged ? autoUpdater : null, {
  outputCount: () => presentation.outputCount(),
  broadcast: broadcastUpdateStatus
})
```

Pass `updater` to `registerIpc(...)`, then call `updater.start()` after `createWindow()`.

- [ ] **Step 7: Full check + commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green.

```bash
git add src/main/updater.ts src/main/updater.test.ts src/main/ipc.ts src/main/index.ts src/preload/index.ts src/shared/types.ts
git commit -m "feat(update): background self-update with live-output guard"
git push
```

---

### Task 6: Renderer update pill

**Files:**
- Create: `src/renderer/operator/UpdatePill.tsx`
- Test: `src/renderer/operator/UpdatePill.test.tsx`
- Modify: `src/renderer/operator/Header.tsx` (mount the pill)

**Interfaces:**
- Consumes: `window.helm.updates` (Task 5) and `window.helm.displays.get()/onStatus` (`DisplayStatus = { outputs: number; displays: DisplayInfo[] }`, exists).

- [ ] **Step 1: Read the neighbors first**

Read `src/renderer/operator/Header.tsx`, `DisplaysSettings.test.tsx` (for the established `window.helm` mocking pattern), and `global.css` (for pill/button styling conventions). Match them.

- [ ] **Step 2: Write the failing test**

`src/renderer/operator/UpdatePill.test.tsx` — follow the repo's existing mock pattern (adjust the `window.helm` stub setup to match how `DisplaysSettings.test.tsx` does it):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { UpdatePill } from './UpdatePill'
import type { UpdateStatus } from '../../shared/types'

let updateCb: (s: UpdateStatus) => void = () => {}
let displaysCb: (d: { outputs: number; displays: [] }) => void = () => {}

beforeEach(() => {
  // Match the window.helm stubbing approach used by DisplaysSettings.test.tsx;
  // the parts UpdatePill needs:
  window.helm = {
    ...window.helm,
    updates: {
      getStatus: vi.fn(() => Promise.resolve({ state: 'idle', version: null })),
      install: vi.fn(() => Promise.resolve(true)),
      onStatus: vi.fn((cb) => { updateCb = cb; return () => {} })
    },
    displays: {
      ...(window.helm?.displays ?? {}),
      get: vi.fn(() => Promise.resolve({ outputs: 0, displays: [] })),
      onStatus: vi.fn((cb) => { displaysCb = cb; return () => {} })
    }
  } as never
})

describe('UpdatePill', () => {
  it('renders nothing until an update is ready', async () => {
    const { container } = render(<UpdatePill />)
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the pill when ready and installs on click', async () => {
    render(<UpdatePill />)
    await act(async () => updateCb({ state: 'ready', version: '0.2.0' }))
    const btn = screen.getByRole('button', { name: /update ready/i })
    btn.click()
    expect(window.helm.updates.install).toHaveBeenCalled()
  })

  it('hides while any output window is up', async () => {
    render(<UpdatePill />)
    await act(async () => {
      updateCb({ state: 'ready', version: '0.2.0' })
      displaysCb({ outputs: 1, displays: [] })
    })
    expect(screen.queryByRole('button')).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/renderer/operator/UpdatePill.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `UpdatePill.tsx`**

```tsx
import { useEffect, useState, type JSX } from 'react'
import type { UpdateStatus } from '../../shared/types'

/**
 * Quiet "restart when you like" affordance. Deliberately invisible unless an
 * update is downloaded AND no output window is up — the operator must never
 * see update chrome mid-service.
 */
export function UpdatePill(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle', version: null })
  const [outputs, setOutputs] = useState(0)
  useEffect(() => {
    void window.helm.updates.getStatus().then(setStatus)
    return window.helm.updates.onStatus(setStatus)
  }, [])
  useEffect(() => {
    void window.helm.displays.get().then((d) => setOutputs(d.outputs))
    return window.helm.displays.onStatus((d) => setOutputs(d.outputs))
  }, [])
  if (status.state !== 'ready' || outputs > 0) return null
  return (
    <button
      className="update-pill"
      title={`Helm ${status.version ?? ''} downloaded — restarts the app`}
      onClick={() => void window.helm.updates.install()}
    >
      Update ready — restart to apply
    </button>
  )
}
```

Style `.update-pill` in `global.css` to match existing subdued chrome (small, muted accent, no animation). Mount it in `Header.tsx` on the right side, near where Settings is opened.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/UpdatePill.test.tsx`
Expected: PASS. Then `npm test` for the full suite.

- [ ] **Step 6: Eyeball it in dev**

Dev mode has a null driver so the pill stays hidden; temporarily verify layout by rendering it with a hardcoded ready state (then revert), or trust the test. Do not commit any temporary hack.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/operator/UpdatePill.tsx src/renderer/operator/UpdatePill.test.tsx src/renderer/operator/Header.tsx src/renderer/operator/global.css
git commit -m "feat(update): restart pill in header, hidden while outputs are up"
git push
```

---

### Task 7: Help menu → Report a Problem

**Files:**
- Create: `src/main/feedback.ts`
- Test: `src/main/feedback.test.ts`
- Modify: `src/main/index.ts` (`buildMenu()`)

**Interfaces:**
- Consumes: issue form field ids `version`, `os` from Task 2.
- Produces: `reportProblemUrl(version: string, os: string): string`.

- [ ] **Step 1: Write the failing test**

`src/main/feedback.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reportProblemUrl } from './feedback'

describe('reportProblemUrl', () => {
  it('prefills the bug-report form with version and OS', () => {
    const url = new URL(reportProblemUrl('0.2.0', 'Windows 11 (10.0.26100)'))
    expect(url.origin + url.pathname).toBe('https://github.com/chase-codes/helm/issues/new')
    expect(url.searchParams.get('template')).toBe('bug_report.yml')
    expect(url.searchParams.get('version')).toBe('0.2.0')
    expect(url.searchParams.get('os')).toBe('Windows 11 (10.0.26100)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/feedback.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/main/feedback.ts`**

```ts
const REPO_ISSUES = 'https://github.com/chase-codes/helm/issues/new'

export function reportProblemUrl(version: string, os: string): string {
  const params = new URLSearchParams({ template: 'bug_report.yml', version, os })
  return `${REPO_ISSUES}?${params}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/feedback.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Help menu**

In `src/main/index.ts` `buildMenu()`, append to the template array:

```ts
{
  label: 'Help',
  submenu: [
    {
      label: 'Report a Problem…',
      click: () =>
        shell.openExternal(reportProblemUrl(app.getVersion(), `Windows (${os.release()})`))
    }
  ]
}
```

Imports: `reportProblemUrl` from `./feedback`, `import os from 'node:os'` (`shell` and `app` are already imported).

- [ ] **Step 6: Full check + commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: green.

```bash
git add src/main/feedback.ts src/main/feedback.test.ts src/main/index.ts
git commit -m "feat(help): Report a Problem menu opens prefilled GitHub issue"
git push
```

---

### Task 8: Release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `publish` config from Task 4 (`releaseType: draft`).
- Produces: pushing a `v*` tag creates a **draft** GitHub Release containing `Helm-Setup.exe`, `latest.yml`, and the `.blockmap`.

- [ ] **Step 1: Write `.github/workflows/release.yml`**

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: windows-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - name: Verify tag matches package.json version
        shell: bash
        run: |
          TAG="${GITHUB_REF_NAME#v}"
          PKG="$(node -p "require('./package.json').version")"
          if [ "$TAG" != "$PKG" ]; then
            echo "Tag v$TAG does not match package.json version $PKG" >&2
            exit 1
          fi
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - name: Cache bundled bibles
        id: bibles
        uses: actions/cache@v4
        with:
          path: resources/bibles
          key: bibles-${{ hashFiles('scripts/fetch-bibles.mjs') }}
      - name: Fetch bundled bibles
        if: steps.bibles.outputs.cache-hit != 'true'
        run: node scripts/fetch-bibles.mjs
      - run: npm run build
      - name: Build installer and publish draft release
        run: npx electron-builder --win --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/release.yml
git commit -m "ci: draft GitHub Release on v* tags"
git push
```

(No tag yet — Task 9 exercises this workflow end-to-end.)

- [ ] **Step 3: Sanity-check workflow syntax**

Run: `gh workflow list`
Expected: `Release` appears (state may show as never-run; that's fine).

---

### Task 9: Cut v0.2.0 — first real release

**Files:**
- Modify: `package.json` (version bump via `npm version`)

**Interfaces:**
- Consumes: everything above.
- Produces: published GitHub Release `v0.2.0` whose assets make the README evergreen link live, and which installed apps will update to in Task 10.

- [ ] **Step 1: Confirm main is green**

Run: `gh run list --workflow CI --limit 1 --json conclusion --jq '.[0].conclusion'`
Expected: `success`. Fix first if not.

- [ ] **Step 2: Bump version and tag**

```bash
npm version minor -m "release: v%s"
git push --follow-tags
```

Expected: `package.json` at `0.2.0`, tag `v0.2.0` pushed.

- [ ] **Step 3: Watch the release workflow**

```bash
gh run watch --exit-status "$(gh run list --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: green. Then `gh release list` shows `v0.2.0` as **Draft**.

- [ ] **Step 4: Verify draft assets**

Run: `gh release view v0.2.0 --json assets --jq '.assets[].name'`
Expected: `Helm-Setup.exe`, `Helm-Setup.exe.blockmap`, `latest.yml`. If `latest.yml` is missing, the updater cannot work — debug before proceeding (usually a publish-config problem from Task 4).

- [ ] **Step 5: Hand the Publish button to Chase**

Tell Chase: draft `v0.2.0` is ready at `gh release view v0.2.0 --web`. He writes/edits notes and clicks **Publish release**. Publishing is the ship moment — after it, the README link is live. Do not publish it yourself unless he says to.

---

### Task 10: Windows verification checklist (human, with Chase)

**Files:** none — this is a guided verification pass on a real Windows machine.

- [ ] **Step 1: Give Chase this checklist for his Windows machine**

```
INSTALL
1. Download from https://github.com/chase-codes/helm/releases/latest/download/Helm-Setup.exe
2. SmartScreen appears (expected while unsigned): More info → Run anyway.
3. Installer runs per-user (no admin prompt), app launches.
4. Add a song, import an image or two — create real user data.

UPDATE (needs a second release)
5. On the Mac: make a trivial visible change, then
   `npm version patch -m "release: v%s" && git push --follow-tags`,
   publish the draft when green.
6. On Windows: relaunch Helm (or wait ≤4h). Within a minute or two of launch,
   the "Update ready — restart to apply" pill appears in the header.
7. Open a Test Output window → pill disappears. Close it → pill returns.
8. Click the pill: app restarts into the new version.
9. VERIFY PERSISTENCE: the song and imported media from step 4 are still there.
10. Help → Report a Problem opens a GitHub issue form with version prefilled.
```

- [ ] **Step 2: File whatever breaks**

Anything that fails becomes a GitHub issue (the templates exist now) and gets fixed before the LibreOffice task — the core pipeline must be trustworthy first.

- [ ] Windows box, NO LibreOffice installed: install Helm-Setup.exe, import a `.pptx`,
      slides render on the projector (bundled-soffice leg).
- [ ] Mac (arm64), browser-downloaded DMG: right-click-open Helm, import a `.pptx`.
      If macOS blocks the bundled soffice (quarantine on first spawn), record the exact
      dialog and apply the spec's fallback (ad-hoc sign the tree at vendor time, or
      documented `xattr -dr com.apple.quarantine` guidance) as a follow-up fix.

---

### Task 11: LibreOffice vendoring — PPTX import in shipped builds

> **Superseded 2026-08-08** by `docs/superpowers/plans/2026-08-08-bundled-libreoffice.md`
> (adds the macOS arm64 leg; same Windows approach). Tracked and executed there.

**Files:**
- Create: `scripts/vendor-libreoffice.mjs`
- Modify: `.github/workflows/ci.yml` (cache + vendor step in `installer` job, plus a `workflow_dispatch` trigger for iterating)
- Modify: `.github/workflows/release.yml` (cache + vendor step before `npm run build`)

**Interfaces:**
- Consumes: `mediaImport.ts` probes `<resources>/libreoffice/program/soffice.exe` (Windows) — the staged tree must have exactly that shape. `electron-builder.yml` already has the `extraResources` entry mapping `resources/libreoffice → libreoffice`.
- Produces: `node scripts/vendor-libreoffice.mjs` stages a pruned LibreOffice at `resources/libreoffice/` (Windows-only script; exits 0 with a notice on non-Windows so local mac builds keep working).

**Note:** This script can only run on Windows (`msiexec`). Iterate via CI: add `workflow_dispatch:` to `ci.yml`'s `on:` block and push to a branch, triggering runs with `gh workflow run CI --ref <branch>`.

- [ ] **Step 1: Pin a LibreOffice version and record its SHA-256**

Fetch the current *still* (stable) branch version from https://download.documentfoundation.org/libreoffice/stable/ — pick the older of the two listed lines (the "still" line, more conservative). Download URL shape:
`https://download.documentfoundation.org/libreoffice/stable/<V>/win/x86_64/LibreOffice_<V>_Win_x86-64.msi` and its published hash at the same path + `.sha256`. Record both as constants.

- [ ] **Step 2: Write `scripts/vendor-libreoffice.mjs`**

Structure (real code, adjusted to what Step 1 pinned):

```js
// Stages a pruned, headless-capable LibreOffice at resources/libreoffice for
// electron-builder's extraResources. Windows-only (msiexec); CI runs this.
// The app probes resources/libreoffice/program/soffice.exe (mediaImport.ts).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, cpSync, writeFileSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = 'X.Y.Z'        // pinned in Step 1
const SHA256 = '...'           // pinned in Step 1
const URL = `https://download.documentfoundation.org/libreoffice/stable/${VERSION}/win/x86_64/LibreOffice_${VERSION}_Win_x86-64.msi`

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(root, 'resources', 'libreoffice')
const work = path.join(root, 'dist', 'lo-vendor')

if (process.platform !== 'win32') {
  console.log('vendor-libreoffice: Windows-only, skipping (PPTX import will use system LibreOffice if present).')
  process.exit(0)
}
if (existsSync(path.join(dest, 'program', 'soffice.exe'))) {
  console.log('vendor-libreoffice: already staged, skipping.')
  process.exit(0)
}

// 1. Download + verify
mkdirSync(work, { recursive: true })
const msi = path.join(work, `libreoffice-${VERSION}.msi`)
if (!existsSync(msi)) {
  console.log(`Downloading ${URL} ...`)
  const res = await fetch(URL)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  writeFileSync(msi, Buffer.from(await res.arrayBuffer()))
}
const hash = createHash('sha256').update(readFileSync(msi)).digest('hex')
if (hash !== SHA256) throw new Error(`SHA256 mismatch: got ${hash}`)

// 2. Administrative extract (no install, no admin rights needed)
const extract = path.join(work, 'extract')
rmSync(extract, { recursive: true, force: true })
execFileSync('msiexec', ['/a', msi, '/qn', `TARGETDIR=${extract}`], { stdio: 'inherit' })

// 3. Locate the program tree (admin extracts nest under a product folder —
//    find the dir containing program/soffice.exe rather than hardcoding).
async function findTree(dir) {
  if (existsSync(path.join(dir, 'program', 'soffice.exe'))) return dir
  for (const e of await readdir(dir, { withFileTypes: true }))
    if (e.isDirectory()) {
      const hit = await findTree(path.join(dir, e.name))
      if (hit) return hit
    }
  return null
}
const tree = await findTree(extract)
if (!tree) throw new Error('program/soffice.exe not found in extracted MSI')

// 4. Prune GUI-only payload. Conservative: filters/libs stay, docs/media go.
//    Extend this list only after the CI convert-check still passes.
for (const rel of ['help', 'readmes', path.join('share', 'gallery'), path.join('share', 'template'), path.join('share', 'wizards'), path.join('share', 'Scripts'), path.join('program', 'wizards')]) {
  rmSync(path.join(tree, rel), { recursive: true, force: true })
}

// 5. Stage + smoke-test: headless convert must actually work post-prune.
rmSync(dest, { recursive: true, force: true })
cpSync(tree, dest, { recursive: true })
const probe = path.join(work, 'probe.txt')
writeFileSync(probe, 'helm vendor smoke test')
execFileSync(path.join(dest, 'program', 'soffice.exe'),
  ['--headless', '--convert-to', 'pdf', '--outdir', work, probe], { stdio: 'inherit' })
if (!existsSync(path.join(work, 'probe.pdf'))) throw new Error('headless convert produced no PDF')
// Impress must survive the prune — PPTX conversion is the whole point.
if (!existsSync(path.join(dest, 'program', 'sdlo.dll'))) {
  throw new Error('Impress library (sdlo.dll) missing after prune — check prune list')
}
console.log('vendor-libreoffice: staged OK')
```

Implementation notes: the `sdlo.dll` filename must be confirmed against the actual extract in CI logs (list `program/*.dll` on first run and pin the real Impress lib name if it differs). Print the final staged size; target under ~350 MB unpruned, prune further only with the smoke test green.

- [ ] **Step 3: Wire into CI and iterate until green**

In `ci.yml`: add `workflow_dispatch:` under `on:`, and in the `installer` job before `npm run build`:

```yaml
      - name: Cache vendored LibreOffice
        uses: actions/cache@v4
        with:
          path: resources/libreoffice
          key: libreoffice-${{ hashFiles('scripts/vendor-libreoffice.mjs') }}
      - name: Vendor LibreOffice
        run: node scripts/vendor-libreoffice.mjs
```

Push on a branch; run with `gh workflow run CI --ref <branch>`; read logs with `gh run view --log-failed`. Iterate on the script (extract layout, prune list, dll name) until the job is green twice (second run proves the cache path too).

- [ ] **Step 4: Wire the same two steps into `release.yml`** (same YAML, before `npm run build`).

- [ ] **Step 5: Merge and commit**

```bash
git add scripts/vendor-libreoffice.mjs .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "feat(dist): vendor pruned LibreOffice into Windows builds for PPTX import"
git push
```

- [ ] **Step 6: Human verification**

Next release Chase cuts (patch is fine): on the Windows machine, import a real `.pptx` through Media → it converts without the no-libreoffice modal. Note the new installer size in the release notes (it will jump by a few hundred MB).

---

## Deferred (tracked in spec, not in this plan)

- Azure Artifact Signing fast-follow (add `publisherName` + signing config when the account exists).
- Beta channel (`allowPrerelease`), macOS builds, numbered DB migrations, standalone download page.
