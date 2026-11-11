import { describe, expect, it } from 'vitest'
import { railHint } from './railHints'

describe('railHint', () => {
  it('is one sentence shape with only the noun changing', () => {
    expect(railHint('section')).toBe("Click a section to cue it; while it's live the screen follows. Double-click to go live.")
    expect(railHint('slide')).toBe("Click a slide to cue it; while it's live the screen follows. Double-click to go live.")
  })

  it('adds the Shift-click clause where the rail has ranges', () => {
    expect(railHint('card', { range: 'select a range' })).toBe(
      "Click a card to cue it; while it's live the screen follows. Double-click to go live. Shift-click to select a range."
    )
    expect(railHint('verse', { range: 'build a range' })).toMatch(/Shift-click to build a range\.$/)
  })

  it('drops the follow clause where a click never moves the screen (decision 3)', () => {
    expect(railHint('reading', { follows: false, range: 'select a range' })).toBe(
      'Click a reading to cue it. Double-click to go live. Shift-click to select a range.'
    )
  })

  it('never says tap', () => {
    for (const h of [railHint('verse'), railHint('card', { range: 'select a range' })]) expect(h).not.toMatch(/tap/i)
  })
})
