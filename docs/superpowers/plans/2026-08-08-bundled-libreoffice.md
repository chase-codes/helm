# Bundled LibreOffice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shipped Helm installers (Windows x64, macOS arm64) import PPTX with nothing else installed, by vendoring a pruned LibreOffice into `resources/libreoffice` at build time.

**Architecture:** One vendor script downloads a pinned LibreOffice (MSI on Windows via `msiexec /a`, DMG on macOS via `hdiutil`), verifies its SHA-256, prunes GUI-only payload, stages it where `bundledSofficeCandidates` (`src/main/mediaImport.ts:68`) already probes, and smoke-tests a real headless conversion. CI and release workflows run it behind an actions cache. Zero app-code changes.

**Tech Stack:** Node ESM script (`node:child_process`, `node:crypto`, `node:fs`), GitHub Actions (`actions/cache@v4`), electron-builder `extraResources` (already configured).

**Spec:** `docs/superpowers/specs/2026-08-08-bundled-libreoffice-design.md`

## Global Constraints

- Pinned LibreOffice **25.8.7** (current "still" line). Win MSI SHA-256 `ecdb65e76f5e91dc198b8c8dce5b5d6e1eb12fea6023553e52b591afd10b619d`; mac aarch64 DMG SHA-256 `e7556aa61e282f89578ebaf35afdb09c94dcf9d6ee7c137004377bee81a6e900`.
- Staged tree shape is fixed by `bundledSofficeCandidates`: `resources/libreoffice/program/soffice.exe` (win32), `resources/libreoffice/MacOS/soffice` (darwin). Do not change `mediaImport.ts`.
- `resources/libreoffice` never enters git (150+ MB).
- Vendor failures (hash, download, broken convert, missing Impress lib) must fail the build loudly — no silent fallback in CI.
- Commit style: concise conventional-commit subjects, **no** `Co-Authored-By`/`Claude-Session` trailers.
- The vendor script is validated by executing it (mac locally, Windows via `workflow_dispatch` CI), not by vitest — its built-in smoke test is the gate.

---

### Task 1: `scripts/vendor-libreoffice.mjs` + .gitignore

**Files:**
- Create: `scripts/vendor-libreoffice.mjs`
- Modify: `.gitignore` (add `resources/libreoffice/`)

**Interfaces:**
- Consumes: nothing from the app. Downloads from `download.documentfoundation.org`.
- Produces: `node scripts/vendor-libreoffice.mjs` → staged pruned tree at `resources/libreoffice/` with the platform's soffice at the probed path; exits 0 with a notice on unsupported platforms (Linux, Intel mac); exits 0 fast if already staged. Tasks 2–4 rely on exactly this command and path.

- [ ] **Step 1: Add `resources/libreoffice/` to `.gitignore`**

Append under the existing entries:

```gitignore
# Vendored LibreOffice tree (150+ MB) — staged by scripts/vendor-libreoffice.mjs
resources/libreoffice/
```

- [ ] **Step 2: Write `scripts/vendor-libreoffice.mjs`**

Follow the house style of `scripts/fetch-bibles.mjs` (plain-JS eslint pragma on `main`, top comment with run instructions):

```js
// Stages a pruned, headless-capable LibreOffice at resources/libreoffice so
// electron-builder's extraResources ships self-contained PPTX import.
// Windows x64 (msiexec admin extract) and macOS arm64 (hdiutil) only; other
// platforms exit 0 with a notice. The app probes
// resources/libreoffice/program/soffice.exe (win) or .../MacOS/soffice (mac) —
// see bundledSofficeCandidates in src/main/mediaImport.ts.
// Run with: node scripts/vendor-libreoffice.mjs
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '25.8.7'
const ARTIFACTS = {
  win32: {
    url: `https://download.documentfoundation.org/libreoffice/stable/${VERSION}/win/x86_64/LibreOffice_${VERSION}_Win_x86-64.msi`,
    sha256: 'ecdb65e76f5e91dc198b8c8dce5b5d6e1eb12fea6023553e52b591afd10b619d'
  },
  darwin: {
    url: `https://download.documentfoundation.org/libreoffice/stable/${VERSION}/mac/aarch64/LibreOffice_${VERSION}_MacOS_aarch64.dmg`,
    sha256: 'e7556aa61e282f89578ebaf35afdb09c94dcf9d6ee7c137004377bee81a6e900'
  }
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(root, 'resources', 'libreoffice')
const work = path.join(root, 'dist', 'lo-vendor')
const supported =
  process.platform === 'win32' || (process.platform === 'darwin' && process.arch === 'arm64')

