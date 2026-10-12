// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Header } from './Header'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)
beforeEach(() => {
  ;(window as unknown as { helm: unknown }).helm = {
    presentation: { get: vi.fn(async () => null), onState: vi.fn(() => () => {}) },
    displays: { get: vi.fn(async () => ({ outputs: 0, released: false, displays: [] })), onStatus: vi.fn(() => () => {}) },
    updates: { getStatus: vi.fn(async () => ({ state: 'idle', version: null })), onStatus: vi.fn(() => () => {}) }
  }
})

describe('Header feedback button', () => {
  it('sits beside settings and opens feedback', () => {
    const onOpenFeedback = vi.fn()
    const { getByTitle } = render(
      <ThemeCtx.Provider value={themeFor('helm', 'dark')}>
        <Header mode="songs" setMode={() => {}} themeMode="dark" toggleTheme={() => {}} onOpenSettings={() => {}} onOpenFeedback={onOpenFeedback} hotkeyOverrides={{}} />
      </ThemeCtx.Provider>
    )
    fireEvent.click(getByTitle('Send feedback'))
    expect(onOpenFeedback).toHaveBeenCalledTimes(1)
    const settings = getByTitle('Settings')
    expect(settings.nextElementSibling).toBe(getByTitle('Send feedback'))
  })
})

// The beforeEach stub's presentation.get resolves null; these tests install a real state.
const setPresentation = (st: unknown): void => {
  ;(window as unknown as { helm: { presentation: unknown } }).helm.presentation = {
    get: vi.fn(async () => st),
    onState: vi.fn(() => () => {})
  }
}
const renderHeader = (): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('helm', 'dark')}>
      <Header mode="songs" setMode={() => {}} themeMode="dark" toggleTheme={() => {}} onOpenSettings={() => {}} onOpenFeedback={() => {}} hotkeyOverrides={{}} />
    </ThemeCtx.Provider>
  )

describe('Header status chip', () => {
  it('reads NOTHING ON SCREEN when the output is black (vocabulary)', async () => {
    setPresentation({ output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null })
    renderHeader()
    expect(await screen.findByText('NOTHING ON SCREEN')).toBeTruthy()
    expect(screen.queryByText('SCREEN BLACK')).toBeNull()
  })

  it('titles the live chip with the Take down tooltip every page uses', async () => {
    setPresentation({
      output: 'live',
      liveKey: 'song:s1:0',
      liveSnap: { kind: 'lyrics', label: 'Amazing Grace', lines: ['x'] },
      cuedKey: null,
      cuedSnap: null
    })
    renderHeader()
    expect(await screen.findByTitle('Black the audience screen')).toBeTruthy()
  })
})
