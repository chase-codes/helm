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
  writeFileSync
} from 'node:fs'
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
  path.join('Resources', 'share', 'Scripts'),
  // macOS-only fat: bundled Python (macro scripting, unused by --convert-to),
  // spellcheck dictionaries + the nlpsolver Calc extension, and the Java
  // bridge (macros/extensions). No win32 equivalent path, so these are no-ops
  // there. Everything else in Frameworks/Resources is load-bearing per the
  // smoke test below.
  path.join('Frameworks', 'LibreOfficePython.framework'),
  path.join('Resources', 'extensions'),
  path.join('Resources', 'java')
]

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
        stdio: ['ignore', 'ignore', 'inherit']
      })
    }
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
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

  if (process.platform === 'darwin') resignMachOTree(dest)

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
