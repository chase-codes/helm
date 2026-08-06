import { describe, expect, it } from 'vitest'
import { chorusJump, labelJump, verseJump } from './sectionJump'
import type { SongSection } from '../types'

const sec = (label: string): SongSection => ({ label, lines: ['x'] })

const SONG = [sec('Verse 1'), sec('Chorus'), sec('Verse 2'), sec('Chorus 2'), sec('Bridge'), sec('Tag')]

describe('chorusJump', () => {
  it('goes to the first chorus from a non-chorus section', () => {
    expect(chorusJump(SONG, 0)).toBe(1)
  })
  it('cycles to the next chorus when already on one, wrapping', () => {
    expect(chorusJump(SONG, 1)).toBe(3)
    expect(chorusJump(SONG, 3)).toBe(1)
  })
  it('returns null when the song has no chorus', () => {
    expect(chorusJump([sec('Verse 1'), sec('Verse 2')], 0)).toBeNull()
  })
})

describe('labelJump', () => {
  it('finds bridge and tag by label', () => {
    expect(labelJump(SONG, 'bridge')).toBe(4)
    expect(labelJump(SONG, 'tag')).toBe(5)
  })
  it('tag also matches Ending', () => {
    expect(labelJump([sec('Verse 1'), sec('Ending')], 'tag')).toBe(1)
  })
  it('returns null when absent', () => {
    expect(labelJump([sec('Verse 1')], 'bridge')).toBeNull()
  })
})

describe('verseJump', () => {
  it('matches by verse LABEL, not card position', () => {
    // 'Verse 2' sits at index 2, not index 1.
    expect(verseJump(SONG, 2)).toBe(2)
  })
  it('returns null for a verse number the song does not have', () => {
    expect(verseJump(SONG, 7)).toBeNull()
  })
  it('does not confuse Verse 1 with Verse 11', () => {
    expect(verseJump([sec('Verse 11'), sec('Verse 1')], 1)).toBe(1)
  })
})
