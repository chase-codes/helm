import { describe, expect, it } from 'vitest'
import { DARK, FAMILIES, themeFor, type ThemeFamily, type ThemeMode } from './theme'

/** The 19 palette tokens every family must carry, in both modes. */
const TOKENS = [
  'appBg', 'panel', 'panel2', 'panel3',
  'text', 'dim', 'faint', 'hairline', 'border',
  'inputBg', 'accent', 'accentInk', 'live',
  'scripture', 'sermon', 'message',
  'selBg', 'lineDim', 'go'
] as const

/** Computed by themeFor rather than carried per-palette. */
const DERIVED = ['floatShadow', 'modalShadow', 'scrim'] as const

const FAMILY_KEYS = Object.keys(FAMILIES) as ThemeFamily[]
const MODES: ThemeMode[] = ['dark', 'light']

describe('themeFor', () => {
  it('classic dark is byte-identical to the shipped charcoal', () => {
    // The default theme must not move: these are the exact values the pre-token
    // build rendered, including the three colors that used to be hardcoded.
    expect(themeFor('classic', 'dark')).toEqual({
      appBg: '#0f1115', panel: '#15171c', panel2: '#1c1f25', panel3: '#23262e',
      text: '#e8e6e1', dim: '#9a9488', faint: '#736f66',
      hairline: 'rgba(255,255,255,.06)', border: 'rgba(255,255,255,.08)',
      inputBg: '#1c1f25', accent: '#e0a341', accentInk: '#1a1206', live: '#cf6a5e',
      scripture: '#6f9cf0', sermon: '#6f9c7a', message: '#a88bc4',
      selBg: '#221d10', lineDim: '#b4b1aa', go: '#2f9e5b',
      floatShadow: '0 18px 50px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.08)',
      modalShadow: '0 30px 80px rgba(0,0,0,.5)',
      scrim: 'rgba(8,9,12,.6)'
    })
  })

  it('classic light is charcoal\'s daytime twin, not parchment', () => {
    const t = themeFor('classic', 'light')
    expect(t.appBg).toBe('#e7e5e0')
    // Darkened from #a76a17 so it clears 4.5:1 on panel/appBg/selBg (#117).
    expect(t.accent).toBe('#905b14')
    expect(t.scripture).toBe('#2f5cab')
  })

  it('helm dark is the brand navy/gold pairing', () => {
    const t = themeFor('helm', 'dark')
    expect(t.appBg).toBe('#0B1322')
    expect(t.text).toBe('#EFE9DC')
    expect(t.accent).toBe('#E0A341')
  })

  it('helm light is navy ink on parchment, with a navy accent', () => {
    const t = themeFor('helm', 'light')
    expect(t.appBg).toBe('#e7dfcc')
    expect(t.text).toBe('#14243f')
    // Navy, not gold — this is what separates Helm from Classic in light mode.
    expect(t.accent).toBe('#1e3a66')
  })

  it('every family/mode palette carries every token', () => {
    for (const family of FAMILY_KEYS) {
      for (const mode of MODES) {
        const t = themeFor(family, mode)
        for (const token of TOKENS) {
          expect(t[token], `${family}/${mode}.${token}`).toBeTruthy()
        }
        for (const token of DERIVED) {
          expect(t[token], `${family}/${mode}.${token}`).toBeTruthy()
        }
        expect(Object.keys(t)).toHaveLength(TOKENS.length + DERIVED.length)
        expect(t.floatShadow).toContain(t.border)
      }
    }
  })

  it('gives each family its own light ground and accent', () => {
    // The point of #45: switching family in light mode must be visible.
    const grounds = FAMILY_KEYS.map((f) => themeFor(f, 'light').appBg)
    const accents = FAMILY_KEYS.map((f) => themeFor(f, 'light').accent)
    expect(new Set(grounds).size).toBe(FAMILY_KEYS.length)
    expect(new Set(accents).size).toBe(FAMILY_KEYS.length)
  })

  it('exports DARK as the classic dark palette for LeaderView', () => {
    expect(DARK).toBe(FAMILIES.classic.dark)
  })

  it('names the presets', () => {
    expect(FAMILIES.classic.presetName).toEqual({ dark: 'Charcoal', light: 'Chalk' })
    expect(FAMILIES.helm.presetName).toEqual({ dark: 'Helm Navy', light: 'Helm Parchment' })
    expect(FAMILIES.contrast.presetName).toEqual({ dark: 'Ink', light: 'Paper' })
    expect(FAMILIES.sanctuary.presetName).toEqual({ dark: 'Vespers', light: 'Chapel' })
    expect(FAMILIES.grove.presetName).toEqual({ dark: 'Cedar', light: 'Sage' })
  })
})

describe('contrast floors (#47)', () => {
  /** WCAG 2.1 relative luminance; hex-only — rgba() tokens (hairline/border/scrim) must not be fed in. */
  const luminance = (hex: string): number => {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const contrast = (fg: string, bg: string): number => {
    const [a, b] = [luminance(fg), luminance(bg)]
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  }

  it('secondary label text (dim) clears 4.5:1 on panel in every family and mode', () => {
    // The hero verse/section labels use `dim` when cued-but-not-live (#47). A future
    // family must not regress the label below WCAG AA body-text contrast.
    for (const family of FAMILY_KEYS) {
      for (const mode of MODES) {
        const t = themeFor(family, mode)
        expect(contrast(t.dim, t.panel), `${family}/${mode} dim on panel`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('accent text clears 4.5:1 on every surface it is written on, in every family and mode', () => {
    // The cued-is-live hero label (SermonCenter/SongsMode) paints `accent` on panel;
    // Header's output label paints it on appBg; SongSearchRail/SectionRail paint it on
    // selBg; buttons paint accentInk on accent. Classic light shipped at 3.88:1 (#117).
    for (const family of FAMILY_KEYS) {
      for (const mode of MODES) {
        const t = themeFor(family, mode)
        expect(contrast(t.accent, t.panel), `${family}/${mode} accent on panel`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.accent, t.appBg), `${family}/${mode} accent on appBg`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.accent, t.selBg), `${family}/${mode} accent on selBg`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.accentInk, t.accent), `${family}/${mode} accentInk on accent`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
