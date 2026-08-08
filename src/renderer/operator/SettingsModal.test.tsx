// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from './SettingsModal'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

// SettingsModal talks to window.helm on mount (bibles manifest + message list,
// plus both progress subscriptions) — stub just that surface.
beforeEach(() => {
  ;(window as unknown as { helm: unknown }).helm = {
    bibles: {
      manifest: vi.fn().mockResolvedValue([]),
      onProgress: vi.fn().mockReturnValue(() => {}),
      install: vi.fn(),
      uninstall: vi.fn()
    },
    message: {
      list: vi.fn().mockResolvedValue([]),
      onInstallProgress: vi.fn().mockReturnValue(() => {}),
      installCorpus: vi.fn()
    }
  }
})

function renderModal(): void {
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <SettingsModal
        open
        onClose={() => {}}
        onBiblesChanged={() => {}}
        hotkeyOverrides={{}}
        onHotkeyOverridesChange={() => {}}
        family="classic"
        setFamily={() => {}}
        themeMode="dark"
        setThemeMode={() => {}}
      />
    </ThemeCtx.Provider>
  )
}

describe('SettingsModal nav', () => {
  it('renders an icon in every nav item', () => {
    renderModal()
    for (const label of ['Appearance', 'Bibles', 'Displays', 'Shortcuts', 'Message']) {
      const btn = screen.getByRole('button', { name: label })
      expect(btn.querySelector('svg'), `${label} nav item should contain an icon`).toBeTruthy()
    }
  })
})
