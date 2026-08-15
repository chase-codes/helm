// @vitest-environment jsdom
import type { JSX } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChapterRail, type ChapterRailProps } from './ChapterRail'
import { themeFor } from '../../shared/theme'

// This project's vitest config does not set `globals: true`, so
// @testing-library/react's auto afterEach(cleanup) never registers; without
// this, DOM from one test leaks into the next.
afterEach(cleanup)

const baseProps = {
  theme: themeFor('classic', 'dark'),
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
  onSelectVerse: vi.fn(),
  onActivate: vi.fn()
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

  it('scales verse preview text with the panel width, like the songs section rail', () => {
    // width/24 clamped to 13–18px — the SectionRail formula, copied verbatim.
    render(<ChapterRail {...baseProps} width={240} />)
    let el = screen.getByText('verse 3 text') as HTMLElement
    expect(el.style.fontSize).toBe('13px') // 240/24 = 10 → floor 13
    cleanup()
    render(<ChapterRail {...baseProps} width={480} />)
    el = screen.getByText('verse 3 text') as HTMLElement
    expect(el.style.fontSize).toBe('18px') // 480/24 = 20 → ceiling 18
    cleanup()
    render(<ChapterRail {...baseProps} width={360} />)
    el = screen.getByText('verse 3 text') as HTMLElement
    expect(el.style.fontSize).toBe('15px') // 360/24 = 15, within band
  })

  it('fires onActivate with the shift flag on double-click', () => {
    const onActivate = vi.fn()
    render(<ChapterRail {...baseProps} onActivate={onActivate} />)
    fireEvent.doubleClick(screen.getByText('Verse 3'), { shiftKey: true })
    expect(onActivate).toHaveBeenCalledWith(3, true)
  })

  it('leaves single-click reporting untouched', () => {
    const onSelectVerse = vi.fn()
    const onActivate = vi.fn()
    render(<ChapterRail {...baseProps} onSelectVerse={onSelectVerse} onActivate={onActivate} />)
    fireEvent.click(screen.getByText('Verse 3'))
    expect(onSelectVerse).toHaveBeenCalledWith(3, false)
    expect(onActivate).not.toHaveBeenCalled()
  })
})

// Renders a ChapterRail with baseProps plus overrides — extends the file's own default
// fixture rather than inventing a second one, so these cases exercise the same shape as
// the tests above.
const rail = (overrides: Partial<ChapterRailProps> = {}): JSX.Element => (
  <ChapterRail {...baseProps} {...overrides} />
)

describe('ChapterRail scrollRequest', () => {
  it('scrolls the requested verse with the requested alignment', () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    render(rail({ verseCount: 10, scrollRequest: { v: 4, align: 'start', nonce: 1 } }))
    expect(spy).toHaveBeenCalledWith({ block: 'start' })
  })

  it('re-applies the same request when the chapter rows arrive (verseCount change)', () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    const { rerender } = render(rail({ verseCount: 1, scrollRequest: { v: 4, align: 'start', nonce: 1 } }))
    spy.mockClear()
    rerender(rail({ verseCount: 10, scrollRequest: { v: 4, align: 'start', nonce: 1 } }))
    expect(spy).toHaveBeenCalledWith({ block: 'start' })
  })

  it('does not scroll again on unrelated re-renders with an unchanged nonce', () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    const { rerender } = render(rail({ verseCount: 10, scrollRequest: { v: 4, align: 'nearest', nonce: 1 } }))
    spy.mockClear()
    rerender(rail({ verseCount: 10, scrollRequest: { v: 4, align: 'nearest', nonce: 1 } }))
    expect(spy).not.toHaveBeenCalled()
  })

  it('reports onScrollConsumed only once the target row is actually found', () => {
    Element.prototype.scrollIntoView = vi.fn()
    const onScrollConsumed = vi.fn()
    // verseCount 1: verse 4's row doesn't exist yet (cross-chapter jump, rows not landed) —
    // the request must NOT be reported consumed, or the verseCount re-apply below would
    // never get a chance to fire it for real.
    const { rerender } = render(
      rail({ verseCount: 1, scrollRequest: { v: 4, align: 'start', nonce: 1 }, onScrollConsumed })
    )
    expect(onScrollConsumed).not.toHaveBeenCalled()

    // Rows land — same nonce, new verseCount — NOW the row exists and gets scrolled.
    rerender(rail({ verseCount: 10, scrollRequest: { v: 4, align: 'start', nonce: 1 }, onScrollConsumed }))
    expect(onScrollConsumed).toHaveBeenCalledWith(1)
  })
})
