// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageSearchRail, type MsgScheduleRow } from './MessageSearchRail'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

const baseProps = {
  theme: themeFor('classic', 'dark'),
  q: '',
  onQChange: vi.fn(),
  scopeLabel: null,
  onClearScope: vi.fn(),
  tapeRows: [],
  quoteRows: [],
  scheduleRows: [],
  tapePlayer: null,
  hasTapes: true,
  onImportMessages: vi.fn()
}

const scheduleRow = (over: Partial<MsgScheduleRow> = {}): MsgScheduleRow => ({
  id: 'q1',
  title: 'Faith',
  meta: '¶2 · Tape 47-0412',
  isCurrent: false,
  isSelected: false,
  isLive: false,
  isQueued: false,
  onClick: vi.fn(),
  onDoubleClick: vi.fn(),
  onContextMenu: vi.fn(),
  ...over
})

describe('MessageSearchRail — double-click to go live (#58)', () => {
  it('fires onDoubleClick on a tape row', () => {
    const onDoubleClick = vi.fn()
    const tapeRows = [{ id: 'm1', title: 'Faith', meta: 'Tape 47-0412', onClick: vi.fn(), onDoubleClick }]
    render(<MessageSearchRail {...baseProps} q="faith" tapeRows={tapeRows} />)
    fireEvent.doubleClick(screen.getByText('Faith').closest('button') as HTMLButtonElement)
    expect(onDoubleClick).toHaveBeenCalled()
  })

  it('fires onDoubleClick on a quote row', () => {
    const onDoubleClick = vi.fn()
    const quoteRows = [{ id: 'm1:1', title: '¶2', preview: 'Second paragraph', onClick: vi.fn(), onDoubleClick }]
    render(<MessageSearchRail {...baseProps} q="faith" quoteRows={quoteRows} />)
    fireEvent.doubleClick(screen.getByText('¶2').closest('button') as HTMLButtonElement)
    expect(onDoubleClick).toHaveBeenCalled()
  })

  it('fires onDoubleClick on a schedule row', () => {
    const onDoubleClick = vi.fn()
    render(<MessageSearchRail {...baseProps} scheduleRows={[scheduleRow({ onDoubleClick })]} />)
    fireEvent.doubleClick(screen.getByText('Faith').closest('button') as HTMLButtonElement)
    expect(onDoubleClick).toHaveBeenCalled()
  })
})

