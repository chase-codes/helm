// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { PreServiceMode } from './PreServiceMode'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { PreCard, PreState, PresentationState } from '../../shared/types'

// This project's vitest config does not set `globals: true`, so
// @testing-library/react's auto afterEach(cleanup) never registers; without
// this, DOM from one test leaks into the next.
afterEach(cleanup)

const cards: PreCard[] = [
  { id: 'a', type: 'message', title: 'Greeting', headline: 'Welcome', enabled: true },
  { id: 'b', type: 'verse', title: 'Psalm 122:1', ref: 'Psalm 122:1', text: 'I was glad…', enabled: true }
]

const baseState: PreState = {
  engaged: false,
  loopOn: true,
  idx: 0,
  dwellS: 12,
  cards
}

const NOTHING_LIVE: PresentationState = { output: 'black', liveKey: null, liveSnap: null }
const SONG_LIVE: PresentationState = {
  output: 'live',
  liveKey: 'song:abc:0',
  liveSnap: { kind: 'lyrics', label: 'Amazing Grace', lines: ['x'] }
}
const cardLive = (id: string): PresentationState => ({
  output: 'live',
  liveKey: `pre:${id}`,
  liveSnap: { kind: 'title', title: 'Greeting' }
})

function installHelmStub(
  state: PreState,
  pres: PresentationState = NOTHING_LIVE
): { showCard: ReturnType<typeof vi.fn>; showNow: ReturnType<typeof vi.fn> } {
  const showCard = vi.fn()
  const showNow = vi.fn()
  ;(window as unknown as { helm: unknown }).helm = {
    preservice: {
      getState: () => Promise.resolve(state),
      onState: () => () => {},
      engage: vi.fn(),
      disengage: vi.fn(),
      showCard,
      step: vi.fn(),
      showNow,
      toggleLoop: vi.fn(),
      setDwell: vi.fn(),
      toggleEnabled: vi.fn(),
      saveCard: vi.fn(),
      removeCard: vi.fn()
    },
    presentation: {
      get: () => Promise.resolve(pres),
      onState: () => () => {}
    }
  }
  return { showCard, showNow }
}

const renderMode = (): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('dark')}>
      <PreServiceMode themeMode="dark" active />
    </ThemeCtx.Provider>
  )

describe('PreServiceMode', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the seeded card titles from getState', async () => {
    installHelmStub(baseState)
    renderMode()
    expect(await screen.findByText('Greeting')).toBeTruthy()
    expect(await screen.findByText('Psalm 122:1')).toBeTruthy()
  })

  it('clicking a card row calls showCard with its index', async () => {
    const { showCard } = installHelmStub(baseState)
    renderMode()
    const row = (await screen.findByText('Psalm 122:1')).closest('button') as HTMLButtonElement
    fireEvent.click(row)
    expect(showCard).toHaveBeenCalledWith(1)
  })

  // BUG-008: these badges must follow the real presentation state, never the engine's
  // `engaged` flag — the two diverge exactly when the operator most needs the truth.
  describe('screen-ownership badges', () => {
    it('reports OFF SCREEN and arms the selection when nothing is live', async () => {
      installHelmStub(baseState)
      renderMode()
      expect(await screen.findByText('OFF SCREEN')).toBeTruthy()
      // Two by design: the row badge and the preview header both mark the armed card.
      expect(screen.getAllByText('● ARMED')).toHaveLength(2)
      expect(screen.queryByText('● ON SCREEN')).toBeNull()
    })

    it('does not claim the screen while a song is live', async () => {
      installHelmStub({ ...baseState, engaged: true }, SONG_LIVE)
      renderMode()
      expect(await screen.findByText('ANOTHER FLOW LIVE')).toBeTruthy()
      expect(screen.queryByText('● ON SCREEN')).toBeNull()
      expect(screen.queryByText('PROJECTING')).toBeNull()
    })

    it('marks the genuinely live card ON SCREEN and stops arming it', async () => {
      installHelmStub({ ...baseState, engaged: true }, cardLive('a'))
      renderMode()
      expect(await screen.findByText('PROJECTING')).toBeTruthy()
      expect(screen.getByText('● ON SCREEN')).toBeTruthy()
      expect(screen.queryByText('● ARMED')).toBeNull()
    })
  })

  describe('Show this card', () => {
    it('takes the screen for the armed card', async () => {
      const { showNow } = installHelmStub(baseState, SONG_LIVE)
      const { container } = renderMode()
      await screen.findByText('Greeting')
      const btn = screen.getByText('Show this card').closest('button') as HTMLButtonElement
      expect(btn.disabled).toBe(false)
      fireEvent.click(btn)
      expect(showNow).toHaveBeenCalledTimes(1)
      expect(container).toBeTruthy()
    })

    it('is inert once that card is already on screen', async () => {
      const { showNow } = installHelmStub(baseState, cardLive('a'))
      renderMode()
      await screen.findByText('Greeting')
      const btn = screen.getByText('On screen').closest('button') as HTMLButtonElement
      expect(btn.disabled).toBe(true)
      fireEvent.click(btn)
      expect(showNow).not.toHaveBeenCalled()
    })
  })
})
