/* ============================================================================
   Helm — landing page behaviour

   Two small jobs, each of which the page survives without:

   1. The tally flips from CUED to LIVE once, a beat after load.
   2. The download block is upgraded from the release API — live version, real
      file sizes, and the visitor's platform promoted to the primary button.

   The markup already contains working download links and honest sizes for the
   release that was current when the page was built, so a failed or rate-limited
   fetch leaves a page that still downloads the right file.
   ========================================================================== */

const REPO = 'chase-codes/helm'
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------- 1. the tally ---------- */
const tally = document.querySelector('[data-tally]')
const tallyWord = document.querySelector('[data-tally-word]')

const goLive = () => {
  if (!tally || !tallyWord) return
  tally.dataset.state = 'live'
  tallyWord.textContent = 'Live'
}

if (reduceMotion) goLive()
else window.setTimeout(goLive, 1100)

/* ---------- 2. the live release ---------- */

// Sizes are quoted the way a download manager quotes them (decimal MB), so the
// number on the page matches the number the browser shows while downloading.
const formatSize = (bytes) => `${Math.round(bytes / 1e6)} MB`

const PLATFORMS = {
  mac: {
    // arm64 is the only Mac artifact electron-builder publishes today.
    match: (asset) => asset.name.endsWith('.dmg'),
    label: 'Download for macOS',
    cardLabel: 'Download the .dmg',
    detail: 'Apple silicon',
    short: 'macOS'
  },
  win: {
    match: (asset) => asset.name.endsWith('.exe'),
    label: 'Download for Windows',
    cardLabel: 'Download the installer',
    detail: '64-bit',
    short: 'Windows'
  }
}

const detectPlatform = () => {
  const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent
  if (/win/i.test(platform)) return 'win'
  if (/mac|iphone|ipad|ipod/i.test(platform)) return 'mac'
  // Linux and anything unrecognised: Helm publishes no build for them, so lead
  // with macOS rather than guessing, and leave both links visible.
  return 'mac'
}

const el = (selector) => document.querySelector(selector)

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

  // --- the platform cards ---
  if (found.mac) {
    const link = el('[data-mac-link]')
    const meta = el('[data-mac-meta]')
    if (link) link.href = found.mac.browser_download_url
    if (meta) meta.textContent = `Apple silicon · ${formatSize(found.mac.size)}`
  }
  if (found.win) {
    const link = el('[data-win-link]')
    const meta = el('[data-win-meta]')
    if (link) link.href = found.win.browser_download_url
    if (meta) meta.textContent = `64-bit · ${formatSize(found.win.size)}`
  }

  const releaseLine = el('[data-release-line]')
  if (releaseLine && version) releaseLine.textContent = `Version ${version}.`

  // --- the hero block, led by the visitor's own platform ---
  const primaryKey = found[detectPlatform()] ? detectPlatform() : found.mac ? 'mac' : 'win'
  const secondaryKey = primaryKey === 'mac' ? 'win' : 'mac'

  const primary = el('[data-download-primary]')
  const primaryMeta = el('[data-download-meta]')
  if (primary && found[primaryKey]) {
    primary.href = found[primaryKey].browser_download_url
    primary.textContent = PLATFORMS[primaryKey].label
  }
  if (primaryMeta && found[primaryKey]) {
    const parts = [PLATFORMS[primaryKey].detail, formatSize(found[primaryKey].size)]
    if (version) parts.unshift(`v${version}`)
    primaryMeta.textContent = parts.join(' · ')
  }

  const secondary = el('[data-download-secondary]')
  const secondaryMeta = el('[data-download-secondary-meta]')
  if (secondary && found[secondaryKey]) {
    secondary.href = found[secondaryKey].browser_download_url
    secondary.textContent = `${PLATFORMS[secondaryKey].short} installer`
  }
  if (secondaryMeta && found[secondaryKey]) {
    secondaryMeta.textContent = formatSize(found[secondaryKey].size)
  }
}

loadRelease().catch((error) => {
  // The static markup is already correct for the release the page shipped with;
  // log for anyone looking, and change nothing on screen.
  console.warn('Helm: keeping the built-in download links —', error.message)
})
