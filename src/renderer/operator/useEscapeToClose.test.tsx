// @vitest-environment jsdom
import { useState, type JSX } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEscapeToClose } from './useEscapeToClose'

afterEach(cleanup)

function Pop(): JSX.Element {
  const [open, setOpen] = useState(true)
  useEscapeToClose(open, () => setOpen(false))
  return <div>{open ? 'popover open' : 'popover closed'}</div>
}

describe('useEscapeToClose', () => {
  it('closes the popover and keeps the press from the page dispatcher', () => {
    const page = vi.fn()
    document.addEventListener('keydown', page)
    try {
      render(<Pop />)
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(screen.getByText('popover closed')).toBeTruthy()
      expect(page).not.toHaveBeenCalled()
      // Closed: the next press belongs to the page again.
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(page).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', page)
    }
  })

  it('lets every other key through while open', () => {
    const page = vi.fn()
    document.addEventListener('keydown', page)
    try {
      render(<Pop />)
      fireEvent.keyDown(document.body, { key: 'ArrowRight' })
      expect(page).toHaveBeenCalledTimes(1)
      expect(screen.getByText('popover open')).toBeTruthy()
    } finally {
      document.removeEventListener('keydown', page)
    }
  })
})
