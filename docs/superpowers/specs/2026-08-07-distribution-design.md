# Helm distribution — design

Date: 2026-08-07
Status: approved direction, pending spec review

## Goal

Non-tech-savvy church users can install Helm on Windows with one download, the app
updates itself from GitHub Releases when the user chooses, and libraries / saved
resources survive every update. Chase merges work freely and cuts a release only
when ready. Bugs and feature requests flow into GitHub Issues.

## Decisions already made

- **Windows first**; macOS later (architecture must not preclude it — it doesn't).
- **Public repo** at `github.com/chase-codes/helm`. Unlocks free unlimited Actions
  minutes (incl. Windows runners), public Releases for the updater, and future
  free-signing options (SignPath) if wanted.
- **Ship unsigned initially.** Signing is a fast-follow via Azure Artifact Signing
  (formerly Trusted Signing, ~$10/mo, open to US individuals, no hardware token).
  Research confirmed EV certs no longer grant instant SmartScreen reputation
  (Microsoft policy change, March 2024), so there is no reason to pay EV prices.
  Until signing lands, users see a SmartScreen warning: More info → Run anyway.
  The unsigned→signed update transition is safe; add `publisherName` to the
  electron-builder config when signing lands.
- **Single release channel** for now. CI artifacts on every merge cover
  pre-release testing; a beta channel (GitHub pre-releases + `electron-updater`
  `allowPrerelease`) slots in later without rework.
- **PPTX import must work in shipped builds** — CI must produce installers with
  the vendored LibreOffice tree (section 6). May be implemented as a follow-up
  phase but is part of this design, not an optional extra.

## Architecture

```
merge PR → ci.yml: lint + typecheck + test (ubuntu)
                   build NSIS installer (windows) → workflow artifact (smoke-testable)

npm version minor && git push --follow-tags
  → release.yml (on tag v*): test → build installer (+ LibreOffice tree)
      → publish DRAFT GitHub Release with latest.yml + Helm-Setup.exe
  → Chase edits notes, clicks Publish  ← final human gate

installed app → electron-updater checks Releases on launch + every few hours
  → downloads in background → quiet "Update ready" indicator
  → user clicks → quitAndInstall → new version, same userData
```

## Components

### 1. Repo + housekeeping

- Push existing local repo to `github.com/chase-codes/helm` (public, default
  branch `main`).
- `.github/ISSUE_TEMPLATE/`: structured issue forms — `bug_report.yml`
  (fields: Helm version, Windows version, what happened, steps) and
  `feature_request.yml`. `config.yml` disables blank issues.
- README gains a **Download** section: evergreen link
  `https://github.com/chase-codes/helm/releases/latest/download/Helm-Setup.exe`
  plus the SmartScreen note.

### 2. CI workflow (`.github/workflows/ci.yml`)

- Triggers: `pull_request`, `push` to `main`.
- Job `checks` (ubuntu): `npm ci`, lint, `typecheck`, `test`.
- Job `installer` (windows-latest): `npm ci`, `npm run build:win` (no publish),
  upload `Helm-Setup.exe` as a workflow artifact, 14-day retention. This is the
  smoke-test artifact for "test the exact thing before tagging".
- `node scripts/fetch-bibles.mjs` runs in CI before any installer build:
  `resources/bibles` is gitignored, so CI must fetch it (cache keyed on the
  script file to avoid hammering getbible.net).

### 3. Release workflow (`.github/workflows/release.yml`)

- Trigger: push of tag `v*`.
- Steps (windows-latest): `npm ci` → lint/typecheck/test → stage LibreOffice
  tree (section 6) → `electron-builder --win --publish always` with
  `GH_TOKEN` → electron-builder creates/updates a **draft** release
  (electron-builder publishes to draft by default when the release doesn't
  exist) containing `Helm-Setup.exe`, `latest.yml`, and blockmap.
- Guard: workflow fails if `package.json` version ≠ tag.
- Chase publishes the draft manually — that's the moment users start updating.
- Cutting a release locally is just: `npm version minor` (or `patch`) →
  `git push --follow-tags`.

### 4. Auto-update in the app

- Add `electron-updater` dependency; add `publish: {provider: github, owner:
  chase-codes, repo: helm}` to `electron-builder.yml`.
- Main process, after window ready: `autoUpdater.checkForUpdates()`, re-check
  every 4 hours. `autoDownload: true`.
- On `update-downloaded`: notify renderer over IPC. Renderer shows a quiet,
  non-modal indicator ("Update ready — restart when you like"). Clicking it
  calls `autoUpdater.quitAndInstall()`.
- **Presentation safety:** the indicator is suppressed (and quitAndInstall
  refused) while any live output display is up. No auto-restart, ever.
- All updater errors are logged, never surfaced as dialogs; offline machines
  keep working untouched.
- Stable artifact name: change `nsis.artifactName` to `Helm-Setup.${ext}`
  (evergreen download link; electron-updater identifies versions via
  `latest.yml`, not filename).

### 5. User-data persistence (already true — recorded as constraint)

- `helm.db` and `library/` live in `app.getPath('userData')`
  (`%APPDATA%/Helm`), untouched by NSIS install/update/uninstall (we do NOT
  set `deleteAppDataOnUninstall`).
- Existing ad-hoc migrations in `db.ts` run on first launch after update.
  Constraint going forward: schema changes are additive/idempotent; never
  destructive. A numbered-migration system is deliberately deferred until
  schema churn justifies it (YAGNI).

### 6. LibreOffice / PPTX import in CI builds

The app probes `<resources>/libreoffice/program/soffice.exe`
(mediaImport.ts) and falls back to a system LibreOffice, else shows the
no-libreoffice modal. The vendored tree exists on no machine today, so CI
must create it reproducibly:

- `scripts/vendor-libreoffice.mjs`: downloads the official LibreOffice
  Windows x64 MSI (pinned version + SHA256), performs an administrative
  extract (`msiexec /a`), prunes to the headless-conversion subset
  (`program/` without the GUI-only payloads — exact prune list determined
  empirically during implementation: extract, delete candidates, verify
  `soffice --headless --convert-to pdf` still works on a sample PPTX),
  and stages the result at `resources/libreoffice`.
- Release workflow runs it with an actions cache keyed on the pinned
  version, so the download/prune cost is paid once per LibreOffice bump.
- CI-built installers therefore ship working PPTX import. The size cost
  (likely 200–350 MB unpruned; pruning target <150 MB) is accepted —
  church media PCs have disk; a later "download on first PPTX import"
  optimization is possible but out of scope.
- This section may be implemented as a phase 2 behind the core pipeline,
  but a release is not considered "1.0-ready" without it.

### 7. In-app feedback

- Help menu (or settings screen) item "Report a problem" → opens default
  browser at `https://github.com/chase-codes/helm/issues/new?template=
  bug_report.yml&version=<appVersion>&os=<windowsVersion>` with fields
  prefilled via query params.

## Error handling

- Update check/download failure: log, retry at next scheduled check. Never
  block launch, never dialog.
- Release workflow failure: no draft release appears; nothing ships. Tests run
  in the release workflow itself, so a broken tag cannot publish.
- SmartScreen: documented in README; disappears once signing fast-follow lands
  and reputation accrues.

## Testing

- Pipeline: after repo push, cut `v0.1.0` end-to-end and install on a real
  Windows machine. Then cut `v0.1.1` (trivial change) and verify: quiet
  indicator appears, restart installs, `helm.db` + library intact.
- Updater logic (suppress-while-live, IPC) gets unit tests like the rest of
  main-process code; `electron-updater` itself is not re-tested.
- LibreOffice vendoring: CI step converts a fixture PPTX via the staged
  `soffice.exe` as its own verification.

## Deferred / backlog

- Azure Artifact Signing (fast-follow; ~$10/mo; add `publisherName` then).
- Beta channel via GitHub pre-releases + `allowPrerelease` opt-in.
- macOS: Developer ID cert + notarization; same Releases/updater flow.
- Numbered DB migrations when schema churn demands it.
- Friendlier standalone download page (a static site) if GitHub README ever
  feels too developer-y for churches.
