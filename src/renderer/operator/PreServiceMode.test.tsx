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
  step: ReturnType<typeof vi.fn>
  disengage: ReturnType<typeof vi.fn>
  setOutput: ReturnType<typeof vi.fn>
} {
  const showCard = vi.fn()
  const showNow = vi.fn()
  const takeCard = vi.fn()
  const removeCard = vi.fn()
  const restoreCard = vi.fn()
  const step = vi.fn()
  const disengage = vi.fn()
  const setOutput = vi.fn()
  ;(window as unknown as { helm: unknown }).helm = {
    preservice: {
      getState: () => Promise.resolve(state),
      onState: () => () => {},
      engage: vi.fn(),
      disengage,
      showCard,
      step,
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
      onState: () => () => {},
      setOutput
    }
  }
  return { showCard, showNow, takeCard, removeCard, restoreCard, step, disengage, setOutput }
}

const renderMode = (
  keyHandlerRef: ModeKeyHandlerRef = { current: null },
  theme = themeFor('classic', 'dark')
): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={theme}>
      <PreServiceMode active keyHandlerRef={keyHandlerRef} />
    </ThemeCtx.Provider>
  )

/** jsdom reads inline colours back as `rgb(r, g, b)`, so palette hexes need converting
 * before they can be compared against a rendered style. */
const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

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
      // The label stays the verb in both states (#92) — the disabled flag, not the copy,
      // is what says the card is already up.
      const btn = screen.getByText('Show this card').closest('button') as HTMLButtonElement
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

