/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS script */
// Video playback probe: imports a video through the real operator UI, presses the real
// Play button, and records what the <video> elements and main's video state actually do.
// VideoCanvas swallows media errors and play() rejections, so this is the only way to see
// why a clip sits on its first frame on a machine nobody can reach (Windows, via CI).
// Same launch pattern as capture-site-shots.mjs: playwright-core drives Electron against
// an isolated --user-data-dir.
//
//   npx electron-vite build && node scripts/probe-video-playback.mjs a.mp4 [b.mp4 ...]
//
// Env:
//   PROBE_OUT      output dir for report.json + screenshots (default: a temp dir)
//   PROBE_APP_EXE  probe a packaged app binary instead of node_modules' Electron + out/,
//                  e.g. dist/win-unpacked/Helm.exe or dist/mac-arm64/Helm.app/Contents/MacOS/Helm
//                  from `npx electron-builder --dir --publish never`
//   PROBE_TIMEOUT  per-file budget in ms (default 150000)
//
// Exit code: 0 when every file PASSes, 1 on any FAIL, 2 on a usage error.
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const OUT_DIR = process.env.PROBE_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'helm-video-probe-'))
const APP_EXE = process.env.PROBE_APP_EXE ? path.resolve(process.env.PROBE_APP_EXE) : ''
const FILE_TIMEOUT = Number(process.env.PROBE_TIMEOUT) || 150_000
const SAMPLE_MS = 250
const SAMPLE_COUNT = 17 // ~4s
const MIN_ADVANCE_S = 1

const files = process.argv.slice(2).map((f) => path.resolve(f))
if (!files.length) {
  console.error('usage: node scripts/probe-video-playback.mjs <video> [<video> ...]')
  process.exit(2)
}
for (const f of APP_EXE ? [APP_EXE, ...files] : files) {
  if (!fs.existsSync(f)) {
    console.error(`no such file: ${f}`)
    process.exit(2)
  }
}
fs.mkdirSync(OUT_DIR, { recursive: true })

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
function withTimeout(promise, ms, what) {
  let timer
  const t = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`timed out after ${ms}ms: ${what}`)), ms)
  })
  return Promise.race([promise, t]).finally(() => clearTimeout(timer))
}
function clip(text, n) {
  return text.length > n ? `${text.slice(0, n)}… (+${text.length - n} chars)` : text
}
function attemptSync(fn) {
  try {
    return fn()
  } catch {
    return null
  }
}
async function attempt(fn) {
  try {
    return await fn()
  } catch (e) {
    return { probeError: String(e && e.message ? e.message : e).split('\n')[0] }
  }
}

// Last-resort guard: nothing below should outlive its own timeouts, but a wedged
// Electron must never hold a CI runner for six hours.
setTimeout(
  () => {
    console.error('PROBE WATCHDOG: overall timeout — exiting')
    process.exit(1)
  },
  files.length * (FILE_TIMEOUT + 30_000)
).unref()

// --- Container sniff: top-level box order (moov before/after mdat) and codec fourccs.
// Not a demuxer — just enough to say "faststart or not, H.264 or HEVC" in the report.
function sniffMp4(file) {
  const info = { sizeBytes: fs.statSync(file).size, boxes: [], codecs: [] }
  const fd = fs.openSync(file, 'r')
  try {
    let pos = 0
    const head = Buffer.alloc(16)
    while (pos + 8 <= info.sizeBytes && info.boxes.length < 32) {
      fs.readSync(fd, head, 0, 16, pos)
      let size = head.readUInt32BE(0)
      const type = head.toString('latin1', 4, 8)
      if (!/^[\x20-\x7e]{4}$/.test(type)) break
      if (size === 1) size = Number(head.readBigUInt64BE(8))
      else if (size === 0) size = info.sizeBytes - pos
      info.boxes.push(type)
      if (type === 'moov') {
        const moov = Buffer.alloc(Math.min(size, 8 * 1024 * 1024))
        fs.readSync(fd, moov, 0, moov.length, pos)
        const text = moov.toString('latin1')
        for (const cc of [
          'avc1',
          'avc3',
          'hvc1',
          'hev1',
          'av01',
          'vp09',
          'mp4a',
          'ac-3',
          'ec-3',
          'Opus'
        ]) {
          if (text.includes(cc)) info.codecs.push(cc)
        }
      }
      if (size < 8) break
      pos += size
    }
  } catch (e) {
    info.error = String(e.message)
  } finally {
    fs.closeSync(fd)
  }
  const moov = info.boxes.indexOf('moov')
  const mdat = info.boxes.indexOf('mdat')
  info.faststart = moov >= 0 && mdat >= 0 ? moov < mdat : null
  return info
}