describe('MessageSearchRail — quote schedule list kit (#90, #88, #86)', () => {
  const rowFor = (title: string): HTMLButtonElement =>
    screen.getByText(title).closest('button') as HTMLButtonElement

  it('fires onContextMenu on a schedule row', () => {
    const onContextMenu = vi.fn()
    render(<MessageSearchRail {...baseProps} scheduleRows={[scheduleRow({ onContextMenu })]} />)
    fireEvent.contextMenu(rowFor('Faith'))
    expect(onContextMenu).toHaveBeenCalled()
  })

  it('passes the click event through so the caller can read shiftKey', () => {
    const onClick = vi.fn()
    render(<MessageSearchRail {...baseProps} scheduleRows={[scheduleRow({ onClick })]} />)
    fireEvent.click(rowFor('Faith'), { shiftKey: true })
    expect(onClick.mock.calls[0][0].shiftKey).toBe(true)
  })

  it('marks a selected row so a range reads as one block', () => {
    render(
      <MessageSearchRail
        {...baseProps}
        scheduleRows={[scheduleRow({ isSelected: true }), scheduleRow({ id: 'q2', title: 'Hope' })]}
      />
    )
    expect(rowFor('Faith').getAttribute('data-selected')).toBe('true')
    expect(rowFor('Hope').getAttribute('data-selected')).toBeNull()
  })

  it('names the add chip when tapes exist but the schedule is empty (#88)', () => {
    render(<MessageSearchRail {...baseProps} scheduleRows={[]} hasTapes />)
    const empty = screen.getByText(/No quotes yet/)
    expect(empty.querySelector('b')?.textContent).toBe('+ Add')
  })

  it('points at the import when no tapes are installed at all (#88)', () => {
    render(<MessageSearchRail {...baseProps} scheduleRows={[]} hasTapes={false} />)
    expect(screen.getByText(/No messages yet/)).toBeTruthy()
    // The empty state names the header's + Import rather than carrying a one-off button
    // of its own (the Slides rail's grammar).
    expect(screen.getByText(/import one with/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '+ Import' })).toBeTruthy()
  })

  // Import is the secondary row under the add chip, as on Songs; the list header's right
  // slot belongs to Clear all, as on Scripture. Present during a search too.
  it('carries + Import at the top of the rail, under the add chip', () => {
    const onImportMessages = vi.fn()
    render(
      <MessageSearchRail
        {...baseProps}
        q="faith"
        add={{ label: '+ Add ¶3', onAdd: vi.fn(), planned: false }}
        onImportMessages={onImportMessages}
      />
    )
    const add = screen.getByRole('button', { name: '+ Add ¶3' })
    const imp = screen.getByRole('button', { name: '+ Import' })
    expect(add.compareDocumentPosition(imp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(imp)
    expect(onImportMessages).toHaveBeenCalledTimes(1)
  })

  it('Clear all sits in the QUOTE SCHEDULE header once the schedule has rows', () => {
    const onClearAll = vi.fn()
    render(<MessageSearchRail {...baseProps} scheduleRows={[scheduleRow()]} onClearAll={onClearAll} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })

  it('offers no Clear all on an empty schedule', () => {
    render(<MessageSearchRail {...baseProps} scheduleRows={[]} onClearAll={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()
  })

  it('shows no empty state once the schedule has rows', () => {
    render(<MessageSearchRail {...baseProps} scheduleRows={[scheduleRow()]} hasTapes={false} />)
    expect(screen.queryByText(/No messages yet/)).toBeNull()
    expect(screen.queryByText(/Search above to find a quote/)).toBeNull()
  })

  it('renders the undo toast and fires onUndo (#86)', () => {
    const onUndo = vi.fn()
    render(<MessageSearchRail {...baseProps} undo={{ label: '¶2', onUndo }} />)
    expect(screen.getByText(/Deleted/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('shows no undo toast when nothing is pending', () => {
    render(<MessageSearchRail {...baseProps} />)
    expect(screen.queryByText(/Deleted/)).toBeNull()
  })
})

describe('MessageSearchRail: + Add files the cued paragraph', () => {
  it('renders the add chip at the top of the rail and fires onAdd', () => {
    const onAdd = vi.fn()
    render(<MessageSearchRail {...baseProps} add={{ label: '+ Add ¶3', onAdd, planned: false }} />)
    const chip = screen.getByRole('button', { name: '+ Add ¶3' })
    // Above the list header: one add chip, top of every rail.
    expect(chip.compareDocumentPosition(screen.getByTitle('Quote schedule')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(chip)
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('stays mounted while a search has the rail, so a found quote can be filed', () => {
    render(<MessageSearchRail {...baseProps} q="faith" add={{ label: '+ Add ¶3', onAdd: vi.fn(), planned: false }} />)
    expect(screen.getByRole('button', { name: '+ Add ¶3' })).toBeTruthy()
  })

  it('ghosts in place, rather than vanishing, when the cued paragraph is already planned', () => {
    const onAdd = vi.fn()
    render(<MessageSearchRail {...baseProps} add={{ label: '+ Add ¶3', onAdd, planned: true }} />)
    const chip = screen.getByRole('button', { name: '+ Add ¶3' }) as HTMLButtonElement
    expect(chip.disabled).toBe(true)
    fireEvent.click(chip)
    expect(onAdd).not.toHaveBeenCalled()
  })
})

describe('MessageSearchRail: live and queued signals (rule 1, decision 7)', () => {
  const T = themeFor('classic', 'dark')
  const rgb = (hex: string): string => {
    const n = parseInt(hex.slice(1), 16)
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
  }
  const row = (): HTMLButtonElement => screen.getByText('Faith').closest('button') as HTMLButtonElement

  it('a current quote that is not on screen gets the message colour, never red', () => {
    render(<MessageSearchRail {...baseProps} scheduleRows={[scheduleRow({ isCurrent: true })]} />)
    expect(row().style.boxShadow).not.toContain(T.live)
    expect((row().querySelector('[data-cued-dot]') as HTMLElement).style.background).toBe(rgb(T.message))
  })

  it('the live quote rings red with LIVE; a queued one says QUEUED', () => {
    const { rerender } = render(
      <MessageSearchRail {...baseProps} scheduleRows={[scheduleRow({ isCurrent: true, isLive: true })]} />
    )
    expect(row().style.boxShadow).toBe(`inset 0 0 0 2px ${T.live}`)
    expect(within(row()).getByText('LIVE')).toBeTruthy()
    rerender(<MessageSearchRail {...baseProps} scheduleRows={[scheduleRow({ isCurrent: true, isQueued: true })]} />)
    expect((within(row()).getByText('QUEUED') as HTMLElement).style.color).toBe(rgb(T.message))
  })

  it('the selection ring is the message colour, not gold', () => {
    render(<MessageSearchRail {...baseProps} scheduleRows={[scheduleRow({ isSelected: true })]} />)
    expect(row().style.boxShadow).toContain(T.message)
    expect(row().style.boxShadow).not.toContain(T.accent)
  })
})
