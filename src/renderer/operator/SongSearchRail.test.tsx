// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SongSearchRail, type SongRow } from './SongSearchRail'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

const rows: SongRow[] = [
  { id: 's1', title: 'Amazing Grace', author: 'Newton', snippet: '', hasSnippet: false, isActive: false, isArmed: false }
]

const baseProps = {
  theme: themeFor('classic', 'dark'),
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
  onAddSong: vi.fn(),
  onImportSongs: vi.fn()
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

  it('shows the add chip in the header, and the old bottom button is gone', () => {
    render(<SongSearchRail {...baseProps} />)
    expect(screen.getByText('+ Add a song')).toBeTruthy()
    expect(screen.queryByText('+ Add a song — search or paste')).toBeNull()
  })

  it('labels the chip with the query when one is typed', () => {
    render(<SongSearchRail {...baseProps} q="Way Maker" />)
    expect(screen.getByText('+ Add “Way Maker” as a new song')).toBeTruthy()
  })

  it('clicking the chip fires onAddSong', () => {
    const onAddSong = vi.fn()
    render(<SongSearchRail {...baseProps} onAddSong={onAddSong} />)
    fireEvent.click(screen.getByText('+ Add a song'))
    expect(onAddSong).toHaveBeenCalledTimes(1)
  })

  it('renders the import row above the song list and fires onImportSongs', () => {
    const onImportSongs = vi.fn()
    render(<SongSearchRail {...baseProps} onImportSongs={onImportSongs} />)
    const imp = screen.getByText('Import a song library')
    fireEvent.click(imp)
    expect(onImportSongs).toHaveBeenCalledTimes(1)
    // Import row must precede the first song row in DOM order (fixed header, not list bottom).
    const firstRow = screen.getByText('Amazing Grace')
    expect(imp.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