const sofficeRel =
  process.platform === 'win32' ? path.join('program', 'soffice.exe') : path.join('MacOS', 'soffice')

// Paths that are safe to drop (docs/media/wizards); filters and libs stay.
// rmSync force:true makes entries that don't exist on a platform no-ops.
// Extend ONLY while the smoke test below still passes.
const PRUNE = [
  'help',
  'readmes',
  path.join('share', 'gallery'),
  path.join('share', 'template'),
  path.join('share', 'wizards'),
  path.join('share', 'Scripts'),
  path.join('program', 'wizards'),
  path.join('Resources', 'help'),
  path.join('Resources', 'gallery'),
  path.join('Resources', 'template'),
  path.join('Resources', 'wizards'),
  path.join('Resources', 'Scripts'),
  path.join('Resources', 'share', 'gallery'),
  path.join('Resources', 'share', 'template'),
  path.join('Resources', 'share', 'wizards'),
  path.join('Resources', 'share', 'Scripts')
]

/** Recursively look for a filename containing `needle` (Impress lib guard). */
function treeContains(dir, needle) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (treeContains(path.join(dir, e.name), needle)) return true
    } else if (e.name.includes(needle)) return true
  }
  return false
}

async function download(url, toFile) {
  console.log(`Downloading ${url} ...`)
  const res = await fetch(url, { signal: AbortSignal.timeout(600_000) })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  writeFileSync(toFile, Buffer.from(await res.arrayBuffer()))
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
async function main() {
  if (!supported) {
    console.log(
      `vendor-libreoffice: unsupported platform (${process.platform}/${process.arch}), skipping — PPTX import will use a system LibreOffice if present.`
    )
    return
  }
  if (existsSync(path.join(dest, sofficeRel))) {
    console.log('vendor-libreoffice: already staged, skipping.')
    return
  }

  const { url, sha256 } = ARTIFACTS[process.platform]
  mkdirSync(work, { recursive: true })
  const archive = path.join(work, path.basename(url))
  if (!existsSync(archive)) await download(url, archive)
  const hash = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (hash !== sha256) throw new Error(`SHA256 mismatch for ${archive}: got ${hash}`)

  // Extract, then locate the dir that holds the soffice binary's parent tree.
  let tree
  if (process.platform === 'win32') {
    const extract = path.join(work, 'extract')
    rmSync(extract, { recursive: true, force: true })
    // Administrative extract: unpacks payload, installs nothing, needs no admin.
    execFileSync('msiexec', ['/a', archive, '/qn', `TARGETDIR=${extract}`], { stdio: 'inherit' })
    tree = findWinTree(extract)
    if (!tree) throw new Error('program/soffice.exe not found in extracted MSI')
  } else {
    const mount = path.join(work, 'mnt')
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, archive], {
      stdio: 'inherit'
    })
    try {
      tree = path.join(work, 'Contents')
      rmSync(tree, { recursive: true, force: true })
      // verbatimSymlinks keeps Frameworks' internal symlinks as symlinks.
      cpSync(path.join(mount, 'LibreOffice.app', 'Contents'), tree, {
        recursive: true,
        verbatimSymlinks: true
      })
    } finally {
      execFileSync('hdiutil', ['detach', mount], { stdio: 'inherit' })
    }
  }

  for (const rel of PRUNE) rmSync(path.join(tree, rel), { recursive: true, force: true })

  rmSync(dest, { recursive: true, force: true })
  cpSync(tree, dest, { recursive: true, verbatimSymlinks: true })

  // Smoke test the STAGED tree: headless convert must actually produce a PDF.
  // A hermetic profile dir keeps the run off any real user profile.
  const probe = path.join(work, 'probe.txt')
  writeFileSync(probe, 'helm vendor smoke test')
  rmSync(path.join(work, 'probe.pdf'), { force: true })
  execFileSync(
    path.join(dest, sofficeRel),
    [
      `-env:UserInstallation=file://${path.join(work, 'lo-profile').replace(/\\/g, '/')}`,
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      work,
      probe
    ],
    { stdio: 'inherit' }
  )
  if (!existsSync(path.join(work, 'probe.pdf'))) throw new Error('headless convert produced no PDF')
  // Impress must survive the prune — PPTX conversion is the whole point.
  if (!treeContains(dest, 'sdlo')) {
    throw new Error('Impress library (sdlo) missing after prune — check PRUNE list')
  }
  console.log('vendor-libreoffice: staged OK')
}

