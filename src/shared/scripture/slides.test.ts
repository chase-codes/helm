import { expect, test } from 'vitest'
import { keyForScripture, parseScriptureKey, verseCols, buildScriptureSlide, pickVersion } from './slides'

test('keyForScripture format', () => {
  expect(keyForScripture('John', 3, 16)).toBe('scr:John:3:16')
  expect(keyForScripture('Genesis', 1, 1)).toBe('scr:Genesis:1:1')
})

test('parseScriptureKey round-trips keyForScripture', () => {
  expect(parseScriptureKey(keyForScripture('John', 3, 16))).toEqual({ book: 'John', ch: 3, v: 16 })
})

test('parseScriptureKey handles book names with spaces and digits', () => {
  expect(parseScriptureKey('scr:1 John:4:8')).toEqual({ book: '1 John', ch: 4, v: 8 })
  expect(parseScriptureKey('scr:Song of Solomon:2:1')).toEqual({ book: 'Song of Solomon', ch: 2, v: 1 })
})

test('parseScriptureKey rejects non-scripture and malformed keys', () => {
  expect(parseScriptureKey(null)).toBeNull()
  expect(parseScriptureKey('song:s1:0')).toBeNull()
  expect(parseScriptureKey('scr:John:3')).toBeNull() // missing verse
  expect(parseScriptureKey('scr:kjv:John:3')).toBeNull() // chapter segment not a number
  expect(parseScriptureKey('scr::3:16')).toBeNull() // empty book
  expect(parseScriptureKey('scr:John:0:16')).toBeNull() // chapters are 1-based
  expect(parseScriptureKey('scr:John:3:0')).toBeNull() // verses are 1-based
})

test('buildScriptureSlide shape', () => {
  const columns: { version: string; text: string }[] = [
    { version: 'KJV', text: 'For God so loved the world' }
  ]
  const slide = buildScriptureSlide('John 3:16', columns)
  expect(slide.kind).toBe('scripture')
  // Canvas gold, not scripture blue: the blue was the dimmest element on the slide (#48).
  expect(slide.accent).toBe('#f0b24a')
  expect(slide.ref).toBe('John 3:16')
  expect(slide.label).toBe('John 3:16')
  expect(slide.columns).toEqual(columns)
})

test('verseCols preserves selection order', () => {
  const textByVersion = {
    kjv: 'King James text',
    niv: 'New International text',
    esv: 'English Standard text'
  }
  const selected = ['niv', 'kjv']
  const result = verseCols(textByVersion, selected, (id) => id.toUpperCase())
  expect(result).toEqual([
    { version: 'NIV', text: 'New International text' },
    { version: 'KJV', text: 'King James text' }
  ])
})

test('verseCols skips missing texts', () => {
  const textByVersion = {
    kjv: 'King James text',
    niv: '',
    esv: 'English Standard text'
  }
  const selected = ['niv', 'kjv', 'esv']
  const result = verseCols(textByVersion, selected, (id) => id.toUpperCase())
  expect(result).toEqual([
    { version: 'KJV', text: 'King James text' },
    { version: 'ESV', text: 'English Standard text' }
  ])
})

test('verseCols returns empty when nothing installed', () => {
  const textByVersion = {}
  const selected = ['kjv', 'niv']
  const result = verseCols(textByVersion, selected, (id) => id.toUpperCase())
  expect(result).toEqual([])
})

test('pickVersion removes a selected id', () => {
  expect(pickVersion(['kjv', 'web'], 'kjv')).toEqual(['web'])
})

test('pickVersion never drops below one selected', () => {
  expect(pickVersion(['kjv'], 'kjv')).toEqual(['kjv'])
})

test('pickVersion appends when fewer than two are selected', () => {
  expect(pickVersion(['kjv'], 'web')).toEqual(['kjv', 'web'])
})

test('pickVersion replaces the compare slot when two are already selected', () => {
  expect(pickVersion(['kjv', 'web'], 'asv')).toEqual(['kjv', 'asv'])
})

test('pickVersion removing the compare slot leaves the primary', () => {
  expect(pickVersion(['kjv', 'web'], 'web')).toEqual(['kjv'])
})