// #87: the page used to speak its own dialect — a hard-coded green for on-air, no
// take-down verb, and a keyboard delegate whose arrows and Enter were no-ops.
describe('PreServiceMode — page chrome speaks the house grammar (#87)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('on-air colour', () => {
    // Red means "the congregation sees this" on every other page. Pinned against a
    // second family so a re-hard-coded constant can't pass by matching one palette.
    it.each(['classic', 'contrast'] as const)('paints PROJECTING with %s live', async (family) => {
      const theme = themeFor(family, 'dark')
      installHelmStub({ ...baseState, engaged: true }, cardLive('a'))
      const { container } = renderMode({ current: null }, theme)

      const bar = (await screen.findByText('PROJECTING')).closest('div') as HTMLElement
      expect(bar.style.color).toBe(rgb(theme.live))
      const dot = bar.querySelector('span') as HTMLElement
      expect(dot.style.background).toBe(rgb(theme.live))
      expect(container.innerHTML).not.toContain('3fb950')
    })

    // The bar reports THIS page's claim on the screen; the header carries the global
    // on-air state. Off screen stays quiet rather than borrowing the live red.
    it('stays faint while pre-service does not own the screen', async () => {
      const theme = themeFor('classic', 'dark')
      installHelmStub(baseState, NOTHING_LIVE)
      renderMode({ current: null }, theme)

      const bar = (await screen.findByText('OFF SCREEN')).closest('div') as HTMLElement
      expect(bar.style.color).toBe(rgb(theme.faint))
    })
  })

  describe('Take down', () => {
    const takeDownBtn = (): HTMLButtonElement =>
      screen.getByText('Take down').closest('button') as HTMLButtonElement

    it('clears the screen and stops the loop', async () => {
      const { setOutput, disengage } = installHelmStub({ ...baseState, engaged: true }, cardLive('a'))
      renderMode()
      await screen.findByText('Greeting')

      fireEvent.click(takeDownBtn())
      expect(setOutput).toHaveBeenCalledWith('black')
      // Explicit, not left to the engine's next tick: `engaged` has to clear now, or the
      // loop keeps claiming a screen the operator just took down for up to a second.
      expect(disengage).toHaveBeenCalledTimes(1)
    })

    it('is inert while nothing is on screen', async () => {
      const { setOutput, disengage } = installHelmStub(baseState, NOTHING_LIVE)
      renderMode()
      await screen.findByText('Greeting')

      expect(takeDownBtn().disabled).toBe(true)
      fireEvent.click(takeDownBtn())
      expect(setOutput).not.toHaveBeenCalled()
      expect(disengage).not.toHaveBeenCalled()
    })

    // Same reach as the header chip and SongsMode's Escape rung: whoever owns the screen,
    // this clears it.
    it('reaches a screen another flow owns', async () => {
      const { setOutput } = installHelmStub(baseState, SONG_LIVE)
      renderMode()
      await screen.findByText('Greeting')

      expect(takeDownBtn().disabled).toBe(false)
      fireEvent.click(takeDownBtn())
      expect(setOutput).toHaveBeenCalledWith('black')
    })
  })

  describe('keyboard delegate', () => {
    it('steps the loop on the arrows, exactly as the ‹ › buttons do', async () => {
      const keyHandlerRef: ModeKeyHandlerRef = { current: null }
      const { step, showNow, takeCard } = installHelmStub(baseState)
      renderMode(keyHandlerRef)
      await screen.findByText('Greeting')

      act(() => {
        keyHandlerRef.current?.onArrow(1)
        keyHandlerRef.current?.onArrow(-1)
      })
      expect(step.mock.calls.map((c) => c[0])).toEqual([1, -1])
      // `step` routes through the engine's navigate-only path, which refuses to light a
      // dark screen (BUG-018) — so arrows can never start projecting.
      expect(showNow).not.toHaveBeenCalled()
      expect(takeCard).not.toHaveBeenCalled()
    })

    it('Enter puts the armed card on screen', async () => {
      const keyHandlerRef: ModeKeyHandlerRef = { current: null }
      const { showNow } = installHelmStub(baseState, NOTHING_LIVE)
      renderMode(keyHandlerRef)
      await screen.findByText('Greeting')

      act(() => keyHandlerRef.current?.onGoLive())
      expect(showNow).toHaveBeenCalledTimes(1)
    })

    it('Enter is inert once that card is already on screen', async () => {
      const keyHandlerRef: ModeKeyHandlerRef = { current: null }
      const { showNow, setOutput } = installHelmStub({ ...baseState, engaged: true }, cardLive('a'))
      renderMode(keyHandlerRef)
      await screen.findByText('Greeting')

      // Mirrors the disabled "On screen" button — Enter is never a take-down here.
      act(() => keyHandlerRef.current?.onGoLive())
      expect(showNow).not.toHaveBeenCalled()
      expect(setOutput).not.toHaveBeenCalled()
    })

    describe('the Escape ladder', () => {
      const THREE: PreState = {
        ...baseState,
        cards: [
          ...cards,
          { id: 'c', type: 'list', title: 'Announcements', points: ['Potluck'], enabled: true }
        ]
      }

      it('clears a delete-selection before it touches the screen', async () => {
        const keyHandlerRef: ModeKeyHandlerRef = { current: null }
        const { setOutput } = installHelmStub({ ...THREE, engaged: true }, cardLive('a'))
        renderMode(keyHandlerRef)
        await screen.findByText('Announcements')

        const row = screen.getByText('Announcements').closest('button') as HTMLElement
        fireEvent.click(row)
        expect(row.getAttribute('data-selected')).toBe('true')

        let consumed = false
        act(() => {
          consumed = keyHandlerRef.current?.onEscape() ?? false
        })
        expect(consumed).toBe(true)
        expect(row.getAttribute('data-selected')).toBeNull()
        expect(setOutput).not.toHaveBeenCalled()
      })

      it('takes the screen down once nothing else is pending', async () => {
        const keyHandlerRef: ModeKeyHandlerRef = { current: null }
        const { setOutput, disengage } = installHelmStub({ ...THREE, engaged: true }, cardLive('a'))
        renderMode(keyHandlerRef)
        await screen.findByText('Announcements')

        let consumed = false
        act(() => {
          consumed = keyHandlerRef.current?.onEscape() ?? false
        })
        expect(consumed).toBe(true)
        expect(setOutput).toHaveBeenCalledWith('black')
        expect(disengage).toHaveBeenCalledTimes(1)
      })

      it('does not consume Escape when the screen is already dark', async () => {
        const keyHandlerRef: ModeKeyHandlerRef = { current: null }
        const { setOutput } = installHelmStub(THREE, NOTHING_LIVE)
        renderMode(keyHandlerRef)
        await screen.findByText('Announcements')

        expect(keyHandlerRef.current?.onEscape()).toBe(false)
        expect(setOutput).not.toHaveBeenCalled()
      })
    })
  })
})