/** Admin extracts nest under a product dir — search for program/soffice.exe. */
function findWinTree(dir) {
  if (existsSync(path.join(dir, 'program', 'soffice.exe'))) return dir
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const hit = findWinTree(path.join(dir, e.name))
      if (hit) return hit
    }
  }
  return null
}

await main()
```

- [ ] **Step 3: Run the darwin path for real (this repo's dev machine is an arm64 Mac)**

Run: `node scripts/vendor-libreoffice.mjs`
Expected: downloads ~300 MB DMG (once — it stays in `dist/lo-vendor/`), mounts, copies, prunes, then prints `vendor-libreoffice: staged OK`. Takes a few minutes.

- [ ] **Step 4: Verify the staged shape, re-run for idempotence, check git is clean**

Run: `ls resources/libreoffice/MacOS/soffice && du -sh resources/libreoffice && node scripts/vendor-libreoffice.mjs && git status --porcelain`
Expected: soffice exists; tree size printed (target: under ~150 MB — if well over, extend PRUNE and re-run from `rm -rf resources/libreoffice`); second run prints `already staged, skipping.`; git status shows only `.gitignore` and the new script (no `resources/libreoffice`).

- [ ] **Step 5: Lint and commit**

Run: `npm run lint`
Expected: clean.

```bash
git add scripts/vendor-libreoffice.mjs .gitignore
git commit -m "feat(build): vendor-libreoffice script — self-contained PPTX import (win x64 + mac arm64)"
```

---

### Task 2: Local packaged mac build — bundled leg verified end-to-end

**Files:**
- None created/modified (verification task; produces a local `dist/` build only).

**Interfaces:**
- Consumes: staged `resources/libreoffice` from Task 1; `npm run build:mac`; the shipped import pipeline (Sermon → Slides → **+ Import**).
- Produces: evidence the bundled probe leg works in a packaged app — the gate for wiring CI in Tasks 3–4.

- [ ] **Step 1: Confirm no system LibreOffice can mask the bundled leg**

Run: `which soffice; ls /Applications | grep -i libre; ls /usr/local/bin/soffice /usr/bin/soffice 2>/dev/null`
Expected: nothing found (verified true on this machine at plan time). If one appears, temporarily rename it for this test so success can only come from the bundled tree.

- [ ] **Step 2: Generate a sample PPTX with the staged soffice**

Run:

```bash
echo "helm e2e deck" > dist/lo-vendor/sample.txt
resources/libreoffice/MacOS/soffice -env:UserInstallation=file:///tmp/lo-e2e-profile \
  --headless --convert-to pptx --outdir dist/lo-vendor dist/lo-vendor/sample.txt
ls dist/lo-vendor/sample.pptx
```

Expected: `sample.pptx` exists.

- [ ] **Step 3: Build the packaged mac app**

Run: `npm run build:mac`
Expected: succeeds; `dist/mac-arm64/Helm.app` exists and `ls "dist/mac-arm64/Helm.app/Contents/Resources/libreoffice/MacOS/soffice"` finds the binary. If electron-builder's ad-hoc signing errors on the vendored binaries, add to `electron-builder.yml` under `mac:` the key `signIgnore: [libreoffice]` and re-run — record whichever outcome in the task notes.

- [ ] **Step 4: Drive the real app through a PPTX import**

Run: `open dist/mac-arm64/Helm.app`, then in the operator window: Sermon → Slides → **+ Import** → pick `dist/lo-vendor/sample.pptx`.
Expected: converting/rasterizing progress, then the deck appears with a slide thumbnail, auto-selected; no `no-libreoffice` modal. This proves `findSoffice` resolved the bundled tree.

- [ ] **Step 5: Note the un-tested residue**

No commit (nothing changed). Record in the session/task notes: a *locally built* app has no quarantine attribute, so **Gatekeeper on a browser-downloaded DMG remains unverified** — it is called out in Task 4's release checklist step.

---

### Task 3: `ci.yml` — workflow_dispatch + cached vendor step, proven in CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `node scripts/vendor-libreoffice.mjs` (Task 1) and its skip-if-staged behavior.
- Produces: the cache+vendor YAML block that Task 4 copies into `release.yml`; a CI-built Windows installer artifact that contains the LibreOffice tree.

- [ ] **Step 1: Edit `ci.yml`**

Add `workflow_dispatch:` to the `on:` block (enables `gh workflow run` from a branch — the msiexec path can only execute on Windows):

```yaml
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
```

In the `installer` job, insert after the `Fetch bundled bibles` step (before `npm run build`):

```yaml
      - name: Cache bundled LibreOffice
        id: libreoffice
        uses: actions/cache@v4
        with:
          path: resources/libreoffice
          key: libreoffice-${{ runner.os }}-${{ hashFiles('scripts/vendor-libreoffice.mjs') }}
      - name: Vendor LibreOffice
        if: steps.libreoffice.outputs.cache-hit != 'true'
        run: node scripts/vendor-libreoffice.mjs
