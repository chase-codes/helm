// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShortcutsSettings } from './ShortcutsSettings'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { HotkeyOverrides } from '../../shared/hotkeys/actions'

afterEach(cleanup)

function renderPane(
  overrides: HotkeyOverrides = {},
  onChange = vi.fn()
): { onChange: ReturnType<typeof vi.fn> } {
  render(
    <ThemeCtx.Provider value={themeFor('dark')}>
      <ShortcutsSettings overrides={overrides} onChange={onChange} />
    </ThemeCtx.Provider>
  )
  return { onChange }
}

describe('ShortcutsSettings', () => {
  it('lists actions grouped with their current bindings', () => {
    renderPane()
    expect(screen.getByText('Jump to chorus')).toBeTruthy()
    expect(screen.getByText('Scripture lookup')).toBeTruthy()
    expect(screen.getByText('Home')).toBeTruthy()
  })

  it('captures a key to rebind and reports it via onChange', () => {
    const { onChange } = renderPane()
    fireEvent.click(screen.getByRole('button', { name: /rebind Jump to bridge/i }))
    expect(screen.getByText(/press a key/i)).toBeTruthy()
    fireEvent.keyDown(window, { key: 'x' })
    expect(onChange).toHaveBeenCalledWith({ 'song.bridge': ['X'] })
  })

  it('refuses a conflicting key and names the holder', () => {
    const { onChange } = renderPane()
    fireEvent.click(screen.getByRole('button', { name: /rebind Jump to bridge/i }))
    fireEvent.keyDown(window, { key: 'c' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/Jump to chorus/i, { selector: '[data-conflict]' })).toBeTruthy()
  })

  it('Escape cancels capture without changes', () => {
    const { onChange } = renderPane()
    fireEvent.click(screen.getByRole('button', { name: /rebind Jump to bridge/i }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/press a key/i)).toBeNull()
  })

  it('per-row reset restores defaults; reset all clears every override', () => {
    const { onChange } = renderPane({ 'song.bridge': ['X'], 'song.tag': ['Y'] })
    fireEvent.click(screen.getByRole('button', { name: /reset Jump to bridge/i }))
    expect(onChange).toHaveBeenCalledWith({ 'song.tag': ['Y'] })
    fireEvent.click(screen.getByRole('button', { name: /reset all/i }))
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('fixed actions offer no rebind button', () => {
    renderPane()
    expect(screen.queryByRole('button', { name: /rebind Close \/ clear/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /rebind Jump to Verse/i })).toBeNull()
  })
})
