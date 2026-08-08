// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { ThemePopover } from './ThemePopover'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

function renderPopover(family: 'classic' | 'helm' = 'classic'): {
  onSelect: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
} {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const containRef = createRef<HTMLDivElement>()
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <div ref={containRef}>
        <ThemePopover family={family} onSelect={onSelect} onClose={onClose} containRef={containRef} />
      </div>
    </ThemeCtx.Provider>
  )
  return { onSelect, onClose }
}

describe('ThemePopover', () => {
  it('lists both families with the active one marked', () => {
    renderPopover('helm')
    expect(screen.getByText('Classic')).toBeTruthy()
    expect(screen.getByText('Helm')).toBeTruthy()
    const helmRow = screen.getByText('Helm').closest('button')!
    expect(helmRow.textContent).toContain('✓')
  })

  it('selecting a family reports it and closes', () => {
    const { onSelect, onClose } = renderPopover('classic')
    fireEvent.click(screen.getByText('Helm'))
    expect(onSelect).toHaveBeenCalledWith('helm')
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape closes', () => {
    const { onClose } = renderPopover()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
