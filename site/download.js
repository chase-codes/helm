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
  win: {
    match: (asset) => asset.name.endsWith('.exe'),
    detail: '64-bit',
    short: 'Windows',
    hero: '[data-hero-win]'
  },
  mac: {
    // arm64 is the only Mac artifact electron-builder publishes today.
    match: (asset) => asset.name.endsWith('.dmg'),
    detail: 'Apple silicon',
    short: 'macOS',
    hero: '[data-hero-mac]'
  }
}

const detectPlatform = () => {
  const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent
  if (/win/i.test(platform)) return 'win'
  if (/mac|iphone|ipad|ipod/i.test(platform)) return 'mac'
  // Linux, or anything unrecognised. Helm publishes no build for it, so promote
  // neither button and leave both offered on equal terms.
  return null
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

  // --- the hero buttons: both stay real links; the visitor's own platform is the
  // one that gets filled in. ---
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    const button = el(platform.hero)
    if (button && found[key]) button.href = found[key].browser_download_url
  }

  const detected = detectPlatform()
  const meta = el('[data-download-meta]')

  if (detected && found[detected]) {
    const button = el(PLATFORMS[detected].hero)
    if (button) {
      button.classList.remove('btn-outline')
      button.classList.add('btn-primary')
    }
    if (meta) {
      const parts = [PLATFORMS[detected].detail, formatSize(found[detected].size)]
      if (version) parts.unshift(`v${version}`)
      meta.textContent = parts.join(' · ')
    }
  } else if (meta) {
    // Nothing to promote — keep both sizes on show rather than picking for them.
    const parts = Object.entries(PLATFORMS)
      .filter(([key]) => found[key])
      .map(([key, platform]) => `${platform.short} ${formatSize(found[key].size)}`)
    if (version) parts.unshift(`v${version}`)
    meta.textContent = parts.join(' · ')
  }
}

loadRelease().catch((error) => {
  // The static markup is already correct for the release the page shipped with;
  // log for anyone looking, and change nothing on screen.
  console.warn('Helm: keeping the built-in download links —', error.message)
})
