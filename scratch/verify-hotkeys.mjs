// Hotkey system + ChapterRail scroll real-app verification (SDD Task 7 for
// docs/superpowers/plans/2026-08-06-hotkeys-and-rail-scroll.md). Drives the real Electron
// app via playwright-core's `_electron.launch` against this worktree's own build/binary —
// no external displays are needed since everything under test lives in the operator window.
// Pattern follows scratch/verify-views.mjs / scratch/verify-sermon-resize.mjs.
import { _electron as electron } from 'playwright-core'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'

const APP_DIR = '/Users/lem/repos/helm/.claude/worktrees/hotkeys-and-rail-scroll'
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(APP_DIR, 'scratch/hotkeys-shots')
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.mkdirSync(SHOT_DIR, { recursive: true })

// One isolated --user-data-dir reused across BOTH launches (initial + the relaunch that
// proves rebind persistence) — same rationale as verify-sermon-resize.mjs.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-verify-hotkeys-'))
const LAUNCH_ARGS = [APP_DIR, `--user-data-dir=${userDataDir}`]

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

async function launch() {
  const app = await electron.launch({ executablePath: electronBin, args: LAUNCH_ARGS, cwd: APP_DIR, timeout: 30_000 })
  await sleep(5_000)
  const op = app.windows().find((w) => w.url().includes('operator')) ?? (await app.firstWindow())
  return { app, op }
}

// Songs hero label ("NOW SINGING · <section>") is a leaf div (no child elements) — its
// ancestor wrapper divs also start with the same text (React nests it inside a couple of
// plain <div>s with no separator before the lyric lines), so filtering to a childless node
// is what isolates the exact label text instead of "label + concatenated lyric lines".
const heroText = (op) =>
  op.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(
      (e) => e.children.length === 0 && e.textContent?.startsWith('NOW SINGING')
    )
    return el ? el.textContent : null
  })

const SEARCH_PLACEHOLDER = 'Title or a lyric line…'
const ENTRY_PLACEHOLDER = 'Add reading — John 3:16'

let { app, op } = await launch()

