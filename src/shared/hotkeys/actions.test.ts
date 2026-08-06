import { describe, expect, it } from 'vitest'
import { sanitizeOverrides } from './actions'

describe('sanitizeOverrides', () => {
  it('passes through a valid overrides map unchanged', () => {
    const value = { 'song.bridge': ['X'], 'go.live': ['Enter', 'Space'] }
    expect(sanitizeOverrides(value)).toEqual(value)
  })

  it('returns {} for garbage top-level values (string, number, null, array)', () => {
    expect(sanitizeOverrides('hotkeys')).toEqual({})
    expect(sanitizeOverrides(42)).toEqual({})
    expect(sanitizeOverrides(null)).toEqual({})
    expect(sanitizeOverrides(undefined)).toEqual({})
    expect(sanitizeOverrides(['song.bridge'])).toEqual({})
  })

  it('drops entries whose value is not an array of strings', () => {
    expect(
      sanitizeOverrides({ 'song.bridge': 'X', 'song.tag': ['Y'], 'song.chorus': [1, 2], 'go.live': null })
    ).toEqual({ 'song.tag': ['Y'] })
  })

  it('drops entries keyed by an unknown action id', () => {
    expect(sanitizeOverrides({ 'not.a.real.action': ['X'], 'song.bridge': ['Y'] })).toEqual({
      'song.bridge': ['Y']
    })
  })

  it('drops entries keyed by a fixed action id (app.escape, song.verse, scripture.reading)', () => {
    expect(
      sanitizeOverrides({
        'app.escape': ['Z'],
        'song.verse': ['A'],
        'scripture.reading': ['B'],
        'song.bridge': ['C']
      })
    ).toEqual({ 'song.bridge': ['C'] })
  })

  it('handles a mix of garbage and valid entries in one object', () => {
    expect(
      sanitizeOverrides({
        'song.bridge': ['X'],
        'bogus.id': ['Y'],
        'go.live': 'not-an-array',
        'app.escape': ['fixed-should-drop']
      })
    ).toEqual({ 'song.bridge': ['X'] })
  })
})
