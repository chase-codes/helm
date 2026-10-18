import { describe, expect, it } from 'vitest'
import { pageOfKey, screenStatus } from './screenOwner'
import { keyForSong } from './core'
import { keyForScripture } from '../scripture/slides'
import { keyForMessageQuote, keyForReading } from '../message/slides'
import { keyForMedia } from '../media/slides'

describe('pageOfKey', () => {
  it('maps every live-key kind to the Header tab that owns it', () => {
    expect(pageOfKey(keyForSong('s1', 0))).toBe('songs')
    expect(pageOfKey(keyForScripture('John', 3, 16))).toBe('sermon')
    expect(pageOfKey(keyForMessageQuote('m1', 2))).toBe('sermon')
    expect(pageOfKey(keyForReading('m1'))).toBe('sermon')
    expect(pageOfKey(keyForMedia('d1', 0))).toBe('sermon')
    expect(pageOfKey('pre:c1')).toBe('pre')
  })

  it('returns null for no key or a kind no page claims', () => {
    expect(pageOfKey(null)).toBeNull()
    expect(pageOfKey('mystery:1')).toBeNull()
  })
})

describe('screenStatus (decision 6)', () => {
  const live = (liveKey: string | null): { output: 'live'; liveKey: string | null } => ({ output: 'live' as const, liveKey })

  it("reads LIVE ON SCREEN for the page's own content", () => {
    expect(screenStatus(live('song:s1:0'), 'songs')).toEqual({ text: 'LIVE ON SCREEN', tone: 'live' })
    expect(screenStatus(live('pres:d1:0'), 'sermon')).toEqual({ text: 'LIVE ON SCREEN', tone: 'live' })
  })

  it('names the owning page, in the faint tone, for anything else', () => {
    expect(screenStatus(live('scr:John:3:16'), 'songs')).toEqual({ text: 'LIVE FROM SERMON', tone: 'elsewhere' })
    expect(screenStatus(live('song:s1:0'), 'pre')).toEqual({ text: 'LIVE FROM SONGS', tone: 'elsewhere' })
    expect(screenStatus(live('pre:c1'), 'sermon')).toEqual({ text: 'LIVE FROM PRE-SERVICE', tone: 'elsewhere' })
  })

  it('reads NOTHING ON SCREEN when black, whatever key lingers behind it', () => {
    expect(screenStatus({ output: 'black', liveKey: 'song:s1:0' }, 'songs')).toEqual({ text: 'NOTHING ON SCREEN', tone: 'black' })
  })

  it('keeps LOGO ON SCREEN for the logo state', () => {
    expect(screenStatus({ output: 'logo', liveKey: null }, 'pre')).toEqual({ text: 'LOGO ON SCREEN', tone: 'logo' })
  })

  it('falls back to LIVE ON SCREEN for a live key no page claims, rather than guessing a page', () => {
    expect(screenStatus(live('mystery:1'), 'songs')).toEqual({ text: 'LIVE ON SCREEN', tone: 'live' })
  })
})
