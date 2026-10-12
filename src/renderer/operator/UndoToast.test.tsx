// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UndoToast } from './UndoToast'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

describe('UndoToast', () => {
  // Decision 1: the menu says Delete, so the toast that follows it says Deleted.
  it('reads "Deleted <label>" and offers Undo', () => {
    const onUndo = vi.fn()
    render(
      <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
        <UndoToast label="3 verses" onUndo={onUndo} />
      </ThemeCtx.Provider>
    )
    expect(screen.getByText('Deleted 3 verses')).toBeTruthy()
    expect(screen.queryByText(/Removed/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })
})
