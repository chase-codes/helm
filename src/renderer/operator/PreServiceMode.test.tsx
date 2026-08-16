// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { PreServiceMode } from './PreServiceMode'
import type { ModeKeyHandlerRef } from './App'
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

const NOTHING_LIVE: PresentationState = { output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null }
const SONG_LIVE: PresentationState = {
  output: 'live',
  liveKey: 'song:abc:0',
  liveSnap: { kind: 'lyrics', label: 'Amazing Grace', lines: ['x'] },
  cuedKey: null,
  cuedSnap: null
}
const cardLive = (id: string): PresentationState => ({
  output: 'live',
  liveKey: `pre:${id}`,
  liveSnap: { kind: 'title', title: 'Greeting' },
  cuedKey: null,
  cuedSnap: null
})

function installHelmStub(
  state: PreState,
  pres: PresentationState = NOTHING_LIVE
): {
  showCard: ReturnType<typeof vi.fn>
  showNow: ReturnType<typeof vi.fn>
  takeCard: ReturnType<typeof vi.fn>
  removeCard: ReturnType<typeof vi.fn>
  restoreCard: ReturnType<typeof vi.fn>
} {
  const showCard = vi.fn()
  const showNow = vi.fn()
  const takeCard = vi.fn()
  const removeCard = vi.fn()
  const restoreCard = vi.fn()
  ;(window as unknown as { helm: unknown }).helm = {
    preservice: {
      getState: () => Promise.resolve(state),
      onState: () => () => {},
      engage: vi.fn(),
      disengage: vi.fn(),
      showCard,
      step: vi.fn(),
      showNow,
      takeCard,
      toggleLoop: vi.fn(),
      setDwell: vi.fn(),
      toggleEnabled: vi.fn(),
      saveCard: vi.fn(),
      removeCard,
      restoreCard
    },
    presentation: {
      get: () => Promise.resolve(pres),
      onState: () => () => {}
    }
  }
  return { showCard, showNow, takeCard, removeCard, restoreCard }
}

