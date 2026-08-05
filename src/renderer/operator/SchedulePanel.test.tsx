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

  it('renders the tail ghost dimmed and aria-hidden, without touching the input value', () => {
    render(<SchedulePanel {...baseProps} value="gen" ghost={{ kind: 'tail', text: 'esis' }} />)
    const input = screen.getByPlaceholderText(/Add reading/) as HTMLInputElement
    expect(input.value).toBe('gen') // the ghost is NEVER in the value
    const ghost = document.querySelector('[data-ghost]') as HTMLElement
    expect(ghost).toBeTruthy()
    expect(ghost.getAttribute('aria-hidden')).toBe('true') // no double-reading the field
    expect(ghost.textContent).toBe('genesis') // transparent copy of "gen" + dim "esis"
    expect((ghost.querySelector('[data-ghost-text]') as HTMLElement).textContent).toBe('esis')
  })

  it('renders the alias ghost as an arrow to the book name', () => {
    render(<SchedulePanel {...baseProps} value="jhn" ghost={{ kind: 'alias', book: 'John' }} />)
    const input = screen.getByPlaceholderText(/Add reading/) as HTMLInputElement
    expect(input.value).toBe('jhn')
    const text = document.querySelector('[data-ghost-text]') as HTMLElement
    expect(text.textContent).toBe(' → John')
  })

  it('renders no ghost when there is no completion', () => {
    render(<SchedulePanel {...baseProps} value="xyz" ghost={null} />)
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })

  it('renders no ghost when the prop is omitted entirely', () => {
    render(<SchedulePanel {...baseProps} value="John 3:16" />)
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })
})
