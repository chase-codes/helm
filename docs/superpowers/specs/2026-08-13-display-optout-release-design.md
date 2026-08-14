# Display opt-out (`off` role) and release/take toggle — design

**Issue:** #51 — Helm claims every external display on launch, with no way to leave a screen alone.

## Problem

`planAttachments` (`src/shared/displays/roles.ts`) turns every non-operator display into an
output, unconditionally, at launch (`initDisplays()` ends in `sync()`), and the output windows
sit at the `screen-saver` always-on-top level. If another program is presenting on a screen,
opening Helm takes it over and only quitting gives it back.

Two fixes, per the issue:

1. **An `off` role** — the durable per-screen opt-out, persisted per fingerprint.
2. **A release/take toggle** — hands every screen back mid-service without quitting.

Decisions made during brainstorming:

- Window layering stays at `screen-saver`. An output that *is* active should win the screen;
  off/release are the escape hatches.
- Release is a **transient suspend**: not persisted, a relaunch always starts un-released.
- Release control: header toggle + hotkey (`Mod+Shift+B`, customizable via the registry).
- `off` joins the `OutputRole` union (same saved map, same IPC) rather than a separate
  enabled-map or a new assignment type.
- The twin-monitor fingerprint collision (two identical unlabeled monitors share a
  fingerprint, so marking one off marks both off) is accepted and documented — consistent
  with how roles already behave.

## 1. The `off` role

- `src/shared/types.ts`: `OutputRole = 'audience' | 'stage' | 'livestream' | 'off'`.
- `src/shared/displays/roles.ts`:
  - `OUTPUT_ROLES` gains `'off'` (last, so dropdown order stays feed-first).
  - `ROLE_VARIANT` is retyped `Record<Exclude<OutputRole, 'off'>, OutputVariant>` — the
    compiler forbids creating a window for an off display.
  - `planAttachments` resolves each display's role from saved assignments first, then
    filters out `'off'`: an off display produces no attachment at all.
  - `DEFAULT_ROLE` stays `'audience'`: a never-seen display still lights up automatically.
- `src/main/displays.ts`:
  - `sync()` needs no structural change — off displays fall out of the plan, so the
    existing "destroy windows no longer planned" loop tears them down.
  - Fix while here: `lastDisplays` currently reports `tracked?.role ?? DEFAULT_ROLE`,
    which would show an off display as `audience`. Resolve from the saved roles map
    instead so `DisplayInfo.role` correctly reports `'off'`.
  - `setDisplayRole(fp, role)`: persists as today; when the change crosses the off
    boundary in either direction (window must be destroyed or created) it calls the full
    `sync()`; non-off→non-off changes keep the cheap live re-tag path.
- No settings migration: legacy saved data cannot contain `'off'`.

## 2. Release / take (transient, mid-service)

- `src/main/displays.ts` gets a module-level `released = false` flag. Never persisted;
  `initDisplays()` starts from `false`.
- While `released` is true, `sync()` plans nothing: all real-display output windows are
  destroyed and none are created — including for displays plugged in while released.
- `setOutputsReleased(released: boolean)`: flips the flag and runs `sync()`. Exposed over a
  new IPC channel `displays:toggleReleased` (renderer sends no payload; main flips its own
  state, so the renderer never races on stale state) and the resulting state is broadcast.
- `DisplayStatus` gains `released: boolean`.
- Existing paths compose:
  - Operator-window close still calls `closeAllOutputs()`; recreating the operator window
    calls `resyncDisplays()`, which respects `released` and stays hands-off.
  - Dev test outputs (framed windows; they don't claim a screen) are unaffected by release.
  - The update-pill guard reads `outputs`, which is 0 while released — correct.

## 3. Interface

- **Settings** (`src/renderer/operator/DisplaysSettings.tsx`):
  - Role dropdown gains an **Off** option.
  - When a display's role is `off`, the Slides/Leader/Mirror segmented control is hidden
    (there is no window to view-switch).
  - Section hint gains one sentence covering Off and the twin-monitor caveat.
- **Header** (`src/renderer/operator/Header.tsx`): a toggle button next to the outputs
  chip — "Release screens" normally; while released, a visually loud state
  ("Screens released · Take back") so the operator can't miss that Helm is dormant.
- **Hotkey**: new global app action `displays.release` ("Release / take screens") in
  `src/shared/hotkeys/actions.ts`, default `Mod+Shift+B`, customizable like the rest.
  No conflict with the songs-scope bare `B`.
- **OutputViewPopover**: off displays are filtered out of the quick view-switcher list.

## 4. Edge cases

- Twin unlabeled monitors: shared fingerprint means shared off state. Accepted, documented.
- All displays off, then a brand-new display is plugged in: it comes up as `audience`
  (only saved fingerprints can be off).
- Release while some displays are off: release affects the remaining outputs; taking back
  restores only non-off displays.
- Relaunch after release: Helm claims screens again per saved roles (transient by design).

## 5. Testing

TDD against the existing harnesses:

- `src/shared/displays/roles.test.ts`: off displays produce no attachment; unknown
  displays still default to audience; operator display still excluded.
- `src/main/displays.test.ts`: `setDisplayRole('off')` destroys the window and stays off
  across a re-sync; off→audience recreates; release destroys all outputs; display-added
  while released creates nothing; take restores; `released` resets on re-init; status
  carries `released` and reports `'off'` roles correctly.
- `src/renderer/operator/DisplaysSettings.test.tsx`: Off option present; view control
  hidden when off.
- Header / keyDispatch tests: toggle renders both states and fires the IPC; the
  `displays.release` action dispatches on `Mod+Shift+B`.

## Acceptance (from #51)

- A display can be set to `off`; Helm creates no window on it and leaves it alone.
- The setting survives a restart — Helm never re-grabs a screen you told it not to touch.
- The operator can release and re-take all outputs mid-service without quitting.
- A newly plugged-in, never-seen display still comes up as audience automatically.
- Nothing regresses for the normal single-projector setup.
