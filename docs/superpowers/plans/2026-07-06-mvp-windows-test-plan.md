# Helm — MVP Windows Test Plan

**Test date:** Wednesday 2026-07-08 · **Written:** 2026-07-05
**Target:** Real projection dress-rehearsal on a Windows machine.

## Decisions locked (from planning)
- **Run mode:** packaged NSIS installer (`Helm-0.1.0-setup.exe`), **built on the Windows box** (not cross-compiled — see the big risk below).
- **Scope to verify:** Songs + projection · Sermon + scripture · Pre-service loop. (Media/video may work but is *not* a gating flow for Wednesday.)
- **Multi-display:** merge **Slice 6a (display roles)** into `master` first, build off that.
- **Windows machine:** full access — admin, internet, can install Node LTS + git + native-build tools.

---

## ⚠️ The one big risk — plan around it

Helm's runtime database is **`better-sqlite3`, a native C++ module** (`src/main/db.ts`). A binary compiled on this Mac will **not** run on Windows, and `electron-builder.yml` sets `npmRebuild: false`. So Helm **must be built on the Windows machine**, where `npm install`'s `postinstall` (`electron-builder install-app-deps`) rebuilds `better-sqlite3` for Windows + Electron's ABI.

**That rebuild is the single thing most likely to eat a day.** For Electron 39 (very new), a prebuilt `better-sqlite3` binary may not exist, so it can compile from source → needs a C++ toolchain.

**De-risk rule: do a full install + `build:win` + launch dry-run on the Windows box by Monday or Tuesday — never Wednesday morning.** If the toolchain is wrong, you want to find out with slack to spare.

---

## Critical path (in order)
1. ~~**[Mac]** Merge Slice 6a → `master`, re-run the gate. *(A1)*~~ ✅ **DONE** (master @ `2ef9f2e`, gate green: typecheck, 286 tests, 0 lint errors).
2. ~~**[Mac]** Handle the font fallback so audience slides render right on Windows. *(A2)*~~ ✅ **DONE** — all three output typefaces bundled (see A2).
3. **[Mac]** Produce a transfer bundle. *(A3)*
4. **[Win]** One-time toolchain install. *(A4)* ← **do this dry-run early**
5. **[Win]** `npm install` → `npm run build:win` → run installer. *(A5)*
6. **[Win]** Smoke-test the three flows on the real projector + operator screen. *(A6)*
7. Load real service content (songs, scripture schedule, pre-service cards). *(Part B, P0-content)*

---

## Part A — Deployment runbook

### A1 · [Mac] Merge Slice 6a into master
The branch is done, reviewed, and green. Master advanced one docs-only commit since the last rebase, so re-rebase then fast-forward.
```bash
# in the worktree
cd /Users/lem/repos/helm-slice6-displays
git fetch ../helm master:master 2>/dev/null || true   # (worktrees share the object store; master ref is already local)
git rebase master
npm run typecheck && npm test && npx eslint .          # re-run the gate; expect 0 errors
# then in the main checkout, fast-forward master onto the branch
cd /Users/lem/repos/helm
git merge --ff-only slice-6-displays
```
If `--ff-only` refuses (divergence), use `git merge slice-6-displays` (a merge commit is fine).

### A2 · [Mac] Fix the font fallback — ✅ DONE (commit `2ef9f2e`)
The slide/reading canvases are designed in **three** custom families — `Hanken Grotesk` (sans), `JetBrains Mono` (mono), `Newsreader` (serif) — and none were bundled, so on Windows all three would fall back to system fonts. Now self-hosted via `@fontsource` (`src/renderer/shared/fonts.ts`, imported in both renderer entry points); the woff/woff2 files are copied into the build (verified: 49 `@font-face` rules in the built CSS). No runtime network, works on any box.

**Still verify on Windows (P1):** eyeball a lyric slide + a scripture reading slide on the projector vs. the Mac — the bundling is proven at build time, but confirm the on-screen render matches. No install of fonts on the Windows machine is needed anymore.

