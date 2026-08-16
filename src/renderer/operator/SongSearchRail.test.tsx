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
  libraryEmpty: false,
  onKeyDown: vi.fn(),
  onSelect: vi.fn(),
  onActivate: vi.fn(),
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

  it('fires onActivate on double-click and leaves onSelect for single-click', () => {
    const onSelect = vi.fn()
    const onActivate = vi.fn()
    render(<SongSearchRail {...baseProps} onSelect={onSelect} onActivate={onActivate} />)
    const row = screen.getByText('Amazing Grace').closest('button') as HTMLButtonElement
    fireEvent.doubleClick(row)
    expect(onActivate).toHaveBeenCalledWith('s1')
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith('s1')
  })

  it('invites the operator to fill an empty library, naming both affordances (#88)', () => {
    render(<SongSearchRail {...baseProps} rows={[]} libraryEmpty />)
    const empty = screen.getByText(/No songs yet/)
    expect(empty.textContent).toMatch(/\+ Add a song/)
    expect(empty.textContent).toMatch(/Import a song library/)
  })

  it('shows no empty state while the library has rows', () => {
    render(<SongSearchRail {...baseProps} libraryEmpty={false} />)
    expect(screen.queryByText(/No songs yet/)).toBeNull()
  })

  it('prefers the no-match copy over the empty-library copy for a fruitless search', () => {
    render(
      <SongSearchRail {...baseProps} rows={[]} libraryEmpty noResults emptyText="No match for “zzz”." />
    )
    expect(screen.getByText(/No match for/)).toBeTruthy()
    expect(screen.queryByText(/No songs yet/)).toBeNull()
  })
})

// #89. While a song holds the screen, one click gesture carries three meanings — arm,
// disarm, or back-to-base on the live row — and nothing distinguished them until after the
// click. Hover now says which one you are about to get.
describe('SongSearchRail — hover forecasts what a click will do while locked (#89)', () => {
  const LOCKED = [
    { id: 's1', title: 'Amazing Grace', author: 'Newton', snippet: '', hasSnippet: false, isActive: true, isArmed: false },
    { id: 's2', title: 'Blessed Assurance', author: 'Crosby', snippet: '', hasSnippet: false, isActive: false, isArmed: false }
  ]
  const row = (title: string): HTMLButtonElement =>
    screen.getByText(title).closest('button') as HTMLButtonElement

  it('shows a ghost NEXT? on a row that a click would arm', () => {
    render(<SongSearchRail {...baseProps} rows={LOCKED} locked />)
    expect(screen.queryByText('NEXT?')).toBeNull()
    fireEvent.mouseEnter(row('Blessed Assurance'))
    expect(screen.getByText('NEXT?')).toBeTruthy()
    fireEvent.mouseLeave(row('Blessed Assurance'))
    expect(screen.queryByText('NEXT?')).toBeNull()
  })

  it('leaves the live row alone — a click there only returns to base', () => {
    render(<SongSearchRail {...baseProps} rows={LOCKED} locked />)
    fireEvent.mouseEnter(row('Amazing Grace'))
    expect(screen.queryByText('NEXT?')).toBeNull()
    expect(row('Amazing Grace').title).toBe('Already on screen')
  })

  it('does not forecast arming when nothing is live — a click there just selects', () => {
    render(<SongSearchRail {...baseProps} rows={LOCKED} />)
    fireEvent.mouseEnter(row('Blessed Assurance'))
    expect(screen.queryByText('NEXT?')).toBeNull()
  })

  it('keeps NEXT on the armed row and says the click would clear it', () => {
    const armed = LOCKED.map((r) => (r.id === 's2' ? { ...r, isArmed: true } : r))
    render(<SongSearchRail {...baseProps} rows={armed} locked />)
    fireEvent.mouseEnter(row('Blessed Assurance'))
    expect(screen.getByText('NEXT')).toBeTruthy()
    expect(screen.queryByText('NEXT?')).toBeNull()
    expect(row('Blessed Assurance').title).toBe('Clear this — nothing queued next')
  })

  it('forecasts on the "also in lyrics" rows too — the same click, the same meaning', () => {
    render(
      <SongSearchRail
        {...baseProps}
        rows={[LOCKED[0]]}
        secondaryRows={[{ ...LOCKED[1], id: 's9', title: 'Solid Rock' }]}
        locked
      />
    )
    fireEvent.mouseEnter(row('Solid Rock'))
    expect(screen.getByText('NEXT?')).toBeTruthy()
  })
})
