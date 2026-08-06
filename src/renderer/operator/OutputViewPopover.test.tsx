// @vitest-environment jsdom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OutputViewPopover } from './OutputViewPopover'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { DisplayStatus } from '../../shared/types'

afterEach(cleanup)

const STATUS: DisplayStatus = {
  outputs: 2,
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
      isOperator: true
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
      isOperator: false
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
      isOperator: false
    }
  ]
}

function installHelmStub(): ReturnType<typeof vi.fn> {
  const setView = vi.fn()
  ;(window as unknown as { helm: unknown }).helm = {
    displays: {
      get: () => Promise.resolve(STATUS),
      onStatus: () => () => {},
      setView,
      setRole: vi.fn(),
      openTest: vi.fn()
    }
  }
  return setView
}
const renderPopover = (onClose = vi.fn()) =>
  render(
    <ThemeCtx.Provider value={themeFor('dark', 'Warm')}>
      <OutputViewPopover onClose={onClose} />
    </ThemeCtx.Provider>
  )

describe('OutputViewPopover', () => {
  it('lists output displays only, with resolution fallback for unlabeled ones', async () => {
    installHelmStub()
    const r = renderPopover()
    await waitFor(() => expect(r.getByText('Projector')).toBeTruthy())
    expect(r.getByText('1024×600')).toBeTruthy()
    expect(r.queryByText('Built-in Display')).toBeNull() // operator screen not listed
  })

  it('switches a view and closes', async () => {
    const setView = installHelmStub()
    const onClose = vi.fn()
    const r = renderPopover(onClose)
    await waitFor(() => expect(r.getByText('Projector')).toBeTruthy())
    fireEvent.click(r.getByTestId('view-label:Projector-slides'))
    expect(setView).toHaveBeenCalledWith('label:Projector', 'slides')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    installHelmStub()
    const onClose = vi.fn()
    renderPopover(onClose)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
