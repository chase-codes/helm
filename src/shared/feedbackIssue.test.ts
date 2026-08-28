import { describe, it, expect } from 'vitest'
import { buildIssue, type FeedbackContext } from './feedbackIssue'

const ctx: FeedbackContext = { version: '0.5.0', os: 'macOS (25.5.0)', arch: 'arm64', displays: 2, hasBibles: true, hasSongs: false }

describe('buildIssue', () => {
  it('titles from the first line, prefixed and capped at 72 chars', () => {
    const long = 'x'.repeat(100) + '\nsecond line'
    const { title } = buildIssue({ type: 'bug', text: long, context: ctx })
    expect(title.startsWith('Feedback: ')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(72)
    expect(title.endsWith('…')).toBe(true)
  })

  it('labels bugs and features differently, always with feedback', () => {
    expect(buildIssue({ type: 'bug', text: 'Slides went black', context: ctx }).labels).toEqual(['feedback', 'bug'])
    expect(buildIssue({ type: 'feature', text: 'Countdown timer', context: ctx }).labels).toEqual(['feedback', 'enhancement'])
  })

  it('renders the text then a context section with all six fields', () => {
    const { body } = buildIssue({ type: 'feature', text: 'Countdown timer\nbefore service', context: ctx })
    expect(body).toContain('Countdown timer\nbefore service')
    expect(body).toContain('### Included automatically')
    for (const s of ['0.5.0', 'macOS (25.5.0)', 'arm64', 'Displays: 2', 'Bibles installed: yes', 'Songs in library: no']) {
      expect(body).toContain(s)
    }
    expect(body.indexOf('Countdown')).toBeLessThan(body.indexOf('### Included'))
  })

  it('uses the kind as the title when text is blank-ish on line one', () => {
    expect(buildIssue({ type: 'bug', text: '   \nreal text', context: ctx }).title).toBe('Feedback: real text')
  })
})
