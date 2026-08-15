# In-app upgrade experience — design

**Issue:** #62 · **Date:** 2026-08-15 · **Status:** approved

## Goal

A user can check for updates on demand and always gets a definite answer: up to
date, downloading (with progress), ready, or a specific failure. Background
checking stays completely silent, including on failure. Install still refuses
while any output window is up — and now says why.

## Scope decisions

- **macOS signing is out of scope.** The app is unsigned, electron-updater
  can't apply updates to unsigned apps, and the build deliberately publishes no
  `latest-mac.yml`. Signing gets filed as its own issue; until it lands, a
  manual check on macOS reports "unavailable" with a download link rather than
  silently doing nothing (or surfacing a misleading 404).
- **UI lives in a Settings sidebar footer** — version number + check control at
  the bottom of the Settings modal's section list, visible whichever section is
  open. No new Settings section.
- **The outputs-up install deferral is explained in Settings only.** The header
  `UpdatePill` stays invisible while any output is up; mid-service silence is a
  deliberate invariant. The reason is discoverable where someone would go
  looking.

## Architecture: one extended state machine

The manual check reuses the existing `updates:status` broadcast rather than a
request/response result or a second channel — one source of truth, and the
long-running part (download → ready) already flows through it.

### `src/shared/types.ts`

```ts
export type UpdateState =
  | 'idle' | 'available' | 'ready'          // existing, background-visible
  | 'checking' | 'downloading'              // manual-only
  | 'upToDate' | 'error' | 'unsupported'    // manual-only, terminal
export interface UpdateStatus {
  state: UpdateState
  version: string | null
  percent?: number   // downloading only
  message?: string   // error only, short
}
```

### `src/main/updater.ts`

`createUpdater` gains a `supported: boolean` dep (main passes
`process.platform !== 'darwin'`) and the returned interface gains `check()`
for manual checks. An internal `manualCheckActive` flag decides what
broadcasts:

- **Background path (behavior unchanged):** startup/4-hour checks never emit
  the manual-only states. Errors collapse to silence, `update-available` →
  `available`, `update-downloaded` → `ready`.
- **Manual path:** `check()` sets `checking`; `download-progress` →
  `downloading` with percent; `update-not-available` → `upToDate`;
  rejection/`error` event → `error` with a short message. The flag clears on
  any terminal state (`ready`, `upToDate`, `error`, `unsupported`).
- **Short-circuits:** manual check with `!supported` or `!driver` (dev build)
  → `unsupported` immediately, no network touched. Manual check while already
  `ready` re-broadcasts `ready`.
- If a background download is mid-flight, a manual check flips the flag and
  progress that was already happening becomes visible.
- **Hardening:** the `error` handler no longer wipes a `ready` status back to
  `idle` — a downloaded update must not be forgotten because a later poll
  failed.

`install()` is untouched, including the outputs-up guard.

### IPC + preload

- New channel `updatesCheck: 'updates:check'`; handler calls `updater.check()`.
  The invoke returns nothing — results arrive via the broadcast.
- New `appGetVersion: 'app:getVersion'` handle returning `app.getVersion()`,
  exposed as `window.helm.app.version()` (no version IPC exists today).
- The download link needs no IPC: the window-open handler in
  `src/main/index.ts` already routes `target="_blank"` anchors through
  `shell.openExternal`.

## UI: `src/renderer/operator/UpdateFooter.tsx`

Rendered at the bottom of the Settings modal's sidebar column. Subscribes to
`updates.onStatus` + initial `getStatus` (push-beats-fetch, same as
`UpdatePill`), fetches `helm.app.version()` once, watches `displays.onStatus`
for the outputs count.

Layout: `Helm <version>` in dim text, then one line:

| State | Footer shows |
|---|---|
| `idle` / `available` | "Check for updates" button |
| `checking` | "Checking…" |
| `downloading` | "Downloading… 42%" |
| `upToDate` | "You're up to date" + the button again |
| `error` | "Couldn't check for updates" + short message + Retry |
| `unsupported` | "In-app updates aren't available on macOS yet." + link to <https://chase-codes.github.io/helm/> |
| `ready`, outputs = 0 | "Restart to update" button → `updates.install()` |
| `ready`, outputs > 0 | "Update ready — installs once output displays are closed" |

`UpdatePill` behavior is unchanged; the widened `UpdateState` still satisfies
its `state !== 'ready'` guard.

## Testing

- **`updater.test.ts`** (driver fake exists): manual check emits
  `checking → downloading → ready`; background check stays silent through the
  same events; manual vs background error; `update-not-available` mapping;
  `unsupported` short-circuits; error no longer wipes `ready`.
- **`UpdateFooter.test.tsx`**: one render assertion per state-table row;
  button wiring to `check()` / `install()`.
- **Manual verification:** Windows end-to-end needs a real released build
  (post-merge). macOS: packaged dmg shows the unsupported message with a
  working link.

## Out of scope / follow-ups

- macOS code signing + notarization — file as its own issue (hard prerequisite
  for Mac in-app updates; same root cause as the "damaged" first-open warning).
- #44 — permanent latest-download URL for macOS; the footer's site link is the
  interim manual-download path.
