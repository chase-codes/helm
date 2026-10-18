// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import { useContextMenu } from './useContextMenu'
import { LIBRARY_DELETE, LIBRARY_DELETE_ARMED, useLibraryDelete } from './useLibraryDelete'

afterEach(cleanup)

function Host({
  onDelete,
  isLive = false
}: {
  onDelete: () => void
  isLive?: boolean
}): JSX.Element {
  const menu = useContextMenu()
  const libraryDelete = useLibraryDelete(menu)
  return (
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <button
        onContextMenu={(e) =>
          libraryDelete.open(e, {
            before: [{ label: 'Edit', onSelect: () => {} }],
            isLive,
            onDelete
          })
        }
      >
        row
      </button>
      {menu.menu}
    </ThemeCtx.Provider>
  )
}

describe('useLibraryDelete', () => {
  it('offers the extra items first, then Delete from library', () => {
    render(<Host onDelete={vi.fn()} />)
    fireEvent.contextMenu(screen.getByText('row'))
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'Edit',
      LIBRARY_DELETE
    ])
  })

  it('arms on the first click and deletes only on a deliberate second one', () => {
    vi.useFakeTimers()
    try {
      const onDelete = vi.fn()
      render(<Host onDelete={onDelete} />)
      fireEvent.contextMenu(screen.getByText('row'))
      fireEvent.click(screen.getByText(LIBRARY_DELETE))
      expect(onDelete).not.toHaveBeenCalled()
      expect(screen.getByRole('menu')).toBeTruthy()

      // The tail of a double-click lands inside the arm guard: not a decision.
      fireEvent.click(screen.getByText(LIBRARY_DELETE_ARMED))
      expect(onDelete).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(400)
      })
      fireEvent.click(screen.getByText(LIBRARY_DELETE_ARMED))
      expect(onDelete).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('menu')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('lapses back to the plain label after the confirm window', () => {
    vi.useFakeTimers()
    try {
      render(<Host onDelete={vi.fn()} />)
      fireEvent.contextMenu(screen.getByText('row'))
      fireEvent.click(screen.getByText(LIBRARY_DELETE))
      act(() => {
        vi.advanceTimersByTime(4000)
      })
      expect(screen.queryByText(LIBRARY_DELETE_ARMED)).toBeNull()
      expect(screen.getByText(LIBRARY_DELETE)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses the row on screen, and says why', () => {
    const onDelete = vi.fn()
    render(<Host onDelete={onDelete} isLive />)
    fireEvent.contextMenu(screen.getByText('row'))
    const item = screen.getByRole('menuitem', { name: /take it down first/i })
    expect(item.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(item)
    expect(onDelete).not.toHaveBeenCalled()
  })
})
