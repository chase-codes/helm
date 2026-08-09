// Stages a pruned, headless-capable LibreOffice at resources/libreoffice so
// electron-builder's extraResources ships self-contained PPTX import.
// Windows x64 (msiexec admin extract) and macOS arm64 (hdiutil) only; other
// platforms exit 0 with a notice. The app probes
// resources/libreoffice/program/soffice.exe (win) or .../MacOS/soffice (mac) —
// see bundledSofficeCandidates in src/main/mediaImport.ts.
// Run with: node scripts/vendor-libreoffice.mjs
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const VERSION = '25.8.7'
// download.documentfoundation.org/stable/<VERSION>/... only serves the current point
// release; once a newer one ships, <VERSION> moves to the archive host and the stable
// URL 404s, breaking every future build that still pins this VERSION. TDF's archive
// mirrors each stable build the moment it releases (not just after rotation), but under
// a *build-numbered* path/filename — old/<VERSION>.<N>/... — where N is a rebuild
// counter that isn't derivable from VERSION alone. ARCHIVE_VERSION below is the exact
// build that was probed and confirmed (via the archive host's SHA-256 response header)
// to be byte-identical to the pinned stable artifact for this VERSION. When VERSION is
// bumped, re-probe old/<VERSION>.1/, .2/, .3/, ... on downloadarchive until one serves a
// `digest: SHA-256=...` header matching the new pinned hash, and update ARCHIVE_VERSION
// to match (it may not exist yet if the new VERSION hasn't been superseded on "stable").
const ARCHIVE_VERSION = '25.8.7.3'
const ARTIFACTS = {
  win32: {
    url: `https://download.documentfoundation.org/libreoffice/stable/${VERSION}/win/x86_64/LibreOffice_${VERSION}_Win_x86-64.msi`,
    archiveUrl: `https://downloadarchive.documentfoundation.org/libreoffice/old/${ARCHIVE_VERSION}/win/x86_64/LibreOffice_${ARCHIVE_VERSION}_Win_x86-64.msi`,
    sha256: 'ecdb65e76f5e91dc198b8c8dce5b5d6e1eb12fea6023553e52b591afd10b619d'
  },
  darwin: {
    url: `https://download.documentfoundation.org/libreoffice/stable/${VERSION}/mac/aarch64/LibreOffice_${VERSION}_MacOS_aarch64.dmg`,
    archiveUrl: `https://downloadarchive.documentfoundation.org/libreoffice/old/${ARCHIVE_VERSION}/mac/aarch64/LibreOffice_${ARCHIVE_VERSION}_MacOS_aarch64.dmg`,
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

// Written as the LAST statement of a successful run (after the smoke test +
// Impress guard both pass). Gating the "already staged" skip on this — not on
// sofficeRel merely existing — means a run that dies partway through (after
// cpSync but before/during the smoke test) leaves no stamp, so the next
// invocation re-vendors instead of silently reporting success on a tree that
// can't actually convert anything. Bumping VERSION also invalidates it.
//
// The stamp content is `${VERSION}:${sha256 of this script's own source}`, not
// just VERSION. CI's cache key already hashes this script (so a cache miss
// re-vendors there), but a local dev tree has no such cache: without the
// script hash baked into the stamp, editing e.g. the PRUNE list and re-running
// locally would silently skip — "already staged" — against a tree pruned by
// the OLD script. Hashing the script closes that hole for both paths.
const stampPath = path.join(dest, '.helm-vendor-ok')
const scriptHash = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')
const expectedStamp = `${VERSION}:${scriptHash}`

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
function stagedStamp() {
  try {
    return readFileSync(stampPath, 'utf8').trim()
  } catch {
    return null
  }
}

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
  // win32 equivalents of the macOS-only cuts below: bundled extensions
  // (spellcheck dictionaries, nlpsolver — same as Resources/extensions) and
  // the Java UNO bridge jars (same as Resources/java). The bundled Python
  // interpreter's win32 equivalent (program/python-core-<ver>/) is pruned
  // separately below by pattern, since its directory name is version-suffixed.
  path.join('share', 'extensions'),
  path.join('program', 'classes'),
  path.join('Resources', 'help'),
  path.join('Resources', 'gallery'),
  path.join('Resources', 'template'),
  path.join('Resources', 'wizards'),
  path.join('Resources', 'Scripts'),
  path.join('Resources', 'share', 'gallery'),
  path.join('Resources', 'share', 'template'),
  path.join('Resources', 'share', 'wizards'),
  path.join('Resources', 'share', 'Scripts'),
  // macOS-only fat, no win32 equivalent path (no-ops there): bundled Python
  // (macro scripting, unused by --convert-to), spellcheck dictionaries + the
  // nlpsolver Calc extension, the Java bridge (macros/extensions), the PDF
  // *import* filter's resource data (mediaImport.ts never routes .pdf through
  // soffice — see the `isPdf` branch — so this is dead weight here), and the
  // bundle's outer code-signature seal (stale by construction: soffice and
  // every dylib get re-signed individually by resignMachOTree below, which
  // makes the original bundle-level seal both wrong and unused).
  path.join('Frameworks', 'LibreOfficePython.framework'),
  path.join('Resources', 'extensions'),
  path.join('Resources', 'java'),
  path.join('Resources', 'xpdfimport'),
  '_CodeSignature'
]

// What's NOT in PRUNE, and why — checked individually, not inferred from the
// smoke test passing (a pass only shows what remains is sufficient, never
// that it's required):
//   - Frameworks/libmergedlo.dylib and libicudata.dylib.77: hard dyld
//     dependencies of soffice — deleting either aborts it immediately with
//     "Library not loaded", confirmed by temporarily removing each and
//     running `soffice --version`. Genuinely required.
//   - Resources/fonts: NOT a hard dependency (soffice converts fine without
//     it, confirmed the same way) but kept deliberately — PPTX files commonly
//     reference Office fonts (Calibri, Cambria, ...) that LibreOffice ships
//     metric-compatible substitutes for, and dropping them risks visibly
//     wrong text layout in imported slides. That's a rendering-fidelity
//     concern the smoke test's plain-text probe wouldn't catch either way, so
//     it's kept on purpose rather than because something failed without it.

/** Recursively look for a filename containing `needle` (Impress lib guard). */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
function treeContains(dir, needle) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (treeContains(path.join(dir, e.name), needle)) return true
    } else if (e.name.includes(needle)) return true
  }
  return false
}

