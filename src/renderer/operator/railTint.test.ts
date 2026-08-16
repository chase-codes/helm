import { describe, expect, it } from 'vitest'
import { railTint } from './railTint'
import { FAMILIES, themeFor, type ThemeFamily } from '../../shared/theme'

const FAMILY_KEYS = Object.keys(FAMILIES) as ThemeFamily[]

describe('railTint', () => {
  it('washes the track colour itself, so a rail follows the family', () => {
    // The whole point of #91: before this, both rails wrote Classic's blue and purple as
    // literal rgba(), so switching to Grove left the rows the old hue while their rings —
    // already `${T.scripture}66` — moved with the theme.
    for (const family of FAMILY_KEYS) {
      const t = themeFor(family, 'dark')
      expect(railTint(t.scripture, 'live', true)).toContain(t.scripture)
      expect(railTint(t.message, 'live', true)).toContain(t.message)
    }
  })

  it('produces a valid 8-digit hex from every palette token it is given', () => {
    for (const family of FAMILY_KEYS) {
      for (const mode of ['dark', 'light'] as const) {
        const t = themeFor(family, mode)
        for (const accent of [t.scripture, t.message, t.sermon]) {
          for (const rung of ['selected', 'live', 'cued', 'planned'] as const) {
            expect(railTint(accent, rung, mode === 'dark')).toMatch(/^#[0-9a-fA-F]{8}$/)
          }
        }
      }
    }
  })

  it('descends selected > live > cued > planned', () => {
    const t = themeFor('classic', 'dark')
    const alpha = (rung: 'selected' | 'live' | 'cued' | 'planned'): number =>
      parseInt(railTint(t.scripture, rung, true).slice(-2), 16)
    expect(alpha('selected')).toBeGreaterThan(alpha('live'))
    expect(alpha('live')).toBeGreaterThan(alpha('cued'))
    expect(alpha('cued')).toBeGreaterThan(alpha('planned'))
  })

  it('runs lighter in light mode, where dark ink on a pale ground reads heavier', () => {
    const t = themeFor('classic', 'light')
    const alphaFor = (dark: boolean): number =>
      parseInt(railTint(t.scripture, 'live', dark).slice(-2), 16)
    expect(alphaFor(false)).toBeLessThan(alphaFor(true))
  })
})
