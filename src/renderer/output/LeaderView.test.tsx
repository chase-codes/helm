// @vitest-environment jsdom
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LeaderView } from './LeaderView'
import type { OutputPayload, PresentationState, Song } from '../../shared/types'

afterEach(cleanup)

const SONG: Song = {
  id: 's1',
  title: 'Amazing Grace',
  author: 'John Newton',
  source: 'manual',
  createdAt: 0,
  sections: [
    { label: 'Verse 1', lines: ['Amazing grace how sweet the sound'] },
    { label: 'Verse 2', lines: ['Twas grace that taught my heart to fear'] }
  ]
}

function installHelmStub(state: PresentationState): void {
  ;(window as unknown as { helm: unknown }).helm = {
    presentation: { get: () => Promise.resolve(state), onState: () => () => {} },
    songs: { get: (id: string) => Promise.resolve(id === 's1' ? SONG : null) }
  }
}
const payload = (state: PresentationState): OutputPayload => ({
  slide: state.liveSnap ?? { kind: 'black' },
  variant: 'stage',
  view: 'leader'
})

describe('LeaderView', () => {
  it('renders hero lines, title, and the section rail with the live section highlighted', async () => {
    const st: PresentationState = {
      output: 'live',
      liveKey: 'song:s1:1',
      liveSnap: {
        kind: 'lyrics',
        accent: '#e0a341',
        label: 'Amazing Grace · Verse 2',
        lines: SONG.sections[1].lines
      }
    }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    // Wait on a marker that only the real (post-fetch) render produces — the fallback
    // SlidesView renders `payload.slide` directly, whose lyric text is identical to the
    // fetched section's, so waiting on the lyric text itself would resolve on the
    // synchronous fallback pass and race the async song fetch.
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    // The live line appears twice (hero + rail snippet) — assert presence, not uniqueness.
    expect(r.getAllByText('Twas grace that taught my heart to fear').length).toBeGreaterThan(0)
    expect(r.getByText('Amazing Grace')).toBeTruthy()
    expect(r.getByTestId('leader-section-1').dataset.live).toBe('true')
    expect(r.getByTestId('leader-section-0').dataset.live).toBe('false')
  })

  it('keeps the song up and shows a status chip while the projector is on logo', async () => {
    const st: PresentationState = {
      output: 'logo',
      liveKey: 'song:s1:0',
      liveSnap: {
        kind: 'lyrics',
        accent: '#e0a341',
        label: 'Amazing Grace · Verse 1',
        lines: SONG.sections[0].lines
      }
    }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    // 'LOGO' only renders once the real leader view mounts (see note above).
    await waitFor(() => expect(r.getByText('LOGO')).toBeTruthy())
    expect(r.getAllByText('Amazing grace how sweet the sound').length).toBeGreaterThan(0)
  })

  it('falls back to the slides render for non-song content', async () => {
    const st: PresentationState = {
      output: 'live',
      liveKey: 'scr:kjv:John:3',
      liveSnap: {
        kind: 'scripture',
        accent: '#7fb069',
        ref: 'John 3:16',
        columns: [{ version: 'KJV', text: 'For God so loved the world' }]
      }
    }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByText('For God so loved the world')).toBeTruthy())
    expect(r.queryByTestId('leader-rail')).toBeNull()
  })

  it('falls back to the slides render when the song has been deleted', async () => {
    const st: PresentationState = {
      output: 'live',
      liveKey: 'song:GONE:0',
      liveSnap: { kind: 'lyrics', accent: '#e0a341', label: 'x', lines: ['orphan line'] }
    }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByText('orphan line')).toBeTruthy())
    expect(r.queryByTestId('leader-rail')).toBeNull()
  })

  it('does not attribute the outgoing song to the incoming live key while the new song is still fetching', async () => {
    const SONG_B: Song = {
      id: 's2',
      title: 'How Great Thou Art',
      author: 'Stuart K. Hine',
      source: 'manual',
      createdAt: 0,
      sections: [{ label: 'Verse 1', lines: ['O Lord my God'] }]
    }
    let resolveB: (s: Song | null) => void = () => {}
    const bFetch = new Promise<Song | null>((res) => {
      resolveB = res
    })
    const stA: PresentationState = {
      output: 'live',
      liveKey: 'song:s1:0',
      liveSnap: {
        kind: 'lyrics',
        accent: '#e0a341',
        label: 'Amazing Grace · Verse 1',
        lines: SONG.sections[0].lines
      }
    }
    const stB: PresentationState = {
      output: 'live',
      liveKey: 'song:s2:0',
      liveSnap: {
        kind: 'lyrics',
        accent: '#6f9cf0',
        label: 'How Great Thou Art · Verse 1',
        lines: SONG_B.sections[0].lines
      }
    }
    let pushState: (s: PresentationState) => void = () => {}
    ;(window as unknown as { helm: unknown }).helm = {
      presentation: {
        get: () => Promise.resolve(stA),
        onState: (cb: (s: PresentationState) => void) => {
          pushState = cb
          return () => {}
        }
      },
      songs: {
        get: (id: string) =>
          id === 's1' ? Promise.resolve(SONG) : id === 's2' ? bFetch : Promise.resolve(null)
      }
    }

    const r = render(<LeaderView payload={payload(stA)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    expect(r.getByText('Amazing Grace')).toBeTruthy()

    // Song A -> song B, direct switch: `liveKey`/`payload` move to B immediately, but B's
    // `songs.get` hasn't resolved yet. The old song (A) must not render under B's live key.
    act(() => pushState(stB))
    r.rerender(<LeaderView payload={payload(stB)} />)
    expect(r.queryByTestId('leader-rail')).toBeNull()
    expect(r.queryByText('Amazing Grace')).toBeNull()
    expect(r.getAllByText('O Lord my God').length).toBeGreaterThan(0) // SlidesView fallback showing B's live slide

    resolveB(SONG_B)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    expect(r.getByText('How Great Thou Art')).toBeTruthy()
    expect(r.queryByText('Amazing Grace')).toBeNull()
  })
})
