// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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

  it('invites the operator to search when tapes exist but the schedule is empty (#88)', () => {
    render(<MessageSearchRail {...baseProps} scheduleRows={[]} hasTapes />)
    expect(screen.getByText(/Search above to find a quote/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Import a message' })).toBeNull()
  })

  // Nothing in the app calls quoteSchedule.add, so copy promising that clicking a quote
  // files it here would describe a workflow the operator cannot perform. Delete this test
  // when the add affordance lands — and update the copy with it.
  it('does not promise an add-to-schedule gesture that does not exist', () => {
    render(<MessageSearchRail {...baseProps} scheduleRows={[]} hasTapes />)
    expect(screen.queryByText(/Quotes you add will wait here/)).toBeNull()
  })

  it('points at the import when no tapes are installed at all (#88)', () => {
    const onImportMessages = vi.fn()
    render(
      <MessageSearchRail {...baseProps} scheduleRows={[]} hasTapes={false} onImportMessages={onImportMessages} />
    )
    expect(screen.getByText(/No messages yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Import a message' }))
    expect(onImportMessages).toHaveBeenCalledTimes(1)
  })

  it('shows no empty state once the schedule has rows', () => {
    render(<MessageSearchRail {...baseProps} scheduleRows={[scheduleRow()]} hasTapes={false} />)
    expect(screen.queryByText(/No messages yet/)).toBeNull()
    expect(screen.queryByText(/Search above to find a quote/)).toBeNull()
  })

  it('renders the undo toast and fires onUndo (#86)', () => {
    const onUndo = vi.fn()
    render(<MessageSearchRail {...baseProps} undo={{ label: '¶2', onUndo }} />)
    expect(screen.getByText(/Removed/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('shows no undo toast when nothing is pending', () => {
    render(<MessageSearchRail {...baseProps} />)
    expect(screen.queryByText(/Removed/)).toBeNull()
  })
})
