/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS script */
// Captures the product screenshots used by the landing page (site/) from the real app.
// Same launch pattern as the scratch/verify-*.mjs harnesses: playwright-core drives a
// packaged-layout Electron against an isolated --user-data-dir so a developer's real
// profile is never touched or photographed.
//
//   npm run build && node scripts/capture-site-shots.mjs
//
// Output: site/assets/shots/*.png
import { _electron as electron } from 'playwright-core'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(APP_DIR, 'site/assets/shots')
const electronBin = path.join(
  APP_DIR,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
)
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// The console shots are taken at 2x on a 1360x850 window: wide enough that the search
// pane, the cue list, and the preview all read at the sizes the page renders them.
const CONSOLE = { width: 1360, height: 850 }

fs.mkdirSync(SHOT_DIR, { recursive: true })
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-site-shots-'))

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_DIR, `--user-data-dir=${userDataDir}`],
  cwd: APP_DIR,
  timeout: 30_000
})
await sleep(6_000)
const op = app.windows().find((w) => w.url().includes('operator')) ?? (await app.firstWindow())

// deviceScaleFactor is fixed at launch, so the retina shots come from resizing the real
// window rather than a viewport override (Electron ignores setViewportSize). The operator
// window is picked by URL, not by index: displays.ts auto-attaches an output window to
// every non-operator display, so on a machine with a projector already plugged in,
// getAllWindows()[0] is not necessarily the console being photographed.
await app.evaluate(({ BrowserWindow }, size) => {
  const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('operator'))
  if (!w) throw new Error('no operator window to resize')
  w.setContentSize(size.width, size.height)
  w.center()
}, CONSOLE)
await sleep(1_200)

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) })
  console.log(`  ${name}.png`)
}

// The output window opens first so that everything below is photographed against a real
// attached screen — "1 OUTPUT" in the header rather than "0 OUTPUTS".
await op.evaluate(() => window.helm.displays.openTest())
await sleep(2_500)
const out = app.windows().find((w) => w.url().includes('output'))
if (out) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('output'))
    if (w) w.setContentSize(1280, 720)
  })
  await sleep(1_200)
} else {
  console.log('  WARN: no output window opened')
}

// The button renders as "⊙ Go live", so match on the words and let Playwright's
// substring matching handle the icon.
const goLive = op.locator('button', { hasText: 'Go live' }).locator('visible=true').first()
async function takeLive(label) {
  if ((await goLive.count()) !== 1) {
    console.log(`  WARN: no Go live button on ${label} — shot will show nothing on screen`)
    return
  }
  await goLive.click()
  await sleep(1_000)
}

// --- Songs: the hero shot. The library seeds "Amazing Grace" cued on load, so one
// click on Go live is enough to photograph a console in its working state. ---
console.log('songs')
await takeLive('songs')
await shot(op, 'console-songs')

// --- The output window, photographed while that same song is live: this is the pair
// the hero leans on (one state, two renders). ---
console.log('output')
if (out) {
  const text = await out.evaluate(() => document.body.innerText)
  if (!text.includes('Amazing grace')) console.log(`  WARN: output is not showing the lyric`)
  await shot(out, 'output-slide')
}

// --- Sermon: the scripture track, typed reference and chapter rail. ---
console.log('sermon')
await op.locator('button', { hasText: 'Sermon' }).first().click()
await sleep(1_500)
const refInput = op
  .locator('input[placeholder*="john" i], input[placeholder*="reference" i]')
  .first()
if ((await refInput.count()) === 1) {
  await refInput.click()
  await refInput.type('john 3:16', { delay: 60 })
  await sleep(400)
  await refInput.press('Enter')
  await sleep(1_500)
  // Typing a reference schedules it; opening the scheduled reading is what moves the
  // preview onto John 3:16 instead of leaving Genesis 1:1 cued from the seed.
  const scheduled = op.locator('text=John 3:16').last()
  if ((await scheduled.count()) >= 1) {
    await scheduled.click()
    await sleep(1_200)
  }
} else {
  console.log('  WARN: no reference input found — sermon shot is the bare tab')
}
await takeLive('sermon')
await shot(op, 'console-sermon')

// --- Pre-service: the rotating loop, with a card actually on the screen. ---
console.log('pre-service')
await op.locator('button', { hasText: 'Pre-service' }).first().click()
await sleep(1_500)
const showCard = op.locator('button', { hasText: 'Show this card' }).first()
if ((await showCard.count()) === 1) {
  await showCard.click()
  await sleep(1_200)
}
await shot(op, 'console-pre')

await app.close()
fs.rmSync(userDataDir, { recursive: true, force: true })

// --- Encode for the web. The raw retina PNGs total ~2 MB, which is most of a landing
// page's budget spent on four images. Each is resized to twice its largest rendered
// size and re-encoded as WebP; the PNGs are intermediate and are removed. ---
console.log('\nencoding')
const { createCanvas, loadImage } = await import('@napi-rs/canvas')
// width = 2x the widest the page ever renders this image.
const TARGETS = {
  'console-songs': 2200,
  'console-sermon': 2200,
  'console-pre': 2200,
  'output-slide': 1600
}
for (const [name, targetWidth] of Object.entries(TARGETS)) {
  const src = path.join(SHOT_DIR, `${name}.png`)
  if (!fs.existsSync(src)) {
    console.log(`  WARN: ${name}.png missing — skipped`)
    continue
  }
  const img = await loadImage(src)
  const w = Math.min(targetWidth, img.width)
  const h = Math.round((img.height / img.width) * w)
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  const webp = await canvas.encode('webp', 82)
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.webp`), webp)
  fs.rmSync(src)
  console.log(`  ${name}.webp  ${w}x${h}  ${(webp.length / 1024).toFixed(0)} kB`)
}

console.log(`\nScreenshots: ${SHOT_DIR}`)
