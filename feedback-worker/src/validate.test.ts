import { describe, it, expect } from 'vitest'
import { validate } from './validate'

const good = { type: 'bug', text: 'Slides went black', context: { version: '0.5.0', os: 'macOS (25.5.0)', arch: 'arm64', displays: 2, hasBibles: true, hasSongs: false } }

describe('validate', () => {
  it('accepts a well-formed payload', () => {
    expect(validate(good)).toEqual({ ok: true, payload: good })
  })
  it.each([
    ['bad type', { ...good, type: 'rant' }],
    ['empty text', { ...good, text: '   ' }],
    ['too long', { ...good, text: 'a'.repeat(4001) }],
    ['missing context', { ...good, context: undefined }],
    ['extra context key', { ...good, context: { ...good.context, lyrics: 'x' } }],
    ['long version', { ...good, context: { ...good.context, version: 'v'.repeat(101) } }],
    ['non-number displays', { ...good, context: { ...good.context, displays: '2' } }],
    ['not an object', 'hi'],
  ])('rejects %s', (_n, bad) => {
    expect(validate(bad).ok).toBe(false)
  })
})
