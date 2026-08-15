// @vitest-environment jsdom
import { render, cleanup, act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateFooter } from './UpdateFooter'
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
      check: vi.fn(() => Promise.resolve()),
      install: vi.fn(() => Promise.resolve(true)),
      onStatus: vi.fn((cb: (s: UpdateStatus) => void) => {
        updateCb = cb
        return () => {}
      })
    },
    displays: {
      get: vi.fn(() => Promise.resolve<DisplayStatus>({ outputs: 0, displays: [], released: false })),
      onStatus: vi.fn((cb: (d: DisplayStatus) => void) => {
        displaysCb = cb
        return () => {}
      })
    },
    app: {
      version: vi.fn(() => Promise.resolve('0.3.0'))
    }
  }
}

beforeEach(() => {
  installHelmStub()
})

describe('UpdateFooter', () => {
  it('shows the version and a check button when idle, and checks on click', async () => {
    render(<UpdateFooter />)
    await act(async () => {})
    expect(screen.getByText('Helm 0.3.0')).toBeTruthy()
    screen.getByRole('button', { name: 'Check for updates' }).click()
    expect(window.helm.updates.check).toHaveBeenCalled()
  })

  it('shows checking and downloading progress', async () => {
    render(<UpdateFooter />)
    await act(async () => updateCb({ state: 'checking', version: null }))
    expect(screen.getByText('Checking…')).toBeTruthy()
    await act(async () => updateCb({ state: 'downloading', version: '0.4.0', percent: 42 }))
    expect(screen.getByText('Downloading… 42%')).toBeTruthy()
  })

  it('shows up to date with the check button again', async () => {
    render(<UpdateFooter />)
    await act(async () => updateCb({ state: 'upToDate', version: null }))
    expect(screen.getByText('You’re up to date')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy()
  })

  it('shows the error with its message and a retry button', async () => {
    render(<UpdateFooter />)
    await act(async () => updateCb({ state: 'error', version: null, message: 'net down' }))
    expect(screen.getByText(/Couldn’t check for updates — net down/)).toBeTruthy()
    screen.getByRole('button', { name: 'Retry' }).click()
    expect(window.helm.updates.check).toHaveBeenCalled()
  })

  it('shows the macOS-unsupported message with the download link', async () => {
    render(<UpdateFooter />)
    await act(async () => updateCb({ state: 'unsupported', version: null }))
    expect(screen.getByText('In-app updates aren’t available on macOS yet.')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Download the latest from the Helm site' })
    expect(link.getAttribute('href')).toBe('https://chase-codes.github.io/helm/')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('offers restart when ready with no outputs up', async () => {
    render(<UpdateFooter />)
    await act(async () => updateCb({ state: 'ready', version: '0.4.0' }))
    screen.getByRole('button', { name: 'Restart to update' }).click()
    expect(window.helm.updates.install).toHaveBeenCalled()
  })

  it('explains the deferral when ready while outputs are up', async () => {
    render(<UpdateFooter />)
    await act(async () => {
      updateCb({ state: 'ready', version: '0.4.0' })
      displaysCb({ outputs: 1, displays: [], released: false })
    })
    expect(screen.getByText('Update ready — installs once output displays are closed')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
