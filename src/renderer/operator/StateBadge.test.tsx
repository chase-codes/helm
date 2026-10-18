// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LiveBadge, QueuedBadge, RowStateMark } from './StateBadge'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

const T = themeFor('classic', 'dark')
const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('StateBadge', () => {
  it('LIVE is red and holds its footprint', () => {
    render(<LiveBadge theme={T} />)
    const badge = screen.getByText('LIVE') as HTMLElement
    expect(badge.style.color).toBe(rgb(T.live))
    expect(badge.style.flexShrink).toBe('0')
    expect(badge.getAttribute('data-badge')).toBe('live')
  })

  it('QUEUED is the track colour, never red', () => {
    render(<QueuedBadge accent={T.message} />)
    const badge = screen.getByText('QUEUED') as HTMLElement
    expect(badge.style.color).toBe(rgb(T.message))
    expect(badge.getAttribute('data-badge')).toBe('queued')
  })

  it('RowStateMark picks LIVE over QUEUED over the cue dot, and nothing when idle', () => {
    const { rerender, container } = render(<RowStateMark theme={T} accent={T.sermon} live queued current />)
    expect(screen.getByText('LIVE')).toBeTruthy()
    expect(screen.queryByText('QUEUED')).toBeNull()

    rerender(<RowStateMark theme={T} accent={T.sermon} live={false} queued current />)
    expect(screen.getByText('QUEUED')).toBeTruthy()

    rerender(<RowStateMark theme={T} accent={T.sermon} live={false} queued={false} current />)
    const dot = container.querySelector('[data-cued-dot]') as HTMLElement
    expect(dot.style.background).toBe(rgb(T.sermon))

    rerender(<RowStateMark theme={T} accent={T.sermon} live={false} queued={false} current={false} />)
    expect(container.innerHTML).toBe('')
  })
})
