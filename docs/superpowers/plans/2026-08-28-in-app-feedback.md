# In-app Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A header button opens a two-field feedback dialog (problem / idea + text) that files a GitHub issue through a small proxy, falling back to a prefilled GitHub URL when the proxy isn't configured or reachable.

**Architecture:** Renderer `FeedbackModal` talks to main over two IPC calls (`feedback:context`, `feedback:send`); main owns the proxy endpoint and does the `fetch`. A shared `buildIssue()` renders identical issue title/body for the in-app fallback URL and for the Cloudflare Worker in `feedback-worker/`, which validates, rate-limits, and calls GitHub with a fine-grained PAT.

**Tech Stack:** Electron (main/preload/renderer), React inline-style components, vitest (+jsdom for renderer tests), Cloudflare Workers + wrangler + KV.

**Spec:** `docs/superpowers/specs/2026-08-28-in-app-feedback-design.md`

## Global Constraints

- Text cap: 4000 chars in the dialog; URL fallback truncates at 1500 chars with marker `… (trimmed — paste the rest below)`.
- Title: first line of text, ≤ 72 chars, prefixed `Feedback: `.
- Labels: `feedback` plus `bug` (problem) or `enhancement` (idea). The `feedback` label must be created on the repo (Task 7).
- Rate limit: 5 requests per IP per hour.
- No user-authored Helm content (lyrics, scripture, messages, paths) in context — only `version, os, arch, displays, hasBibles, hasSongs`.
- Theme tokens only (`T.*` from `ThemeCtx`); no new CSS classes; inline `CSSProperties` like siblings.
- Copy: pills are **Something's wrong** / **Something I'd like** (default: Something I'd like). Heading: **What would make Helm better?**
- Commits: short conventional subjects, no trailers (CLAUDE.md).
- Tests: never `mockClear()` behind a DOM gate; use `settleAndClear` from `src/test/mocks.ts` or `await act(async () => {})`.
- Run `npm run typecheck && npm run lint && npm test` before every commit that touches `src/`.

---

## File map

| File | Responsibility |
|---|---|
| `src/shared/feedbackIssue.ts` (new) | `FeedbackType`, `FeedbackContext`, `FeedbackSendResult`, `buildIssue()` — pure, shared by app and worker |
| `src/shared/feedbackIssue.test.ts` (new) | tests for `buildIssue` |
| `src/main/feedback.ts` | `osLabel`, `feedbackUrl` (replaces `reportProblemUrl`), `sendFeedback` (fetch to proxy) |
| `src/main/feedback.test.ts` | tests for the above |
| `src/shared/types.ts` | `CH.feedback*`, `PushPayloads[feedbackOpen]`, `HelmApi.feedback` |
| `src/preload/index.ts` | `feedback` bridge |
| `src/main/ipc.ts` | `feedback:context` + `feedback:send` handlers |
| `src/main/index.ts` | Help menu → push `feedback:open` |
| `src/main/buildEnv.d.ts` (new) + `electron.vite.config.ts` | `__FEEDBACK_ENDPOINT__`, `__FEEDBACK_CLIENT__` build-time defines |
| `src/renderer/shared/icons.tsx` | `FeedbackIcon` |
| `src/renderer/operator/Header.tsx` | third icon button |
| `src/renderer/operator/App.tsx` | `feedbackOpen` state, menu subscription, hotkey suppression |
| `src/renderer/operator/FeedbackModal.tsx` (new) + `.test.tsx` | the dialog |
| `feedback-worker/` (new) | Cloudflare Worker: `src/index.ts`, `src/validate.ts`, `src/rateLimit.ts`, tests, `wrangler.toml`, `README.md` |
| `.github/workflows/release.yml` | pass `HELM_FEEDBACK_ENDPOINT` / `HELM_FEEDBACK_CLIENT` from secrets |

---

### Task 1: Shared issue builder

**Files:**
- Create: `src/shared/feedbackIssue.ts`
- Test: `src/shared/feedbackIssue.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FeedbackType = 'bug' | 'feature'
  export interface FeedbackContext { version: string; os: string; arch: string; displays: number; hasBibles: boolean; hasSongs: boolean }
  export interface FeedbackPayload { type: FeedbackType; text: string; context: FeedbackContext }
  export type FeedbackSendResult =
    | { ok: true; number: number; url: string }
    | { ok: false; reason: 'offline' | 'rejected' | 'unconfigured' }
  export const FEEDBACK_TEXT_MAX = 4000
  export function buildIssue(p: FeedbackPayload): { title: string; body: string; labels: string[] }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/feedbackIssue.test.ts
import { describe, it, expect } from 'vitest'
import { buildIssue, type FeedbackContext } from './feedbackIssue'

const ctx: FeedbackContext = { version: '0.5.0', os: 'macOS (25.5.0)', arch: 'arm64', displays: 2, hasBibles: true, hasSongs: false }

describe('buildIssue', () => {
  it('titles from the first line, prefixed and capped at 72 chars', () => {
    const long = 'x'.repeat(100) + '\nsecond line'
    const { title } = buildIssue({ type: 'bug', text: long, context: ctx })
    expect(title.startsWith('Feedback: ')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(72)
    expect(title.endsWith('…')).toBe(true)
  })

  it('labels bugs and features differently, always with feedback', () => {
    expect(buildIssue({ type: 'bug', text: 'Slides went black', context: ctx }).labels).toEqual(['feedback', 'bug'])
    expect(buildIssue({ type: 'feature', text: 'Countdown timer', context: ctx }).labels).toEqual(['feedback', 'enhancement'])
  })

  it('renders the text then a context section with all six fields', () => {
    const { body } = buildIssue({ type: 'feature', text: 'Countdown timer\nbefore service', context: ctx })
    expect(body).toContain('Countdown timer\nbefore service')
    expect(body).toContain('### Included automatically')
    for (const s of ['0.5.0', 'macOS (25.5.0)', 'arm64', 'Displays: 2', 'Bibles installed: yes', 'Songs in library: no']) {
      expect(body).toContain(s)
    }
    expect(body.indexOf('Countdown')).toBeLessThan(body.indexOf('### Included'))
  })

  it('uses the kind as the title when text is blank-ish on line one', () => {
    expect(buildIssue({ type: 'bug', text: '   \nreal text', context: ctx }).title).toBe('Feedback: real text')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/feedbackIssue.test.ts`
Expected: FAIL — cannot find module `./feedbackIssue`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/feedbackIssue.ts
// Pure: shared by the app (fallback URL + IPC types) and feedback-worker (proxy),
// so both paths file byte-identical issues.

export type FeedbackType = 'bug' | 'feature'

export interface FeedbackContext {
  version: string
  os: string
  arch: string
  displays: number
  hasBibles: boolean
  hasSongs: boolean
}

export interface FeedbackPayload {
  type: FeedbackType
  text: string
  context: FeedbackContext
}

export type FeedbackSendResult =
  | { ok: true; number: number; url: string }
  | { ok: false; reason: 'offline' | 'rejected' | 'unconfigured' }

export const FEEDBACK_TEXT_MAX = 4000
const TITLE_MAX = 72
const TITLE_PREFIX = 'Feedback: '

export function buildIssue(p: FeedbackPayload): { title: string; body: string; labels: string[] } {
  const firstLine = p.text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? (p.type === 'bug' ? 'Problem report' : 'Idea')
  const room = TITLE_MAX - TITLE_PREFIX.length
  const title = TITLE_PREFIX + (firstLine.length > room ? firstLine.slice(0, room - 1) + '…' : firstLine)
  const c = p.context
  const body = [
    p.text.trim(),
    '',
    '### Included automatically',
    `- Version: ${c.version}`,
    `- OS: ${c.os}`,
    `- Arch: ${c.arch}`,
    `- Displays: ${c.displays}`,
    `- Bibles installed: ${c.hasBibles ? 'yes' : 'no'}`,
    `- Songs in library: ${c.hasSongs ? 'yes' : 'no'}`,
  ].join('\n')
  return { title, body, labels: ['feedback', p.type === 'bug' ? 'bug' : 'enhancement'] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/feedbackIssue.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/feedbackIssue.ts src/shared/feedbackIssue.test.ts
git commit -m "feat(feedback): shared issue builder"
```

---

### Task 2: Main-side URL fallback and proxy send

> **Post-hoc correction (2026-08-28 final-review pass):** the code and test
> snippets below prefill `feature_request.yml`'s optional `idea` field. That
> template's required field is `problem` — `feedbackUrl` now prefills `problem`
> (and also sets `title` + `labels=feedback`). See `src/main/feedback.ts` and
> `src/main/feedback.test.ts` for the shipped behavior.

**Files:**
- Modify: `src/main/feedback.ts`
- Modify: `src/main/feedback.test.ts`
- Modify: `src/main/index.ts:9` (import) and `:121-131` (menu — temporary, replaced in Task 3)

**Interfaces:**
- Consumes: `buildIssue`, `FeedbackPayload`, `FeedbackSendResult` from Task 1.
- Produces:
  ```ts
  export function osLabel(platform: NodeJS.Platform, release: string): string   // unchanged
  export function feedbackUrl(p: FeedbackPayload): string                       // replaces reportProblemUrl
  export interface SendOpts { endpoint: string; client: string; fetchFn?: typeof fetch; timeoutMs?: number }
  export function sendFeedback(p: FeedbackPayload, opts: SendOpts): Promise<FeedbackSendResult>
  ```

- [ ] **Step 1: Write the failing tests** (replace the `reportProblemUrl` describe; keep `osLabel` tests)

```ts
// src/main/feedback.test.ts — replace the reportProblemUrl block with:
import { describe, it, expect, vi } from 'vitest'
import { osLabel, feedbackUrl, sendFeedback } from './feedback'
import type { FeedbackContext } from '../shared/feedbackIssue'

const ctx: FeedbackContext = { version: '0.5.0', os: 'macOS (25.5.0)', arch: 'arm64', displays: 1, hasBibles: false, hasSongs: true }

describe('feedbackUrl', () => {
  it('prefills the bug template with version, os and what-happened', () => {
    const url = new URL(feedbackUrl({ type: 'bug', text: 'Slides went black', context: ctx }))
    expect(url.origin + url.pathname).toBe('https://github.com/chase-codes/helm/issues/new')
    expect(url.searchParams.get('template')).toBe('bug_report.yml')
    expect(url.searchParams.get('version')).toBe('0.5.0')
    expect(url.searchParams.get('os')).toBe('macOS (25.5.0)')
    expect(url.searchParams.get('what-happened')).toContain('Slides went black')
    expect(url.searchParams.get('what-happened')).toContain('### Included automatically')
  })

  it('prefills the feature template into idea', () => {
    const url = new URL(feedbackUrl({ type: 'feature', text: 'Countdown timer', context: ctx }))
    expect(url.searchParams.get('template')).toBe('feature_request.yml')
    expect(url.searchParams.get('idea')).toContain('Countdown timer')
    expect(url.searchParams.get('version')).toBeNull()
  })

  it('truncates long text with a marker to stay under URL limits', () => {
    const url = new URL(feedbackUrl({ type: 'feature', text: 'a'.repeat(3000), context: ctx }))
    const idea = url.searchParams.get('idea')!
    expect(idea).toContain('… (trimmed — paste the rest below)')
    expect(idea.indexOf('… (trimmed')).toBe(1500)
  })
})

describe('sendFeedback', () => {
  const payload = { type: 'bug' as const, text: 'Slides went black', context: ctx }

  it('returns unconfigured without fetching when endpoint is empty', async () => {
    const fetchFn = vi.fn()
    expect(await sendFeedback(payload, { endpoint: '', client: 'c', fetchFn })).toEqual({ ok: false, reason: 'unconfigured' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('posts the payload with the client header and returns the issue', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ number: 12, url: 'https://github.com/chase-codes/helm/issues/12' }), { status: 201 }))
    const r = await sendFeedback(payload, { endpoint: 'https://fb.example/v1/feedback', client: 'secret', fetchFn })
    expect(r).toEqual({ ok: true, number: 12, url: 'https://github.com/chase-codes/helm/issues/12' })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://fb.example/v1/feedback')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Helm-Client']).toBe('secret')
    expect(JSON.parse(init.body as string)).toEqual(payload)
  })

  it('maps non-2xx to rejected and thrown fetch to offline', async () => {
    const bad = vi.fn(async () => new Response('nope', { status: 429 }))
    expect(await sendFeedback(payload, { endpoint: 'https://x', client: 'c', fetchFn: bad })).toEqual({ ok: false, reason: 'rejected' })
    const down = vi.fn(async () => { throw new TypeError('fetch failed') })
    expect(await sendFeedback(payload, { endpoint: 'https://x', client: 'c', fetchFn: down })).toEqual({ ok: false, reason: 'offline' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/feedback.test.ts`
Expected: FAIL — `feedbackUrl` / `sendFeedback` not exported.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/feedback.ts (full file)
import { buildIssue, type FeedbackPayload, type FeedbackSendResult } from '../shared/feedbackIssue'

const REPO_ISSUES = 'https://github.com/chase-codes/helm/issues/new'
// GitHub's new-issue form accepts prefilled fields via query params; browsers and
// GitHub both start dropping very long GETs around 8 KB, so clip the text.
const URL_TEXT_MAX = 1500
const TRIM_MARK = '… (trimmed — paste the rest below)'

// The prefilled `os` field is the main triage signal on incoming issues — name the
// platform, don't assume it. `release` is the kernel/OS release string (os.release()).
export function osLabel(platform: NodeJS.Platform, release: string): string {
  const name =
    platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform
  return `${name} (${release})`
}

/** Fallback when the proxy is unconfigured/unreachable: the same issue, but the
 * reporter submits it on GitHub. Field ids match .github/ISSUE_TEMPLATE/*.yml. */
export function feedbackUrl(p: FeedbackPayload): string {
  const text = p.text.length > URL_TEXT_MAX ? p.text.slice(0, URL_TEXT_MAX) + TRIM_MARK : p.text
  const { body } = buildIssue({ ...p, text })
  const params =
    p.type === 'bug'
      ? new URLSearchParams({ template: 'bug_report.yml', version: p.context.version, os: p.context.os, 'what-happened': body })
      : new URLSearchParams({ template: 'feature_request.yml', idea: body })
  return `${REPO_ISSUES}?${params}`
}

export interface SendOpts {
  endpoint: string
  client: string
  fetchFn?: typeof fetch
  timeoutMs?: number
}

/** Main does the network call so the renderer never learns the endpoint. Never throws. */
export async function sendFeedback(p: FeedbackPayload, opts: SendOpts): Promise<FeedbackSendResult> {
  if (!opts.endpoint) return { ok: false, reason: 'unconfigured' }
  const fetchFn = opts.fetchFn ?? fetch
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15_000)
  try {
    const res = await fetchFn(opts.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Helm-Client': opts.client },
      body: JSON.stringify(p),
      signal: ctl.signal,
    })
    if (!res.ok) return { ok: false, reason: 'rejected' }
    const j = (await res.json()) as { number: number; url: string }
    return { ok: true, number: j.number, url: j.url }
  } catch {
    return { ok: false, reason: 'offline' }
  } finally {
    clearTimeout(timer)
  }
}
```

Then in `src/main/index.ts` change the import and the menu click so the build stays green until Task 3 replaces it:

```ts
import { osLabel, feedbackUrl } from './feedback'
// …
label: 'Report a Problem…',
click: () =>
  shell.openExternal(
    feedbackUrl({
      type: 'bug',
      text: '',
      context: { version: app.getVersion(), os: osLabel(process.platform, os.release()), arch: process.arch, displays: 0, hasBibles: false, hasSongs: false }
    })
  )
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/main/feedback.test.ts && npm run typecheck:node`
Expected: PASS (8 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/feedback.ts src/main/feedback.test.ts src/main/index.ts
git commit -m "feat(feedback): template-aware fallback URL + proxy send"
```

---

### Task 3: IPC contract, preload, handlers, menu, build-time endpoint

**Files:**
- Modify: `src/shared/types.ts` (`CH` ~line 233, `PushPayloads` ~line 238, `HelmApi` ~line 421)
- Modify: `src/preload/index.ts:128-131`
- Modify: `src/main/ipc.ts` (imports, `registerIpc` body near line 195)
- Modify: `src/main/index.ts:121-131` (menu), `:205` (registerIpc call unchanged)
- Create: `src/main/buildEnv.d.ts`
- Modify: `electron.vite.config.ts`

**Interfaces:**
- Consumes: `sendFeedback`, `osLabel` (Task 2); `buildIssue` types (Task 1); `BiblesRepo.installed()`, `SongsRepo.count()`, `screen.getAllDisplays()`.
- Produces (renderer sees):
  ```ts
  window.helm.feedback.context(): Promise<FeedbackContext>
  window.helm.feedback.send(p: FeedbackPayload): Promise<FeedbackSendResult>
  window.helm.feedback.fallbackUrl(p: FeedbackPayload): Promise<string>
  window.helm.feedback.onOpen(cb: () => void): () => void   // Help-menu push
  ```
  Globals: `__FEEDBACK_ENDPOINT__: string`, `__FEEDBACK_CLIENT__: string` (main only).

- [ ] **Step 1: Add channels and API types** in `src/shared/types.ts`

```ts
// in CH, after appGetVersion:
  feedbackContext: 'feedback:context', feedbackSend: 'feedback:send',
  feedbackFallbackUrl: 'feedback:fallbackUrl',
  feedbackOpen: 'feedback:open',             // main → operator (Help menu)

// in PushPayloads:
  [CH.feedbackOpen]: null;

// near the top, with the other shared re-exports:
export type { FeedbackContext, FeedbackPayload, FeedbackSendResult, FeedbackType } from './feedbackIssue';

// in HelmApi, after app:
  feedback: {
    context(): Promise<FeedbackContext>;
    send(p: FeedbackPayload): Promise<FeedbackSendResult>;
    fallbackUrl(p: FeedbackPayload): Promise<string>;
    onOpen(cb: (_: null) => void): () => void;
  };
```

(Add `import type { FeedbackContext, FeedbackPayload, FeedbackSendResult } from './feedbackIssue';` if the file uses `import type` rather than re-export for interface bodies.)

- [ ] **Step 2: Preload bridge** in `src/preload/index.ts`, after `app:`

```ts
  feedback: {
    context: () => ipcRenderer.invoke(CH.feedbackContext),
    send: (p) => ipcRenderer.invoke(CH.feedbackSend, p),
    fallbackUrl: (p) => ipcRenderer.invoke(CH.feedbackFallbackUrl, p),
    onOpen: sub(CH.feedbackOpen),
  },
```

- [ ] **Step 3: Build-time defines**

```ts
// src/main/buildEnv.d.ts
// Baked by electron.vite.config.ts from HELM_FEEDBACK_ENDPOINT / HELM_FEEDBACK_CLIENT.
// Empty endpoint = proxy unconfigured → dialog falls back to the GitHub URL.
declare const __FEEDBACK_ENDPOINT__: string
declare const __FEEDBACK_CLIENT__: string
```

```ts
// electron.vite.config.ts — main section becomes:
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __FEEDBACK_ENDPOINT__: JSON.stringify(process.env.HELM_FEEDBACK_ENDPOINT ?? ''),
      __FEEDBACK_CLIENT__: JSON.stringify(process.env.HELM_FEEDBACK_CLIENT ?? ''),
    },
  },
```

- [ ] **Step 4: Handlers** in `src/main/ipc.ts`

Add imports:
```ts
import { app, ipcMain, screen } from 'electron';
import os from 'node:os';
import { feedbackUrl, osLabel, sendFeedback } from './feedback';
```
After the `appGetVersion` handler:
```ts
  const feedbackContext = (): FeedbackContext => ({
    version: app.getVersion(),
    os: osLabel(process.platform, os.release()),
    arch: process.arch,
    displays: screen.getAllDisplays().length,
    hasBibles: biblesRepo.installed().length > 0,
    hasSongs: repo.count() > 0,
  });
  handleApi<HelmApi['feedback']['context']>(CH.feedbackContext, feedbackContext);
  handleApi<HelmApi['feedback']['send']>(CH.feedbackSend, (p) =>
    sendFeedback(p, { endpoint: __FEEDBACK_ENDPOINT__, client: __FEEDBACK_CLIENT__ }),
  );
  handleApi<HelmApi['feedback']['fallbackUrl']>(CH.feedbackFallbackUrl, (p) => feedbackUrl(p));
```
(`import type { FeedbackContext } from '../shared/types'`.) `repo` and `biblesRepo` are already destructured from `deps`.

- [ ] **Step 5: Menu → push** in `src/main/index.ts`

Replace the Help submenu item and drop the now-unused `feedbackUrl`/`osLabel`/`os` imports if nothing else uses them:
```ts
        {
          label: 'Send Feedback…',
          click: () => broadcastAll(CH.feedbackOpen)(null)
        }
```

- [ ] **Step 6: Typecheck + lint + tests**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean. If `typecheck:node` can't see `buildEnv.d.ts`, confirm `tsconfig.node.json` includes `src/main/**/*` (it does).

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/preload/index.ts src/main/ipc.ts src/main/index.ts src/main/buildEnv.d.ts electron.vite.config.ts
git commit -m "feat(feedback): IPC contract, handlers, build-time proxy endpoint"
```

---

### Task 4: Header button and App wiring

**Files:**
- Modify: `src/renderer/shared/icons.tsx` (append)
- Modify: `src/renderer/operator/Header.tsx:15-22` (props), `:12` (import), `:189-194` (buttons)
- Modify: `src/renderer/operator/App.tsx:65` (state), `:119-128` (key dispatch), `:160` (Header props), `:194` (modal mount)
- Test: `src/renderer/operator/Header.test.tsx` (create if absent; if a Header test exists, add a case)

**Interfaces:**
- Consumes: `window.helm.feedback.onOpen` (Task 3).
- Produces: `HeaderProps.onOpenFeedback: () => void`; `FeedbackIcon`; App renders `<FeedbackModal onClose={…} />` (component from Task 5 — until then App imports a stub; see Step 5).

- [ ] **Step 1: Icon**

```tsx
// src/renderer/shared/icons.tsx — append
export function FeedbackIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M3.5 5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8.5L5 16.5v-3h.5a2 2 0 0 1-2-2v-6z" />
      <path d="M7 8h6M7 10.5h4" />
    </Icon>
  )
}
```

- [ ] **Step 2: Failing header test**

```tsx
// src/renderer/operator/Header.test.tsx (new)
// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Header } from './Header'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)
beforeEach(() => {
  ;(window as unknown as { helm: unknown }).helm = {
    presentation: { get: vi.fn(async () => null), onState: vi.fn(() => () => {}) },
    displays: { getStatus: vi.fn(async () => ({ outputs: 0, released: false, displays: [] })), onStatus: vi.fn(() => () => {}) },
    updates: { getStatus: vi.fn(async () => ({ state: 'idle' })), onStatus: vi.fn(() => () => {}) },
  }
})

describe('Header feedback button', () => {
  it('sits beside settings and opens feedback', () => {
    const onOpenFeedback = vi.fn()
    const { getByTitle } = render(
      <ThemeCtx.Provider value={themeFor('helm', 'dark')}>
        <Header mode="songs" setMode={() => {}} themeMode="dark" toggleTheme={() => {}} onOpenSettings={() => {}} onOpenFeedback={onOpenFeedback} hotkeyOverrides={{}} />
      </ThemeCtx.Provider>
    )
    fireEvent.click(getByTitle('Send feedback'))
    expect(onOpenFeedback).toHaveBeenCalledTimes(1)
    const settings = getByTitle('Settings')
    expect(settings.nextElementSibling).toBe(getByTitle('Send feedback'))
  })
})
```

If `useHelm` hooks in Header need more of `window.helm` than stubbed above, extend the stub with `vi.fn()`s until the render mounts — copy the shape from `SettingsModal.test.tsx:13`.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/renderer/operator/Header.test.tsx`
Expected: FAIL — no element with title "Send feedback".

- [ ] **Step 4: Header changes**

```tsx
// props
  onOpenSettings: () => void
  onOpenFeedback: () => void
// import
import { FeedbackIcon, MoonIcon, PreServiceIcon, ScreenBlackIcon, SermonIcon, SettingsIcon, SongsIcon, SunIcon } from '../shared/icons'
// buttons — after the Settings button
      <button style={themeBtnStyle} onClick={onOpenFeedback} title="Send feedback">
        <FeedbackIcon size={17} />
      </button>
```
Destructure `onOpenFeedback` in the component signature.

- [ ] **Step 5: App wiring**

```tsx
// App.tsx
import { FeedbackModal } from './FeedbackModal'
// state, next to settingsOpen:
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Help → Send Feedback… lands here so menu and header open the same dialog.
  useEffect(() => window.helm.feedback.onOpen(() => setFeedbackOpen(true)), []);
// key dispatch: treat the feedback dialog like settings so hotkeys don't fire under it
      dispatchModeKey(e, {
        settingsOpen: settingsOpen || feedbackOpen,
        closeSettings: () => { setSettingsOpen(false); setFeedbackOpen(false); },
        …
      });
    // and add feedbackOpen to that effect's dependency array
// Header:
  onOpenFeedback={() => setFeedbackOpen(true)}
// mount, after SettingsModal:
        {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
```
Until Task 5 lands, create a placeholder so typecheck passes:
```tsx
// src/renderer/operator/FeedbackModal.tsx (placeholder — replaced in Task 5)
import type { JSX } from 'react'
export function FeedbackModal(_p: { onClose: () => void }): JSX.Element | null { return null }
```

- [ ] **Step 6: Run tests + typecheck + lint**

Run: `npm run typecheck && npm run lint && npx vitest run src/renderer/operator`
Expected: all green, including existing `App`/`Header` tests if any (they may need `onOpenFeedback` and `window.helm.feedback.onOpen` stubs — add `feedback: { onOpen: vi.fn(() => () => {}) }` where `window.helm` is stubbed for App-level tests).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/shared/icons.tsx src/renderer/operator/Header.tsx src/renderer/operator/Header.test.tsx src/renderer/operator/App.tsx src/renderer/operator/FeedbackModal.tsx
git commit -m "feat(feedback): header button + app state"
```

---

### Task 5: FeedbackModal

**Files:**
- Replace: `src/renderer/operator/FeedbackModal.tsx`
- Test: `src/renderer/operator/FeedbackModal.test.tsx`

**Interfaces:**
- Consumes: `window.helm.feedback.{context,send,fallbackUrl}` (Task 3), `ModalShell`, `ThemeCtx`, `FEEDBACK_TEXT_MAX`.
- Produces: `FeedbackModal({ onClose }: { onClose: () => void })`.

- [ ] **Step 1: Failing tests**

```tsx
// src/renderer/operator/FeedbackModal.test.tsx
// @vitest-environment jsdom
import { render, cleanup, fireEvent, findByText, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeedbackModal } from './FeedbackModal'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { FeedbackContext, FeedbackSendResult } from '../../shared/types'

afterEach(cleanup)

const ctx: FeedbackContext = { version: '0.5.0', os: 'macOS (25.5.0)', arch: 'arm64', displays: 2, hasBibles: true, hasSongs: false }
let send: ReturnType<typeof vi.fn>

function stub(result: FeedbackSendResult): void {
  send = vi.fn(async () => result)
  ;(window as unknown as { helm: unknown }).helm = {
    feedback: {
      context: vi.fn(async () => ctx),
      send,
      fallbackUrl: vi.fn(async () => 'https://github.com/chase-codes/helm/issues/new?template=feature_request.yml'),
    },
  }
}

function mount(onClose = vi.fn()) {
  return { onClose, ...render(<ThemeCtx.Provider value={themeFor('helm', 'dark')}><FeedbackModal onClose={onClose} /></ThemeCtx.Provider>) }
}

beforeEach(() => stub({ ok: true, number: 7, url: 'https://github.com/chase-codes/helm/issues/7' }))

describe('FeedbackModal', () => {
  it('defaults to an idea and switches placeholder on type change', async () => {
    const { getByPlaceholderText, getByText } = mount()
    getByPlaceholderText('What would you like Helm to do? When would you use it?')
    fireEvent.click(getByText("Something's wrong"))
    getByPlaceholderText('What happened, and what did you expect instead?')
  })

  it('disables Send until text is non-blank', () => {
    const { getByText, getByRole } = mount()
    const btn = getByText('Send') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.change(getByRole('textbox'), { target: { value: '   ' } })
    expect(btn.disabled).toBe(true)
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer' } })
    expect(btn.disabled).toBe(false)
  })

  it('shows the attached context when expanded', async () => {
    const { getByText, findByText } = mount()
    fireEvent.click(getByText('Included with your report'))
    await findByText(/macOS \(25\.5\.0\)/)
    await findByText(/Displays: 2/)
    await findByText(/Bibles installed: yes/)
  })

  it('sends the typed payload and shows the issue link', async () => {
    const { getByText, getByRole, findByText } = mount()
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer' } })
    fireEvent.click(getByText('Send'))
    await findByText('Sent — thank you.')
    expect(send).toHaveBeenCalledWith({ type: 'feature', text: 'Countdown timer', context: ctx })
    const link = (await findByText('View on GitHub')) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('https://github.com/chase-codes/helm/issues/7')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('on failure keeps the text and offers the GitHub fallback', async () => {
    stub({ ok: false, reason: 'offline' })
    const { getByText, getByRole, findByText } = mount()
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer' } })
    fireEvent.click(getByText('Send'))
    await findByText("Couldn't send right now.")
    expect((getByRole('textbox') as HTMLTextAreaElement).value).toBe('Countdown timer')
    const link = getByText('Open on GitHub instead') as HTMLAnchorElement
    expect(link.getAttribute('href')).toContain('feature_request.yml')
    getByText('Try again')
  })

  it('reads Continue on GitHub when the proxy is unconfigured', async () => {
    stub({ ok: false, reason: 'unconfigured' })
    const { getByRole, findByText } = mount()
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer' } })
    const btn = await findByText('Continue on GitHub')
    expect(btn.closest('a')?.getAttribute('href')).toContain('feature_request.yml')
  })

  it('caps text at 4000 and shows a counter past 3500', () => {
    const { getByRole, getByText } = mount()
    fireEvent.change(getByRole('textbox'), { target: { value: 'a'.repeat(3600) } })
    getByText('3600 / 4000')
    expect((getByRole('textbox') as HTMLTextAreaElement).maxLength).toBe(4000)
  })
})
```

Note on the `unconfigured` case: the dialog must know *before* Send is clicked. Add a probe: on mount call `window.helm.feedback.send` **not** — instead expose configuration via context. Simplest: add `configured: boolean` to `FeedbackContext`? No — keep the shared type diagnostic-only. Instead, the modal calls `send` lazily and, when it gets `unconfigured`, swaps the primary button to the fallback link. So the test above should click Send first. **Amend the test:** after typing, `fireEvent.click(getByText('Send'))`, then `await findByText('Continue on GitHub')`. Keep this behaviour — one round-trip, no extra IPC.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/operator/FeedbackModal.test.tsx`
Expected: FAIL — placeholder renders null.

- [ ] **Step 3: Implementation**

```tsx
// src/renderer/operator/FeedbackModal.tsx
import { useContext, useEffect, useState, type CSSProperties, type JSX } from 'react'
import { ModalShell } from './ModalShell'
import { ThemeCtx } from './ThemeCtx'
import { FEEDBACK_TEXT_MAX } from '../../shared/feedbackIssue'
import type { FeedbackContext, FeedbackSendResult, FeedbackType } from '../../shared/types'

type Phase = { k: 'edit' } | { k: 'sending' } | { k: 'sent'; url: string } | { k: 'failed'; fallback: string } | { k: 'unconfigured'; fallback: string }

const PLACEHOLDER: Record<FeedbackType, string> = {
  bug: 'What happened, and what did you expect instead?',
  feature: 'What would you like Helm to do? When would you use it?',
}
const COUNTER_FROM = 3500

export function FeedbackModal({ onClose }: { onClose: () => void }): JSX.Element {
  const T = useContext(ThemeCtx)
  const [type, setType] = useState<FeedbackType>('feature')
  const [text, setText] = useState('')
  const [ctx, setCtx] = useState<FeedbackContext | null>(null)
  const [showCtx, setShowCtx] = useState(false)
  const [phase, setPhase] = useState<Phase>({ k: 'edit' })

  useEffect(() => {
    let live = true
    void window.helm.feedback.context().then((c) => { if (live) setCtx(c) })
    return () => { live = false }
  }, [])

  // Auto-close after a successful send; Done closes sooner.
  useEffect(() => {
    if (phase.k !== 'sent') return
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [phase, onClose])

  const canSend = text.trim().length > 0 && ctx !== null && phase.k !== 'sending'

  const submit = async (): Promise<void> => {
    if (!canSend || !ctx) return
    const payload = { type, text, context: ctx }
    setPhase({ k: 'sending' })
    const r: FeedbackSendResult = await window.helm.feedback.send(payload)
    if (r.ok) { setPhase({ k: 'sent', url: r.url }); return }
    const fallback = await window.helm.feedback.fallbackUrl(payload)
    setPhase(r.reason === 'unconfigured' ? { k: 'unconfigured', fallback } : { k: 'failed', fallback })
  }

  // Fixed footprint: the card keeps one height across edit/sending/sent/failed.
  const bodyStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '14px', minHeight: '360px' }
  const h1: CSSProperties = { fontSize: '18px', fontWeight: 700, color: T.text }
  const sub: CSSProperties = { fontSize: '13px', color: T.dim, lineHeight: 1.5 }
  const pillsWrap: CSSProperties = { display: 'flex', gap: '4px', background: T.panel2, padding: '4px', borderRadius: '10px', alignSelf: 'flex-start' }
  const pill = (active: boolean): CSSProperties => ({
    height: '32px', padding: '0 14px', borderRadius: '8px', fontSize: '12.5px',
    fontWeight: active ? 700 : 600, color: active ? T.accentInk : T.dim,
    background: active ? T.accent : 'transparent', cursor: 'pointer',
  })
  const area: CSSProperties = {
    width: '100%', minHeight: '150px', padding: '10px 12px', background: T.inputBg,
    borderRadius: '9px', boxShadow: `inset 0 0 0 1px ${T.border}`, fontSize: '13.5px', lineHeight: 1.55, resize: 'vertical',
  }
  const faint: CSSProperties = { fontSize: '11.5px', color: T.faint }
  const disclosure: CSSProperties = { ...faint, cursor: 'pointer', fontWeight: 600, letterSpacing: '0.04em' }
  const row: CSSProperties = { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', marginTop: 'auto' }
  const cancel: CSSProperties = { height: '40px', padding: '0 18px', borderRadius: '10px', background: T.panel2, boxShadow: `inset 0 0 0 1px ${T.border}`, fontSize: '14px', color: T.dim }
  const primary = (enabled: boolean): CSSProperties => ({
    height: '40px', padding: '0 20px', borderRadius: '10px', background: T.accent, color: T.accentInk,
    fontWeight: 700, fontSize: '14px', opacity: enabled ? 1 : 0.5, cursor: enabled ? 'pointer' : 'not-allowed',
    display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
  })
  const link: CSSProperties = { color: T.accent, fontSize: '13px', textDecoration: 'underline' }

  const contextList = ctx && (
    <ul style={{ ...faint, margin: '6px 0 0 16px', lineHeight: 1.7 }}>
      <li>Version: {ctx.version}</li>
      <li>OS: {ctx.os}</li>
      <li>Arch: {ctx.arch}</li>
      <li>Displays: {ctx.displays}</li>
      <li>Bibles installed: {ctx.hasBibles ? 'yes' : 'no'}</li>
      <li>Songs in library: {ctx.hasSongs ? 'yes' : 'no'}</li>
    </ul>
  )

  return (
    <ModalShell onClose={onClose} variant="card" width="520px" maxWidth="96vw" maxHeight="88vh">
      <div style={bodyStyle}>
        {phase.k === 'sent' ? (
          <>
            <div style={h1}>Sent — thank you.</div>
            <div style={sub}>We read every one. If we need more detail we'll follow up on the issue.</div>
            <a href={phase.url} target="_blank" rel="noreferrer" style={link}>View on GitHub</a>
            <div style={row}><button style={primary(true)} onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            <div style={h1}>What would make Helm better?</div>
            <div style={sub}>Tell us about a problem or something you'd like. It goes straight to the team.</div>
            <div style={pillsWrap}>
              <button style={pill(type === 'bug')} onClick={() => setType('bug')}>Something's wrong</button>
              <button style={pill(type === 'feature')} onClick={() => setType('feature')}>Something I'd like</button>
            </div>
            <textarea
              style={area}
              value={text}
              maxLength={FEEDBACK_TEXT_MAX}
              placeholder={PLACEHOLDER[type]}
              disabled={phase.k === 'sending'}
              onChange={(e) => setText(e.target.value)}
            />
            {text.length >= COUNTER_FROM && <div style={{ ...faint, textAlign: 'right' }}>{text.length} / {FEEDBACK_TEXT_MAX}</div>}
            <div>
              <div style={disclosure} onClick={() => setShowCtx((s) => !s)}>{showCtx ? '▾' : '▸'} Included with your report</div>
              {showCtx && (
                <>
                  <div style={{ ...faint, marginTop: '6px' }}>We attach a few details so we can reproduce what you saw. Nothing you've typed into Helm is included.</div>
                  {contextList}
                </>
              )}
            </div>
            {phase.k === 'failed' && (
              <div style={{ fontSize: '13px', color: T.dim }}>
                Couldn't send right now.{' '}
                <a href={phase.fallback} target="_blank" rel="noreferrer" style={link}>Open on GitHub instead</a>
                {' · '}
                <button style={{ ...link, background: 'none' }} onClick={() => setPhase({ k: 'edit' })}>Try again</button>
              </div>
            )}
            <div style={row}>
              <button style={cancel} onClick={onClose}>Cancel</button>
              {phase.k === 'unconfigured' ? (
                <a href={phase.fallback} target="_blank" rel="noreferrer" style={primary(true)}>Continue on GitHub</a>
              ) : (
                <button style={primary(canSend)} disabled={!canSend} onClick={() => void submit()}>
                  {phase.k === 'sending' ? 'Sending…' : 'Send'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  )
}
```

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npx vitest run src/renderer/operator/FeedbackModal.test.tsx && npm run typecheck:web && npm run lint`
Expected: PASS (7 tests). If `ModalShell` needs a click-outside guard to avoid closing when the textarea is clicked, it already stops propagation on the card.

- [ ] **Step 5: Run the app and eyeball both themes**

Run: `npm run dev`, click the speech-bubble button, toggle light/dark, open "Included with your report", type >3500 chars, click Send (expect Continue on GitHub since no endpoint is baked; confirm the browser opens the prefilled feature form). Use Help → Send Feedback… and confirm the same dialog opens.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/operator/FeedbackModal.tsx src/renderer/operator/FeedbackModal.test.tsx
git commit -m "feat(feedback): in-app feedback dialog"
```

---

### Task 6: Cloudflare Worker proxy

**Files:**
- Create: `feedback-worker/package.json`, `feedback-worker/wrangler.toml`, `feedback-worker/tsconfig.json`, `feedback-worker/src/index.ts`, `feedback-worker/src/validate.ts`, `feedback-worker/src/rateLimit.ts`, `feedback-worker/src/validate.test.ts`, `feedback-worker/src/rateLimit.test.ts`, `feedback-worker/src/index.test.ts`, `feedback-worker/README.md`
- Modify: root `.gitignore` (add `feedback-worker/node_modules`, `feedback-worker/.wrangler`), root `package.json` scripts (`"test:worker": "npm --prefix feedback-worker test"`), `.github/workflows/ci.yml` (run it)

**Interfaces:**
- Consumes: `buildIssue`, `FeedbackPayload`, `FEEDBACK_TEXT_MAX` from `../../src/shared/feedbackIssue` (relative import — the worker is compiled by wrangler/esbuild, which follows relative paths outside its dir).
- Produces: `POST /v1/feedback` → `201 { number, url }` | `400` | `401` | `429` | `502`.

- [ ] **Step 1: Scaffold**

```json
// feedback-worker/package.json
{
  "name": "helm-feedback-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250101.0",
    "typescript": "^5.6.0",
    "vitest": "^4.1.9",
    "wrangler": "^4.0.0"
  }
}
```

```toml
# feedback-worker/wrangler.toml
name = "helm-feedback"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[vars]
GITHUB_REPO = "chase-codes/helm"

[[kv_namespaces]]
binding = "RATE"
id = "REPLACE_WITH_OUTPUT_OF_wrangler_kv_namespace_create"

# Secrets (wrangler secret put): GITHUB_TOKEN, CLIENT_KEY
```

```json
// feedback-worker/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ES2022", "moduleResolution": "Bundler",
    "strict": true, "noEmit": true, "types": ["@cloudflare/workers-types"], "skipLibCheck": true
  },
  "include": ["src/**/*", "../src/shared/feedbackIssue.ts"]
}
```

Run: `cd feedback-worker && npm install` (creates its own lockfile — commit it).

- [ ] **Step 2: Failing validation tests**

```ts
// feedback-worker/src/validate.test.ts
import { describe, it, expect } from 'vitest'
import { validate } from './validate'

const good = { type: 'bug', text: 'Slides went black', context: { version: '0.5.0', os: 'macOS (25.5.0)', arch: 'arm64', displays: 2, hasBibles: true, hasSongs: false } }

describe('validate', () => {
  it('accepts a well-formed payload', () => {
    expect(validate(good)).toEqual({ ok: true, payload: good })
  })
  it.each([
    ['bad type', { ...good, type: 'rant' }],
    ['empty text', { ...good, text: '   ' }],
    ['too long', { ...good, text: 'a'.repeat(4001) }],
    ['missing context', { ...good, context: undefined }],
    ['extra context key', { ...good, context: { ...good.context, lyrics: 'x' } }],
    ['long version', { ...good, context: { ...good.context, version: 'v'.repeat(101) } }],
    ['non-number displays', { ...good, context: { ...good.context, displays: '2' } }],
    ['not an object', 'hi'],
  ])('rejects %s', (_n, bad) => {
    expect(validate(bad).ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify fail**

Run: `cd feedback-worker && npx vitest run src/validate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: validate.ts**

```ts
// feedback-worker/src/validate.ts
import { FEEDBACK_TEXT_MAX, type FeedbackPayload } from '../../src/shared/feedbackIssue'

const STR_MAX = 100
const CONTEXT_KEYS = ['version', 'os', 'arch', 'displays', 'hasBibles', 'hasSongs'] as const

export type Validation = { ok: true; payload: FeedbackPayload } | { ok: false; error: string }

export function validate(input: unknown): Validation {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'body must be an object' }
  const o = input as Record<string, unknown>
  if (o.type !== 'bug' && o.type !== 'feature') return { ok: false, error: 'type must be bug|feature' }
  if (typeof o.text !== 'string' || o.text.trim().length === 0 || o.text.length > FEEDBACK_TEXT_MAX)
    return { ok: false, error: `text must be 1–${FEEDBACK_TEXT_MAX} chars` }
  const c = o.context
  if (typeof c !== 'object' || c === null) return { ok: false, error: 'context required' }
  const cx = c as Record<string, unknown>
  const keys = Object.keys(cx)
  if (keys.length !== CONTEXT_KEYS.length || keys.some((k) => !(CONTEXT_KEYS as readonly string[]).includes(k)))
    return { ok: false, error: 'context has unexpected keys' }
  for (const k of ['version', 'os', 'arch'] as const)
    if (typeof cx[k] !== 'string' || (cx[k] as string).length > STR_MAX) return { ok: false, error: `context.${k} invalid` }
  if (typeof cx.displays !== 'number' || !Number.isInteger(cx.displays) || cx.displays < 0 || cx.displays > 32)
    return { ok: false, error: 'context.displays invalid' }
  if (typeof cx.hasBibles !== 'boolean' || typeof cx.hasSongs !== 'boolean') return { ok: false, error: 'context flags invalid' }
  return {
    ok: true,
    payload: {
      type: o.type,
      text: o.text,
      context: { version: cx.version as string, os: cx.os as string, arch: cx.arch as string, displays: cx.displays, hasBibles: cx.hasBibles, hasSongs: cx.hasSongs },
    },
  }
}
```

Run: `npx vitest run src/validate.test.ts` → PASS.

- [ ] **Step 5: Failing rate-limit test**

```ts
// feedback-worker/src/rateLimit.test.ts
import { describe, it, expect } from 'vitest'
import { allow, type RateStore } from './rateLimit'

function fakeKv(): RateStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => { data.set(k, v) },
  }
}

describe('allow', () => {
  it('permits 5 per hour then blocks', async () => {
    const kv = fakeKv()
    const now = 1_700_000_000_000
    for (let i = 0; i < 5; i++) expect(await allow(kv, '1.2.3.4', now)).toBe(true)
    expect(await allow(kv, '1.2.3.4', now)).toBe(false)
    expect(await allow(kv, '5.6.7.8', now)).toBe(true)
  })
  it('resets after the window', async () => {
    const kv = fakeKv()
    const now = 1_700_000_000_000
    for (let i = 0; i < 5; i++) await allow(kv, 'a', now)
    expect(await allow(kv, 'a', now + 61 * 60 * 1000)).toBe(true)
  })
})
```

- [ ] **Step 6: rateLimit.ts**

```ts
// feedback-worker/src/rateLimit.ts
export interface RateStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
}

const LIMIT = 5
const WINDOW_MS = 60 * 60 * 1000

/** Fixed window per key. KV is eventually consistent, so a burst can slightly
 * exceed LIMIT — acceptable for spam deterrence, not billing. */
export async function allow(store: RateStore, ip: string, nowMs: number): Promise<boolean> {
  const key = `rate:${ip}`
  const raw = await store.get(key)
  let start = nowMs
  let count = 0
  if (raw) {
    const parsed = JSON.parse(raw) as { start: number; count: number }
    if (nowMs - parsed.start < WINDOW_MS) { start = parsed.start; count = parsed.count }
  }
  if (count >= LIMIT) return false
  await store.put(key, JSON.stringify({ start, count: count + 1 }), { expirationTtl: Math.ceil(WINDOW_MS / 1000) })
  return true
}
```

Run: `npx vitest run src/rateLimit.test.ts` → PASS.

- [ ] **Step 7: Failing handler test**

```ts
// feedback-worker/src/index.test.ts
import { describe, it, expect, vi } from 'vitest'
import worker, { type Env } from './index'

const good = { type: 'feature', text: 'Countdown timer', context: { version: '0.5.0', os: 'macOS (25.5.0)', arch: 'arm64', displays: 2, hasBibles: true, hasSongs: false } }

function env(overrides: Partial<Env> = {}): Env {
  const data = new Map<string, string>()
  return {
    GITHUB_REPO: 'chase-codes/helm',
    GITHUB_TOKEN: 'ghp_test',
    CLIENT_KEY: 'client-secret',
    RATE: { get: async (k: string) => data.get(k) ?? null, put: async (k: string, v: string) => { data.set(k, v) } } as unknown as KVNamespace,
    ...overrides,
  }
}

function req(body: unknown, headers: Record<string, string> = { 'X-Helm-Client': 'client-secret' }): Request {
  return new Request('https://fb.example/v1/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: JSON.stringify(body) })
}

describe('worker', () => {
  it('files an issue and returns its number and url', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ number: 42, html_url: 'https://github.com/chase-codes/helm/issues/42' }), { status: 201 }))
    const res = await worker.fetch(req(good), env(), fetchFn)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ number: 42, url: 'https://github.com/chase-codes/helm/issues/42' })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/chase-codes/helm/issues')
    const h = init.headers as Record<string, string>
    expect(h.Authorization).toBe('Bearer ghp_test')
    const sent = JSON.parse(init.body as string)
    expect(sent.title).toBe('Feedback: Countdown timer')
    expect(sent.labels).toEqual(['feedback', 'enhancement'])
    expect(sent.body).toContain('### Included automatically')
  })
  it('401s without the client header', async () => {
    expect((await worker.fetch(req(good, {}), env(), vi.fn())).status).toBe(401)
  })
  it('400s on a bad payload', async () => {
    expect((await worker.fetch(req({ ...good, type: 'rant' }), env(), vi.fn())).status).toBe(400)
  })
  it('429s past the rate limit', async () => {
    const e = env()
    const ok = vi.fn(async () => new Response(JSON.stringify({ number: 1, html_url: 'u' }), { status: 201 }))
    for (let i = 0; i < 5; i++) expect((await worker.fetch(req(good), e, ok)).status).toBe(201)
    expect((await worker.fetch(req(good), e, ok)).status).toBe(429)
  })
  it('502s when GitHub fails', async () => {
    const bad = vi.fn(async () => new Response('boom', { status: 500 }))
    expect((await worker.fetch(req(good), env(), bad)).status).toBe(502)
  })
  it('404s other routes and 405s other methods', async () => {
    expect((await worker.fetch(new Request('https://fb.example/'), env(), vi.fn())).status).toBe(404)
    expect((await worker.fetch(new Request('https://fb.example/v1/feedback'), env(), vi.fn())).status).toBe(405)
  })
})
```

- [ ] **Step 8: index.ts**

```ts
// feedback-worker/src/index.ts
import { buildIssue } from '../../src/shared/feedbackIssue'
import { validate } from './validate'
import { allow } from './rateLimit'

export interface Env {
  GITHUB_REPO: string
  GITHUB_TOKEN: string
  CLIENT_KEY: string
  RATE: KVNamespace
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Third param is injectable for tests; Cloudflare passes ExecutionContext there, which we ignore.
async function handle(request: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname !== '/v1/feedback') return json(404, { error: 'not found' })
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' })
  // Shared client key: deters drive-by posting from outside the app. It ships in
  // the binary, so treat it as obfuscation, not authentication — the rate limit
  // and the token's narrow scope are the real controls.
  if (request.headers.get('X-Helm-Client') !== env.CLIENT_KEY) return json(401, { error: 'unauthorized' })

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (!(await allow(env.RATE, ip, Date.now()))) return json(429, { error: 'too many requests' })

  let body: unknown
  try { body = await request.json() } catch { return json(400, { error: 'invalid json' }) }
  const v = validate(body)
  if (!v.ok) return json(400, { error: v.error })

  const issue = buildIssue(v.payload)
  const gh = await fetchFn(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'helm-feedback-worker',
    },
    body: JSON.stringify(issue),
  })
  if (!gh.ok) return json(502, { error: 'github error' })
  const created = (await gh.json()) as { number: number; html_url: string }
  return json(201, { number: created.number, url: created.html_url })
}

export default {
  fetch: (request: Request, env: Env, ctxOrFetch?: ExecutionContext | typeof fetch) =>
    handle(request, env, typeof ctxOrFetch === 'function' ? ctxOrFetch : undefined),
}
```

Run: `npx vitest run` (in `feedback-worker/`) → PASS (all three files). `npm run typecheck` in the worker → clean.

- [ ] **Step 9: README + CI + gitignore**

```md
<!-- feedback-worker/README.md -->
# helm-feedback worker

Receives in-app feedback and files it as a GitHub issue so reporters never leave Helm.

## One-time setup
1. Fine-grained PAT (Settings → Developer settings → Fine-grained tokens): repository access **chase-codes/helm** only, permission **Issues: Read and write**. Expiry ≤ 1 year — put the renewal date in your calendar.
2. `cd feedback-worker && npm install`
3. `npx wrangler login`
4. `npx wrangler kv namespace create RATE` → paste the id into `wrangler.toml`.
5. `npx wrangler secret put GITHUB_TOKEN` (the PAT)
6. `npx wrangler secret put CLIENT_KEY` (any long random string, e.g. `openssl rand -hex 24`)
7. `npm run deploy` → note the worker URL.
8. Repo secrets for the release workflow: `HELM_FEEDBACK_ENDPOINT` = `https://<worker>/v1/feedback`, `HELM_FEEDBACK_CLIENT` = the same CLIENT_KEY.
9. Create the `feedback` label on the repo: `gh label create feedback --color 0e8a16 --description "Filed from the in-app feedback dialog"`.

Builds without those secrets fall back to opening a prefilled GitHub issue form.

## What it does not do
- Store anything about the reporter. No identity, no email (see #63 follow-ups).
- Authenticate. `CLIENT_KEY` is in the app binary; it only deters casual abuse. Rate limit is 5/IP/hour.
```

Root `.gitignore` append:
```
feedback-worker/node_modules
feedback-worker/.wrangler
```

Root `package.json` scripts: `"test:worker": "npm --prefix feedback-worker test"`.

`.github/workflows/ci.yml`: after the existing `npm test` step add
```yaml
      - run: npm --prefix feedback-worker ci
      - run: npm run test:worker
```

- [ ] **Step 10: Commit**

```bash
git add feedback-worker .gitignore package.json .github/workflows/ci.yml
git commit -m "feat(feedback): cloudflare worker proxy"
```

---

### Task 7: Release wiring, follow-up issues, docs

**Files:**
- Modify: `.github/workflows/release.yml` (the `npm run build` steps in both `release` and `release-mac` jobs)
- Modify: `docs/ux-grammar.md` only if it enumerates header controls (check with `grep -n "Settings" docs/ux-grammar.md`); otherwise no change.

- [ ] **Step 1: Release env**

For each `- run: npm run build` in `release.yml` (Windows job ~line 50 and the mac job), add:
```yaml
      - run: npm run build
        env:
          HELM_FEEDBACK_ENDPOINT: ${{ secrets.HELM_FEEDBACK_ENDPOINT }}
          HELM_FEEDBACK_CLIENT: ${{ secrets.HELM_FEEDBACK_CLIENT }}
```
Unset secrets expand to empty strings → the app runs in fallback mode; nothing breaks.

- [ ] **Step 2: Follow-up issues** (use `gh issue create --repo chase-codes/helm`)

1. Title: `Feedback proxy: Cloudflare setup + release secrets` — body: steps 1–9 from `feedback-worker/README.md`, labels `area:distribution`, `P1`. Note: until done, releases fall back to the GitHub form.
2. Title: `Feedback: reporter identity so we can reply` — body: onboarding collects email or assigns an app id; must never appear in the public issue body (private store keyed by issue number, or private mirror repo); needs a security review before design. Labels `enhancement`, `P2`.
3. Title: `Feedback: public-repo privacy review` — body: define what a feedback issue may contain, redaction rules for text (emails, file paths), who can read the worker's KV, PAT rotation. Labels `documentation`, `P2`.

Then comment on #63 linking all three and noting the PR.

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npm run lint && npm test && npm run test:worker && npm run build`
Expected: all green. Then `npm run dev` smoke: header button → dialog → Send → Continue on GitHub opens the browser with the feature template prefilled.

- [ ] **Step 4: Commit and PR**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): pass feedback proxy endpoint into builds"
git push -u origin feat/in-app-feedback
gh pr create --title "feat: in-app feedback dialog + proxy" --body "Closes #63. Header button + Help menu open a two-field feedback dialog; main sends to the Cloudflare worker in feedback-worker/, falling back to a prefilled GitHub issue when unconfigured/offline. Follow-ups: <issue links>."
```

---

## Self-review

- **Spec coverage:** entry points (T4, T3 menu), dialog + states + copy (T5), context fields + main-side collection (T3), unconfigured fallback + URL truncation (T2, T5), shared `buildIssue` (T1), worker validate/rate-limit/PAT/labels/README (T6), release env + follow-up issues (T7), tests per section (each task). Manual packaged-build check on mac/Windows is listed in T7 step 3 as dev smoke only — the packaged check happens at next release (fallback path is what ships until the worker exists).
- **Placeholders:** none; wrangler KV id is a documented "replace with" by necessity.
- **Type consistency:** `FeedbackPayload {type,text,context}`, `FeedbackSendResult` reasons `offline|rejected|unconfigured`, `window.helm.feedback.{context,send,fallbackUrl,onOpen}`, header prop `onOpenFeedback`, title `Send feedback` — used identically in T2–T5.
