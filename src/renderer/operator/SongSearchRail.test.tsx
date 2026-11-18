// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SongSearchRail, type SongRow } from './SongSearchRail'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

const rows: SongRow[] = [
  { id: 's1', title: 'Amazing Grace', author: 'Newton', snippet: '', hasSnippet: false, isActive: false, isArmed: false, isLive: false, musicKey: '' }
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
  it('gives every row a fixed-width key slot at the right: the key in dim, or nothing', () => {
    const T = baseProps.theme
    render(
      <SongSearchRail
        {...baseProps}
        rows={[
          { ...rows[0], musicKey: 'C#m' },
          { ...rows[0], id: 's2', title: 'Blessed Assurance', musicKey: '' }
        ]}
      />
    )
    const slots = [...document.querySelectorAll<HTMLElement>('[data-key-slot]')]
    expect(slots.map((s) => s.textContent)).toEqual(['C#m', ''])
    for (const s of slots) {
      expect(s.style.width).toBe('30px')
      expect(s.style.flexShrink).toBe('0')
      // Last in its row, so the keys line up down the rail.
      expect(s.parentElement!.lastElementChild).toBe(s)
    }
    expect(slots[0].style.color).toBe(slots[1].style.color) // no colour for a missing key
    const probe = document.createElement('span')
    probe.style.color = T.dim
    expect(slots[0].style.color).toBe(probe.style.color)
  })

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

  // #5: import is a migration, not an every-Sunday control. Once the library has songs it
  // lives in Settings → Songs, and the rail carries no import control at all.
  it('offers no import control once the library has songs', () => {
    render(<SongSearchRail {...baseProps} />)
    expect(screen.queryByText(/Import a song library/)).toBeNull()
    expect(screen.getByText('+ Add a song')).toBeTruthy()
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
    expect(empty.textContent).toMatch(/\+ Import a song library/)
  })

  // #5: on an empty library the invitation itself carries the import button, and it is the
  // only one: the header never grows one, so the rail is the same height either way.
  it('puts the import button inside the empty-library invitation, and nowhere else', () => {
    const onImportSongs = vi.fn()
    render(<SongSearchRail {...baseProps} rows={[]} libraryEmpty onImportSongs={onImportSongs} />)
    const imports = screen.getAllByRole('button', { name: '+ Import a song library' })
    expect(imports).toHaveLength(1)
    expect(imports[0].closest('div')!.textContent).toMatch(/No songs yet/)
    fireEvent.click(imports[0])
    expect(onImportSongs).toHaveBeenCalledTimes(1)
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

  it('heads the rail SONG LIBRARY, like the other rails name their list', () => {
    render(<SongSearchRail {...baseProps} />)
    expect(screen.getByText('SONG LIBRARY')).toBeTruthy()
    expect(screen.queryByText(/FIND A SONG/)).toBeNull()
  })
})

// #89. While a song holds the screen, one click gesture carries three meanings — arm,
// disarm, or back-to-base on the live row — and nothing distinguished them until after the
// click. Hover now says which one you are about to get.
describe('SongSearchRail — hover forecasts what a click will do while locked (#89)', () => {
  const LOCKED = [
    { id: 's1', title: 'Amazing Grace', author: 'Newton', snippet: '', hasSnippet: false, isActive: true, isArmed: false, isLive: true, musicKey: '' },
    { id: 's2', title: 'Blessed Assurance', author: 'Crosby', snippet: '', hasSnippet: false, isActive: false, isArmed: false, isLive: false, musicKey: '' }
  ]
  const row = (title: string): HTMLButtonElement =>
    screen.getByText(title).closest('button') as HTMLButtonElement

  it('shows a ghost QUEUE? on a row that a click would arm', () => {
    render(<SongSearchRail {...baseProps} rows={LOCKED} locked />)
    expect(screen.queryByText('QUEUE?')).toBeNull()
    fireEvent.mouseEnter(row('Blessed Assurance'))
    expect(screen.getByText('QUEUE?')).toBeTruthy()
    fireEvent.mouseLeave(row('Blessed Assurance'))
    expect(screen.queryByText('QUEUE?')).toBeNull()
  })

  it('leaves the live row alone — a click there only returns to base', () => {
    render(<SongSearchRail {...baseProps} rows={LOCKED} locked />)
    fireEvent.mouseEnter(row('Amazing Grace'))
    expect(screen.queryByText('QUEUE?')).toBeNull()
    expect(row('Amazing Grace').title).toBe('Already on screen')
  })

  it('does not forecast arming when nothing is live — a click there just selects', () => {
    render(<SongSearchRail {...baseProps} rows={LOCKED} />)
    fireEvent.mouseEnter(row('Blessed Assurance'))
    expect(screen.queryByText('QUEUE?')).toBeNull()
  })

  it('keeps QUEUED on the armed row and says the click would clear it', () => {
    const armed = LOCKED.map((r) => (r.id === 's2' ? { ...r, isArmed: true } : r))
    render(<SongSearchRail {...baseProps} rows={armed} locked />)
    fireEvent.mouseEnter(row('Blessed Assurance'))
    expect(screen.getByText('QUEUED')).toBeTruthy()
    expect(screen.queryByText('QUEUE?')).toBeNull()
    expect(row('Blessed Assurance').title).toBe('Queued. Click to clear it')
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
    expect(screen.getByText('QUEUE?')).toBeTruthy()
  })
})

describe('SongSearchRail: live and queued signals (rule 1, decision 7)', () => {
  const T = themeFor('classic', 'dark')
  const rgb = (hex: string): string => {
    const n = parseInt(hex.slice(1), 16)
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
  }
  const row = (title: string): HTMLButtonElement => screen.getByText(title).closest('button') as HTMLButtonElement
  const LIVE_ROW: SongRow = { id: 's1', title: 'Amazing Grace', author: 'Newton', snippet: '', hasSnippet: false, isActive: true, isArmed: false, isLive: true, musicKey: '' }
  const QUEUED_ROW: SongRow = { id: 's2', title: 'Blessed Assurance', author: 'Crosby', snippet: '', hasSnippet: false, isActive: false, isArmed: true, isLive: false, musicKey: '' }

  it('the live song wears the red ring and a LIVE badge', () => {
    render(<SongSearchRail {...baseProps} rows={[LIVE_ROW, QUEUED_ROW]} locked />)
    expect(row('Amazing Grace').style.boxShadow).toBe(`inset 0 0 0 2px ${T.live}`)
    expect(within(row('Amazing Grace')).getByText('LIVE')).toBeTruthy()
  })

  it('the queued song wears QUEUED in the track colour and no red', () => {
    render(<SongSearchRail {...baseProps} rows={[LIVE_ROW, QUEUED_ROW]} locked />)
    const badge = within(row('Blessed Assurance')).getByText('QUEUED') as HTMLElement
    expect(badge.style.color).toBe(rgb(T.accent))
    expect(row('Blessed Assurance').style.boxShadow).not.toContain(T.live)
    expect(row('Blessed Assurance').title).toBe('Queued. Click to clear it')
  })

  it('a selected song that is not on screen gets no LIVE badge', () => {
    render(<SongSearchRail {...baseProps} rows={[{ ...LIVE_ROW, isLive: false }]} />)
    expect(within(row('Amazing Grace')).queryByText('LIVE')).toBeNull()
  })

  it('the rail eyebrow dot is the Songs colour, not Scripture blue', () => {
    render(<SongSearchRail {...baseProps} />)
    const dot = document.querySelector('[data-rail-eyebrow-dot]') as HTMLElement
    expect(dot.style.background).toBe(rgb(T.accent))
  })
})
