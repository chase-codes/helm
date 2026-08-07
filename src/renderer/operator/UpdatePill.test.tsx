// @vitest-environment jsdom
import { render, cleanup, act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdatePill } from './UpdatePill'
import type { DisplayStatus, UpdateStatus } from '../../shared/types'

afterEach(cleanup)

let updateCb: (s: UpdateStatus) => void = () => {}
let displaysCb: (d: DisplayStatus) => void = () => {}

function installHelmStub(): void {
  updateCb = () => {}
  displaysCb = () => {}
  ;(window as unknown as { helm: unknown }).helm = {
    updates: {
      getStatus: vi.fn(() => Promise.resolve<UpdateStatus>({ state: 'idle', version: null })),
      install: vi.fn(() => Promise.resolve(true)),
      onStatus: vi.fn((cb: (s: UpdateStatus) => void) => {
        updateCb = cb
        return () => {}
      })
    },
    displays: {
      get: vi.fn(() => Promise.resolve<DisplayStatus>({ outputs: 0, displays: [] })),
      onStatus: vi.fn((cb: (d: DisplayStatus) => void) => {
        displaysCb = cb
        return () => {}
      })
    }
  }
}

beforeEach(() => {
  installHelmStub()
})

describe('UpdatePill', () => {
  it('renders nothing until an update is ready', async () => {
    const { container } = render(<UpdatePill />)
    await act(async () => {})
    expect(container.firstChild).toBeNull()
  })

  it('shows the pill when ready and installs on click', async () => {
    render(<UpdatePill />)
    await act(async () => updateCb({ state: 'ready', version: '0.2.0' }))
    const btn = screen.getByRole('button', { name: /update ready/i })
    btn.click()
    expect(window.helm.updates.install).toHaveBeenCalled()
  })

  it('hides while any output window is up', async () => {
    render(<UpdatePill />)
    await act(async () => {
      updateCb({ state: 'ready', version: '0.2.0' })
      displaysCb({ outputs: 1, displays: [] })
    })
    expect(screen.queryByRole('button')).toBeNull()
  })
})
