import { describe, expect, it } from 'vitest'
import { bindingConflict, eventToBinding, formatBinding, resolveHotkey } from './match'

// Minimal KeyboardEvent stand-in — match.ts only reads key/metaKey/ctrlKey/altKey/shiftKey.
function ev(key: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}): KeyboardEvent {
  return {
    key,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift
  } as unknown as KeyboardEvent
}

describe('eventToBinding', () => {
  it('normalizes single letters to uppercase', () => {
    expect(eventToBinding(ev('c'), false)).toBe('C')
  })
  it('maps the platform-primary modifier to Mod (meta on mac, ctrl elsewhere)', () => {
    expect(eventToBinding(ev('l', { meta: true }), true)).toBe('Mod+L')
    expect(eventToBinding(ev('l', { ctrl: true }), false)).toBe('Mod+L')
  })
  it('meta on windows/linux is NOT Mod', () => {
    expect(eventToBinding(ev('l', { meta: true }), false)).toBe('L')
  })
  it('normalizes space and keeps named keys as-is', () => {
    expect(eventToBinding(ev(' '), false)).toBe('Space')
    expect(eventToBinding(ev('Home'), false)).toBe('Home')
    expect(eventToBinding(ev('Backspace', { ctrl: true }), false)).toBe('Mod+Backspace')
  })
  it('returns null on bare modifier presses', () => {
    expect(eventToBinding(ev('Shift'), false)).toBeNull()
    expect(eventToBinding(ev('Meta'), false)).toBeNull()
  })
  it('includes Shift only for non-printable keys (printables already carry it in e.key)', () => {
    expect(eventToBinding(ev('C', { shift: true }), false)).toBe('C')
    expect(eventToBinding(ev('Enter', { shift: true }), false)).toBe('Shift+Enter')
  })
})

describe('resolveHotkey', () => {
  const opts = (over: Partial<Parameters<typeof resolveHotkey>[1]> = {}): Parameters<typeof resolveHotkey>[1] => ({
    scope: null,
    typing: false,
    overrides: {},
    isMac: false,
    ...over
  })

  it('resolves defaults: Mod+2 → page.songs, Mod+L → scripture.lookup', () => {
    expect(resolveHotkey(ev('2', { ctrl: true }), opts())).toEqual({ id: 'page.songs' })
    expect(resolveHotkey(ev('l', { ctrl: true }), opts())).toEqual({ id: 'scripture.lookup' })
  })
  it('songs scope: C → song.chorus, Home → song.chorus, B → song.bridge', () => {
    expect(resolveHotkey(ev('c'), opts({ scope: 'songs' }))).toEqual({ id: 'song.chorus' })
    expect(resolveHotkey(ev('Home'), opts({ scope: 'songs' }))).toEqual({ id: 'song.chorus' })
    expect(resolveHotkey(ev('b'), opts({ scope: 'songs' }))).toEqual({ id: 'song.bridge' })
  })
  it('digit blocks report which digit: 3 → song.verse/3 in songs, scripture.reading/3 in scripture', () => {
    expect(resolveHotkey(ev('3'), opts({ scope: 'songs' }))).toEqual({ id: 'song.verse', digit: 3 })
    expect(resolveHotkey(ev('3'), opts({ scope: 'scripture' }))).toEqual({ id: 'scripture.reading', digit: 3 })
  })
  it('unscoped digit resolves nothing', () => {
    expect(resolveHotkey(ev('3'), opts())).toBeNull()
  })
  it('typing suppresses unmodified bindings but not Mod bindings', () => {
    expect(resolveHotkey(ev('c'), opts({ scope: 'songs', typing: true }))).toBeNull()
    expect(resolveHotkey(ev('/'), opts({ typing: true }))).toBeNull()
    expect(resolveHotkey(ev('Backspace', { ctrl: true }), opts({ typing: true }))).toEqual({ id: 'field.clear' })
  })
  it('typing suppresses digit blocks', () => {
    expect(resolveHotkey(ev('3'), opts({ scope: 'songs', typing: true }))).toBeNull()
    expect(resolveHotkey(ev('3'), opts({ scope: 'scripture', typing: true }))).toBeNull()
  })
  it('overrides replace defaults', () => {
    const overrides = { 'song.bridge': ['X'] }
    expect(resolveHotkey(ev('b'), opts({ scope: 'songs', overrides }))).toBeNull()
    expect(resolveHotkey(ev('x'), opts({ scope: 'songs', overrides }))).toEqual({ id: 'song.bridge' })
  })
  it('mode scope beats global on a collision', () => {
    // Override bridge onto '/' which is global focus.search by default.
    const overrides = { 'song.bridge': ['/'] }
    expect(resolveHotkey(ev('/'), opts({ scope: 'songs', overrides }))).toEqual({ id: 'song.bridge' })
    expect(resolveHotkey(ev('/'), opts({ scope: 'scripture', overrides }))).toEqual({ id: 'focus.search' })
  })
})

describe('bindingConflict', () => {
  it('flags a clash inside the same scope', () => {
    expect(bindingConflict('C', 'song.tag', {})?.id).toBe('song.chorus')
  })
  it('flags a global↔mode clash both directions', () => {
    expect(bindingConflict('Home', 'go.live', {})?.id).toBe('song.chorus')
    expect(bindingConflict('Enter', 'song.tag', {})?.id).toBe('go.live')
  })
  it('digit-block keys are protected', () => {
    expect(bindingConflict('4', 'song.chorus', {})?.id).toBe('song.verse')
  })
  it('songs↔scripture do not clash (different pages)', () => {
    // scripture.reading holds '1'–'9', but so does song.verse — both use digit blocks but
    // in different scopes. Checking if we can bind '3' to song.verse must not see a conflict
    // with scripture.reading (even though both hold that digit).
    expect(bindingConflict('3', 'song.verse', {})).toBeNull()
  })
  it('respects overrides when detecting clashes', () => {
    expect(bindingConflict('X', 'song.tag', { 'song.bridge': ['X'] })?.id).toBe('song.bridge')
    expect(bindingConflict('B', 'song.tag', { 'song.bridge': ['X'] })).toBeNull()
  })
})

describe('formatBinding', () => {
  it('renders Mod per platform', () => {
    expect(formatBinding('Mod+L', true)).toBe('⌘L')
    expect(formatBinding('Mod+L', false)).toBe('Ctrl+L')
  })
  it('renders arrows compactly', () => {
    expect(formatBinding('ArrowRight', false)).toBe('→')
  })
})
