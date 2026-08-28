// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState, type JSX } from 'react'
import { deleteMenuItems, useListSelection, type ListSelection } from './useListSelection'

afterEach(cleanup)

// Tiny host component so we exercise the hook through real React state transitions.
// Rows can be removed to simulate deletion happening elsewhere in the list.
function Host({ initialIds = ['a', 'b', 'c', 'd'] }: { initialIds?: string[] } = {}): JSX.Element {
  const [ids, setIds] = useState(initialIds)
  const sel = useListSelection(ids)
  return (
    <div>
      <span data-testid="selected">{sel.selectedId ?? 'none'}</span>
      <span data-testid="selected-ids">{sel.selectedIds.join(',') || 'none'}</span>
      <span data-testid="a-selected">{String(sel.isSelected('a'))}</span>
      {ids.map((id) => (
        <span key={id}>
          <button onClick={() => sel.select(id)}>{`select-${id}`}</button>
          <button onClick={() => sel.selectTo(id)}>{`shift-${id}`}</button>
          <button onClick={() => setIds((cur) => cur.filter((x) => x !== id))}>{`remove-${id}`}</button>
        </span>
      ))}
      <button onClick={() => sel.clear()}>clear</button>
    </div>
  )
}

const ids = (): string => screen.getByTestId('selected-ids').textContent ?? ''

describe('useListSelection', () => {
  it('selects, re-selects, and clears (single-select behavior unchanged)', () => {
    render(<Host />)
    expect(screen.getByTestId('selected').textContent).toBe('none')
    expect(screen.getByTestId('a-selected').textContent).toBe('false')

    fireEvent.click(screen.getByText('select-a'))
    expect(screen.getByTestId('selected').textContent).toBe('a')
    expect(screen.getByTestId('a-selected').textContent).toBe('true')

    fireEvent.click(screen.getByText('select-b'))
    expect(screen.getByTestId('selected').textContent).toBe('b')
    expect(screen.getByTestId('a-selected').textContent).toBe('false')

    fireEvent.click(screen.getByText('clear'))
    expect(screen.getByTestId('selected').textContent).toBe('none')
    expect(ids()).toBe('none')
  })

  it('selectTo with no anchor acts like select', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('shift-c'))
    expect(ids()).toBe('c')
    expect(screen.getByTestId('selected').textContent).toBe('c')
  })

  it('select then selectTo yields the contiguous run, in list order', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('select-a'))
    fireEvent.click(screen.getByText('shift-c'))
    expect(ids()).toBe('a,b,c')
    // multi-selection has no single selectedId
    expect(screen.getByTestId('selected').textContent).toBe('none')
  })

  it('a backwards shift-click still yields an ordered run', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('select-c'))
    fireEvent.click(screen.getByText('shift-a'))
    expect(ids()).toBe('a,b,c')
  })

  it('a second shift-click pivots from the anchor, it does not grow', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('select-b'))
    fireEvent.click(screen.getByText('shift-d'))
    expect(ids()).toBe('b,c,d')
    fireEvent.click(screen.getByText('shift-a'))
    expect(ids()).toBe('a,b') // anchored at b — NOT a,b,c,d
  })

  it('ids that vanish from the list drop out of the selection', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('select-a'))
    fireEvent.click(screen.getByText('shift-c'))
    fireEvent.click(screen.getByText('remove-b'))
    expect(ids()).toBe('a,c')
  })

  it('a vanished anchor makes the next selectTo act like select', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('select-a'))
    fireEvent.click(screen.getByText('remove-a'))
    expect(ids()).toBe('none')
    fireEvent.click(screen.getByText('shift-c'))
    expect(ids()).toBe('c')
  })
})

describe('deleteMenuItems', () => {
  const makeSel = (selectedIds: string[], select = vi.fn()): ListSelection => ({
    selectedIds,
    selectedId: selectedIds.length === 1 ? selectedIds[0] : null,
    select,
    selectTo: vi.fn(),
    clear: vi.fn(),
    isSelected: (id) => selectedIds.includes(id)
  })

  it('offers a batch delete when the row is inside a multi-selection', () => {
    const remove = vi.fn()
    const select = vi.fn()
    const items = deleteMenuItems(makeSel(['a', 'b', 'c'], select), 'b', 'verses', remove)
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('Delete 3 verses')
    expect(items[0].danger).toBe(true)
    expect(select).not.toHaveBeenCalled()
    items[0].onSelect?.()
    expect(remove).toHaveBeenCalledWith(['a', 'b', 'c'])
  })

  it('selects the row first and offers a single Delete otherwise', () => {
    const remove = vi.fn()
    const select = vi.fn()
    const items = deleteMenuItems(makeSel(['a', 'b'], select), 'z', 'quotes', remove)
    expect(select).toHaveBeenCalledWith('z')
    expect(items[0].label).toBe('Delete')
    expect(items[0].danger).toBe(true)
    items[0].onSelect?.()
    expect(remove).toHaveBeenCalledWith(['z'])
  })

  it('a single-row selection right-clicked on itself still reads plain Delete', () => {
    const remove = vi.fn()
    const select = vi.fn()
    const items = deleteMenuItems(makeSel(['a'], select), 'a', 'items', remove)
    expect(select).toHaveBeenCalledWith('a')
    expect(items[0].label).toBe('Delete')
  })
})
