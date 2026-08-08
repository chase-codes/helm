import { describe, expect, it } from 'vitest'
import { DARK, FAMILIES, themeFor } from './theme'

describe('themeFor', () => {
  it('classic dark keeps today\'s charcoal values', () => {
    const t = themeFor('classic', 'dark')
    expect(t.appBg).toBe('#0f1115')
    expect(t.accent).toBe('#e0a341')
    expect(t.scripture).toBe('#6f9cf0')
    expect(t.message).toBe('#a88bc4')
  })

  it('classic light uses its own parchment-tuned content colors', () => {
    const t = themeFor('classic', 'light')
    expect(t.appBg).toBe('#ece5d6')
    // Previously dead — the Warm tone merge overrode these with dark-tuned values.
    expect(t.scripture).toBe('#3f6bb5')
    expect(t.sermon).toBe('#4f7d5f')
    expect(t.message).toBe('#7d54ad')
  })

  it('helm dark is the brand navy/gold pairing', () => {
    const t = themeFor('helm', 'dark')
    expect(t.appBg).toBe('#0B1322')
    expect(t.text).toBe('#EFE9DC')
    expect(t.accent).toBe('#E0A341')
  })

  it('helm light is ink-on-parchment', () => {
    const t = themeFor('helm', 'light')
    expect(t.appBg).toBe('#EFE9DC')
    expect(t.text).toBe('#16243E')
  })

  it('every family/mode palette carries every token', () => {
    for (const family of ['classic', 'helm'] as const) {
      for (const mode of ['dark', 'light'] as const) {
        const t = themeFor(family, mode)
        for (const [k, v] of Object.entries(t)) {
          expect(v, `${family}/${mode}.${k}`).toBeTruthy()
        }
        expect(t.floatShadow).toContain(t.border)
      }
    }
  })

  it('exports DARK as the classic dark palette for LeaderView', () => {
    expect(DARK).toBe(FAMILIES.classic.dark)
  })

  it('names the presets', () => {
    expect(FAMILIES.classic.presetName).toEqual({ dark: 'Charcoal', light: 'Parchment' })
    expect(FAMILIES.helm.presetName).toEqual({ dark: 'Helm Navy', light: 'Helm Parchment' })
  })
})
