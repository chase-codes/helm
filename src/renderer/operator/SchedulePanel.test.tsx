// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SchedulePanel, type ScheduleRow } from './SchedulePanel'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

function rows(overrides: Partial<ScheduleRow> = {}): ScheduleRow[] {
  return [
    {
      id: 'r1',
      title: 'John 3:16',
      meta: '1 verse · KJV',
      isCurrent: false,
      isSelected: false,
      onClick: vi.fn(),
      onContextMenu: vi.fn(),
      ...overrides
    }
  ]
}

const baseProps = {
  theme: themeFor('dark'),
  width: 270,
  track: 'scripture' as const,
  setTrack: vi.fn(),
  value: '',
  onEntryChange: vi.fn(),
  onEntryKeyDown: vi.fn(),
  canAdd: false,
  addLabel: '',
  onAdd: vi.fn(),
  rows: rows()
}

describe('SchedulePanel', () => {
  it('marks the selected row via data-selected', () => {
    render(<SchedulePanel {...baseProps} rows={rows({ isSelected: true })} />)
    const row = screen.getByText('John 3:16').closest('button') as HTMLButtonElement
    expect(row.getAttribute('data-selected')).toBe('true')
  })

  it('fires onClick on left-click and onContextMenu on right-click', () => {
    const onClick = vi.fn()
    const onContextMenu = vi.fn()
    render(<SchedulePanel {...baseProps} rows={rows({ onClick, onContextMenu })} />)
    const row = screen.getByText('John 3:16').closest('button') as HTMLButtonElement
    fireEvent.click(row)
    fireEvent.contextMenu(row)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onContextMenu).toHaveBeenCalledTimes(1)
  })

  it('renders the undo toast and fires onUndo', () => {
    const onUndo = vi.fn()
    render(<SchedulePanel {...baseProps} undo={{ label: 'John 3:16', onUndo }} />)
    expect(screen.getByText(/Removed/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })
})