```

(The cache key hashes the script, so bumping `VERSION` or the PRUNE list naturally invalidates it.)

- [ ] **Step 2: Commit and push on a branch, trigger a run**

```bash
git checkout -b bundled-libreoffice   # if not already on the feature branch
git add .github/workflows/ci.yml
git commit -m "ci: vendor LibreOffice into the Windows installer build"
git push -u origin bundled-libreoffice
gh workflow run CI --ref bundled-libreoffice
```

- [ ] **Step 3: Watch the run to completion**

Run: `gh run watch $(gh run list --workflow CI --branch bundled-libreoffice --limit 1 --json databaseId -q '.[0].databaseId')`
Expected: `installer` job green. In its log, the `Vendor LibreOffice` step prints `staged OK` (msiexec extract + smoke convert both worked on `windows-latest`). If the vendor script fails, fix it, push, re-dispatch — this is the iterate loop for the Windows-only path.

- [ ] **Step 4: Confirm the artifact actually contains LibreOffice**

Run: `gh run view <run-id> --json jobs` then download: `gh run download <run-id> -n helm-setup -D dist/ci-artifact`
Expected: `Helm-Setup.exe` (or `*-setup.exe`) is roughly **250 MB** — an order-of-size jump from the previous ~100 MB proves the tree shipped. (Optional deeper check on any Windows box: install it and look for `resources\libreoffice\program\soffice.exe`.)

- [ ] **Step 5: Verify the cache round-trips**

Run: `gh workflow run CI --ref bundled-libreoffice`, watch as in Step 3.
Expected: `Cache bundled LibreOffice` reports a cache hit and `Vendor LibreOffice` is skipped; run is faster and still green.

---

### Task 4: `release.yml` — vendor in the Windows job + new mac arm64 job, docs updated

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `electron-builder.yml` (comment only)
- Modify: `docs/superpowers/plans/2026-07-06-mvp-windows-test-plan.md` (A3b section)
- Modify: `docs/superpowers/plans/2026-08-07-distribution-pipeline.md` (Task 11 header note)

**Interfaces:**
- Consumes: the exact cache+vendor block from Task 3; `node scripts/vendor-libreoffice.mjs` on `macos-14` (arm64 runner → darwin path).
- Produces: a release pipeline whose next tag build publishes `Helm-Setup.exe` + `Helm-<version>-arm64.dmg` (name per existing `dmg.artifactName`: `${name}-${version}.${ext}`), both self-contained, into one draft release.

- [ ] **Step 1: Edit `release.yml`**

In the existing `release` job, insert the same block as Task 3 after `Fetch bundled bibles`:

```yaml
      - name: Cache bundled LibreOffice
        id: libreoffice
        uses: actions/cache@v4
        with:
          path: resources/libreoffice
          key: libreoffice-${{ runner.os }}-${{ hashFiles('scripts/vendor-libreoffice.mjs') }}
      - name: Vendor LibreOffice
        if: steps.libreoffice.outputs.cache-hit != 'true'
        run: node scripts/vendor-libreoffice.mjs