const MACHO_MAGICS = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca
])

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
function isMachO(file) {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(4)
    if (readSync(fd, buf, 0, 4, 0) < 4) return false
    return MACHO_MAGICS.has(buf.readUInt32LE(0))
  } finally {
    closeSync(fd)
  }
}

/**
 * Ad-hoc re-sign every Mach-O file in the staged tree. Apple's original
 * signatures are bound to the `LibreOffice.app/Contents/...` bundle shape;
 * once staged at resources/libreoffice/MacOS/soffice (no .app wrapper) they
 * no longer verify, and macOS kills soffice (and any dylib it loads) at exec
 * with "the signature on the file is invalid" — regardless of what PRUNE
 * removes. An ad-hoc signature is self-consistent no matter where the file
 * lives, so this must run after cpSync, before the smoke test.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
function resignMachOTree(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      resignMachOTree(full)
    } else if (e.isFile() && isMachO(full)) {
      execFileSync('codesign', ['--force', '-s', '-', full], {
        stdio: ['ignore', 'ignore', 'inherit'],
        timeout: 5 * 60_000
      })
    }
  }
}

// Tries each URL in order (primary "stable" host, then archive fallback), falling
// through to the next on a non-OK response or a network failure. The same pinned
// SHA256 is checked by the caller regardless of which URL wins, so integrity is
// unaffected by which source actually served the bytes.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
async function download(urls, toFile) {
  let lastErr
  for (const url of urls) {
    console.log(`Downloading ${url} ...`)
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(600_000) })
      if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
      writeFileSync(toFile, Buffer.from(await res.arrayBuffer()))
      return
    } catch (err) {
      lastErr = err
      console.log(`vendor-libreoffice: download from ${url} failed (${err.message})`)
    }
  }
  throw lastErr
}

/**
 * Detach the mounted DMG, tolerating a busy mount (e.g. Spotlight/quicklook still
 * indexing it right after `hdiutil attach`). Tries a plain detach, then one more
 * plain retry after a short pause, then `-force`. A detach failure must never
 * replace whatever error is already propagating out of the try block above (or
 * fail an otherwise fully-successful run) — it's a leftover mount, not a build
 * failure — so on exhausting retries this only warns, never throws.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
async function detachDmg(mount) {
  const attempts = [
    () => execFileSync('hdiutil', ['detach', mount], { stdio: 'inherit' }),
    () => execFileSync('hdiutil', ['detach', mount], { stdio: 'inherit' }),
    () => execFileSync('hdiutil', ['detach', '-force', mount], { stdio: 'inherit' })
  ]
  for (let i = 0; i < attempts.length; i++) {
    try {
      attempts[i]()
      return
    } catch (err) {
      if (i === attempts.length - 1) {
        console.error(`vendor-libreoffice: WARNING hdiutil detach ${mount} failed after retries: ${err.message}`)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
async function main() {
  if (!supported) {
    console.log(
      `vendor-libreoffice: unsupported platform (${process.platform}/${process.arch}), skipping — PPTX import will use a system LibreOffice if present.`
    )
    return
  }
  if (stagedStamp() === expectedStamp) {
    console.log('vendor-libreoffice: already staged, skipping.')
    return
  }

  const { url, archiveUrl, sha256 } = ARTIFACTS[process.platform]
  mkdirSync(work, { recursive: true })
  const archive = path.join(work, path.basename(url))
  console.log('vendor-libreoffice: phase=download')
  if (!existsSync(archive)) await download([url, archiveUrl], archive)
  console.log('vendor-libreoffice: phase=verify')
  let hash = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (hash !== sha256) {
    // A cached archive (CI cache restore, or a leftover dist/lo-vendor from a prior
    // local run) that fails the hash check is most often corruption from an
    // interrupted download, not a moved-target attack — treating it as permanently
    // fatal would wedge every future run on the same machine/cache. Delete it and
    // retry the full [primary, archive-host] download chain exactly once; only a
    // fresh download that STILL mismatches is treated as fatal.
    console.log(`vendor-libreoffice: SHA256 mismatch for ${archive} (got ${hash}), re-downloading once...`)
    rmSync(archive, { force: true })
    await download([url, archiveUrl], archive)
    hash = createHash('sha256').update(readFileSync(archive)).digest('hex')
    if (hash !== sha256) throw new Error(`SHA256 mismatch for ${archive} after re-download: got ${hash}`)
  }

  // Extract, then locate the dir that holds the soffice binary's parent tree.
  console.log('vendor-libreoffice: phase=extract')
  let tree
  if (process.platform === 'win32') {
    const extract = path.join(work, 'extract')
    rmSync(extract, { recursive: true, force: true })
    // Administrative extract: unpacks payload, installs nothing, needs no admin.
    //
    // msiexec parses `PROPERTY=value` as a single token and expects any embedded
    // spaces to be quoted around the *value only* (`TARGETDIR="C:\path with
    // spaces"`), not around the whole `PROPERTY=value` token. Node's default
    // Windows argv quoting (execFileSync without windowsVerbatimArguments) does the
    // latter — if `extract` contains a space it emits `"TARGETDIR=C:\path with
    // spaces"`, which msiexec misparses as an unknown property. windowsVerbatimArguments
    // hands the argv string to CreateProcess unescaped, so we build each token's
    // quoting ourselves: quote a path only if it contains whitespace, and for
    // TARGETDIR quote just the value, matching msiexec's own expectation. This is a
    // no-op on non-Windows (windowsVerbatimArguments is ignored there) and a no-op
    // here whenever no path contains a space (the common case, incl. CI runners).
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
    const quoteWin = (s) => (/\s/.test(s) ? `"${s}"` : s)
    execFileSync(
      'msiexec',
      ['/a', quoteWin(archive), '/qn', `TARGETDIR=${quoteWin(extract)}`],
      { stdio: 'inherit', timeout: 15 * 60_000, windowsVerbatimArguments: true }
    )
    console.log('vendor-libreoffice: phase=locate')
    tree = findWinTree(extract)
    if (!tree) throw new Error('program/soffice.exe not found in extracted MSI')
    // Defense in depth: a future flat MSI layout could leave the payload-stripped
    // .msi (msiexec's own admin-image artifact, not a real installer) sitting inside
    // the extracted tree next to program/. Make sure it can never get copied into
    // dest by cpSync below.
    rmSync(path.join(tree, path.basename(archive)), { force: true })
  } else {
    const mount = path.join(work, 'mnt')
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, archive], {
      stdio: 'inherit'
    })
    try {
      console.log('vendor-libreoffice: phase=locate')
      tree = path.join(work, 'Contents')
      rmSync(tree, { recursive: true, force: true })
      // verbatimSymlinks keeps Frameworks' internal symlinks as symlinks.
      cpSync(path.join(mount, 'LibreOffice.app', 'Contents'), tree, {
        recursive: true,
        verbatimSymlinks: true
      })
    } finally {
      await detachDmg(mount)
    }
  }

  console.log('vendor-libreoffice: phase=prune')
  for (const rel of PRUNE) rmSync(path.join(tree, rel), { recursive: true, force: true })

  // Windows-only: bundled Python interpreter (program/python-core-<ver>/), the
  // win32 equivalent of macOS's Frameworks/LibreOfficePython.framework — same
  // justification (macro scripting, unused by --convert-to). The directory
  // name is version-suffixed, so match by pattern instead of hardcoding it.
  if (process.platform === 'win32') {
    const programDir = path.join(tree, 'program')
    if (existsSync(programDir)) {
      for (const name of readdirSync(programDir)) {
        if (/^python-core-/.test(name)) {
          rmSync(path.join(programDir, name), { recursive: true, force: true })
        }
      }
    }
  }

  // GUI icon themes (images_*.zip) — headless conversion never draws a
  // toolbar. Exact filenames vary by icon theme/point release, so match by
  // pattern instead of hardcoding ~20 names into PRUNE. Lives at
  // Resources/config on macOS, share/config on Windows.
  const configDir = path.join(tree, process.platform === 'win32' ? 'share' : 'Resources', 'config')
  if (existsSync(configDir)) {
    for (const name of readdirSync(configDir)) {
      if (/^images_.*\.zip$/.test(name)) rmSync(path.join(configDir, name), { force: true })
    }
  }

  console.log('vendor-libreoffice: phase=stage')
  rmSync(dest, { recursive: true, force: true })
  cpSync(tree, dest, { recursive: true, verbatimSymlinks: true })

  if (process.platform === 'darwin') {
    console.log('vendor-libreoffice: phase=resign')
    resignMachOTree(dest)
  }

  console.log('vendor-libreoffice: phase=smoke-test')
  // Fast pre-check, run before the real (slower) conversion below: Impress must
  // survive the prune — PPTX conversion is the whole point of vendoring this at
  // all. Failing here first gives a clear cause instead of an opaque soffice
  // error if some future PRUNE edit accidentally deletes the Impress library.
  if (!treeContains(dest, 'sdlo')) {
    throw new Error('Impress library (sdlo) missing after prune — check PRUNE list')
  }

  // Smoke test the STAGED tree: headless convert must actually turn a real PPTX
  // into a PDF via the Impress import/export path — a plain-text probe would only
  // ever exercise Writer, never proving Impress conversion (the whole point of
  // vendoring LibreOffice) actually works. A hermetic profile dir keeps the run
  // off any real user profile. The URL is built with pathToFileURL rather than by
  // hand-concatenating `file://` + path: a malformed URL (e.g. the two-slash
  // `file://D:/...`, which on Windows parses "D:" as a host instead of a drive
  // letter) silently falls back to the default per-user profile path and risks
  // soffice hitting the interactive first-run/registration dialog that a headless
  // CI runner can never dismiss. pathToFileURL also percent-encodes spaces
  // correctly, which naive string concatenation does not (see the msiexec
  // TARGETDIR fix above for the sibling spaced-path hazard on Windows).
  const fixture = path.join(root, 'scripts', 'fixtures', 'smoke.pptx')
  const outPdf = path.join(work, 'smoke.pdf')
  rmSync(outPdf, { force: true })
  const profileDir = path.join(work, 'lo-profile')
  const profileUrl = pathToFileURL(profileDir).href
  execFileSync(
    path.join(dest, sofficeRel),
    [
      `-env:UserInstallation=${profileUrl}`,
      '--headless',
      '--norestore',
      '--convert-to',
      'pdf',
      '--outdir',
      work,
      fixture
    ],
    { stdio: 'inherit', timeout: 5 * 60_000 }
  )
  if (!existsSync(outPdf)) throw new Error('headless convert (Impress) produced no PDF')
  const outSize = statSync(outPdf).size
  if (outSize <= 1024) throw new Error(`smoke-test PDF is suspiciously small (${outSize} bytes)`)

  // Last statement of a successful run — see stampPath comment above.
  writeFileSync(stampPath, expectedStamp)
  console.log('vendor-libreoffice: staged OK')
}

/** Admin extracts nest under a product dir — search for program/soffice.exe. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
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
