/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS script */
// Regenerates the raster brand assets from the vector sources in assets/.
//
//   node scripts/generate-brand-assets.mjs            # 64–1024, ico, icns, banner
//   node scripts/generate-brand-assets.mjs --small    # also icon-16/32
//
// Sources of truth:
//   assets/helm-mark.svg          — the gold helm wheel (96 viewBox)
//   assets/app-icon/icon-48.png   — hand-tuned; never regenerated
//   assets/app-icon/icon-{16,32}.png — drawn by scripts/small-wheel.mjs (thick
//                                   rim + 8 handle nubs, no spokes; #64) only
//                                   when --small is passed, never by accident
//
// Outputs:
//   assets/app-icon/icon-{64,128,256,512,1024}.png and icon.png (1024 master)
//   assets/github-banner.png      — 1280×640 social preview
//   build/icon.png (1024), build/icon.ico, build/icon.icns (macOS only)
//   resources/icon.png (256)      — runtime window icon
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import { TILE, roundRect, drawSmallWheel } from './small-wheel.mjs'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const appIconDir = path.join(root, 'assets', 'app-icon')

// Icon tile recipe (fitted to the brand deliverable PNGs): full-bleed rounded
// square, 23% corner radius, vertical navy gradient, mark at 64% of the tile.
// TILE itself lives in small-wheel.mjs so the 16/32 routine shares it.

const markSvg = fs.readFileSync(path.join(root, 'assets', 'helm-mark.svg'))

// Rasterize the mark at the size it will be drawn — an SVG image otherwise
// rasterizes at its intrinsic 96px and upscales blurry.
async function markAt(size) {
  const img = await loadImage(markSvg)
  img.width = size
  img.height = size
  return img
}

async function renderTile(size) {
  const c = createCanvas(size, size)
  const ctx = c.getContext('2d')
  roundRect(ctx, 0, 0, size, size, size * TILE.radius)
  const g = ctx.createLinearGradient(0, 0, 0, size)
  g.addColorStop(0, TILE.gradTop)
  g.addColorStop(1, TILE.gradBottom)
  ctx.fillStyle = g
  ctx.fill()
  const m = size * TILE.markScale
  const mark = await markAt(m)
  ctx.drawImage(mark, (size - m) / 2, (size - m) / 2, m, m)
  return c
}

function halve(canvas) {
  const n = createCanvas(canvas.width / 2, canvas.height / 2)
  const ctx = n.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, n.width, n.height)
  return n
}

async function generateIconPngs() {
  // Render once at 2048 and halve down the chain so every size shares the
  // same supersampled antialiasing.
  let c = await renderTile(2048)
  const out = {}
  for (const size of [1024, 512, 256, 128, 64]) {
    c = halve(c)
    out[size] = c.toBuffer('image/png')
    fs.writeFileSync(path.join(appIconDir, `icon-${size}.png`), out[size])
  }
  fs.writeFileSync(path.join(appIconDir, 'icon.png'), out[1024])
  return out
}

// .ico with PNG-compressed entries (valid on Windows Vista+).
function buildIco(sizes) {
  const entries = sizes.map((s) => ({
    size: s,
    data: fs.readFileSync(path.join(appIconDir, `icon-${s}.png`))
  }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + dir.length
  entries.forEach((e, i) => {
    const o = i * 16
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o) // width (0 = 256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1) // height
    dir.writeUInt8(0, o + 2) // palette
    dir.writeUInt8(0, o + 3) // reserved
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(e.data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += e.data.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)])
}

function buildIcns() {
  // iconutil ships with macOS; skip elsewhere (the committed icns stays put).
  if (os.platform() !== 'darwin') {
    console.log('skipping icon.icns (iconutil requires macOS)')
    return
  }
  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-iconset-')) + '.iconset'
  fs.mkdirSync(iconset)
  const map = {
    'icon_16x16.png': 16,
    'icon_16x16@2x.png': 32,
    'icon_32x32.png': 32,
    'icon_32x32@2x.png': 64,
    'icon_128x128.png': 128,
    'icon_128x128@2x.png': 256,
    'icon_256x256.png': 256,
    'icon_256x256@2x.png': 512,
    'icon_512x512.png': 512,
    'icon_512x512@2x.png': 1024
  }
  for (const [name, size] of Object.entries(map)) {
    fs.copyFileSync(path.join(appIconDir, `icon-${size}.png`), path.join(iconset, name))
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'build', 'icon.icns')])
  fs.rmSync(iconset, { recursive: true })
}

