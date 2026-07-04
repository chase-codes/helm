// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChapterRail } from './ChapterRail'
import { themeFor } from '../../shared/theme'

// This project's vitest config does not set `globals: true`, so
// @testing-library/react's auto afterEach(cleanup) never registers; without
// this, DOM from one test leaks into the next.
afterEach(cleanup)

const baseProps = {
  theme: themeFor('dark'),
  dark: true,
  width: 330,
  book: 'James',
  ch: 1,
  verseCount: 5,
  plannedSet: new Set<number>(),
  cuedV: 1,
  isVerseLive: () => false,
  previewOf: (v: number) => `verse ${v} text`,
  selectedRange: { from: 2, to: 4 } as { from: number; to: number } | null,
  onSelectVerse: vi.fn()
}

describe('ChapterRail', () => {
  it('marks verses inside selectedRange as selected', () => {
    render(<ChapterRail {...baseProps} />)
    const selected = document.querySelectorAll('[data-selected="true"]')
    expect(selected.length).toBe(3) // verses 2,3,4
  })

  it('fires onSelectVerse with the shift flag', () => {
    const onSelectVerse = vi.fn()
    render(<ChapterRail {...baseProps} onSelectVerse={onSelectVerse} />)
    const v3 = screen.getByText('verse 3 text').closest('button') as HTMLButtonElement
    fireEvent.click(v3, { shiftKey: true })
    expect(onSelectVerse).toHaveBeenCalledWith(3, true)
  })
})
