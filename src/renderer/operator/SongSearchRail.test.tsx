// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SongSearchRail, type SongRow } from './SongSearchRail'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

const rows: SongRow[] = [
  { id: 's1', title: 'Amazing Grace', author: 'Newton', snippet: '', hasSnippet: false, isActive: false }
]

const baseProps = {
  theme: themeFor('dark'),
  dark: true,
  width: 250,
  q: '',
  setQ: vi.fn(),
  field: 'all' as const,
  setField: vi.fn(),
  rows,
  noResults: false,
  emptyText: '',
  onKeyDown: vi.fn(),
  onSelect: vi.fn(),
  onAddSong: vi.fn()
}

describe('SongSearchRail', () => {
  it('fires onRowContextMenu with the row id on right-click', () => {
    const onRowContextMenu = vi.fn()
    render(<SongSearchRail {...baseProps} onRowContextMenu={onRowContextMenu} />)
    const row = screen.getByText('Amazing Grace').closest('button') as HTMLButtonElement
    fireEvent.contextMenu(row)
    expect(onRowContextMenu).toHaveBeenCalledTimes(1)
    expect(onRowContextMenu.mock.calls[0][0]).toBe('s1')
  })

  it('left-click still selects (unchanged)', () => {
    const onSelect = vi.fn()
    render(<SongSearchRail {...baseProps} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Amazing Grace').closest('button') as HTMLButtonElement)
    expect(onSelect).toHaveBeenCalledWith('s1')
  })
})
