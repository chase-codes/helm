// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from './SettingsModal'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { SongImportResult } from '../../shared/types'

afterEach(cleanup)

// SettingsModal talks to window.helm on mount (bibles manifest + message list,
// plus both progress subscriptions) — stub just that surface, plus the song import wizard's.
const songImport = {
  sources: vi.fn(),
  scan: vi.fn(),
  commit: vi.fn(),
  onProgress: vi.fn()
}
beforeEach(() => {
  songImport.sources.mockReset().mockResolvedValue([{ id: 'easyworship', label: 'EasyWorship' }])
  songImport.scan.mockReset().mockResolvedValue({ token: 'tok', rows: [{ title: 'New Song', author: '', stanzas: 1, status: 'new' }] })
  songImport.commit.mockReset()
  songImport.onProgress.mockReset().mockReturnValue(() => {})
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
    },
    updates: {
      getStatus: vi.fn().mockResolvedValue({ state: 'idle', version: null }),
      check: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(true),
      onStatus: vi.fn().mockReturnValue(() => {})
    },
    displays: {
      get: vi.fn().mockResolvedValue({ outputs: 0, displays: [], released: false }),
      onStatus: vi.fn().mockReturnValue(() => {})
    },
    app: {
      version: vi.fn().mockResolvedValue('0.3.0')
    },
    songImport
  }
})

function renderModal({ onClose = () => {}, onSongsImported = () => {} }: { onClose?: () => void; onSongsImported?: () => void } = {}): void {
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <SettingsModal
        open
        onClose={onClose}
        onBiblesChanged={() => {}}
        onSongsImported={onSongsImported}
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
    for (const label of ['Appearance', 'Bibles', 'Displays', 'Shortcuts', 'Songs', 'Message']) {
      const btn = screen.getByRole('button', { name: label })
      expect(btn.querySelector('svg'), `${label} nav item should contain an icon`).toBeTruthy()
    }
  })

  it('renders the update footer at the bottom of the nav', async () => {
    renderModal()
    await act(async () => {})
    expect(screen.getByText('Helm 0.3.0')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy()
  })
})

// #5: song import moved off the Songs rail into Settings → Songs. The wizard stacks over this
// modal, so Escape has to back out one layer at a time (grammar rule 9) and never close
// Settings, and with it the wizard, while a commit is running.
describe('SettingsModal: Songs', () => {
  // Stands in for App's document-level dispatcher, whose Escape closes Settings.
  const appEscape = vi.fn()
  const onAppKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') appEscape()
  }
  beforeEach(() => {
    appEscape.mockReset()
    document.addEventListener('keydown', onAppKey)
  })
  afterEach(() => document.removeEventListener('keydown', onAppKey))
  const escape = (): void => {
    fireEvent.keyDown(document.body, { key: 'Escape' })
  }

  const openWizard = async (): Promise<void> => {
    fireEvent.click(screen.getByRole('button', { name: 'Songs' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Import a song library' }))
    expect(await screen.findByText('Import songs')).toBeTruthy()
  }

  it('opens the import wizard from the Songs section', async () => {
    renderModal()
    await openWizard()
    expect(await screen.findByText('EasyWorship')).toBeTruthy()
  })

  it('Escape closes the wizard first and leaves Settings open; the next press reaches App', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    await openWizard()

    escape()
    expect(screen.queryByText('Import songs')).toBeNull()
    expect(appEscape).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Settings')).toBeTruthy()

    escape()
    expect(appEscape).toHaveBeenCalledTimes(1)
  })

  it('swallows Escape while a commit is in flight, then closes once it settles', async () => {
    let resolveCommit: (r: SongImportResult) => void = () => {}
    songImport.commit.mockImplementation(
      () =>
        new Promise<SongImportResult>((resolve) => {
          resolveCommit = resolve
        })
    )
    const onSongsImported = vi.fn()
    renderModal({ onSongsImported })
    await openWizard()
    fireEvent.click(await screen.findByText('EasyWorship'))
    fireEvent.click(await screen.findByText(/Import 1 song/))
    await screen.findByText(/Importing…/)
    // The in-flight flag reaches this modal through the wizard's passive effect.
    await act(async () => {})

    escape()
    expect(screen.getByText(/Importing…/)).toBeTruthy()
    expect(appEscape).not.toHaveBeenCalled()

    await act(async () => {
      resolveCommit({ imported: 1, skipped: 0, unreadable: [] })
    })
    await screen.findByText(/Imported 1 song/)
    await waitFor(() => expect(onSongsImported).toHaveBeenCalledTimes(1))
    await act(async () => {})

    escape()
    expect(screen.queryByText('Import songs')).toBeNull()
    expect(appEscape).not.toHaveBeenCalled()
  })
})
