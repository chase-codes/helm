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

import { railBadgeStyle, railFont, railLabelStyle, railRowStyle, railTextStyle, tintChip } from './railTint'
import type { CSSProperties } from 'react'

// #136/#140: the shared builders must return byte-identical objects to the rail-local
// literals they replaced. The expected shapes below are copied from the pre-extraction
// rails; if a builder drifts, the restyle is no longer behavior-preserving.
describe('rail card builders', () => {
  const T = themeFor('classic', 'dark')

  it('railFont matches the width-derived formula both rails shared', () => {
    for (const w of [200, 300, 320, 380, 431, 500]) {
      expect(railFont(w)).toBe(Math.round(Math.max(13, Math.min(18, w / 24)) * 10) / 10)
    }
  })

  it('railRowStyle reproduces the ChapterRail ladder for every tier combination', () => {
    const legacy = (isLive: boolean, isCued: boolean, planned: boolean, selected: boolean): CSSProperties => ({
      display: 'block',
      width: '100%',
      textAlign: 'left',
      padding: '11px 13px',
      borderRadius: '11px',
      cursor: 'pointer',
      userSelect: 'none',
      background: selected
        ? railTint(T.scripture, 'selected', true)
        : isLive
          ? railTint(T.scripture, 'live', true)
          : isCued
            ? railTint(T.scripture, 'cued', true)
            : planned
              ? railTint(T.scripture, 'planned', true)
              : T.panel2,
      boxShadow: selected
        ? `inset 0 0 0 2px ${T.scripture}`
        : isLive
          ? `inset 0 0 0 2px ${T.scripture}`
          : isCued
            ? `inset 0 0 0 1.5px ${T.scripture}66`
            : planned
              ? `inset 0 0 0 1px ${T.scripture}44`
              : `inset 0 0 0 1px ${T.hairline}`
    })
    for (const live of [false, true])
      for (const cued of [false, true])
        for (const planned of [false, true])
          for (const selected of [false, true]) {
            expect(railRowStyle(T, T.scripture, true, { live, cued, planned, selected })).toEqual(
              legacy(live, cued, planned, selected)
            )
          }
  })

  it('railRowStyle without the selected tier reproduces the ParagraphRail ladder', () => {
    expect(railRowStyle(T, T.message, true, { live: false, cued: true, planned: false })).toEqual({
      display: 'block',
      width: '100%',
      textAlign: 'left',
      padding: '11px 13px',
      borderRadius: '11px',
      cursor: 'pointer',
      userSelect: 'none',
      background: railTint(T.message, 'cued', true),
      boxShadow: `inset 0 0 0 1.5px ${T.message}66`
    })
  })

  it('railLabelStyle / railBadgeStyle / railTextStyle reproduce the shared typography', () => {
    expect(railLabelStyle(T, T.message, true)).toEqual({
      fontFamily: "'JetBrains Mono',monospace",
      fontSize: '10.5px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      fontWeight: 500,
      color: T.message
    })
    expect(railLabelStyle(T, T.accent, false).color).toBe(T.faint)
    expect(railBadgeStyle(T, true)).toEqual({
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      fontFamily: "'JetBrains Mono',monospace",
      fontSize: '9px',
      letterSpacing: '0.08em',
      fontWeight: 600,
      color: T.live
    })
    expect(railBadgeStyle(T, false).color).toBe(T.dim)
    expect(railTextStyle(T, { cued: false, planned: true, fontPx: 12.5 })).toEqual({
      fontSize: '12.5px',
      lineHeight: 1.42,
      fontWeight: 500,
      color: T.lineDim,
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden'
    })
    expect(railTextStyle(T, { cued: true, planned: false, fontPx: 15.4 })).toMatchObject({ fontSize: '15.4px', color: T.text })
  })

  it('tintChip is exactly the house 1c/55 triple', () => {
    expect(tintChip(T.live)).toEqual({
      background: `${T.live}1c`,
      boxShadow: `inset 0 0 0 1px ${T.live}55`,
      color: T.live
    })
  })
})
