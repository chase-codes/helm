// @vitest-environment jsdom
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JSX } from 'react'
import { useTimedUndo } from './useTimedUndo'

afterEach(cleanup)

function Host(): JSX.Element {
  const u = useTimedUndo<string>(5000)
  return (
    <div>
      <span data-testid="pending">{u.pending ?? 'none'}</span>
      <button onClick={() => u.arm('a')}>arm-a</button>
      <button onClick={() => u.arm('b')}>arm-b</button>
      <button onClick={() => u.cancel()}>cancel</button>
    </div>
  )
}

describe('useTimedUndo', () => {
  it('arms, re-arms, cancels, and auto-clears after the duration', () => {
    vi.useFakeTimers()
    try {
      render(<Host />)
      expect(screen.getByTestId('pending').textContent).toBe('none')

      fireEvent.click(screen.getByText('arm-a'))
      expect(screen.getByTestId('pending').textContent).toBe('a')

      fireEvent.click(screen.getByText('arm-b'))
      expect(screen.getByTestId('pending').textContent).toBe('b')

      fireEvent.click(screen.getByText('cancel'))
      expect(screen.getByTestId('pending').textContent).toBe('none')

      fireEvent.click(screen.getByText('arm-a'))
      act(() => { vi.advanceTimersByTime(5000) })
      expect(screen.getByTestId('pending').textContent).toBe('none')
    } finally {
      vi.useRealTimers()
    }
  })
})