### A3 · [Mac] Make a transfer bundle (no remote needed)
There's no git remote. A **git bundle** is a single self-contained file with full history and no `node_modules`:
```bash
cd /Users/lem/repos/helm
git bundle create ~/helm.bundle --all
# copy ~/helm.bundle to the Windows box (USB stick, OneDrive, or scp)
```
*(Alternative: push to a private GitHub repo and `git clone` on Windows — cleaner if you want a backup + to iterate remotely. Requires creating the remote; ask if you want help wiring that up.)*

### A3b · [Build machine] Stage the vendored LibreOffice tree (required for PPTX import)
The per-OS LibreOffice-headless tree lives **outside git** (large). Before `build:win`
(or `build:mac`) it MUST be staged at `resources/libreoffice` so electron-builder's
`extraResources` copies it next to the app (`<resourcesPath>/libreoffice`). If it's
absent the build still succeeds, but PPTX import degrades to the "PowerPoint import
unavailable" modal at runtime. Windows layout expected by `bundledSofficeCandidates`:
`resources/libreoffice/program/soffice.exe`.

### A4 · [Win] One-time toolchain (do the dry-run EARLY)
1. **Node.js LTS 22.x** from nodejs.org — during install, **check "Tools for Native Modules"** (installs Python + Visual Studio Build Tools via Chocolatey). This is what makes `better-sqlite3` compile if no prebuilt exists. Do **not** use Node 26 on the box; stick to LTS for native-build reliability.
2. **Git for Windows** (git-scm.com).
3. Reboot after the native-tools install so PATH updates take.

### A5 · [Win] Build + run
```bat
git clone %USERPROFILE%\helm.bundle helm
cd helm
git checkout master
npm install                 :: postinstall rebuilds better-sqlite3 for Windows/Electron
npm run build:win           :: -> dist\Helm-0.1.0-setup.exe
```
Then run `dist\Helm-0.1.0-setup.exe`, install, launch from the desktop shortcut.

**If `npm install` or the rebuild fails on `better-sqlite3`:** that's the toolchain — confirm the "Tools for Native Modules" step (A4) actually installed VS Build Tools + Python (`npm config get msvs_version`, `python --version`). See Part D for fallbacks.

### A6 · [Win] Smoke test on the real setup (projector + operator screen)
Plug in the projector as a second display, then walk each in-scope flow (checklist in Part B, P0-verify). The Slice 6a manual multi-display verification (still owed from the branch) folds into this — it's exactly what Wednesday exercises.

---

## Part B — Prioritized task list before Wednesday

### P0 — Blocks the test (must be green)
- [x] **Merge Slice 6a → master + re-gate** (A1). Done — master @ `2ef9f2e`.
- [ ] **Windows deployment dry-run**: install toolchain → `npm install` → `build:win` → launch (A4–A5). *Do by Mon/Tue.* This is the critical de-risk.
- [ ] **P0-verify — smoke-test the three flows on Windows + projector:**
  - [ ] **Songs:** search a song → navigate sections (mouse + arrow keys) → **go live** onto the audience screen → **take down** clears it. Text is legible on the projector.
  - [ ] **Sermon + scripture:** look up a scripture reference → reading/scripture slides project correctly → schedule a reading and recall it.
  - [ ] **Pre-service loop:** create/enable pre-service cards → engage the loop → cards cycle full-screen on the audience display at the set dwell.
  - [ ] **Multi-display roles (Slice 6a):** projector shows the **audience** feed on plug-in; set it to **stage** via the seam (`window.helm.displays.setRole('<fingerprint>','stage')` from operator devtools; get the fingerprint from `await window.helm.displays.get()`) → that screen shows clock/NEXT chrome while audience stays clean; **unplug + replug** → role remembered; **drag the operator window onto the projector** → its output is excluded (no output on the operator's screen).
- [ ] **P0-content — seed real service content**: the actual songs, scripture readings, and pre-service cards for Wednesday's service must be entered/imported on the Windows box (bundled KJV auto-installs on first run; confirm it's there). A dry run with real content, not lorem-ipsum.

