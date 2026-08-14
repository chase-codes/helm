// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SermonCenter, SLIDE_HERO_WIDTH, type SermonCenterProps } from './SermonCenter'
import { themeFor } from '../../shared/theme'

// This project's vitest config does not set `globals: true`, so
// @testing-library/react's auto afterEach(cleanup) never registers.
afterEach(cleanup)

const baseProps = (variant: SermonCenterProps['variant']): SermonCenterProps => ({
  theme: themeFor('classic', 'dark'),
  output: 'black',
  cuedIsLive: false,
  accent: '#c9a55c',
  heroLabel: 'Label',
  ondeckTag: 'SLIDE',
  ondeckTagColor: '#c9a55c',
  ondeckTitle: 'Up next',
  ondeckPreview: 'Preview',
  nextLabel: 'Next slide ›',
  onPrev: () => {},
  onNext: () => {},
  onGoLive: () => {},
  onToggleLogo: () => {},
  variant,
  slide: variant === 'slide' ? { kind: 'image', src: 'helm-media://d1/1.png' } : undefined,
  cols: variant === 'verse' ? [{ version: 'KJV', text: 'In the beginning' }] : undefined
})

// jsdom does no layout, so these pin the sizing contract through the inline styles: the
// hero box must be the largest 16:9 rectangle that fits the hero card in BOTH dimensions
// (#56). Width-wise that means no hard pixel cap; height-wise it means the width formula
// is derived from the card's height (container query units against the card).
describe('SermonCenter — slide hero fills the card (#56)', () => {
  const heroBox = (): HTMLElement =>
    document.querySelector('[style*="aspect-ratio"]') as HTMLElement

  it('is not hard-capped at 680px and fits the card height, preserving 16:9', () => {
    render(<SermonCenter {...baseProps('slide')} />)
    const box = heroBox()
    expect(box).toBeTruthy()
    expect(box.style.aspectRatio).toBe('16/9')
    // jsdom's cssstyle drops the width declaration itself (container-query units), so
    // the formula is pinned via the exported constant the box's style uses: no pixel
    // cap, and clamped by the card's height (cqh × 16/9) so a short window shrinks the
    // box instead of overflowing the card.
    expect(SLIDE_HERO_WIDTH).not.toContain('680')
    expect(SLIDE_HERO_WIDTH).toContain('100%')
    expect(SLIDE_HERO_WIDTH).toContain('100cqh * 16 / 9')
  })

  it('the hero card never scrolls a slide — it is a size container that clips', () => {
    render(<SermonCenter {...baseProps('slide')} />)
    const card = heroBox().parentElement as HTMLElement
    expect(card.style.overflowY).toBe('hidden')
    // cqh above resolves against the card, so the card must be the query container.
    expect(card.style.containerType).toBe('size')
  })

  it('the verse hero keeps its scroll — long stacked versions genuinely overflow', () => {
    render(<SermonCenter {...baseProps('verse')} />)
    const card = screen.getByText('In the beginning').closest('div[style*="overflow"]') as HTMLElement
    expect(card).toBeTruthy()
    expect(card.style.overflowY).toBe('auto')
  })
})
