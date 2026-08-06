// Pulpit view modes real-app verification (Plan B Task 9): cycles a test-output window
// through slides -> leader -> mirror -> slides via the 'test' fingerprint seam
// (window.helm.displays.setView('test', v)), with a song live, and checks the header
// popover opens. There are no external displays on this dev machine, so this drives the
// test-output window (window.helm.displays.openTest()) instead of a real attached display.
import { _electron as electron } from 'playwright-core'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'

const APP_DIR = '/Users/lem/repos/helm/.claude/worktrees/sermon-resize-pulpit-views'
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(APP_DIR, 'scratch/views-shots')
const electronBin = path.join(
  APP_DIR,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.mkdirSync(SHOT_DIR, { recursive: true })

// A fresh, isolated --user-data-dir so this run never touches (or is polluted by) a
// developer's real profile — same rationale as verify-sermon-resize.mjs.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-verify-views-'))
const LAUNCH_ARGS = [APP_DIR, `--user-data-dir=${userDataDir}`]

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const app = await electron.launch({
  executablePath: electronBin,
  args: LAUNCH_ARGS,
  cwd: APP_DIR,
  timeout: 30_000
})
await sleep(6_000)
const op = app.windows().find((w) => w.url().includes('operator')) ?? (await app.firstWindow())

// --- 1. Open a test output window (the seam Task 3 built for displayless dev machines). ---
await op.evaluate(() => window.helm.displays.openTest())
await sleep(2_000)
const out = app.windows().find((w) => w.url().includes('output'))
if (!out) {
  console.log('FAIL  no output window opened after openTest()')
  await app.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
  process.exit(1)
}
check('test output window opened', true)

// --- 2. Put a song live via the real Songs-tab UI (Songs is the default mode). ---
// The song library seeds "Amazing Grace" first (refreshLibrary(true) selects songs[0]),
// so it is already cued on load — clicking "Go live" is enough to put it on screen.
const goLiveBtn = op.locator('button', { hasText: /^● Go live$/ }).locator('visible=true')
check('Go live button present', (await goLiveBtn.count()) === 1)
await goLiveBtn.click()
await sleep(700)
const pres = await op.evaluate(() => window.helm.presentation.get())
check(
  'song is live',
  pres.output === 'live' && !!pres.liveKey,
  `output=${pres.output} liveKey=${pres.liveKey}`
)

// --- 3. Slides view (default): screenshot as the "before" baseline. ---
await sleep(500)
await out.screenshot({ path: path.join(SHOT_DIR, 'slides.png') })
const slidesText = await out.evaluate(() => document.body.innerText)
check(
  'slides view shows the live lyric line',
  slidesText.includes('Amazing grace'),
  slidesText.slice(0, 80)
)

// --- 4. Leader view: hero + rail, one section highlighted data-live="true". ---
await op.evaluate(() => window.helm.displays.setView('test', 'leader'))
await out.waitForSelector('[data-testid="leader-view"]', { timeout: 5_000 })
await sleep(600)
await out.screenshot({ path: path.join(SHOT_DIR, 'leader.png') })

const railInfo = await out.evaluate(() => {
  const rail = document.querySelector('[data-testid="leader-rail"]')
  if (!rail) return null
  const cards = [...rail.querySelectorAll('[data-testid^="leader-section-"]')]
  return {
    count: cards.length,
    liveCount: cards.filter((c) => c.getAttribute('data-live') === 'true').length,
    labels: cards.map((c) => c.textContent?.slice(0, 30))
  }
})
check('leader rail lists sections', !!railInfo && railInfo.count > 0, JSON.stringify(railInfo))
check(
  'exactly one rail section is marked data-live="true"',
  !!railInfo && railInfo.liveCount === 1,
  `liveCount=${railInfo?.liveCount}`
)

// --- 5. Mirror view: either a live captured frame OR the permission/error message is a
// pass on this unprivileged/headless dev machine — log which occurred. ---
await op.evaluate(() => window.helm.displays.setView('test', 'mirror'))
await out.waitForSelector('[data-testid="mirror-view"]', { timeout: 5_000 })
await sleep(2_500) // let getDisplayMedia settle (resolve or reject) before inspecting.
await out.screenshot({ path: path.join(SHOT_DIR, 'mirror.png') })

const mirrorInfo = await out.evaluate(() => {
  const video = document.querySelector('[data-testid="mirror-video"]')
  const error = document.querySelector('[data-testid="mirror-error"]')
  return {
    hasVideo: !!video,
    videoHasStream: !!(video && video.srcObject),
    hasError: !!error,
    errorText: error ? error.textContent : null
  }
})
if (mirrorInfo.hasVideo && mirrorInfo.videoHasStream) {
  console.log('MIRROR OUTCOME: live captured video stream')
  check('mirror view shows a live video stream', true)
} else if (mirrorInfo.hasError) {
  console.log(`MIRROR OUTCOME: permission/error message — "${mirrorInfo.errorText}"`)
  check('mirror view shows the permission/error fallback message', true, mirrorInfo.errorText ?? '')
} else {
  console.log('MIRROR OUTCOME: neither a live stream nor an error message was found')
  check(
    'mirror view resolved to a video stream or an error message',
    false,
    JSON.stringify(mirrorInfo)
  )
}

// --- 6. Back to slides: switching away and back must restore the lyrics. ---
await op.evaluate(() => window.helm.displays.setView('test', 'slides'))
await sleep(1_000)
await out.screenshot({ path: path.join(SHOT_DIR, 'slides-after.png') })
const slidesAfterText = await out.evaluate(() => document.body.innerText)
check(
  'slides view is back and shows the live lyric line again',
  slidesAfterText.includes('Amazing grace'),
  slidesAfterText.slice(0, 80)
)
check(
  'slides view text is identical before/after the cycle',
  slidesAfterText === slidesText,
  slidesAfterText === slidesText
    ? ''
    : `before="${slidesText.slice(0, 80)}" after="${slidesAfterText.slice(0, 80)}"`
)

// --- 7. Header popover: click the outputs chip, expect it to open. On this dev machine
// there are no external displays attached (the test-output window is intentionally NOT
// listed by the popover — it only lists real displays via displayStatus()), so the
// three-way control itself may not be visible; either the control rows OR the "no output
// displays connected" empty state is a pass — log which occurred. ---
const outputsChip = op.locator('button[title="Output views"]')
check('outputs chip button present', (await outputsChip.count()) === 1)
await outputsChip.click()
await op.waitForSelector('[data-testid="output-view-popover"]', { timeout: 5_000 })
await sleep(300)
await op.screenshot({ path: path.join(SHOT_DIR, 'popover.png') })

const popoverInfo = await op.evaluate(() => {
  const pop = document.querySelector('[data-testid="output-view-popover"]')
  if (!pop) return null
  const segButtons = [...pop.querySelectorAll('button[data-testid^="view-"]')]
  return { text: pop.textContent ?? '', segButtonCount: segButtons.length }
})
check('output view popover opened', !!popoverInfo, JSON.stringify(popoverInfo))
if (popoverInfo && popoverInfo.segButtonCount > 0) {
  console.log(
    `POPOVER OUTCOME: lists ${popoverInfo.segButtonCount / 3} screen(s) with the three-way control`
  )
} else if (popoverInfo) {
  console.log(`POPOVER OUTCOME: empty state — "${popoverInfo.text}"`)
}

await app.close()
fs.rmSync(userDataDir, { recursive: true, force: true })

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(`Screenshots: ${SHOT_DIR}`)
process.exit(failed.length ? 1 : 0)