```

Append a mac job. `needs: release` serializes the two publishes so electron-builder never races to create the same draft release twice:

```yaml
  release-mac:
    runs-on: macos-14
    needs: release
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - name: Verify tag matches package.json version
        run: |
          TAG="${GITHUB_REF_NAME#v}"
          PKG="$(node -p "require('./package.json').version")"
          if [ "$TAG" != "$PKG" ]; then
            echo "Tag v$TAG does not match package.json version $PKG" >&2
            exit 1
          fi
      - run: npm ci
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
      - name: Cache bundled LibreOffice
        id: libreoffice
        uses: actions/cache@v4
        with:
          path: resources/libreoffice
          key: libreoffice-${{ runner.os }}-${{ hashFiles('scripts/vendor-libreoffice.mjs') }}
      - name: Vendor LibreOffice
        if: steps.libreoffice.outputs.cache-hit != 'true'
        run: node scripts/vendor-libreoffice.mjs
      - run: npm run build
      - name: Build DMG and publish to draft release
        run: npx electron-builder --mac --arm64 --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

(No `shell: bash` needed on macos — bash is the default there; the Windows job keeps its existing `shell: bash` line.)

- [ ] **Step 2: Update `electron-builder.yml`'s stale comment**

Replace the comment block above `extraResources` (lines 15–18) with:

```yaml
# resources/libreoffice is a vendored, per-OS LibreOffice-headless tree kept OUTSIDE git
# (large). Stage it with `node scripts/vendor-libreoffice.mjs` (win x64 / mac arm64; CI
# does this automatically). If the folder is absent the build still succeeds but PPTX
# import degrades to the no-libreoffice fallback modal at runtime.
```

- [ ] **Step 3: Update the two plan docs**

In `docs/superpowers/plans/2026-07-06-mvp-windows-test-plan.md` section A3b, after the sentence ending `resources/libreoffice/program/soffice.exe`, append:

```markdown
Staging is now automated: `node scripts/vendor-libreoffice.mjs` (CI runs it for
installer and release builds — see `docs/superpowers/plans/2026-08-08-bundled-libreoffice.md`).
```

In `docs/superpowers/plans/2026-08-07-distribution-pipeline.md`, directly under the `### Task 11: LibreOffice vendoring — PPTX import in shipped builds` heading, insert:

```markdown
> **Superseded 2026-08-08** by `docs/superpowers/plans/2026-08-08-bundled-libreoffice.md`
> (adds the macOS arm64 leg; same Windows approach). Tracked and executed there.
```

- [ ] **Step 4: Validate YAML and commit**

Run: `npx yaml-lint .github/workflows/release.yml 2>/dev/null || node -e "const y=require('js-yaml');y.load(require('fs').readFileSync('.github/workflows/release.yml','utf8'));console.log('yaml ok')"`
Expected: parses clean (js-yaml ships with the dependency tree; if neither tool is available, `python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/release.yml'))"` works too).

```bash
git add .github/workflows/release.yml electron-builder.yml \
  docs/superpowers/plans/2026-07-06-mvp-windows-test-plan.md \
  docs/superpowers/plans/2026-08-07-distribution-pipeline.md
git commit -m "ci(release): self-contained installers — vendor LibreOffice, add mac arm64 release job"
```

- [ ] **Step 5: Record what the next release must verify (the human gate)**

The release workflow itself only runs on the next `v*` tag — that cut (not this branch) proves it end-to-end. Confirm these live in the Task 10 checklist of `docs/superpowers/plans/2026-08-07-distribution-pipeline.md`, adding any that are missing under its existing items:

```markdown
- [ ] Windows box, NO LibreOffice installed: install Helm-Setup.exe, import a `.pptx`,
      slides render on the projector (bundled-soffice leg).
- [ ] Mac (arm64), browser-downloaded DMG: right-click-open Helm, import a `.pptx`.
      If macOS blocks the bundled soffice (quarantine on first spawn), record the exact
      dialog and apply the spec's fallback (ad-hoc sign the tree at vendor time, or
      documented `xattr -dr com.apple.quarantine` guidance) as a follow-up fix.
```

If edited, amend or commit with: `git commit -am "docs(plan): fold self-contained PPTX checks into the Windows/mac release checklist"`

---

## Self-review notes

- **Spec coverage:** vendor script win+mac (Task 1), local mac E2E incl. signing contingency (Task 2), CI wiring + workflow_dispatch + cache (Task 3), release wiring + mac job + doc updates + human verification gate (Task 4). Runtime fallback behavior needs no task — unchanged app code.
- **Deliberate non-goals repeated from the spec:** no Linux/Intel-mac vendoring, no download-on-first-import, no mac auto-update work.
- **The one unprovable-here leg:** release.yml executes only on the next tag; Task 4 Step 5 pins where that verification lives.
