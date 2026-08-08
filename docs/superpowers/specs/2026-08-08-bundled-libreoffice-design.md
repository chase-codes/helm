# Bundled LibreOffice — self-contained PPTX import (design)

**Date:** 2026-08-08 · **Status:** approved for planning

## Goal

A shipped Helm installer imports a `.pptx` with **nothing else installed** on the
operator's machine. This finishes the "self-contained" requirement from the media-import
design (`2026-07-07-media-import-design.md`) and section 6 of the distribution design
(`2026-08-07-distribution-design.md`) — the release spec says no build is 1.0-ready
without it.

**Platforms:** Windows x64 and macOS Apple Silicon (arm64). Linux keeps the
system-install fallback. Intel Macs fall back to "install LibreOffice yourself".

## What already exists (and does not change)

- `src/main/mediaImport.ts` probes, in order: **bundled tree under
  `process.resourcesPath` → known install locations → PATH**. `bundledSofficeCandidates`
  expects `libreoffice/program/soffice.exe` (win32) or `libreoffice/MacOS/soffice` /
  `libreoffice/program/soffice` (darwin). Tested; zero app-code changes in this design.
- `electron-builder.yml` already maps `resources/libreoffice → libreoffice` via
  `extraResources`, and documents that the tree lives outside git.
- The conversion pipeline (soffice → PDF → pdfjs/canvas → PNGs) is shipped and covered
  by the media-import spec. This design only makes the binary exist in shipped builds.

## Components

### 1. `scripts/vendor-libreoffice.mjs`

One script, dispatching on `process.platform`. Pins **one** LibreOffice version — the
older ("still") line of the stable branch at
`download.documentfoundation.org/libreoffice/stable/` — with a SHA-256 constant per
artifact (MSI and DMG). Exact version + hashes are pinned at implementation time.

Common shape on both platforms: skip if already staged → download → verify SHA-256 →
extract → locate the tree containing the soffice binary → prune → stage at
`resources/libreoffice/` → smoke-test → assert Impress survived.

- **win32:** administrative extract via `msiexec /a` (no install, no admin rights).
  Stage so `program/soffice.exe` exists. Impress guard: `program/sdlo.dll`.
- **darwin:** `hdiutil attach` the aarch64 DMG, copy `LibreOffice.app/Contents/*` so
  `MacOS/soffice` exists (the whole `Contents` layout is preserved — soffice resolves
  `Frameworks/` and `Resources/` relative to itself). Impress guard: the Impress
  library dylib (exact name confirmed empirically during implementation).
- **any other platform:** print a notice and exit 0, so builds elsewhere keep working.

**Prune list** (per platform, extended only while the smoke test still passes):
help, readmes, galleries, templates, wizards, scripts — filters and libraries stay.
Target: LibreOffice tree under ~150 MB.

**Smoke test is part of the script,** not a separate step: convert a generated sample
file to PDF with `--headless --convert-to pdf` from the *staged* tree and fail loudly
if no PDF appears. A prune that breaks conversion can never reach a release.

### 2. CI / release wiring

- `release.yml`: add a `macos-14` (arm64) job mirroring the Windows job — checks →
  vendor script → `npm run build` → `electron-builder --mac --arm64 --publish always`.
  Both jobs publish into the same draft release.
- Both release jobs and `ci.yml`'s Windows installer job run the vendor script behind
  `actions/cache` keyed on the pinned version — download/prune cost is paid once per
  LibreOffice bump.
- `ci.yml` gains `workflow_dispatch` so the Windows vendor path (msiexec-only) can be
  iterated from a branch via `gh workflow run`.
- Local mac builds: the darwin path runs on a dev Mac (hdiutil is stock), so a packaged
  self-contained mac build is testable locally before any release.

## Error handling

- Vendor script failures (bad hash, download error, broken post-prune convert, missing
  Impress lib) fail the build — never a silent fallback in CI.
- At runtime nothing changes: if the tree is somehow absent, the existing
  `no-libreoffice` modal path handles it, as today.

## Known risks (verify, don't guess)

- **mac Gatekeeper.** Helm is unsigned (`notarize: false`). Everything copied from a
  quarantined DMG inherits quarantine, and spawning the bundled `soffice` may be
  blocked even after the user approves Helm. Must be verified on a real Mac with a
  DMG that actually went through a browser download. Fallbacks if it bites, decided
  empirically: ad-hoc signing the staged tree at vendor time, or documented
  right-click-open / `xattr -dr com.apple.quarantine` guidance.
- **mac auto-update** requires a signed app, so the mac DMG stays manual-download.
  Already true today; recorded here so nobody expects otherwise.
- **Windows acceptance is human:** Task 10's checklist — on a Windows box with no
  LibreOffice installed, install Helm, import a `.pptx`, see slides on the projector.

## Accepted costs

Installer size grows to roughly 250 MB per platform (spec'd and accepted in the
distribution design — church media PCs have disk). Release cadence gains a mac job.

## Out of scope

Linux vendoring; Intel Mac support; download-on-first-import; `.key` decks; signing /
notarization work beyond what Gatekeeper verification forces.