function font(pkg, file, family) {
  const p = path.join(root, 'node_modules', '@fontsource', pkg, 'files', file)
  GlobalFonts.registerFromPath(p, family)
}

async function generateBanner() {
  font('hanken-grotesk', 'hanken-grotesk-latin-800-normal.woff2', 'Hanken Grotesk')
  font('newsreader', 'newsreader-latin-400-italic.woff2', 'Newsreader')
  font('jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff2', 'JetBrains Mono')

  const W = 1280
  const H = 640
  const c = createCanvas(W, H)
  const ctx = c.getContext('2d')

  // linear-gradient(160deg, #1a2a4a, #0b1322)
  const rad = ((160 - 90) * Math.PI) / 180
  const L = (Math.abs(W * Math.cos(rad)) + Math.abs(H * Math.sin(rad))) / 2
  const g = ctx.createLinearGradient(
    W / 2 - L * Math.cos(rad),
    H / 2 - L * Math.sin(rad),
    W / 2 + L * Math.cos(rad),
    H / 2 + L * Math.sin(rad)
  )
  g.addColorStop(0, '#1a2a4a')
  g.addColorStop(1, '#0b1322')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // Watermark wheel: 720px, right: -190px, top: -60px, opacity .08
  ctx.globalAlpha = 0.08
  ctx.drawImage(await markAt(720), W - 720 + 190, -60, 720, 720)
  ctx.globalAlpha = 1

  // Content row: padding 0 110px, gap 44, vertically centered.
  ctx.drawImage(await markAt(128), 110, (H - 128) / 2, 128, 128)
  const textX = 110 + 128 + 44

  // Text block heights: 104 (Helm, line-height 1) + 18 + ~45 (tagline) +
  // 26 + 3 + 26 + ~21 (mono line) ≈ 243 → top edge centers the block.
  let y = (H - 243) / 2

  ctx.textBaseline = 'top'
  ctx.fillStyle = '#efe9dc'
  ctx.letterSpacing = `${-0.02 * 104}px`
  ctx.font = '800 104px "Hanken Grotesk"'
  ctx.fillText('Helm', textX, y)
  y += 104 + 18

  ctx.letterSpacing = '0px'
  ctx.fillStyle = '#c4bba6'
  ctx.font = 'italic 34px Newsreader'
  ctx.fillText('Run the service from one seat.', textX, y)
  y += 45 + 26

  ctx.fillStyle = '#e0a341'
  roundRect(ctx, textX, y, 56, 3, 2)
  ctx.fill()
  y += 3 + 26

  ctx.fillStyle = '#8b93a5'
  ctx.letterSpacing = `${0.18 * 16}px`
  ctx.font = '500 16px "JetBrains Mono"'
  ctx.fillText('SONGS · SCRIPTURE · MESSAGE · PRE-SERVICE', textX, y)
  ctx.letterSpacing = '0px'

  fs.writeFileSync(path.join(root, 'assets', 'github-banner.png'), c.toBuffer('image/png'))
}

if (process.argv.includes('--small')) {
  for (const size of [16, 32]) {
    fs.writeFileSync(
      path.join(appIconDir, `icon-${size}.png`),
      drawSmallWheel(size).toBuffer('image/png')
    )
  }
}
const pngs = await generateIconPngs()
fs.writeFileSync(path.join(root, 'build', 'icon.png'), pngs[1024])
fs.writeFileSync(path.join(root, 'resources', 'icon.png'), pngs[256])
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), buildIco([16, 32, 48, 64, 128, 256]))
buildIcns()
await generateBanner()
console.log('brand assets generated')
