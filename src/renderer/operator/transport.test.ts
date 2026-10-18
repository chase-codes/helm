import { describe, expect, it } from 'vitest'
import { primaryBtnStyle, secondaryVerbStyle, TRANSPORT_VERB_W } from './transport'
import { themeFor } from '../../shared/theme'

const T = themeFor('classic', 'dark')

describe('transport verb looks', () => {
  it('neutral holds the fixed slot width and is neither go-green nor live-red', () => {
    const s = primaryBtnStyle(T, 'neutral')
    expect(s.width).toBe(TRANSPORT_VERB_W)
    expect(s.background).toBe(T.accent)
    expect(s.color).toBe(T.accentInk)
    expect(s.background).not.toBe(T.go)
    expect(JSON.stringify(s)).not.toContain(T.live)
  })

  it('neutral stays clickable, unlike ghost', () => {
    expect(primaryBtnStyle(T, 'neutral').cursor).toBeUndefined()
    expect(primaryBtnStyle(T, 'ghost').cursor).toBe('default')
  })

  it('the secondary verb is content-sized, since it sits left of the spacer', () => {
    expect(secondaryVerbStyle(T, true).width).toBeUndefined()
    expect(secondaryVerbStyle(T, true).whiteSpace).toBe('nowrap')
  })

  it('the secondary verb reads as an action when enabled and ghosts when not', () => {
    expect(secondaryVerbStyle(T, true).color).toBe(T.accent)
    expect(secondaryVerbStyle(T, true).boxShadow).toContain(T.accent)
    expect(secondaryVerbStyle(T, false).color).toBe(T.faint)
    expect(secondaryVerbStyle(T, false).cursor).toBe('default')
  })
})