### P1 — Makes the test trustworthy (do if the P0 dry-run leaves time)
- [x] **Fonts bundled** (A2) — Hanken Grotesk / JetBrains Mono / Newsreader now self-hosted in-app. Remaining: eyeball the projected render on Windows to confirm it matches the Mac.
- [ ] **Output-window behavior on Windows**: confirm the audience output is truly **fullscreen, frameless, always-on-top, no taskbar entry** on the projector (`setAlwaysOnTop(...,'screen-saver')` + `skipTaskbar` behave differently on Windows than macOS). No stray title bar or Windows chrome on the audience screen.
- [ ] **DPI / scaling**: if the laptop is at 125/150% and the projector at 100%, confirm the output fills the projector edge-to-edge and text isn't mis-scaled.
- [ ] **BUG-001 (stale focus ring)** — cosmetic; a mouse-clicked control keeps a faded focus ring after keyboard nav. Likely a one-shot global `:focus-visible` outline policy. Fix only if P0 is fully green; it won't stop the test.

### P2 — Explicitly deferred (do NOT do before Wednesday)
- All roadmap features: right-click context menus, quick-edit-in-preview, hotkey system, count-label change, secondary lyric matches, select-and-delete schedule items, dedicated pre-service scripture search. *(All post-MVP; `docs/superpowers/roadmap.md`.)*
- Media/deck/video flows — not a gating scope for Wednesday. If they happen to work, bonus. LibreOffice (deck import) already has a Windows path but degrades gracefully if absent; don't install it just for the test unless PPTX import is needed.
- [ ] **Bundled LibreOffice PPTX/PDF import (self-contained) — NOT YET VERIFIED.** On a
  packaged Windows build with **no** LibreOffice installed on the box: import a `.pptx`
  and a `.pdf` via **+ Import → Slides / PDF**. Confirm (a) every slide/page renders as a
  separate thumbnail on the projector (no first-slide-only truncation), (b) the file
  picker opens **parented** to the operator window (a sheet/owned modal), never behind the
  always-on-top audience output, and (c) right-click **Delete + Undo** works on a media
  row. This exercises the *bundled* `findSoffice` leg (`<resourcesPath>/libreoffice`) that
  cannot be driven from macOS. Leave unchecked until run on a real Windows box.

---

## Part C — Windows-specific watchouts (reference)
- **Display fingerprint = geometry on Windows.** `display.label` is usually empty on Windows, so Slice 6a fingerprints by resolution/scale/rotation (`roles.ts` `geo:` key). Role persistence works; the documented limit is two *identical* monitors sharing a role. One projector → no issue.
- **better-sqlite3 rebuild** is the recurring gotcha — a stray `npm install` re-triggers it; that's expected and fine as long as the toolchain is present.
- **No ffmpeg dependency** — audio features download only; nothing to install.
- **Bibles ship in-app** (`resources/bibles`, ~8.5 MB, via `extraResources`) — the installer carries them; bundled KJV auto-installs on first launch.

## Part D — Fallbacks if the Windows build fights back
1. **Native rebuild fails →** confirm VS Build Tools + Python (A4). If still stuck, try `npm run build:unpack` (portable `dist\win-unpacked\Helm.exe`, no installer) — same native requirement but removes NSIS from the equation while you debug.
2. **Packaging fails but the app runs →** `npm run dev` runs Helm from source (needs the repo + `npm install` on the box). Less polished, but a valid rehearsal path and proves the flows work.
3. **Display roles misbehave on the projector →** master's pre-6a behavior (every external display auto-shows the single audience feed) is the safety net; you still get a projected audience screen even if stage/livestream roles have trouble.

---

## Timeline suggestion
- **Today/Mon:** A1 merge + gate; A3 bundle; start A4 toolchain on the Windows box.
- **Mon/Tue:** A5 dry-run build + launch; A6 smoke test; fix whatever the dry-run surfaces (fonts, output window, native build).
- **Tue:** P0-content seeding with real Wednesday material; P1 items if green.
- **Wed:** final rehearsal, then the test.
</content>
