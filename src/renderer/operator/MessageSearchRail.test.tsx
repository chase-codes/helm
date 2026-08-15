// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageSearchRail } from './MessageSearchRail'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

const baseProps = {
  theme: themeFor('classic', 'dark'),
  q: '',
  onQChange: vi.fn(),
  scopeLabel: null,
  onClearScope: vi.fn(),
  tapeRows: [],
  quoteRows: [],
  scheduleRows: [],
  tapePlayer: null
}

describe('MessageSearchRail — double-click to go live (#58)', () => {
  it('fires onDoubleClick on a tape row', () => {
    const onDoubleClick = vi.fn()
    const tapeRows = [{ id: 'm1', title: 'Faith', meta: 'Tape 47-0412', onClick: vi.fn(), onDoubleClick }]
    render(<MessageSearchRail {...baseProps} q="faith" tapeRows={tapeRows} />)
    fireEvent.doubleClick(screen.getByText('Faith').closest('button') as HTMLButtonElement)
    expect(onDoubleClick).toHaveBeenCalled()
  })

  it('fires onDoubleClick on a quote row', () => {
    const onDoubleClick = vi.fn()
    const quoteRows = [{ id: 'm1:1', title: '¶2', preview: 'Second paragraph', onClick: vi.fn(), onDoubleClick }]
    render(<MessageSearchRail {...baseProps} q="faith" quoteRows={quoteRows} />)
    fireEvent.doubleClick(screen.getByText('¶2').closest('button') as HTMLButtonElement)
    expect(onDoubleClick).toHaveBeenCalled()
  })

  it('fires onDoubleClick on a schedule row', () => {
    const onDoubleClick = vi.fn()
    const scheduleRows = [{ id: 'q1', title: 'Faith', meta: '¶2 · Tape 47-0412', isCurrent: false, onClick: vi.fn(), onDoubleClick }]
    render(<MessageSearchRail {...baseProps} scheduleRows={scheduleRows} />)
    fireEvent.doubleClick(screen.getByText('Faith').closest('button') as HTMLButtonElement)
    expect(onDoubleClick).toHaveBeenCalled()
  })
})
