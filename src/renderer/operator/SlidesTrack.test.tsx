// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { SlidesTrack } from './SlidesTrack'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { MediaItem, PresentationState } from '../../shared/types'

// This project's vitest config does not set `globals: true`, so
// @testing-library/react's auto afterEach(cleanup) never registers; without
// this, DOM from one test leaks into the next.
afterEach(cleanup)

const items: MediaItem[] = [
  { id: 'deck1', type: 'deck', title: 'Sermon.pptx', filePath: null, slides: ['deck1/1.png', 'deck1/2.png'], createdAt: 1 },
  { id: 'img1', type: 'image', title: 'Welcome.jpg', filePath: 'img1.jpg', slides: [], createdAt: 2 },
  { id: 'vid1', type: 'video', title: 'Promo.mp4', filePath: 'video/promo.mp4', slides: [], createdAt: 3 }
]

function installHelmStub(): { goLive: ReturnType<typeof vi.fn>; cue: ReturnType<typeof vi.fn> } {
  const goLive = vi.fn()
  const cue = vi.fn()
  const state: PresentationState = { output: 'black', liveKey: null, liveSnap: null }
  ;(window as unknown as { helm: unknown }).helm = {
    media: {
      list: () => Promise.resolve(items),
      importImages: vi.fn(() => Promise.resolve(items)),
      importVideo: vi.fn(() => Promise.resolve(items)),
      importDeck: vi.fn(() => Promise.resolve({ items })),
      remove: vi.fn(() => Promise.resolve(items))
    },
    presentation: {
      get: () => Promise.resolve(state),
      cue,
      goLive,
      setOutput: vi.fn(),
      onState: () => () => {}
    },
    video: {
      get: () => Promise.resolve({ key: null, src: null, playing: false, positionMs: 0, durationMs: 0, volume: 1, muted: false }),
      onState: () => () => {},
      load: vi.fn(), play: vi.fn(), pause: vi.fn(),
      seek: vi.fn(), setVolume: vi.fn(), setMuted: vi.fn(), reportDuration: vi.fn()
    }
  }
  return { goLive, cue }
}

function renderTrack(): void {
  render(
    <ThemeCtx.Provider value={themeFor('dark')}>
      <SlidesTrack slidesKeyRef={{ current: null }} active track="slides" setTrack={() => {}} />
    </ThemeCtx.Provider>
  )
}

describe('SlidesTrack', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders both library item titles from media.list', async () => {
    installHelmStub()
    renderTrack()
    expect(await screen.findByText('▤ Sermon.pptx')).toBeTruthy()
    expect(await screen.findByText('▣ Welcome.jpg')).toBeTruthy()
  })

  it('selecting the deck shows its numbered slide rail', async () => {
    installHelmStub()
    renderTrack()
    const deckRow = (await screen.findByText('▤ Sermon.pptx')).closest('button') as HTMLButtonElement
    fireEvent.click(deckRow)
    expect(await screen.findByText('1')).toBeTruthy()
    expect(await screen.findByText('2')).toBeTruthy()
  })

  it('does not show a slide rail for a single-slide image item', async () => {
    installHelmStub()
    renderTrack()
    const imgRow = (await screen.findByText('▣ Welcome.jpg')).closest('button') as HTMLButtonElement
    fireEvent.click(imgRow)
    expect(screen.queryByText('1')).toBeNull()
  })

  it('Go Live calls presentation.goLive with a pres: key', async () => {
    const { goLive } = installHelmStub()
    renderTrack()
    await screen.findByText('▤ Sermon.pptx')
    const goLiveBtn = (await screen.findByText('● Go live')).closest('button') as HTMLButtonElement
    fireEvent.click(goLiveBtn)
    expect(goLive).toHaveBeenCalledWith(expect.stringMatching(/^pres:/), expect.anything())
  })

  it('shows the LibreOffice-missing fallback modal when importDeck reports no-libreoffice', async () => {
    installHelmStub()
    window.helm.media.importDeck = vi.fn(async () => ({ items: [], error: 'no-libreoffice' as const }))
    renderTrack()
    const importBtn = (await screen.findByText('+ Import')).closest('button') as HTMLButtonElement
    fireEvent.click(importBtn)
    const pptBtn = (await screen.findByText('PowerPoint')).closest('button') as HTMLButtonElement
    fireEvent.click(pptBtn)
    expect(
      await screen.findByText(
        'Install LibreOffice to import PowerPoint decks, or export your slides as images and add them individually.'
      )
    ).toBeTruthy()
  })

  it('cancelling the PowerPoint picker (same items, no new id) leaves the current selection untouched', async () => {
    const { cue } = installHelmStub()
    // Select the image item first, so we can prove a cancelled deck-import doesn't
    // silently steal selection back to the deck (items[0]).
    renderTrack()
    const imgRow = (await screen.findByText('▣ Welcome.jpg')).closest('button') as HTMLButtonElement
    fireEvent.click(imgRow)
    await screen.findByText('▣ Welcome.jpg')
    cue.mockClear()

    // Simulate a cancelled OS file picker: importDeck resolves with the SAME items
    // (no new id) — the only signal a cancel gives, per the IPC contract.
    window.helm.media.importDeck = vi.fn(async () => ({ items }))
    const importBtn = (await screen.findByText('+ Import')).closest('button') as HTMLButtonElement
    fireEvent.click(importBtn)
    const pptBtn = (await screen.findByText('PowerPoint')).closest('button') as HTMLButtonElement
    fireEvent.click(pptBtn)

    // Give the resolved promise a tick to flush.
    await screen.findByText('▣ Welcome.jpg')
    // No slide rail (deck rail only renders when a deck is selected) — selection is
    // still the image, not silently reassigned to items[0] (the deck).
    expect(screen.queryByText('1')).toBeNull()
    expect(screen.queryByText('2')).toBeNull()
    // The cue effect must not have re-fired for the deck as a result of the cancel.
    expect(cue).not.toHaveBeenCalledWith(expect.stringContaining('deck1'), expect.anything())
  })

  it('selecting a video item loads it into the shared video state', async () => {
    installHelmStub()
    renderTrack()
    const vidRow = (await screen.findByText('▶ Promo.mp4')).closest('button') as HTMLButtonElement
    fireEvent.click(vidRow)
    await waitFor(() =>
      expect(window.helm.video.load).toHaveBeenCalledWith('pres:vid1:0', 'helm-media://video/promo.mp4')
    )
  })

  it('a selected video item renders the synced VideoCanvas (not just a poster) in the hero', async () => {
    installHelmStub()
    renderTrack()
    const vidRow = (await screen.findByText('▶ Promo.mp4')).closest('button') as HTMLButtonElement
    fireEvent.click(vidRow)
    // VideoCanvas renders <video playsInline> with NO preload attribute; SlideCanvas
    // posters (e.g. the left-rail thumbnails) always have preload="metadata". A video
    // element lacking preload="metadata" therefore proves the heroMedia/VideoCanvas
    // wiring is present — a bare querySelector('video') would match a rail poster instead.
    await waitFor(() => {
      const videos = Array.from(document.querySelectorAll('video'))
      expect(videos.some((v) => v.getAttribute('preload') !== 'metadata')).toBe(true)
    })
  })
})
