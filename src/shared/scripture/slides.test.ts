import { expect, test } from 'vitest'
import { keyForScripture, verseCols, buildScriptureSlide } from './slides'

test('keyForScripture format', () => {
  expect(keyForScripture('John', 3, 16)).toBe('scr:John:3:16')
  expect(keyForScripture('Genesis', 1, 1)).toBe('scr:Genesis:1:1')
})

test('buildScriptureSlide shape', () => {
  const columns: { version: string; text: string }[] = [
    { version: 'KJV', text: 'For God so loved the world' }
  ]
  const slide = buildScriptureSlide('John 3:16', columns)
  expect(slide.kind).toBe('scripture')
  expect(slide.accent).toBe('#6f9cf0')
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
