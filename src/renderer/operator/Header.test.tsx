// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react'
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