// --- In-page instrumentation (runs in the renderer; must be self-contained). ---
// Media events don't bubble, but they do capture, so one document-level listener sees
// every <video> the app mounts later — no need to wait for the elements to exist.
function installProbe(windowLabel) {
  if (window.__probe) return
  const P = { window: windowLabel, events: [], states: [], plays: [] }
  window.__probe = P
  // VideoCanvas renders <video playsInline>; SlideCanvas's rail thumbnail does not.
  const tag = (v) => (v.hasAttribute('playsinline') ? 'canvas' : 'thumb')
  const NAMES = [
    'loadstart',
    'loadedmetadata',
    'loadeddata',
    'canplay',
    'canplaythrough',
    'play',
    'playing',
    'pause',
    'waiting',
    'stalled',
    'suspend',
    'seeking',
    'seeked',
    'ended',
    'error',
    'emptied',
    'abort'
  ]
  for (const name of NAMES) {
    document.addEventListener(
      name,
      (e) => {
        const v = e.target
        if (!(v instanceof HTMLVideoElement)) return
        P.events.push({
          at: Date.now(),
          el: tag(v),
          event: name,
          t: v.currentTime,
          rs: v.readyState,
          ns: v.networkState,
          paused: v.paused,
          err: v.error ? { code: v.error.code, message: v.error.message } : null
        })
      },
      true
    )
  }
  // Observe (never alter) play(): the app discards the promise, so the rejection reason
  // — NotSupportedError, NotAllowedError, AbortError — is otherwise invisible.
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    const rec = { at: Date.now(), el: tag(this), result: 'pending' }
    P.plays.push(rec)
    const p = origPlay.apply(this, args)
    p.then(
      () => {
        rec.result = 'resolved'
        rec.settledAt = Date.now()
      },
      (err) => {
        rec.result = `rejected: ${err && err.name}: ${err && err.message}`
        rec.settledAt = Date.now()
      }
    )
    return p
  }
  window.helm.video.onState((s) => {
    P.states.push({
      at: Date.now(),
      playing: s.playing,
      positionMs: s.positionMs,
      durationMs: s.durationMs,
      src: s.src,
      key: s.key
    })
  })
}

async function snapshotInPage() {
  const videos = [...document.querySelectorAll('video')].map((v) => {
    const buffered = []
    for (let i = 0; i < v.buffered.length; i++)
      buffered.push([v.buffered.start(i), v.buffered.end(i)])
    return {
      el: v.hasAttribute('playsinline') ? 'canvas' : 'thumb',
      src: v.currentSrc || v.src,
      paused: v.paused,
      ended: v.ended,
      muted: v.muted,
      currentTime: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : String(v.duration),
      readyState: v.readyState,
      networkState: v.networkState,
      error: v.error ? { code: v.error.code, message: v.error.message } : null,
      buffered,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      visible: v.offsetParent !== null
    }
  })
  const buttons = [...document.querySelectorAll('button')]
    .filter((b) => b.offsetParent !== null)
    .map((b) => b.innerText.replace(/\s+/g, ' ').trim())
    .filter((t) => /\b(play|pause)\b/i.test(t))
  let state = null
  try {
    state = await window.helm.video.get()
  } catch (e) {
    state = { probeError: String(e) }
  }
  return { at: Date.now(), buttons, videos, state }
}

function codecSupportInPage() {
  const v = document.createElement('video')
  const types = {
    h264_aac: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    h264_high: 'video/mp4; codecs="avc1.640028"',
    hevc_hvc1: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
    hevc_hev1: 'video/mp4; codecs="hev1.1.6.L93.B0"',
    av1: 'video/mp4; codecs="av01.0.05M.08"',
    aac: 'audio/mp4; codecs="mp4a.40.2"',
    webm_vp9: 'video/webm; codecs="vp9"'
  }
  const out = {}
  for (const [k, t] of Object.entries(types)) {
    out[k] = {
      canPlayType: v.canPlayType(t) || '(empty = no)',
      mse: typeof MediaSource !== 'undefined' ? MediaSource.isTypeSupported(t) : null
    }
  }
  return out
}

