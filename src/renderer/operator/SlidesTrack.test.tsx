// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
  { id: 'img1', type: 'image', title: 'Welcome.jpg', filePath: 'img1.jpg', slides: [], createdAt: 2 }
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
})
