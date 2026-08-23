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
      onDoubleClick: vi.fn(),
      onContextMenu: vi.fn(),
      ...overrides
    }
  ]
}

const baseProps = {
  theme: themeFor('classic', 'dark'),
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

  it('fires a row onDoubleClick', () => {
    const onDoubleClick = vi.fn()
    render(<SchedulePanel {...baseProps} rows={[{ ...rows()[0], onDoubleClick }]} />)
    fireEvent.doubleClick(screen.getByText('John 3:16'))
    expect(onDoubleClick).toHaveBeenCalled()
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
    const input = screen.getByPlaceholderText(/Add verse/) as HTMLInputElement
    fireEvent.focus(input)
    expect(input.value).toBe('gen') // the ghost is NEVER in the value
    const ghost = document.querySelector('[data-ghost]') as HTMLElement
    expect(ghost).toBeTruthy()
    expect(ghost.getAttribute('aria-hidden')).toBe('true') // no double-reading the field
    expect(ghost.textContent).toBe('genesis') // transparent copy of "gen" + dim "esis"
    expect((ghost.querySelector('[data-ghost-text]') as HTMLElement).textContent).toBe('esis')
  })

  it('renders the alias ghost as an arrow to the book name', () => {
    render(<SchedulePanel {...baseProps} value="jhn" ghost={{ kind: 'alias', book: 'John' }} />)
    const input = screen.getByPlaceholderText(/Add verse/) as HTMLInputElement
    fireEvent.focus(input)
    expect(input.value).toBe('jhn')
    const text = document.querySelector('[data-ghost-text]') as HTMLElement
    expect(text.textContent).toBe(' → John')
  })

  it('renders no ghost when there is no completion', () => {
    render(<SchedulePanel {...baseProps} value="xyz" ghost={null} />)
    fireEvent.focus(screen.getByPlaceholderText(/Add verse/))
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })

  it('renders no ghost when the prop is omitted entirely', () => {
    render(<SchedulePanel {...baseProps} value="John 3:16" />)
    fireEvent.focus(screen.getByPlaceholderText(/Add verse/))
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })

  // Finding 1: the ghost is derived from builder state alone and knows nothing about focus,
  // but "space commits the book" is only true while the entry has focus — away from focus,
  // space goes to onGoLive instead. A stale ghost surviving a click-away would promise a
  // commit that space no longer performs, so the overlay must track focus itself.
  it('does not render the ghost overlay before the input is focused, even with a ghost prop', () => {
    render(<SchedulePanel {...baseProps} value="gen" ghost={{ kind: 'tail', text: 'esis' }} />)
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })

  it('shows the ghost overlay once focused, and hides it again on blur', () => {
    render(<SchedulePanel {...baseProps} value="gen" ghost={{ kind: 'tail', text: 'esis' }} />)
    const input = screen.getByPlaceholderText(/Add verse/) as HTMLInputElement
    expect(document.querySelector('[data-ghost]')).toBeNull()
    fireEvent.focus(input)
    expect(document.querySelector('[data-ghost]')).toBeTruthy()
    fireEvent.blur(input)
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })

  it('shows Clear all only when there are rows, and fires onClearAll', () => {
    const onClearAll = vi.fn()
    render(<SchedulePanel {...baseProps} onClearAll={onClearAll} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })

  it('hides Clear all when the schedule is empty', () => {
    render(<SchedulePanel {...baseProps} rows={[]} onClearAll={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()
  })

  it('gives Clear all a real button footprint, not a text link (#86)', () => {
    render(<SchedulePanel {...baseProps} onClearAll={vi.fn()} />)
    const clear = screen.getByRole('button', { name: 'Clear all' })
    expect(clear.style.height).toBe('26px')
    expect(clear.style.padding).toBe('0px 10px')
  })

  it('invites the operator to act when the schedule is empty (#88)', () => {
    render(<SchedulePanel {...baseProps} rows={[]} />)
    const empty = screen.getByText(/No verses yet/)
    expect(empty.textContent).toMatch(/enter a reference above/)
    expect(empty.textContent).toMatch(/\+ Add/)
  })

  it('shows no empty state once the schedule has rows', () => {
    render(<SchedulePanel {...baseProps} />)
    expect(screen.queryByText(/No verses yet/)).toBeNull()
  })
})

// #85. Dynamic copy is fine as long as the container's footprint doesn't move. The chip is
// already full-width, so a long reference can't widen it — but without clipping it wraps to
// a second line, which pushes the schedule below it down instead.
describe('SchedulePanel — the + Add chip holds a fixed footprint (#85)', () => {
  it('clips a long reference to one line rather than growing taller', () => {
    render(
      <SchedulePanel
        {...baseProps}
        canAdd
        addLabel="+ Add 1 Chronicles 12:23–40 (Amplified Classic Edition)"
      />
    )
    const chip = screen.getByText(/^\+ Add 1 Chronicles/).closest('button') as HTMLButtonElement
    expect(chip.style.whiteSpace).toBe('nowrap')
    expect(chip.style.overflow).toBe('hidden')
    expect(chip.style.textOverflow).toBe('ellipsis')
  })
})

describe('SchedulePanel — search results rail', () => {
  it('renders search results in place of the schedule while searching', () => {
    render(
      <SchedulePanel
        {...baseProps}
        value="zacch"
        search={{
          query: 'zacch', tokens: ['zacch'], abbr: 'KJV', total: 1, passages: [],
          verses: [{ key: 'v', ref: 'Luke 19:2', text: 'a man named Zaccheus' }],
          highlighted: 0, onHover: vi.fn(), onPick: vi.fn(), onActivate: vi.fn(), noVersion: false
        }}
      />
    )
    expect(screen.getByText('1 VERSE · KJV')).toBeTruthy()
    expect(screen.queryByText('SCRIPTURE SCHEDULE')).toBeNull()
    expect(screen.queryByText('John 3:16')).toBeNull() // the schedule row is not shown
    expect(screen.getByPlaceholderText(/Add verse/)).toBeTruthy() // entry stays
  })
})