// Hits the helm-media:// handler directly with the Range shapes the media stack uses, so a
// broken 206 on Windows shows up as a status/header fact rather than a silent stall. Runs
// in main via net.fetch (which honours protocol.handle); the renderer can't fetch() the
// scheme cross-origin, only load it as media.
async function protocolCheckInMain({ net }, src) {
  const one = async (label, range) => {
    const ctl = new AbortController()
    try {
      const res = await net.fetch(src, {
        headers: range ? { Range: range } : {},
        signal: ctl.signal
      })
      const headers = {}
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        headers[k] = res.headers.get(k)
      }
      let bytes = 0
      let head = ''
      if (res.body) {
        const first = await res.body.getReader().read()
        if (first.value) {
          bytes = first.value.length
          head = Array.from(first.value.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join(
            ' '
          )
        }
      }
      ctl.abort()
      return {
        label,
        range,
        status: res.status,
        headers,
        firstChunkBytes: bytes,
        firstBytesHex: head
      }
    } catch (e) {
      return { label, range, error: `${e && e.name}: ${e && e.message}` }
    }
  }
  return [
    await one('open-ended', 'bytes=0-'),
    await one('first-100', 'bytes=0-99'),
    await one('suffix-100', 'bytes=-100'),
    await one('no-range', null)
  ]
}

// --- Driving ---
async function clickButton(page, re, what) {
  const b = page.locator('button:visible', { hasText: re }).first()
  try {
    await b.click({ timeout: 8_000 })
    return { clicked: true }
  } catch (e) {
    return { clicked: false, error: `could not click ${what}: ${String(e.message).split('\n')[0]}` }
  }
}

async function samplePhase(name, op, out, pressPlay) {
  const phase = {
    name,
    before: { operator: await attempt(() => op.evaluate(snapshotInPage)) },
    samples: []
  }
  if (out) phase.before.output = await attempt(() => out.evaluate(snapshotInPage))
  phase.clickAt = Date.now()
  phase.click = await pressPlay()
  phase.clickDoneAt = Date.now()
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const started = Date.now()
    const s = { operator: await attempt(() => op.evaluate(snapshotInPage)) }
    if (out) s.output = await attempt(() => out.evaluate(snapshotInPage))
    phase.samples.push(s)
    await sleep(Math.max(0, SAMPLE_MS - (Date.now() - started)))
  }
  return phase
}

