// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { PreServiceMode } from './PreServiceMode'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { PreCard, PreState } from '../../shared/types'

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

function installHelmStub(state: PreState): { showCard: ReturnType<typeof vi.fn> } {
  const showCard = vi.fn()
  ;(window as unknown as { helm: unknown }).helm = {
    preservice: {
      getState: () => Promise.resolve(state),
      onState: () => () => {},
      engage: vi.fn(),
      disengage: vi.fn(),
      showCard,
      step: vi.fn(),
      toggleLoop: vi.fn(),
      setDwell: vi.fn(),
      toggleEnabled: vi.fn(),
      saveCard: vi.fn(),
      removeCard: vi.fn()
    }
  }
  return { showCard }
}

describe('PreServiceMode', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the seeded card titles from getState', async () => {
    installHelmStub(baseState)
    render(
      <ThemeCtx.Provider value={themeFor('dark')}>
        <PreServiceMode themeMode="dark" active />
      </ThemeCtx.Provider>
    )
    expect(await screen.findByText('Greeting')).toBeTruthy()
    expect(await screen.findByText('Psalm 122:1')).toBeTruthy()
  })

  it('clicking a card row calls showCard with its index', async () => {
    const { showCard } = installHelmStub(baseState)
    render(
      <ThemeCtx.Provider value={themeFor('dark')}>
        <PreServiceMode themeMode="dark" active />
      </ThemeCtx.Provider>
    )
    const row = (await screen.findByText('Psalm 122:1')).closest('button') as HTMLButtonElement
    fireEvent.click(row)
    expect(showCard).toHaveBeenCalledWith(1)
  })
})