const renderMode = (keyHandlerRef: ModeKeyHandlerRef = { current: null }): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <PreServiceMode active keyHandlerRef={keyHandlerRef} />
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

  it('double-clicking a card takes it live', async () => {
    const { takeCard, showCard } = installHelmStub(baseState)
    renderMode()
    const row = (await screen.findByText('Psalm 122:1')).closest('button') as HTMLButtonElement
    // jsdom's fireEvent.doubleClick only dispatches 'dblclick', not the leading
    // 'click' a real double-click also fires — so fire it explicitly to model that.
    fireEvent.click(row)
    fireEvent.doubleClick(row)
    expect(takeCard).toHaveBeenCalledWith(1)
    expect(showCard).toHaveBeenCalledWith(1) // the first click still cues, unchanged
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

    // Load-bearing since BUG-018: with nothing live a tap only selects, so this button is
    // the operator's only way to put a specific card up without starting the rotation.
    it('is available when nothing is live at all', async () => {
      const { showNow } = installHelmStub(baseState, NOTHING_LIVE)
      renderMode()
      await screen.findByText('Greeting')
      const btn = screen.getByText('Show this card').closest('button') as HTMLButtonElement
      expect(btn.disabled).toBe(false)
      fireEvent.click(btn)
      expect(showNow).toHaveBeenCalledTimes(1)
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

describe('PreServiceMode — card removal speaks the in-service grammar (#86, #90)', () => {
  const THREE: PreState = {
    ...baseState,
    cards: [
      ...cards,
      { id: 'c', type: 'list', title: 'Announcements', points: ['Potluck'], enabled: true }
    ]
  }
  const rowFor = (title: string): HTMLElement =>
    screen.getByText(title).closest('button') as HTMLElement

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('right-click Delete removes the card immediately and offers an undo', async () => {
    const { removeCard } = installHelmStub(THREE)
    renderMode()
    await screen.findByText('Announcements')

    fireEvent.contextMenu(rowFor('Announcements'))
    fireEvent.click(await screen.findByText('Delete'))

    // Immediate, NOT deferred: the loop lives in main, and a card left there could still
    // rotate onto the audience screen after the operator removed it.
    expect(removeCard).toHaveBeenCalledWith('c')
    expect(await screen.findByText(/Removed/)).toBeTruthy()
  })

  it('undo restores the card at its original index', async () => {
    const { restoreCard } = installHelmStub(THREE)
    renderMode()
    await screen.findByText('Psalm 122:1')

    fireEvent.contextMenu(rowFor('Psalm 122:1'))
    fireEvent.click(await screen.findByText('Delete'))
    fireEvent.click(await screen.findByText('Undo'))

    expect(restoreCard).toHaveBeenCalledTimes(1)
    expect(restoreCard.mock.calls[0][0]).toMatchObject({ id: 'b', title: 'Psalm 122:1' })
    expect(restoreCard.mock.calls[0][1]).toBe(1)
  })

  it('the undo lapses without restoring once the window closes', async () => {
    const { restoreCard } = installHelmStub(THREE)
    renderMode()
    await screen.findByText('Announcements')

    // Fake timers only from here: the undo window's own timeout has to be created under
    // them to be advanceable, and the async mount above needs real ones.
    vi.useFakeTimers()
    try {
      fireEvent.contextMenu(rowFor('Announcements'))
      fireEvent.click(screen.getByText('Delete'))
      expect(screen.getByText(/Removed/)).toBeTruthy()

      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(screen.queryByText(/Removed/)).toBeNull()
      expect(restoreCard).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shift-click selects a range without switching the screen', async () => {
    const { showCard } = installHelmStub(THREE)
    renderMode()
    await screen.findByText('Announcements')

    fireEvent.click(rowFor('Greeting'))
    showCard.mockClear()
    fireEvent.click(rowFor('Announcements'), { shiftKey: true })

    for (const t of ['Greeting', 'Psalm 122:1', 'Announcements']) {
      expect(rowFor(t).getAttribute('data-selected')).toBe('true')
    }
    // Critical: on an engaged loop showCard switches what the congregation sees, and
    // picking rows to delete is not a request to project any of them.
    expect(showCard).not.toHaveBeenCalled()
  })

  it('a batch delete removes every selected card and restores them all in order', async () => {
    const { removeCard, restoreCard } = installHelmStub(THREE)
    renderMode()
    await screen.findByText('Announcements')

    fireEvent.click(rowFor('Greeting'))
    fireEvent.click(rowFor('Psalm 122:1'), { shiftKey: true })
    fireEvent.contextMenu(rowFor('Psalm 122:1'))
    fireEvent.click(await screen.findByText('Delete 2 cards'))

    expect(removeCard.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    expect(await screen.findByText(/2 cards/)).toBeTruthy()

    fireEvent.click(screen.getByText('Undo'))
    // Ascending index order, so each later insert lands where it was.
    expect(restoreCard.mock.calls.map((c) => c[1])).toEqual([0, 1])
  })

  it('the Delete key removes the selection', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    const { removeCard } = installHelmStub(THREE)
    renderMode(keyHandlerRef)
    await screen.findByText('Announcements')

    fireEvent.click(rowFor('Announcements'))
    act(() => keyHandlerRef.current?.onDelete?.())
    expect(removeCard).toHaveBeenCalledWith('c')
  })

  it('Delete with nothing selected does nothing', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    const { removeCard } = installHelmStub(THREE)
    renderMode(keyHandlerRef)
    await screen.findByText('Announcements')

    act(() => keyHandlerRef.current?.onDelete?.())
    expect(removeCard).not.toHaveBeenCalled()
  })

  it('reports the card editor as a modal so Delete cannot fire behind it', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    installHelmStub(THREE)
    renderMode(keyHandlerRef)
    await screen.findByText('Announcements')
    expect(keyHandlerRef.current?.isModalOpen()).toBe(false)

    fireEvent.click(screen.getByText('+ Add a card — verse, announcements, prayer…'))
    expect(keyHandlerRef.current?.isModalOpen()).toBe(true)

    // Escape backs the modal out, and says it consumed the press. Wrapped in act so the
    // close commits and the delegate is re-registered before it is queried again.
    let consumed = false
    act(() => {
      consumed = keyHandlerRef.current?.onEscape() ?? false
    })
    expect(consumed).toBe(true)
    expect(keyHandlerRef.current?.isModalOpen()).toBe(false)
    expect(keyHandlerRef.current?.onEscape()).toBe(false)
  })

  it('never takes the screen from the keyboard', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    const { showCard, showNow, takeCard } = installHelmStub(THREE)
    renderMode(keyHandlerRef)
    await screen.findByText('Announcements')

    // Pre-service has never answered arrows or Enter, and must not start here: a keystroke
    // that begins projecting from a dark screen is the BUG-018 class of defect.
    act(() => {
      keyHandlerRef.current?.onArrow(1)
      keyHandlerRef.current?.onGoLive()
    })
    expect(showCard).not.toHaveBeenCalled()
    expect(showNow).not.toHaveBeenCalled()
    expect(takeCard).not.toHaveBeenCalled()
  })

  it('Remove card in the editor lands in the same undo bar', async () => {
    const { removeCard } = installHelmStub(THREE)
    renderMode()
    await screen.findByText('Announcements')

    fireEvent.click(within(rowFor('Announcements')).getByTitle('Edit card'))
    fireEvent.click(await screen.findByText('Remove card'))

    expect(removeCard).toHaveBeenCalledWith('c')
    expect(await screen.findByText(/Removed/)).toBeTruthy()
  })

  it('invites the operator to add a card when the loop is empty (#88)', async () => {
    installHelmStub({ ...baseState, cards: [] })
    renderMode()
    expect(await screen.findByText(/The loop is empty/)).toBeTruthy()
  })

  it('shows no empty state while the loop has cards', async () => {
    installHelmStub(THREE)
    renderMode()
    await screen.findByText('Announcements')
    expect(screen.queryByText(/The loop is empty/)).toBeNull()
  })

  // The logo card is the one row with no creation path — PreCardEditor only builds
  // verse/list/message cards — so a delete that lapsed would be permanent with no way back.
  it('refuses to delete the logo card, and says why', async () => {
    const WITH_LOGO: PreState = {
      ...baseState,
      cards: [...cards, { id: 'logo', type: 'logo', title: 'Logo', enabled: false }]
    }
    const { removeCard } = installHelmStub(WITH_LOGO)
    renderMode()
    await screen.findByText('Logo')

    fireEvent.contextMenu(rowFor('Logo'))
    const item = await screen.findByRole('menuitem', { name: /logo card/i })
    expect(item.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(item)
    expect(removeCard).not.toHaveBeenCalled()
  })

  it('a range spanning the logo deletes the rest and counts only those', async () => {
    const WITH_LOGO: PreState = {
      ...baseState,
      cards: [...cards, { id: 'logo', type: 'logo', title: 'Logo', enabled: false }]
    }
    const { removeCard } = installHelmStub(WITH_LOGO)
    renderMode()
    await screen.findByText('Logo')

    fireEvent.click(rowFor('Greeting'))
    fireEvent.click(rowFor('Logo'), { shiftKey: true })
    fireEvent.contextMenu(rowFor('Logo'))
    // Three rows are selected, but only two can go — the label must not over-promise.
    fireEvent.click(await screen.findByText('Delete 2 cards'))

    expect(removeCard.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })

  it('the Delete key leaves the logo card alone', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    const WITH_LOGO: PreState = {
      ...baseState,
      cards: [...cards, { id: 'logo', type: 'logo', title: 'Logo', enabled: false }]
    }
    const { removeCard } = installHelmStub(WITH_LOGO)
    renderMode(keyHandlerRef)
    await screen.findByText('Logo')

    fireEvent.click(rowFor('Logo'))
    act(() => keyHandlerRef.current?.onDelete?.())
    expect(removeCard).not.toHaveBeenCalled()
    expect(screen.queryByText(/Removed/)).toBeNull()
  })
})