async function probeFile(file, index) {
  const base = `${String(index + 1).padStart(2, '0')}-${path.basename(file).replace(/[^\w.-]+/g, '_')}`
  const r = {
    file,
    container: sniffMp4(file),
    steps: [],
    mainLog: [],
    console: [],
    phases: [],
    screenshots: []
  }
  const step = (msg) => {
    r.steps.push({ at: Date.now(), msg })
    console.log(`  · ${msg}`)
  }
  // The space is deliberate: Windows profiles ("C:\Users\First Last\AppData") put the
  // media library under a path with one, and the media URL has to survive it.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm probe '))
  let app
  const body = async () => {
    const flags = [`--user-data-dir=${userDataDir}`, '--enable-logging=stderr']
    // A packaged app starts electron-updater at launch with autoDownload on (main/index.ts),
    // and there is no switch to turn it off. Nothing the probe exercises needs the network
    // (helm-media:// is served from disk), so take DNS away: an update check can then only
    // fail, silently, and can never download or stage an installer on the runner.
    const packagedFlags = [...flags, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost']
    // Playwright prepends --inspect=0 --remote-debugging-port=0 either way; a packaged
    // binary only honours --inspect while the EnableNodeCliInspectArguments fuse is on
    // (Electron's default — electron-builder.yml sets no electronFuses). With it off the
    // launch dies here waiting for "Debugger listening".
    app = await electron.launch(
      APP_EXE
        ? { executablePath: APP_EXE, args: packagedFlags, timeout: 60_000 }
        : {
            executablePath: require('electron'),
            args: [APP_DIR, ...flags],
            cwd: APP_DIR,
            timeout: 60_000
          }
    )
    const logLines = (stream) => (d) => {
      for (const line of String(d).split(/\r?\n/)) {
        // --enable-logging echoes every renderer console line; those are already in r.console.
        if (line.trim() && !line.includes(':CONSOLE:'))
          r.mainLog.push({ at: Date.now(), stream, line: clip(line, 2000) })
      }
    }
    app.process().stdout.on('data', logLines('stdout'))
    app.process().stderr.on('data', logLines('stderr'))
    const watch = (page, label) => {
      page.on('console', (m) =>
        r.console.push({
          at: Date.now(),
          window: label,
          type: m.type(),
          text: clip(m.text(), 2000)
        })
      )
      page.on('pageerror', (e) =>
        r.console.push({ at: Date.now(), window: label, type: 'pageerror', text: String(e) })
      )
      page.on('crash', () =>
        r.console.push({ at: Date.now(), window: label, type: 'crash', text: 'renderer crashed' })
      )
    }

    let op
    for (let i = 0; i < 120 && !op; i++) {
      op = app.windows().find((w) => w.url().includes('operator'))
      if (!op) await sleep(250)
    }
    if (!op)
      throw new Error(
        `no operator window (windows: ${
          app
            .windows()
            .map((w) => w.url())
            .join(', ') || 'none'
        })`
      )
    watch(op, 'operator')
    await op.waitForFunction(() => !!(window.helm && window.helm.video), null, { timeout: 30_000 })
    step(`operator window up: ${op.url()}`)

    r.env = await attempt(() =>
      app.evaluate(async ({ app: a }) => {
        let gpuInfo = null
        try {
          gpuInfo = await Promise.race([
            a.getGPUInfo('basic'),
            new Promise((res) => setTimeout(() => res('timeout'), 5000))
          ])
        } catch (e) {
          gpuInfo = String(e)
        }
        return {
          execPath: process.execPath,
          appPath: a.getAppPath(),
          resourcesPath: process.resourcesPath,
          platform: process.platform,
          arch: process.arch,
          osRelease: process.getSystemVersion(),
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
          isPackaged: a.isPackaged,
          appVersion: a.getVersion(),
          userData: a.getPath('userData'),
          gpuFeatureStatus: a.getGPUFeatureStatus(),
          gpuInfo
        }
      })
    )
    // Refuse to drive an app that isn't the one asked for, or that ignored
    // --user-data-dir: the import below would land in the real profile's library.
    if (r.env.probeError) throw new Error(`could not read app env: ${r.env.probeError}`)
    // Present = electron-updater has a feed to poll (NSIS installs; --dir builds may not).
    r.env.updateConfig = fs.existsSync(path.join(r.env.resourcesPath, 'app-update.yml'))
    if (r.env.isPackaged !== !!APP_EXE)
      throw new Error(`expected packaged=${!!APP_EXE}, app reports packaged=${r.env.isPackaged}`)
    const real = (p) => attemptSync(() => fs.realpathSync(p)) || path.resolve(p)
    if (real(r.env.userData) !== real(userDataDir))
      throw new Error(`app ignored --user-data-dir: userData=${r.env.userData}`)
    r.codecs = await attempt(() => op.evaluate(codecSupportInPage))

    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
    }, file)
    await op.evaluate(installProbe, 'operator')

    // Sermon → Slides → + Import → Video
    for (const [re, what] of [
      [/sermon/i, 'Sermon tab'],
      [/^\s*slides/i, 'Slides track'],
      [/\+\s*Import/i, '+ Import'],
      [/^\s*Video\s*$/i, 'Import → Video']
    ]) {
      const c = await clickButton(op, re, what)
      if (!c.clicked) throw new Error(c.error)
      await sleep(700)
    }
    step('import requested; waiting for the hero <video>')
    await op.waitForFunction(() => !!document.querySelector('video[playsinline]'), null, {
      timeout: 90_000
    })
    // Give metadata a chance to load so "before" reflects a settled still frame.
    await attempt(() =>
      op.waitForFunction(
        () => {
          const v = document.querySelector('video[playsinline]')
          return v.readyState >= 1 || v.error
        },
        null,
        { timeout: 15_000 }
      )
    )
    await sleep(1_000)
    const src = await op.evaluate(() => {
      const v = document.querySelector('video[playsinline]')
      return v.currentSrc || v.src
    })
    r.src = src
    step(`imported; hero src = ${src}`)
    r.protocol = await attempt(() =>
      withTimeout(app.evaluate(protocolCheckInMain, src), 20_000, 'protocol check')
    )

    // --- Phase 1: preview. The bug report: Play does nothing visible here. ---
    step('phase preview: pressing Play')
    r.phases.push(
      await samplePhase('preview', op, null, () =>
        clickButton(op, /(^|\s)Play\s*$/, 'the Play button')
      )
    )
    const shot1 = `${base}-preview.png`
    await attempt(() => op.screenshot({ path: path.join(OUT_DIR, shot1) }))
    r.screenshots.push(shot1)

    // --- Phase 2: live. Pause + rewind through the same IPC the transport uses, open
    // the test output, Go live (lands paused by design), then press Play again. ---
    await op.evaluate(() => {
      window.helm.video.pause()
      window.helm.video.seek(0)
    })
    await sleep(600)
    await op.evaluate(() => window.helm.displays.openTest())
    let out
    for (let i = 0; i < 60 && !out; i++) {
      out = app.windows().find((w) => w.url().includes('output'))
      if (!out) await sleep(250)
    }
    if (!out) {
      r.liveSkipped = 'no output window appeared after displays.openTest()'
      step(r.liveSkipped)
      return
    }
    watch(out, 'output')
    await out.waitForFunction(() => !!(window.helm && window.helm.video), null, { timeout: 30_000 })
    await out.evaluate(installProbe, 'output')
    const live = await clickButton(op, /Go live/i, 'Go live')
    r.goLive = live
    if (!live.clicked) step(live.error)
    await attempt(() =>
      out.waitForFunction(() => !!document.querySelector('video'), null, { timeout: 10_000 })
    )
    await sleep(1_200)
    step('phase live: pressing Play')
    r.phases.push(
      await samplePhase('live', op, out, () => clickButton(op, /(^|\s)Play\s*$/, 'the Play button'))
    )
    const shot2 = `${base}-live-operator.png`
    const shot3 = `${base}-live-output.png`
    await attempt(() => op.screenshot({ path: path.join(OUT_DIR, shot2) }))
    await attempt(() => out.screenshot({ path: path.join(OUT_DIR, shot3) }))
    r.screenshots.push(shot2, shot3)
    r.updater = await attempt(() => op.evaluate(() => window.helm.updates.getStatus()))
    r.probes = {
      operator: await attempt(() => op.evaluate(() => window.__probe)),
      output: await attempt(() => out.evaluate(() => window.__probe))
    }
  }

  try {
    await withTimeout(body(), FILE_TIMEOUT, `probing ${path.basename(file)}`)
  } catch (e) {
    r.fatal = String(e && e.message ? e.message : e).split('\n')[0]
    step(`FATAL: ${r.fatal}`)
  } finally {
    if (app) {
      // Whatever went wrong, keep what the renderers recorded and a picture of the end state.
      if (!r.probes) {
        r.probes = {}
        for (const w of app.windows()) {
          const label = w.url().includes('output')
            ? 'output'
            : w.url().includes('operator')
              ? 'operator'
              : null
          if (!label) continue
          r.probes[label] = await attempt(() =>
            withTimeout(
              w.evaluate(() => window.__probe),
              5_000,
              'collect'
            )
          )
          if (r.fatal) {
            const shot = `${base}-fatal-${label}.png`
            await attempt(() =>
              withTimeout(w.screenshot({ path: path.join(OUT_DIR, shot) }), 5_000, 'shot')
            )
            r.screenshots.push(shot)
          }
        }
      }
      const proc = app.process()
      await attempt(() => withTimeout(app.close(), 10_000, 'app.close'))
      if (proc.exitCode === null && proc.signalCode === null) {
        try {
          proc.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }
    }
    await sleep(500)
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      /* Windows may still hold a handle; the temp dir is disposable */
    }
  }
  r.verdict = judge(r)
  return r
}

