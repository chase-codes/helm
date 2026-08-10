// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettings } from './AppearanceSettings'
import { ThemeCtx } from './ThemeCtx'
import { FAMILIES, themeFor, type ThemeFamily, type ThemeMode } from '../../shared/theme'

afterEach(cleanup)

function renderAppearance(
  family: ThemeFamily = 'classic',
  mode: ThemeMode = 'dark'
): { onFamilyChange: ReturnType<typeof vi.fn>; onModeChange: ReturnType<typeof vi.fn> } {
  const onFamilyChange = vi.fn()
  const onModeChange = vi.fn()
  render(
    <ThemeCtx.Provider value={themeFor(family, mode)}>
      <AppearanceSettings
        family={family}
        onFamilyChange={onFamilyChange}
        themeMode={mode}
        onModeChange={onModeChange}
      />
    </ThemeCtx.Provider>
  )
  return { onFamilyChange, onModeChange }
}

describe('AppearanceSettings', () => {
  it('renders a card per family with the active one marked', () => {
    renderAppearance('helm')
    for (const f of Object.keys(FAMILIES)) {
      expect(screen.getByTestId(`family-${f}`)).toBeTruthy()
    }
    const helm = screen.getByTestId('family-helm')
    const classic = screen.getByTestId('family-classic')
    expect(helm.textContent).toContain('Helm')
    expect(helm.textContent).toContain('✓')
    expect(classic.textContent).toContain('Classic')
    expect(classic.textContent).not.toContain('✓')
  })

  it('offers the three families added alongside Classic and Helm', () => {
    const { onFamilyChange } = renderAppearance('classic', 'light')
    expect(screen.getByTestId('family-grove').textContent).toContain('Sage')
    fireEvent.click(screen.getByTestId('family-grove'))
    expect(onFamilyChange).toHaveBeenCalledWith('grove')
  })

  it('shows the preset name for the current mode', () => {
    renderAppearance('helm', 'dark')
    expect(screen.getByText('Helm Navy')).toBeTruthy()
    expect(screen.getByText('Charcoal')).toBeTruthy()
  })

  it('clicking a family card reports it', () => {
    const { onFamilyChange } = renderAppearance('classic')
    fireEvent.click(screen.getByTestId('family-helm'))
    expect(onFamilyChange).toHaveBeenCalledWith('helm')
  })

  it('mode control reports the absolute mode', () => {
    const { onModeChange } = renderAppearance('classic', 'dark')
    fireEvent.click(screen.getByText('Light'))
    expect(onModeChange).toHaveBeenCalledWith('light')
  })
})
