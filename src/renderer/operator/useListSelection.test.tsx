// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { JSX } from 'react'
import { useListSelection } from './useListSelection'

afterEach(cleanup)

// Tiny host component so we exercise the hook through real React state transitions.
function Host(): JSX.Element {
  const sel = useListSelection()
  return (
    <div>
      <span data-testid="selected">{sel.selectedId ?? 'none'}</span>
      <span data-testid="a-selected">{String(sel.isSelected('a'))}</span>
      <button onClick={() => sel.select('a')}>select-a</button>
      <button onClick={() => sel.select('b')}>select-b</button>
      <button onClick={() => sel.clear()}>clear</button>
    </div>
  )
}

describe('useListSelection', () => {
  it('selects, re-selects, and clears', () => {
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
  })
})