// --- Verdict ---
function canvasOf(snap) {
  return snap && snap.videos ? snap.videos.find((v) => v.el === 'canvas') : undefined
}

function judgeWindow(r, phase, win) {
  const res = { window: win, pass: false, facts: [] }
  const facts = res.facts
  if (!phase) {
    facts.push('phase never ran')
    return res
  }
  const snaps = phase.samples.map((s) => s[win]).filter(Boolean)
  const before = canvasOf(phase.before[win])
  const t0 = before ? before.currentTime : 0
  let maxT = t0
  let advancedWhilePlaying = false
  for (const s of snaps) {
    const v = canvasOf(s)
    if (!v) continue
    if (v.currentTime > maxT) maxT = v.currentTime
    if (v.currentTime - t0 > MIN_ADVANCE_S && s.state && s.state.playing === true)
      advancedWhilePlaying = true
  }
  res.advancedS = Number((maxT - t0).toFixed(3))
  const lastSnap = snaps[snaps.length - 1]
  const last = canvasOf(lastSnap)
  const everPlaying = snaps.some((s) => s.state && s.state.playing === true)
  res.statePlaying = lastSnap && lastSnap.state ? lastSnap.state.playing : null
  res.pass = advancedWhilePlaying
  if (res.pass) {
    facts.push(
      `currentTime advanced ${res.advancedS}s`,
      `main playing:${res.statePlaying} at end of sampling`
    )
    return res
  }

  if (!phase.click.clicked) facts.push(phase.click.error)
  if (!before && !last) facts.push(`no VideoCanvas <video> in the ${win} window`)
  facts.push(`currentTime advanced ${res.advancedS}s (need > ${MIN_ADVANCE_S}s)`)
  facts.push(
    everPlaying
      ? `main playing: true was observed; ${res.statePlaying} at end of sampling`
      : 'no sample saw main playing:true'
  )
  const labels = [
    ...new Set(phase.samples.flatMap((s) => (s.operator && s.operator.buttons) || []))
  ]
  facts.push(
    `transport button text seen: ${labels.length ? labels.map((l) => JSON.stringify(l)).join(', ') : '(none)'}`
  )

  const probe = r.probes && r.probes[win] && !r.probes[win].probeError ? r.probes[win] : null
  const inPhase = (x) => x.at >= phase.clickAt
  if (probe) {
    const evs = probe.events.filter((e) => e.el === 'canvas')
    const err = evs.find((e) => e.event === 'error' || e.err)
    if (err)
      facts.push(
        `first media error: code ${err.err ? err.err.code : '?'} "${err.err ? err.err.message : ''}" (on ${err.event})`
      )
    const rejected = probe.plays.filter(
      (p) => p.el === 'canvas' && String(p.result).startsWith('rejected')
    )
    if (rejected.length) facts.push(`play() ${rejected[0].result} (${rejected.length}x)`)
    const calls = probe.plays.filter((p) => p.el === 'canvas' && inPhase(p))
    facts.push(
      `el.play() called ${calls.length}x after the click${calls.length ? ` → ${[...new Set(calls.map((c) => c.result))].join(' | ')}` : ''}`
    )
    const after = evs.filter(inPhase)
    const play = after.find((e) => e.event === 'play')
    if (play) {
      const stop = after.find(
        (e) => (e.event === 'pause' || e.event === 'ended') && e.at >= play.at
      )
      if (stop) facts.push(`"${stop.event}" fired ${stop.at - play.at}ms after "play"`)
      if (!after.some((e) => e.event === 'playing'))
        facts.push('"play" fired but "playing" never did')
    } else {
      facts.push('no "play" event on the element after the click')
    }
    const st = probe.states.filter(inPhase)
    const flips = []
    for (let i = 1; i < st.length; i++)
      if (st[i - 1].playing && !st[i].playing) flips.push(st[i].at - st[i - 1].at)
    if (flips.length)
      facts.push(`state flipped playing true→false ${flips.length}x (first after ${flips[0]}ms)`)
    facts.push(`${st.length} state broadcast(s) after the click`)
    const evNames = after.map((e) => e.event)
    facts.push(`element events after click: ${evNames.length ? evNames.join(',') : '(none)'}`)
  } else {
    facts.push('in-page probe data unavailable')
  }
  if (last) {
    facts.push(
      `last: readyState=${last.readyState} networkState=${last.networkState} paused=${last.paused} ` +
        `duration=${last.duration} videoWidth=${last.videoWidth} error=${last.error ? `${last.error.code} "${last.error.message}"` : 'none'}`
    )
  }
  if (lastSnap && lastSnap.state && last && lastSnap.state.src !== last.src) {
    facts.push(`src mismatch — state.src=${lastSnap.state.src} vs element src=${last.src}`)
  }
  return res
}

