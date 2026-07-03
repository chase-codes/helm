# Final review fixes

Applied on branch `feat/slice-1-2-songs`, 2026-07-03.

## Critical

1. **QuickAdd.tsx copy** (`src/renderer/operator/QuickAdd.tsx:151`) — "Lectern splits and
   labels them automatically." → "Helm splits and labels them automatically."
2. **Missing Edit menu** (`src/main/index.ts` `buildMenu`) — added `{ role: 'editMenu' as const }`
   to the menu template (after `appMenu` on mac, before the existing `View` menu). Restores
   Cmd+C/V/X in text fields, including the paste-lyrics modal.

## Important

3. **Orphaned output windows on operator close** — `src/main/displays.ts` now tracks test-output
   windows in a `testOutputs` set (in addition to the existing `byDisplayId` map for real-display
   outputs) and exports `closeAllOutputs()`, which destroys and clears both. `src/main/index.ts`
   now keeps a module-level `operatorWindow` reference, calls `closeAllOutputs()` on the operator
   window's `'closed'` event, and the macOS `activate` handler now recreates the operator window
   when `operatorWindow === null` (previously checked `BrowserWindow.getAllWindows().length === 0`,
   which never fired once output windows existed).
4. **App user model id** (`src/main/index.ts:76`) — `electronApp.setAppUserModelId('com.electron')`
   → `'com.helm.app'`.
5. **Output replay on renderer reload** (`src/main/stateStore.ts:21`) — `webContents.once('did-finish-load', ...)`
   → `webContents.on('did-finish-load', ...)`. The send is idempotent (re-sends current state), so
   listening on every load (not just the first) fixes the black-screen-after-reload case. The
   listener is attached to `webContents`, which is disposed with the window, so it does not
   outlive window close — no separate teardown needed (confirmed by reading the existing
   `w.on('closed', () => outputWindows.delete(w))` cleanup already in `registerOutput`, and the
   `on` listener itself not being stored anywhere it could leak from).

## Minor

6. **Quick-add ordering** (`src/renderer/operator/SongsMode.tsx` `onQuickAddSaved`) — new song is
   now appended (`[...prev, song]`) instead of prepended (`[song, ...prev]`), matching
   `repo.list()`'s `created_at, title` order so the song doesn't jump to a different position
   after restart.
7. **Unhandled rejections** (`src/renderer/operator/SongsMode.tsx`, the `songs.list()` and
   `songs.search()` effects) — added `.catch(console.error)` to both IPC promise chains.
8. **`build:mac` typecheck** (`package.json`) — now `"npm run typecheck && electron-vite build && electron-builder --mac"`,
   matching `build:win`/`build` (build:linux was left as-is; only `build:mac` was named in scope).
9. **Scaffold `extendInfo` entries** (`electron-builder.yml`, `mac:`) — removed the
   `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSDocumentsFolderUsageDescription`,
   and `NSDownloadsFolderUsageDescription` entries; Helm uses none of these.

## Verification

- `npm run typecheck` — clean (both `typecheck:node` and `typecheck:web`).
- `npm test` — 38/38 passed (7 test files).
- `npx eslint` on all touched `src/` files (`QuickAdd.tsx`, `index.ts`, `displays.ts`,
  `stateStore.ts`, `SongsMode.tsx`) — 0 errors before and after (254 pre-existing/incidental
  `prettier/prettier` formatting warnings after vs. 243 before; the codebase already carries
  243 such warnings on these same files prior to this change, so this is pre-existing lint
  posture, not a new-error regression). Confirmed via a `git stash` A/B comparison.
- Electron was not launched, per instructions (better-sqlite3 is built for Node ABI).

## Re-review residual (follow-up commit)

10. **Output windows not re-attached after operator-window recreate** — `src/main/displays.ts`
    now hoists the `sync` closure via a module-level `let resync: (() => void) | null = null`
    assigned inside `initDisplays()`, exported as `resyncDisplays()` with a null-guard
    (`resync?.()`). `src/main/index.ts` imports it and calls it after `createWindow()` in the
    macOS `activate` handler, so reopening the console after an accidental Cmd+W (which tears
    all outputs down via `closeAllOutputs()`) re-attaches output windows to external displays
    immediately instead of waiting for a display add/remove/metrics event.

### Verification (follow-up)

- `npm run typecheck` — clean.
- `npm test` — 38/38 passed (7 files).
- `npx eslint src/main/displays.ts src/main/index.ts` — 0 errors (38 pre-existing
  prettier/prettier warnings, same posture as before).
