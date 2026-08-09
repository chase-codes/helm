/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS, browser */
/* ============================================================================
   Helm — landing page behaviour

   Two small jobs, each of which the page survives without:

   1. The tally flips from CUED to LIVE once, a beat after load.
   2. The visitor's own platform is promoted to the filled download button, and
      the version and file sizes are refreshed from the release API.

   Only the second half of job 2 needs the network. Promotion runs immediately
   from navigator alone, so a rate-limited or blocked api.github.com still leaves
   a page with one clear button — the markup carries the version and sizes that
   were current when it was built, and the fetch only refines them.
   ========================================================================== */

const REPO = 'chase-codes/helm'
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------- 1. the tally ---------- */
const tally = document.querySelector('[data-tally]')
const tallyWord = document.querySelector('[data-tally-word]')

function goLive() {
  if (!tally || !tallyWord) return
  tally.dataset.state = 'live'
  tallyWord.textContent = 'Live'
}

if (reduceMotion) goLive()
else window.setTimeout(goLive, 1100)

/* ---------- 2. platform + release ---------- */

const PLATFORMS = {
  win: {
    match: (asset) => asset.name.endsWith('.exe'),
    short: 'Windows',
    hero: '[data-hero-win]',
    cardLink: '[data-win-link]',
    cardMeta: '[data-win-meta]'
  },
  mac: {
    // arm64 is the only Mac artifact electron-builder publishes today.
    match: (asset) => asset.name.endsWith('.dmg'),
    short: 'macOS',
    hero: '[data-hero-mac]',
    cardLink: '[data-mac-link]',
    cardMeta: '[data-mac-meta]'
  }
}

function el(selector) {
  return document.querySelector(selector)
}

// Sizes are quoted the way a download manager quotes them (decimal MB), so the
// number on the page matches the number the browser shows while downloading.
function formatSize(bytes) {
  return `${Math.round(bytes / 1e6)} MB`
}

function detectPlatform() {
  const ua = navigator.userAgent || ''
  const platform = navigator.userAgentData?.platform || navigator.platform || ua

  // iPadOS reports "MacIntel", so iOS has to be ruled out before the Mac test —
  // otherwise an iPhone is offered a disk image it cannot open. Helm publishes no
  // build for iOS or Linux, so those promote nothing and both buttons stay equal.
  if (/iphone|ipad|ipod/i.test(ua)) return null
  if (/mac/i.test(platform) && navigator.maxTouchPoints > 1) return null

  if (/win/i.test(platform)) return 'win'
  if (/mac/i.test(platform)) return 'mac'
  return null
}

const detected = detectPlatform()

// The build-time facts live in the markup (data-detail / data-size / data-version)
// so this file has no copy of them to drift out of step.
function readBuiltIn() {
  const block = el('[data-download-block]')
  const info = { version: block?.dataset.version || '' }
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    const button = el(platform.hero)
    if (button) info[key] = { detail: button.dataset.detail, size: button.dataset.size }
  }
  return info
}

function renderHero(info) {
  const meta = el('[data-download-meta]')
  const version = info.version ? `v${info.version}` : null

  if (detected && info[detected]) {
    const button = el(PLATFORMS[detected].hero)
    if (button) {
      button.classList.remove('btn-outline')
      button.classList.add('btn-primary')
    }
    if (meta) {
      meta.textContent = [version, info[detected].detail, info[detected].size]
        .filter(Boolean)
        .join(' · ')
    }
    return
  }

  // Nothing to promote — show both sizes rather than picking on their behalf.
  if (meta) {
    const both = Object.entries(PLATFORMS)
      .filter(([key]) => info[key])
      .map(([key, platform]) => `${platform.short} ${info[key].size}`)
    meta.textContent = [version, ...both].filter(Boolean).join(' · ')
  }
}

// Runs before any network call, so the hero is never left without a filled button.
renderHero(readBuiltIn())

async function loadRelease() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' }
  })
  if (!response.ok) throw new Error(`releases/latest responded ${response.status}`)

  const release = await response.json()
  const version = (release.tag_name || '').replace(/^v/, '')
  const assets = Array.isArray(release.assets) ? release.assets : []

  const found = {}
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    // .blockmap files sit next to the installers and end in .exe.blockmap etc.,
    // so they must not win the match.
    const asset = assets.find((a) => !a.name.endsWith('.blockmap') && platform.match(a))
    if (asset) found[key] = asset
  }
  if (!found.mac && !found.win) throw new Error('no installers on the latest release')

  const info = readBuiltIn()
  if (version) info.version = version

  for (const [key, platform] of Object.entries(PLATFORMS)) {
    if (!found[key]) continue
    const size = formatSize(found[key].size)
    const url = found[key].browser_download_url
    info[key] = { detail: info[key]?.detail, size }

    const hero = el(platform.hero)
    if (hero) {
      hero.href = url
      hero.dataset.size = size
    }
    const cardLink = el(platform.cardLink)
    if (cardLink) cardLink.href = url
    const cardMeta = el(platform.cardMeta)
    if (cardMeta && info[key].detail) cardMeta.textContent = `${info[key].detail} · ${size}`
  }

  const releaseLine = el('[data-release-line]')
  if (releaseLine && version) releaseLine.textContent = `Version ${version}.`

  renderHero(info)
}

loadRelease().catch((error) => {
  // The markup is already correct for the release the page shipped with, and the
  // platform has already been promoted — log for anyone looking, change nothing.
  console.warn('Helm: keeping the built-in download links —', error.message)
})
