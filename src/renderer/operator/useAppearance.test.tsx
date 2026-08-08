// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { themeFor } from '../../shared/theme'
import { sanitizeAppearance, useAppearance } from './useAppearance'

const settingsGet = vi.fn()
const settingsSet = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  settingsGet.mockResolvedValue({ family: 'classic', mode: 'dark' })
  ;(window as unknown as { helm: unknown }).helm = {
    settings: { get: settingsGet, set: settingsSet }
  }
})

describe('sanitizeAppearance', () => {
  it('passes valid values through', () => {
    expect(sanitizeAppearance({ family: 'helm', mode: 'light' })).toEqual({ family: 'helm', mode: 'light' })
  })
  it('falls back per-field on garbage', () => {
    expect(sanitizeAppearance({ family: 'neon', mode: 42 })).toEqual({ family: 'classic', mode: 'dark' })
    expect(sanitizeAppearance(null)).toEqual({ family: 'classic', mode: 'dark' })
    expect(sanitizeAppearance('nope')).toEqual({ family: 'classic', mode: 'dark' })
  })
})

describe('useAppearance', () => {
  it('hydrates the saved appearance on mount', async () => {
    settingsGet.mockResolvedValue({ family: 'helm', mode: 'light' })
    const { result } = renderHook(() => useAppearance())
    await waitFor(() => expect(result.current.family).toBe('helm'))
    expect(result.current.mode).toBe('light')
    expect(result.current.theme).toEqual(themeFor('helm', 'light'))
    expect(settingsGet).toHaveBeenCalledWith('appearance', { family: 'classic', mode: 'dark' })
  })

  it('toggleMode flips within the family and persists', async () => {
    const { result } = renderHook(() => useAppearance())
    await waitFor(() => expect(settingsGet).toHaveBeenCalled())
    act(() => result.current.toggleMode())
    expect(result.current.mode).toBe('light')
    expect(result.current.family).toBe('classic')
    expect(settingsSet).toHaveBeenCalledWith('appearance', { family: 'classic', mode: 'light' })
  })

  it('setFamily keeps the mode and persists', async () => {
    const { result } = renderHook(() => useAppearance())
    await waitFor(() => expect(settingsGet).toHaveBeenCalled())
    act(() => result.current.setFamily('helm'))
    expect(result.current.family).toBe('helm')
    expect(result.current.mode).toBe('dark')
    expect(settingsSet).toHaveBeenCalledWith('appearance', { family: 'helm', mode: 'dark' })
  })
})