function judge(r) {
  const preview = judgeWindow(
    r,
    r.phases.find((p) => p.name === 'preview'),
    'operator'
  )
  const livePhase = r.phases.find((p) => p.name === 'live')
  const output = judgeWindow(r, livePhase, 'output')
  const liveHero = judgeWindow(r, livePhase, 'operator')
  if (r.liveSkipped) output.facts.unshift(r.liveSkipped)
  if (r.goLive && !r.goLive.clicked) output.facts.unshift(r.goLive.error)
  const pass = preview.pass && output.pass && !r.fatal
  return { result: pass ? 'PASS' : 'FAIL', preview, output, liveHero, fatal: r.fatal || null }
}

// --- Report ---
function fmtVideo(v) {
  if (!v) return '(no element)'
  const buf = v.buffered.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`).join(' ') || '-'
  const t = typeof v.duration === 'number' ? v.duration.toFixed(2) : v.duration
  return (
    `t=${v.currentTime.toFixed(3)}/${t} paused=${v.paused ? 'Y' : 'n'} rs=${v.readyState} ns=${v.networkState} ` +
    `w=${v.videoWidth} buf=[${buf}]${v.error ? ` ERR ${v.error.code} "${v.error.message}"` : ''}`
  )
}

function printReport(r) {
  const line = '='.repeat(100)
  console.log(`\n${line}\nFILE ${r.file}\n${line}`)
  const c = r.container
  console.log(
    `container: ${(c.sizeBytes / 1048576).toFixed(1)} MB  boxes=[${c.boxes.join(' ')}]  ` +
      `faststart=${c.faststart}  codecs=[${c.codecs.join(' ')}]`
  )
  if (r.env && !r.env.probeError) {
    const e = r.env
    console.log(
      `platform:  process.platform=${e.platform} arch=${e.arch} os=${e.osRelease}  ` +
        `electron=${e.electron} chromium=${e.chrome} node=${e.node}  packaged=${e.isPackaged} app=${e.appVersion}`
    )
    console.log(`binary:    ${e.execPath}`)
    console.log(`app path:  ${e.appPath}`)
    console.log(`userData:  ${e.userData}`)
    console.log(
      `updater:   app-update.yml ${e.updateConfig ? 'present' : 'absent'}; ` +
        `status at end = ${JSON.stringify(r.updater ?? '(not reached)')}`
    )
    console.log(`gpu features: ${JSON.stringify(e.gpuFeatureStatus)}`)
    const g = e.gpuInfo && e.gpuInfo.gpuDevice ? e.gpuInfo.gpuDevice : e.gpuInfo
    console.log(`gpu devices:  ${JSON.stringify(g)}`)
  } else {
    console.log(`platform:  unavailable (${r.env ? r.env.probeError : 'app never started'})`)
  }
  if (r.codecs && !r.codecs.probeError) {
    console.log('codec support (canPlayType / MediaSource.isTypeSupported):')
    for (const [k, v] of Object.entries(r.codecs))
      console.log(`  ${k.padEnd(10)} ${String(v.canPlayType).padEnd(14)} mse=${v.mse}`)
  }
  console.log(`hero src:  ${r.src || '(never appeared)'}`)
  if (Array.isArray(r.protocol)) {
    console.log('helm-media:// handler check (net.fetch from main):')
    for (const p of r.protocol) {
      console.log(
        p.error
          ? `  ${p.label.padEnd(11)} ERROR ${p.error}`
          : `  ${p.label.padEnd(11)} ${p.status}  type=${p.headers['content-type']} len=${p.headers['content-length']} ` +
              `range=${p.headers['content-range']} accept-ranges=${p.headers['accept-ranges']}  ` +
              `chunk=${p.firstChunkBytes}B  [${p.firstBytesHex}]`
      )
    }
  } else if (r.protocol) {
    console.log(`helm-media:// handler check failed: ${r.protocol.probeError}`)
  }

  for (const ph of r.phases) {
    const rel = (at) => `${at - ph.clickAt >= 0 ? '+' : ''}${at - ph.clickAt}ms`.padStart(9)
    console.log(
      `\n--- phase "${ph.name}" — Play pressed (click ${ph.click.clicked ? `ok, took ${ph.clickDoneAt - ph.clickAt}ms` : `FAILED: ${ph.click.error}`}) ---`
    )
    const wins = ph.before.output ? ['operator', 'output'] : ['operator']
    for (const w of wins) {
      const b = ph.before[w]
      console.log(
        `before [${w}] button=${JSON.stringify(b.buttons || [])} state=${JSON.stringify(b.state)}`
      )
      for (const v of b.videos || []) console.log(`         ${v.el.padEnd(6)} ${fmtVideo(v)}`)
    }
    console.log('samples:')
    for (const s of ph.samples) {
      const o = s.operator
      if (o.probeError) {
        console.log(`  operator snapshot failed: ${o.probeError}`)
        continue
      }
      const st = o.state || {}
      let row = `${rel(o.at)}  btn=${JSON.stringify((o.buttons || []).join('|')).padEnd(12)} main{playing=${st.playing} pos=${st.positionMs}}  hero: ${fmtVideo(canvasOf(o))}`
      if (s.output)
        row += `\n${' '.repeat(11)}output: ${s.output.probeError ? s.output.probeError : fmtVideo(canvasOf(s.output))}`
      console.log(row)
    }
    // Merged timeline for this phase, from 2s before the click.
    const next = r.phases[r.phases.indexOf(ph) + 1]
    const from = ph.clickAt - 2_000
    const to = next ? next.clickAt - 2_000 : Infinity
    const rows = []
    for (const [w, p] of Object.entries(r.probes || {})) {
      if (!p || p.probeError) continue
      for (const e of p.events) {
        rows.push({
          at: e.at,
          text:
            `${w}/${e.el}`.padEnd(16) +
            ` ${e.event.padEnd(15)} t=${e.t.toFixed(3)} rs=${e.rs} ns=${e.ns} paused=${e.paused}${e.err ? ` ERR ${e.err.code} "${e.err.message}"` : ''}`
        })
      }
      for (const c of p.plays) {
        rows.push({
          at: c.at,
          text:
            `${w}/${c.el}`.padEnd(16) +
            ` el.play() → ${c.result}${c.settledAt ? ` (${c.settledAt - c.at}ms)` : ''}`
        })
      }
      // Every window gets the same broadcast; the operator's copy is the timeline of record.
      if (w === 'operator') {
        for (const s of p.states)
          rows.push({
            at: s.at,
            text: `${'main→state'.padEnd(16)} playing=${s.playing} pos=${s.positionMs} dur=${s.durationMs} key=${s.key}`
          })
      }
    }
    const shown = rows.filter((x) => x.at >= from && x.at < to).sort((a, b) => a.at - b.at)
    console.log(`timeline (relative to the click; ${shown.length} entries):`)
    for (const x of shown) console.log(`  ${rel(x.at)}  ${x.text}`)
  }

  const early = []
  for (const [w, p] of Object.entries(r.probes || {})) {
    if (!p || p.probeError) continue
    const first = r.phases[0] ? r.phases[0].clickAt - 2_000 : Infinity
    for (const e of p.events)
      if (e.at < first)
        early.push(`${w}/${e.el}:${e.event}(rs=${e.rs}${e.err ? ` ERR ${e.err.code}` : ''})`)
  }
  if (early.length) console.log(`\nload-time element events (before Play): ${early.join(' ')}`)

  // Collapse repeats (the app logs one CSP line per bundled font) so real errors stand out.
  const seen = new Map()
  for (const m of r.console) {
    const line = `[${m.window}] ${m.type}: ${clip(m.text.replace(/data:[^'"\s]{40,}/g, 'data:…'), 300)}`
    seen.set(line, (seen.get(line) || 0) + 1)
  }
  console.log(`\nrenderer console (${r.console.length} messages, ${seen.size} distinct):`)
  for (const [line, count] of seen) console.log(`  ${count > 1 ? `(x${count}) ` : ''}${line}`)
  const MAX_MAIN = 200
  console.log(
    `main process output (${r.mainLog.length} lines${r.mainLog.length > MAX_MAIN ? `, first ${MAX_MAIN} shown; all in report.json` : ''}):`
  )
  for (const m of r.mainLog.slice(0, MAX_MAIN)) console.log(`  [${m.stream}] ${clip(m.line, 400)}`)
  console.log(`screenshots: ${r.screenshots.join(', ') || '(none)'}`)
}