try {
  // ============================================================
  // PHASE 1 — Songs page: chorus/bridge/tag/verse jumps, live-follow, black-output no-op
  // ============================================================
  await op.screenshot({ path: path.join(SHOT_DIR, '01-songs-default.png') })

  const librarySongs = await op.evaluate(() => window.helm.songs.list())
  const amazingGrace = librarySongs.find((s) => s.title === 'Amazing Grace')
  check(
    'seed song Amazing Grace is verse-only (no chorus)',
    !!amazingGrace && amazingGrace.sections.every((s) => /^Verse/i.test(s.label)),
    amazingGrace ? amazingGrace.sections.map((s) => s.label).join(',') : 'missing'
  )

  // No seeded hymn has Chorus + a second Verse + Bridge + Tag together, so add one through
  // the real QuickAdd modal (NOT a direct window.helm.songs.add() call — SongsMode's
  // `library` state is only fetched once on mount, and a raw API call bypasses the
  // onQuickAddSaved callback that appends to it, leaving `activeSong` unresolved and the
  // whole hero panel blank even though the row highlights as selected. QuickAdd is the
  // only path that keeps UI state in sync with the DB.) to get positive-path coverage for
  // every section-jump action in one song.
  await op.getByRole('button', { name: '+ Add a song — search or paste' }).click()
  await sleep(400)
  await op.getByPlaceholder('Song title').fill('Hotkey QA Song')
  await op
    .getByPlaceholder(/Paste lyrics here/)
    .fill(
      'Verse 1\nfirst verse line\n\nChorus\nchorus line\n\nVerse 2\nsecond verse line\n\nBridge\nbridge line\n\nTag\ntag line'
    )
  await sleep(300)
  await op.getByRole('button', { name: 'Add to library' }).click()
  await sleep(500)
  let hero = await heroText(op)
  check('QA song saved + selected, lands on Verse 1', hero === 'NOW SINGING · Verse 1', hero)
  await op.screenshot({ path: path.join(SHOT_DIR, '02-qa-song-verse1.png') })

  const qaSong = (await op.evaluate(() => window.helm.songs.list())).find((s) => s.title === 'Hotkey QA Song')
  check(
    'QA song has 5 sections (Verse1/Chorus/Verse2/Bridge/Tag)',
    !!qaSong && qaSong.sections.length === 5,
    qaSong ? qaSong.sections.map((s) => s.label).join(',') : 'missing'
  )

  await op.keyboard.press('c')
  await sleep(300)
  hero = await heroText(op)
  check("'c' jumps to Chorus", hero === 'NOW SINGING · Chorus', hero)

  await op.keyboard.press('2')
  await sleep(300)
  hero = await heroText(op)
  check("'2' jumps to Verse 2", hero === 'NOW SINGING · Verse 2', hero)

  await op.keyboard.press('b')
  await sleep(300)
  hero = await heroText(op)
  check("'b' jumps to Bridge", hero === 'NOW SINGING · Bridge', hero)

  await op.keyboard.press('t')
  await sleep(300)
  hero = await heroText(op)
  check("'t' jumps to Tag", hero === 'NOW SINGING · Tag', hero)

  await op.keyboard.press('Home')
  await sleep(300)
  hero = await heroText(op)
  check("'Home' (chorus synonym) jumps to Chorus", hero === 'NOW SINGING · Chorus', hero)
  await op.screenshot({ path: path.join(SHOT_DIR, '03-section-jumps.png') })

  // Go live, then confirm a section jump changes the live output in the SAME keypress.
  const goLiveBtn = op.locator('button', { hasText: /^● Go live$/ }).locator('visible=true')
  await goLiveBtn.click()
  await sleep(500)
  let pres = await op.evaluate(() => window.helm.presentation.get())
  check('song is live after Go live click', pres.output === 'live' && !!pres.liveKey, JSON.stringify(pres))

  await op.keyboard.press('2') // Chorus(1) -> Verse 2(2): a real key change, not a same-key no-op
  await sleep(500)
  pres = await op.evaluate(() => window.helm.presentation.get())
  hero = await heroText(op)
  check(
    'live song: jump moves the live output in one press',
    pres.output === 'live' && pres.liveKey === `song:${qaSong.id}:2` && hero === 'NOW SINGING · Verse 2',
    JSON.stringify({ pres, hero })
  )
  await op.screenshot({ path: path.join(SHOT_DIR, '04-live-follow.png') })

  const takeDownBtn = op.locator('button', { hasText: /Take down/ }).locator('visible=true')
  await takeDownBtn.click()
  await sleep(400)
  pres = await op.evaluate(() => window.helm.presentation.get())
  check('Take down sets output black', pres.output === 'black', JSON.stringify(pres))

  const liveKeyBeforeBlindJump = pres.liveKey
  await op.keyboard.press('b')
  await sleep(300)
  pres = await op.evaluate(() => window.helm.presentation.get())
  hero = await heroText(op)
  check(
    'with output black, a jump only moves the selection (screen unchanged)',
    hero === 'NOW SINGING · Bridge' && pres.output === 'black' && pres.liveKey === liveKeyBeforeBlindJump,
    JSON.stringify({ hero, pres })
  )

  // ============================================================
  // PHASE 2 — page switching + Mod+L scripture lookup
  // ============================================================
  await op.keyboard.press('Meta+3')
  await sleep(600)
  let onSermon = await op.getByPlaceholder(ENTRY_PLACEHOLDER).count()
  check('Meta+3 switches to Sermon page', onSermon > 0, `entryCount=${onSermon}`)
  await op.screenshot({ path: path.join(SHOT_DIR, '05-sermon-page.png') })

  await op.keyboard.press('Meta+2')
  await sleep(600)
  let backOnSongs = await op.getByPlaceholder(SEARCH_PLACEHOLDER).count()
  check('Meta+2 switches back to Songs page', backOnSongs > 0, `searchCount=${backOnSongs}`)

  await op.keyboard.press('Meta+L')
  await sleep(700) // lookupNonce's track-switch effect is deferred a tick before the focus effect runs
  let active = await op.evaluate(() => document.activeElement?.getAttribute('placeholder'))
  check(
    'Meta+L lands on Sermon/Scripture with the ref entry focused',
    active === ENTRY_PLACEHOLDER,
    String(active)
  )
  await op.screenshot({ path: path.join(SHOT_DIR, '06-modl-lookup-focused.png') })

  // ============================================================
  // PHASE 3 — '/' focus + Mod+Backspace clear, on both pages
  // ============================================================
  await op.keyboard.type('xyz')
  await sleep(200)
  let entryVal = await op.evaluate(() => document.querySelector('input[placeholder^="Add reading"]')?.value)
  check('typing lands in the (already-focused) scripture entry', entryVal === 'xyz', entryVal)

  await op.keyboard.press('Meta+Backspace')
  await sleep(200)
  entryVal = await op.evaluate(() => document.querySelector('input[placeholder^="Add reading"]')?.value)
  check('Mod+Backspace clears the scripture entry', entryVal === '', entryVal)

  await op.keyboard.press('Meta+2')
  await sleep(500)
  await op.evaluate(() => document.activeElement?.blur())
  await sleep(150)
  await op.keyboard.press('/')
  await sleep(200)
  active = await op.evaluate(() => document.activeElement?.getAttribute('placeholder'))
  check("'/' focuses song search on the Songs page", active === SEARCH_PLACEHOLDER, String(active))

  await op.getByPlaceholder(SEARCH_PLACEHOLDER).fill('grace')
  await sleep(200)
  let qval = await op.evaluate(() => document.activeElement?.value)
  check('typed query lands in the song search field', qval === 'grace', qval)

  await op.keyboard.press('Meta+Backspace')
  await sleep(200)
  qval = await op.evaluate(() => document.activeElement?.value)
  check('Mod+Backspace clears the song search field', qval === '', qval)

  // ============================================================
  // PHASE 4 — Scripture: reading digit hotkeys + ChapterRail scrollRequest
  // ============================================================
  await op.keyboard.press('Meta+3')
  await sleep(600)

  const entry = op.getByPlaceholder(ENTRY_PLACEHOLDER)
  for (const ref of ['John 3:16', 'John 3:18', 'Romans 8:28']) {
    await entry.click()
    await entry.fill(ref)
    await sleep(150)
    await op.keyboard.press('Enter')
    await sleep(400)
  }
  const scheduled = await op.evaluate(() => window.helm.schedule.list())
  check(
    '3 readings scheduled in order (John 3:16, John 3:18, Romans 8:28)',
    scheduled.length === 3 &&
      scheduled[0].book === 'John' &&
      scheduled[0].from === 16 &&
      scheduled[1].book === 'John' &&
      scheduled[1].from === 18 &&
      scheduled[2].book === 'Romans' &&
      scheduled[2].from === 28,
    JSON.stringify(scheduled)
  )
  await op.screenshot({ path: path.join(SHOT_DIR, '07-scripture-schedule.png') })

  // Go live on the scripture cursor so subsequent jumps are independently verifiable via
  // presentation.get().liveKey (scr:<book>:<ch>:<v>), not just DOM text.
  const scrGoLiveBtn = op.locator('button', { hasText: /^● Go live$/ }).locator('visible=true')
  await scrGoLiveBtn.click()
  await sleep(500)
  pres = await op.evaluate(() => window.helm.presentation.get())
  check('scripture cursor is live', pres.output === 'live' && !!pres.liveKey, JSON.stringify(pres))

  await op.evaluate(() => document.activeElement?.blur())
  await sleep(150)
  await op.keyboard.press('2') // reading 2 = John 3:18
  await sleep(700) // cross-book jump: chapter fetch + rail rows landing
  pres = await op.evaluate(() => window.helm.presentation.get())
  check(
    "digit '2' jumps the cursor to reading 2 (John 3:18) and follows live",
    pres.liveKey === 'scr:John:3:18',
    JSON.stringify(pres)
  )

  // NOTE on measurement: `listRef`'s div has no `position` set, so `offsetTop` is NOT
  // relative to it (offsetParent skips unpositioned ancestors) — comparing offsetTop to
  // scrollTop looks like a fixed ~130px "gap" that is actually just wrong math, confirmed
  // stable over 3s of polling in scratch/debug-rail-scroll.mjs. getBoundingClientRect()
  // deltas are relative to the viewport regardless of positioning and are the correct way
  // to check "is this row's top flush with the container's top".
  let railInfo = await op.evaluate(() => {
    const row = document.querySelector('[data-verse="18"]')
    if (!row) return null
    const c = row.parentElement
    const rr = row.getBoundingClientRect()
    const cr = c.getBoundingClientRect()
    return { relTop: rr.top - cr.top }
  })
  check(
    "reading-2 jump pins verse 18's row to the top of the rail",
    !!railInfo && Math.abs(railInfo.relTop) < 2,
    JSON.stringify(railInfo)
  )
  await op.screenshot({ path: path.join(SHOT_DIR, '08-reading2-rail-pinned.png') })

  // Click a scheduled reading in ANOTHER chapter/book — same gesture, mouse-driven.
  await op.getByRole('button', { name: /Romans 8:28/ }).first().click()
  await sleep(800) // cross-book jump again
  pres = await op.evaluate(() => window.helm.presentation.get())
  check('clicking a reading in another book jumps + follows live', pres.liveKey === 'scr:Romans:8:28', JSON.stringify(pres))

  railInfo = await op.evaluate(() => {
    const row = document.querySelector('[data-verse="28"]')
    if (!row) return null
    const c = row.parentElement
    const rr = row.getBoundingClientRect()
    const cr = c.getBoundingClientRect()
    return { relTop: rr.top - cr.top }
  })
  check(
    'schedule-row click pins the start verse to the top after the chapter loads',
    !!railInfo && Math.abs(railInfo.relTop) < 2,
    JSON.stringify(railInfo)
  )
  await op.screenshot({ path: path.join(SHOT_DIR, '09-cross-chapter-click-pinned.png') })

  // ArrowRight steps the verse; the rail should keep the cued verse in view (not
  // necessarily pinned to the top — 'nearest' alignment).
  await op.keyboard.press('ArrowRight')
  await sleep(500)
  pres = await op.evaluate(() => window.helm.presentation.get())
  check("ArrowRight steps the cursor forward one verse", pres.liveKey === 'scr:Romans:8:29', JSON.stringify(pres))

  railInfo = await op.evaluate(() => {
    const row = document.querySelector('[data-verse="29"]')
    if (!row) return null
    const c = row.parentElement
    const rr = row.getBoundingClientRect()
    const cr = c.getBoundingClientRect()
    return { visible: rr.top >= cr.top - 2 && rr.bottom <= cr.bottom + 2, relTop: rr.top - cr.top }
  })
  check('ArrowRight keeps the cued verse visible in the rail', !!railInfo && railInfo.visible, JSON.stringify(railInfo))
  await op.screenshot({ path: path.join(SHOT_DIR, '10-arrowright-visible.png') })

  // ============================================================
  // PHASE 5 — Settings -> Shortcuts: conflict guard, rebind, behavior, persistence, reset
  // ============================================================
  await op.evaluate(() => document.activeElement?.blur())
  await sleep(150)
  await op.getByTitle('Settings').click()
  await sleep(400)
  await op.getByRole('button', { name: 'Shortcuts', exact: true }).click()
  await sleep(300)
  await op.screenshot({ path: path.join(SHOT_DIR, '11-settings-shortcuts.png') })

  // Conflict guard: try to rebind "tag" onto 'c', which song.chorus already owns.
  await op.getByRole('button', { name: /rebind Jump to tag/i }).click()
  await sleep(200)
  await op.keyboard.press('c')
  await sleep(300)
  const conflictText = await op.evaluate(() => document.querySelector('[data-conflict]')?.textContent ?? null)
  check(
    'rebinding tag to a chorus-owned key shows a conflict and refuses it',
    !!conflictText && /Jump to chorus/i.test(conflictText),
    String(conflictText)
  )
  let overridesNow = await op.evaluate(() => window.helm.settings.get('hotkeys', {}))
  check('conflicting rebind is NOT applied', !('song.tag' in overridesNow), JSON.stringify(overridesNow))
  await op.screenshot({ path: path.join(SHOT_DIR, '12-conflict.png') })
  await op.keyboard.press('Escape') // cancel capture
  await sleep(200)

  // Rebind bridge -> X.
  await op.getByRole('button', { name: /rebind Jump to bridge/i }).click()
  await sleep(200)
  await op.keyboard.press('x')
  await sleep(300)
  overridesNow = await op.evaluate(() => window.helm.settings.get('hotkeys', {}))
  check("bridge rebound to 'X'", JSON.stringify(overridesNow['song.bridge']) === '["X"]', JSON.stringify(overridesNow))
  await op.screenshot({ path: path.join(SHOT_DIR, '13-rebind-x.png') })

  await op.getByRole('button', { name: 'Done' }).click()
  await sleep(400)

  // Behavior check: 'x' now acts as bridge, 'b' no longer does. Settings can be opened from
  // any page and doesn't change it — we were on Sermon/scripture (Phase 4) when it opened,
  // so 'songs' actions like song.chorus/song.bridge won't resolve there at all; switch back
  // to Songs first (the QA song is still selected, SongsMode stays mounted/keep-alive).
  await op.keyboard.press('Meta+2')
  await sleep(500)
  await op.evaluate(() => document.activeElement?.blur())
  await sleep(150)
  await op.keyboard.press('c') // known state: Chorus
  await sleep(300)
  hero = await heroText(op)
  check('pre-check: c still jumps to Chorus', hero === 'NOW SINGING · Chorus', hero)

  await op.keyboard.press('x')
  await sleep(300)
  hero = await heroText(op)
  check("rebound 'x' now jumps to Bridge", hero === 'NOW SINGING · Bridge', hero)

  await op.keyboard.press('c') // move away from Bridge so a 'b' no-op is observable
  await sleep(300)
  hero = await heroText(op)
  check('moved back to Chorus before the negative check', hero === 'NOW SINGING · Chorus', hero)

  await op.keyboard.press('b')
  await sleep(300)
  hero = await heroText(op)
  check("old default 'b' no longer jumps to Bridge (selection unchanged)", hero === 'NOW SINGING · Chorus', hero)
  await op.screenshot({ path: path.join(SHOT_DIR, '14-b-is-inert.png') })

  // ---- Persistence across restart: relaunch with the SAME user-data-dir ----
  await app.close()
  await sleep(500)
  ;({ app, op } = await launch())
  const persistedOverrides = await op.evaluate(() => window.helm.settings.get('hotkeys', {}))
  check(
    "hotkey rebind survives a relaunch (song.bridge still ['X'])",
    JSON.stringify(persistedOverrides['song.bridge']) === '["X"]',
    JSON.stringify(persistedOverrides)
  )

  await op.getByTitle('Settings').click()
  await sleep(400)
  await op.getByRole('button', { name: 'Shortcuts', exact: true }).click()
  await sleep(300)
  const bridgeChipTextAfterRelaunch = await op.evaluate(() => {
    const rows = [...document.querySelectorAll('button')]
    const btn = rows.find((b) => b.getAttribute('aria-label') === 'rebind Jump to bridge')
    return btn ? btn.textContent : null
  })
  check(
    'Shortcuts pane shows the persisted rebind chip after relaunch',
    bridgeChipTextAfterRelaunch === 'X',
    String(bridgeChipTextAfterRelaunch)
  )
  await op.screenshot({ path: path.join(SHOT_DIR, '15-relaunch-persisted.png') })

  // Reset all -> defaults restored.
  await op.getByRole('button', { name: 'reset all shortcuts' }).click()
  await sleep(300)
  const afterReset = await op.evaluate(() => window.helm.settings.get('hotkeys', {}))
  check('Reset all clears every override', Object.keys(afterReset).length === 0, JSON.stringify(afterReset))
  const bridgeChipAfterReset = await op.evaluate(() => {
    const rows = [...document.querySelectorAll('button')]
    const btn = rows.find((b) => b.getAttribute('aria-label') === 'rebind Jump to bridge')
    return btn ? btn.textContent : null
  })
  check('bridge chip shows default B again after reset', bridgeChipAfterReset === 'B', String(bridgeChipAfterReset))
  await op.screenshot({ path: path.join(SHOT_DIR, '16-reset-all.png') })

  await op.getByRole('button', { name: 'Done' }).click()
  await sleep(300)
} finally {
  await app.close().catch(() => {})
  fs.rmSync(userDataDir, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(`Screenshots: ${SHOT_DIR}`)
process.exit(failed.length ? 1 : 0)
