// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  onTakeDown: () => {},
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

// #85. The transport is the one row an operator must be able to hit without looking, so
// every control keeps its coordinates in every state: Take down is always rendered (ghosted
// when there is nothing to take down), the primary slot only ever means "put this on
// screen", and nothing variable-width sits to the right of either verb.
describe('SermonCenter — the transport is stable ground (#85)', () => {
  const btn = (name: RegExp): HTMLButtonElement =>
    screen.getByRole('button', { name }) as HTMLButtonElement

  it('renders Take down in every state, ghosted when nothing is on screen', () => {
    render(<SermonCenter {...baseProps('verse')} output="black" />)
    expect(btn(/Take down/).disabled).toBe(true)
  })

  it('blacks the screen from its own slot while something is live', () => {
    const onTakeDown = vi.fn()
    render(<SermonCenter {...baseProps('verse')} output="live" onTakeDown={onTakeDown} />)
    const takeDown = btn(/Take down/)
    expect(takeDown.disabled).toBe(false)
    fireEvent.click(takeDown)
    expect(onTakeDown).toHaveBeenCalledTimes(1)
  })

  it('keeps the primary slot saying Go live once the cued verse is already on screen', () => {
    const onGoLive = vi.fn()
    render(<SermonCenter {...baseProps('verse')} output="live" cuedIsLive onGoLive={onGoLive} />)
    // The old bar re-labelled this very button "Take down" — the same pixels meaning the
    // opposite thing. It now ghosts instead, because there is nothing left to put up.
    const goLive = btn(/Go live/)
    expect(goLive.disabled).toBe(true)
    fireEvent.click(goLive)
    expect(onGoLive).not.toHaveBeenCalled()
  })

  it('carries no logo toggle', () => {
    render(<SermonCenter {...baseProps('verse')} output="logo" />)
    expect(screen.queryByRole('button', { name: /logo/i })).toBeNull()
  })

  it('ends with Take down then Go live, so no variable-width control can shift them', () => {
    render(
      <SermonCenter
        {...baseProps('verse')}
        versionPicker={<button>KJV + NASB1995</button>}
      />
    )
    const bar = document.querySelector('[data-transport-bar]') as HTMLElement
    expect(bar).toBeTruthy()
    const labels = within(bar)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim())
    // Right-anchored group: a slot's position depends on the widths to its RIGHT, so the
    // version picker — whose label grows with the stacked-version list — must sit left of
    // both verbs rather than between them.
    expect(labels.slice(-2)).toEqual(['Take down', 'Go live'])
    expect(labels.indexOf('KJV + NASB1995')).toBeLessThan(labels.indexOf('Take down'))
  })

  it('gives both verbs a fixed width, so neither moves as its state changes', () => {
    render(<SermonCenter {...baseProps('verse')} output="live" />)
    expect(btn(/Take down/).style.width).toBe(btn(/Go live/).style.width)
    expect(btn(/Go live/).style.width).toBeTruthy()
  })
})

// #47: the hero label is the leader's handle on what's on screen; when cued-but-not-live
// it must use `dim` (≥4.5:1 on panel in every palette), not decorative `faint`.
describe('SermonCenter — hero labels readable when cued but not live (#47)', () => {
  const T = themeFor('classic', 'dark')
  // jsdom reads inline colours back as rgb(r, g, b)
  const rgb = (hex: string): string => {
    const n = parseInt(hex.slice(1), 16)
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
  }

  it('verse hero label and version tag use dim, not faint', () => {
    render(<SermonCenter {...baseProps('verse')} />)
    expect(screen.getByText('Label').style.color).toBe(rgb(T.dim))
    expect(screen.getByText('KJV').style.color).toBe(rgb(T.dim))
  })

  it('quote label and source line use dim, not faint', () => {
    render(<SermonCenter {...baseProps('quote')} quoteText="Grace abounds" quoteSource="— Author" />)
    expect(screen.getByText('Label').style.color).toBe(rgb(T.dim))
    expect(screen.getByText('— Author').style.color).toBe(rgb(T.dim))
  })

  it('the live hero label still uses the track accent', () => {
    render(<SermonCenter {...baseProps('verse')} cuedIsLive />)
    expect(screen.getByText('Label').style.color).toBe(rgb('#c9a55c'))
  })
})