function verdictLines(r) {
  const v = r.verdict
  const name = path.basename(r.file)
  const lines = [
    `VERDICT ${v.result} ${name} — preview=${v.preview.pass ? 'PASS' : 'FAIL'} output=${v.output.pass ? 'PASS' : 'FAIL'}` +
      (v.fatal ? ` — ${v.fatal}` : '')
  ]
  for (const [label, w] of [
    ['preview hero', v.preview],
    ['live output', v.output],
    ['live hero', v.liveHero]
  ]) {
    lines.push(`    ${label.padEnd(12)} ${w.pass ? 'PASS' : 'FAIL'}: ${w.facts.join('; ')}`)
  }
  return lines
}

// --- Main ---
console.log(
  `helm video playback probe — ${files.length} file(s), host ${process.platform}/${process.arch}`
)
console.log(
  `app: ${APP_EXE ? `${APP_EXE} (packaged)` : `${APP_DIR} (unpackaged, node_modules Electron)`}`
)
console.log(`output dir: ${OUT_DIR}`)
const results = []
for (const [i, file] of files.entries()) {
  console.log(`\n[${i + 1}/${files.length}] ${file}`)
  results.push(await probeFile(file, i))
  fs.writeFileSync(
    path.join(OUT_DIR, 'report.json'),
    JSON.stringify({ host: process.platform, results }, null, 2)
  )
}
for (const r of results) printReport(r)

console.log(
  `\n${'='.repeat(100)}\nVERDICTS  (PASS = <video> currentTime advanced > ${MIN_ADVANCE_S}s while main reported playing:true)`
)
const summary = results.flatMap(verdictLines)
for (const l of summary) console.log(l)
fs.writeFileSync(path.join(OUT_DIR, 'verdicts.txt'), summary.join('\n') + '\n')
console.log(`\nreport: ${path.join(OUT_DIR, 'report.json')}`)
process.exit(results.every((r) => r.verdict.result === 'PASS') ? 0 : 1)
