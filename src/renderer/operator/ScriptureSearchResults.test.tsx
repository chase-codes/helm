// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScriptureSearchResults, type ScriptureSearchState } from './ScriptureSearchResults'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

const T = themeFor('classic', 'dark')
const state = (over: Partial<ScriptureSearchState> = {}): ScriptureSearchState => ({
  query: 'zaccheus',
  tokens: ['zaccheus'],
  abbr: 'KJV',
  total: 3,
  passages: [{ key: 'p:Luke:19:1', title: 'Zacchaeus', meta: 'Luke 19:1–10' }],
  verses: [
    { key: 'v:Luke:19:2', ref: 'Luke 19:2', text: 'And, behold, there was a man named Zaccheus, which was the chief among the publicans, and he was rich.' },
    { key: 'v:Luke:19:5', ref: 'Luke 19:5', text: 'Zaccheus, make haste, and come down.' }
  ],
  highlighted: 0,
  onHover: vi.fn(),
  onPick: vi.fn(),
  onActivate: vi.fn(),
  noVersion: false,
  settled: true,
  ...over
})

describe('ScriptureSearchResults', () => {
  it('shows the total with the version, the PASSAGES group, and the VERSES group', () => {
    render(<ScriptureSearchResults theme={T} search={state()} />)
    expect(screen.getByText('3 VERSES · KJV')).toBeTruthy()
    expect(screen.getByText('PASSAGES')).toBeTruthy()
    expect(screen.getByText('Zacchaeus')).toBeTruthy()
    expect(screen.getByText('Luke 19:1–10')).toBeTruthy()
    expect(screen.getByText('Luke 19:2')).toBeTruthy()
  })

  it('bolds matched words in verse text', () => {
    render(<ScriptureSearchResults theme={T} search={state()} />)
    const marks = document.querySelectorAll('[data-hit]')
    expect(marks.length).toBeGreaterThanOrEqual(2)
    expect(marks[0].textContent).toBe('Zaccheus')
  })

  it('marks the highlighted row across the combined list (passages first)', () => {
    render(<ScriptureSearchResults theme={T} search={state({ highlighted: 1 })} />)
    const row = screen.getByText('Luke 19:2').closest('button') as HTMLButtonElement
    expect(row.getAttribute('data-highlighted')).toBe('true')
    const pas = screen.getByText('Zacchaeus').closest('button') as HTMLButtonElement
    expect(pas.getAttribute('data-highlighted')).toBeNull()
  })

  it('click picks, double-click activates, hover reports the combined index', () => {
    const s = state()
    render(<ScriptureSearchResults theme={T} search={s} />)
    const row = screen.getByText('Luke 19:5').closest('button') as HTMLButtonElement
    fireEvent.mouseEnter(row)
    fireEvent.click(row)
    fireEvent.doubleClick(row)
    expect(s.onHover).toHaveBeenCalledWith(2)
    expect(s.onPick).toHaveBeenCalledWith(2)
    expect(s.onActivate).toHaveBeenCalledWith(2)
  })

  it('empty states: no hits, and no version installed', () => {
    const { rerender } = render(<ScriptureSearchResults theme={T} search={state({ passages: [], verses: [], total: 0, query: 'xyzzy' })} />)
    expect(screen.getByText(/No verses match “xyzzy”/)).toBeTruthy()
    rerender(<ScriptureSearchResults theme={T} search={state({ passages: [], verses: [], total: 0, noVersion: true, abbr: '' })} />)
    expect(screen.getByText(/Install a Bible/)).toBeTruthy()
  })

  it('while a search is in flight, no empty state renders (the header still does)', () => {
    render(<ScriptureSearchResults theme={T} search={state({ passages: [], verses: [], total: 0, query: 'zacche', settled: false })} />)
    expect(screen.queryByText(/No verses match/)).toBeNull()
    expect(screen.queryByText(/Install a Bible/)).toBeNull()
    expect(screen.getByText('0 VERSES · KJV')).toBeTruthy()
  })

  it('singular count copy', () => {
    render(<ScriptureSearchResults theme={T} search={state({ total: 1, verses: state().verses.slice(0, 1) })} />)
    expect(screen.getByText('1 VERSE · KJV')).toBeTruthy()
  })
})
