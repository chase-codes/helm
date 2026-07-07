// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

function renderMenu(items: ContextMenuItem[], onClose = vi.fn()): { onClose: typeof onClose } {
  render(
    <ThemeCtx.Provider value={themeFor('dark')}>
      <ContextMenu open x={100} y={120} items={items} onClose={onClose} />
    </ThemeCtx.Provider>
  )
  return { onClose }
}

describe('ContextMenu', () => {
  it('renders nothing when closed', () => {
    render(
      <ThemeCtx.Provider value={themeFor('dark')}>
        <ContextMenu open={false} x={0} y={0} items={[{ label: 'Edit', onSelect: vi.fn() }]} onClose={vi.fn()} />
      </ThemeCtx.Provider>
    )
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('renders items with menu/menuitem roles at the given position', () => {
    renderMenu([{ label: 'Edit', onSelect: vi.fn() }])
    const menu = screen.getByRole('menu')
    expect(menu.style.left).toBe('100px')
    expect(menu.style.top).toBe('120px')
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy()
  })

  it('activates an item on click and closes', () => {
    const onSelect = vi.fn()
    const { onClose } = renderMenu([{ label: 'Edit', onSelect }])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not activate a disabled item', () => {
    const onSelect = vi.fn()
    renderMenu([{ label: 'Edit', onSelect, disabled: true }])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const { onClose } = renderMenu([{ label: 'Edit', onSelect: vi.fn() }])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on outside (scrim) click', () => {
    const onClose = vi.fn()
    const { container } = render(
      <ThemeCtx.Provider value={themeFor('dark')}>
        <ContextMenu open x={10} y={10} items={[{ label: 'Edit', onSelect: vi.fn() }]} onClose={onClose} />
      </ThemeCtx.Provider>
    )
    // The scrim is the first fixed full-viewport div (inset:0).
    const scrim = container.querySelector('div[style*="inset"]') as HTMLElement
    fireEvent.click(scrim)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ArrowDown moves the active item so Enter fires the next one', () => {
    const first = vi.fn()
    const second = vi.fn()
    renderMenu([
      { label: 'First', onSelect: first },
      { label: 'Second', onSelect: second }
    ])
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('marks danger items via data-danger', () => {
    renderMenu([{ label: 'Delete', onSelect: vi.fn(), danger: true }])
    expect(screen.getByRole('menuitem', { name: 'Delete' }).getAttribute('data-danger')).toBe('true')
  })
})
