// @vitest-environment jsdom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRef, useState, type ReactNode } from 'react'
import { OutputViewPopover } from './OutputViewPopover'
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

function installHelmStub(): { setView: ReturnType<typeof vi.fn>; setLeaderSplit: ReturnType<typeof vi.fn> } {
  const setView = vi.fn()
  const setLeaderSplit = vi.fn()
  ;(window as unknown as { helm: unknown }).helm = {
    displays: {
      get: () => Promise.resolve(STATUS),
      onStatus: () => () => {},
      setView,
      setLeaderSplit,
      setRole: vi.fn(),
      openTest: vi.fn()
    }
  }
  return { setView, setLeaderSplit }
}

// Test wrapper component that includes container ref (mimics Header's structure).
function PopoverWithContainer({ onClose }: { onClose: () => void }): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null)
  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div data-testid="chip-button">Chip</div>
      <OutputViewPopover onClose={onClose} containRef={containerRef} />
    </div>
  )
}

// Stateful harness for testing chip toggle behavior (open/close without flicker).
function StatefulPopoverHarness(): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button data-testid="chip-toggle" onClick={() => setOpen((o) => !o)}>
        Chip
      </button>
      {open && <OutputViewPopover onClose={() => setOpen(false)} containRef={containerRef} />}
    </div>
  )
}

const renderPopover = (onClose = vi.fn()): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <PopoverWithContainer onClose={onClose} />
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
    const { setView } = installHelmStub()
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

  it('closes on outside mousedown', async () => {
    installHelmStub()
    const onClose = vi.fn()
    renderPopover(onClose)
    await waitFor(() => expect(onClose).not.toHaveBeenCalled())
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close on inside mousedown (button click proceeds)', async () => {
    const { setView } = installHelmStub()
    const onClose = vi.fn()
    const r = renderPopover(onClose)
    await waitFor(() => expect(r.getByText('Projector')).toBeTruthy())
    // Fire mousedown on the button itself (capture phase) then click (bubble phase).
    const btn = r.getByTestId('view-label:Projector-slides')
    fireEvent.mouseDown(btn)
    fireEvent.click(btn)
    // The click handler runs (setView), then its onClick calls onClose.
    expect(setView).toHaveBeenCalledWith('label:Projector', 'slides')
    expect(onClose).toHaveBeenCalledTimes(1) // only the click's onClose, not the mousedown
  })

  it('chip toggle closes popover without reopen flicker (mousedown in container)', async () => {
    installHelmStub()
    const r = render(
      <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
        <StatefulPopoverHarness />
      </ThemeCtx.Provider>
    )
    // Open popover
    fireEvent.click(r.getByTestId('chip-toggle'))
    await waitFor(() => expect(r.getByTestId('output-view-popover')).toBeTruthy())
    // Click chip (inside container) — mousedown should not trigger outside-close
    const chipBtn = r.getByTestId('chip-toggle')
    fireEvent.mouseDown(chipBtn) // capture phase: inside container, so no dismiss
    fireEvent.click(chipBtn) // bubble phase: onClick toggles closed
    // Popover should be gone now (state is closed)
    await waitFor(() => expect(r.queryByTestId('output-view-popover')).toBeNull())
  })

  it('shows a leader-split slider only for leader-view outputs and sends changes by fingerprint', async () => {
    const setLeaderSplit = vi.fn()
    const leaderStatus: DisplayStatus = {
      outputs: 2,
      released: false,
      displays: [
        {
          id: 1,
          fingerprint: 'fpL',
          label: 'Leader Screen',
          width: 1920,
          height: 1080,
          scaleFactor: 1,
          role: 'stage',
          view: 'leader',
          isOperator: false,
          leaderSplit: 320
        },
        {
          id: 2,
          fingerprint: 'fpS',
          label: 'Slides Screen',
          width: 1920,
          height: 1080,
          scaleFactor: 1,
          role: 'audience',
          view: 'slides',
          isOperator: false,
          leaderSplit: null
        }
      ]
    }
    ;(window as unknown as { helm: unknown }).helm = {
      displays: {
        get: () => Promise.resolve(leaderStatus),
        onStatus: () => () => {},
        setView: vi.fn(),
        setLeaderSplit,
        setRole: vi.fn(),
        openTest: vi.fn()
      }
    }
    const onClose = vi.fn()
    const r = renderPopover(onClose)
    await waitFor(() => expect(r.getByTestId('split-fpL')).toBeTruthy())
    expect(r.queryByTestId('split-fpS')).toBeNull()

    fireEvent.change(r.getByTestId('split-fpL'), { target: { value: '400' } })
    expect(setLeaderSplit).toHaveBeenCalledWith('fpL', 400)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('skips off displays — they have no view to switch', async () => {
    installHelmStub()
    const r = renderPopover()
    await waitFor(() => expect(r.getByText('Projector')).toBeTruthy())
    expect(r.queryByText('Lobby TV')).toBeNull()
  })
})
