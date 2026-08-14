// @vitest-environment jsdom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DisplaysSettings } from './DisplaysSettings'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { DisplayStatus } from '../../shared/types'

afterEach(cleanup)

const STATUS: DisplayStatus = {
  outputs: 2,
  released: false,
  displays: [
    {
      id: 1,
      fingerprint: 'label:Built-in',
      label: 'Built-in Display',
      width: 1512,
      height: 982,
      scaleFactor: 2,
      role: null,
      view: null,
      isOperator: true,
      leaderSplit: null
    },
    {
      id: 2,
      fingerprint: 'label:Projector',
      label: 'Projector',
      width: 1920,
      height: 1080,
      scaleFactor: 1,
      role: 'audience',
      view: 'slides',
      isOperator: false,
      leaderSplit: 320
    },
    {
      id: 3,
      fingerprint: 'geo:1024x600@1r0',
      label: '',
      width: 1024,
      height: 600,
      scaleFactor: 1,
      role: 'stage',
      view: 'mirror',
      isOperator: false,
      leaderSplit: 320
    },
    {
      id: 4,
      fingerprint: 'label:Lobby TV',
      label: 'Lobby TV',
      width: 1280,
      height: 720,
      scaleFactor: 1,
      role: 'off',
      view: 'slides',
      isOperator: false,
      leaderSplit: 320
    }
  ]
}

function installHelmStub(): {
  setRole: ReturnType<typeof vi.fn>
  setView: ReturnType<typeof vi.fn>
} {
  const setRole = vi.fn()
  const setView = vi.fn()
  ;(window as unknown as { helm: unknown }).helm = {
    displays: {
      get: () => Promise.resolve(STATUS),
      onStatus: () => () => {},
      setView,
      setRole,
      openTest: vi.fn()
    }
  }
  return { setRole, setView }
}

const renderPane = (): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <DisplaysSettings />
    </ThemeCtx.Provider>
  )

describe('DisplaysSettings', () => {
  it('lists every display, marking the operator screen and offering no pickers for it', async () => {
    installHelmStub()
    const r = renderPane()
    await waitFor(() => expect(r.getByText('Built-in Display')).toBeTruthy())
    expect(r.getByText('Operator screen')).toBeTruthy()
    expect(r.queryByTestId('role-label:Built-in')).toBeNull()
  })

  it('changes a role and a view over IPC', async () => {
    const { setRole, setView } = installHelmStub()
    const r = renderPane()
    await waitFor(() => expect(r.getByText('Projector')).toBeTruthy())
    fireEvent.change(r.getByTestId('role-label:Projector'), { target: { value: 'stage' } })
    expect(setRole).toHaveBeenCalledWith('label:Projector', 'stage')
    fireEvent.click(r.getByTestId('view-label:Projector-leader'))
    expect(setView).toHaveBeenCalledWith('label:Projector', 'leader')
  })

  it('shows resolution and scale for each display', async () => {
    installHelmStub()
    const r = renderPane()
    await waitFor(() => expect(r.getByText('1920×1080 @1x')).toBeTruthy())
    expect(r.getByText('1512×982 @2x')).toBeTruthy()
  })

  it('offers an off option in the role dropdown', async () => {
    installHelmStub()
    const r = renderPane()
    await waitFor(() => expect(r.getByText('Projector')).toBeTruthy())
    const select = r.getByTestId('role-label:Projector') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toContain('off')
  })

  it('hides the view control for an off display but keeps its role picker', async () => {
    installHelmStub()
    const r = renderPane()
    await waitFor(() => expect(r.getByText('Lobby TV')).toBeTruthy())
    expect(r.getByTestId('role-label:Lobby TV')).toBeTruthy()
    expect(r.queryByTestId('view-label:Lobby TV-slides')).toBeNull()
    // A driven display still shows its view buttons.
    expect(r.getByTestId('view-label:Projector-slides')).toBeTruthy()
  })
})
