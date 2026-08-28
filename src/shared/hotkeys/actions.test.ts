import { describe, expect, it } from 'vitest'
import { sanitizeOverrides, HOTKEY_ACTIONS } from './actions'

describe('sanitizeOverrides', () => {
  it('passes through a valid overrides map unchanged', () => {
    const value = { 'song.bridge': ['X'], 'go.live': ['Enter', 'F1'] }
    expect(sanitizeOverrides(value)).toEqual(value)
  })

  // #52: Space stopped being a go-live key. Stored overrides from before that change
  // still carry it, so it is stripped on load rather than honoured as a choice.
  it('strips Space from a stored go.live override', () => {
    expect(sanitizeOverrides({ 'go.live': ['Enter', 'Space'], 'song.bridge': ['X'] })).toEqual({
      'go.live': ['Enter'],
      'song.bridge': ['X']
    })
  })

  it('drops a go.live override that was only Space, so the default applies', () => {
    expect(sanitizeOverrides({ 'go.live': ['Space'] })).toEqual({})
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

describe('HOTKEY_ACTIONS', () => {
  it('go.live is Enter only — Space never goes live (#52)', () => {
    const action = HOTKEY_ACTIONS.find((a) => a.id === 'go.live')!
    expect(action.defaults).toEqual(['Enter'])
  })

  it('Mod+L is song search and scripture lookup moved to Mod+K (#52)', () => {
    expect(HOTKEY_ACTIONS.find((a) => a.id === 'song.search')!.defaults).toEqual(['Mod+L'])
    expect(HOTKEY_ACTIONS.find((a) => a.id === 'scripture.lookup')!.defaults).toEqual(['Mod+K'])
  })

  it('focus.search ships both / and \\ as default bindings', () => {
    const action = HOTKEY_ACTIONS.find((a) => a.id === 'focus.search')!
    expect(action.defaults).toEqual(['/', '\\'])
  })
})
