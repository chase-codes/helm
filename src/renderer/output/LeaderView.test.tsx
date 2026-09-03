// @vitest-environment jsdom
import { render, cleanup, waitFor, act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeaderView } from './LeaderView'
import type { OutputPayload, PresentationState, Song } from '../../shared/types'

afterEach(cleanup)

const SONG: Song = {
  id: 's1',
  title: 'Amazing Grace',
  author: 'John Newton',
  source: 'manual',
  createdAt: 0,
  key: 'D',
  sections: [
    { label: 'Verse 1', lines: ['Amazing grace how sweet the sound'] },
    { label: 'Verse 2', lines: ['Twas grace that taught my heart to fear'] },
    { label: 'Chorus', lines: ['line one', 'line two'] }
  ]
}

function installHelmStub(state: PresentationState): void {
  ;(window as unknown as { helm: unknown }).helm = {
    presentation: { get: () => Promise.resolve(state), onState: () => () => {} },
    songs: { get: (id: string) => Promise.resolve(id === 's1' ? SONG : null) },
    displays: { setLeaderSplit: vi.fn() }
  }
}
const payload = (state: PresentationState): OutputPayload => ({
  slide: state.liveSnap ?? { kind: 'black' },
  variant: 'stage',
  view: 'leader',
  leaderSplit: 320
})

const scriptureSnap = (v: number): PresentationState['liveSnap'] => ({
  kind: 'scripture',
  accent: '#f0b24a',
  ref: `John 3:${v}`,
  label: `John 3:${v}`,
  columns: [{ version: 'KJV', text: `Verse ${['one', 'two', 'three'][v - 1]} text` }]
})
const scriptureState = (output: PresentationState['output'], v: number): PresentationState => ({
  output,
  liveKey: `scr:John:3:${v}`,
  liveSnap: scriptureSnap(v),
  cuedKey: `scr:John:3:${v}`,
  cuedSnap: scriptureSnap(v)
})
function installScriptureStub(state: PresentationState): void {
  ;(window as unknown as { helm: unknown }).helm = {
    presentation: { get: () => Promise.resolve(state), onState: () => () => {} },
    songs: { get: () => Promise.resolve(null) },
    bibles: {
      manifest: () => Promise.resolve([{ id: 'kjv', abbr: 'KJV', name: 'King James', installed: true }]),
      getChapter: (book: string, ch: number) =>
        Promise.resolve(
          book === 'John' && ch === 3
            ? {
                book,
                chapter: ch,
                verseCount: 3,
                verses: {
                  1: { kjv: 'Verse one text' },
                  2: { kjv: 'Verse two text' },
                  3: { kjv: 'Verse three text' }
                }
              }
            : { book, chapter: ch, verseCount: 0, verses: {} }
        )
    },
    displays: { setLeaderSplit: vi.fn() }
  }
}

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
      },
      cuedKey: 'song:s1:1',
      cuedSnap: {
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
    // The live line appears twice (hero + rail full-line) — assert presence, not uniqueness.
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
      },
      cuedKey: 'song:s1:0',
      cuedSnap: {
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
    // The hero tracks the cue, but the output isn't 'live' on this display, so the
    // status chip reads CUED, not LIVE.
    expect(r.getByText('CUED')).toBeTruthy()
    expect(r.queryByText('LIVE')).toBeNull()
  })

  it('falls back to the slides render for content that is neither song nor scripture', async () => {
    const st: PresentationState = {
      output: 'live',
      liveKey: 'msg:q1:0',
      liveSnap: { kind: 'quote', accent: '#6f9cf0', text: 'A quoted line', source: 'Someone' },
      cuedKey: 'msg:q1:0',
      cuedSnap: { kind: 'quote', accent: '#6f9cf0', text: 'A quoted line', source: 'Someone' }
    }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByText('A quoted line')).toBeTruthy())
    expect(r.queryByTestId('leader-rail')).toBeNull()
  })

  it('renders the scripture hero and chapter rail with the live verse highlighted (#188)', async () => {
    const st = scriptureState('live', 2)
    installScriptureStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    // Hero shows the projected slide (ref + verse text); rail shows the whole chapter so
    // the leader can read ahead — including verses that are not live yet.
    expect(r.getAllByText('John 3:2').length).toBeGreaterThan(0)
    expect(r.getAllByText('Verse two text').length).toBeGreaterThan(0)
    expect(r.getByTestId('leader-verse-2').dataset.live).toBe('true')
    expect(r.getByTestId('leader-verse-1').dataset.live).toBe('false')
    expect(r.getByTestId('leader-rail').textContent).toContain('Verse three text')
    expect(r.getByText('LIVE')).toBeTruthy()
  })

  it('follows the cued verse while output is down so the operator can walk the leader through (#188)', async () => {
    const st: PresentationState = {
      output: 'black',
      liveKey: 'scr:John:3:1',
      liveSnap: scriptureSnap(1),
      cuedKey: 'scr:John:3:3',
      cuedSnap: scriptureSnap(3)
    }
    installScriptureStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    expect(r.getByTestId('leader-verse-3').dataset.live).toBe('true')
    expect(r.getByTestId('leader-verse-1').dataset.live).toBe('false')
    expect(r.getByText('CUED')).toBeTruthy()
    expect(r.getByText('BLACK')).toBeTruthy()
  })

  it('keeps the cued verse up while the chapter is still fetching — never a black flash (#188 review)', async () => {
    const st = scriptureState('black', 2)
    installScriptureStub(st)
    // Chapter fetch never resolves (a cross-chapter IPC round trip, or a failed fetch):
    // the leader must render the cued snap's verse text, not fall through to the black
    // payload slide. Model the real payload: with output black, outputPayload sends
    // {kind:'black'}, NOT the snap — so the SlidesView fallback here is a black screen.
    ;(window as unknown as { helm: { bibles: { getChapter: () => Promise<never> } } }).helm.bibles.getChapter = () =>
      new Promise<never>(() => {})
    const r = render(<LeaderView payload={{ ...payload(st), slide: { kind: 'black' } }} />)
    await waitFor(() => expect(r.getAllByText('Verse two text').length).toBeGreaterThan(0))
    expect(r.queryByTestId('leader-rail')).toBeNull()
  })

  it('renders the bare slide when the shown verse is outside the chapter (#188 review)', async () => {
    const st: PresentationState = {
      output: 'live',
      liveKey: 'scr:John:3:9',
      liveSnap: { kind: 'scripture', accent: '#f0b24a', ref: 'John 3:9', label: 'John 3:9', columns: [] },
      cuedKey: 'scr:John:3:9',
      cuedSnap: { kind: 'scripture', accent: '#f0b24a', ref: 'John 3:9', label: 'John 3:9', columns: [] }
    }
    installScriptureStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    // Chapter has 3 verses; verse 9 can't be highlighted, so a rail with every card dark
    // would be a lie — degrade to the bare slide like a mid-fetch song. Flush until the
    // chapter fetch has landed (waiting on the ref text alone would resolve on the
    // pre-fetch fallback pass and race the getChapter promise).
    await act(async () => {})
    await act(async () => {})
    expect(r.getAllByText('John 3:9').length).toBeGreaterThan(0)
    expect(r.queryByTestId('leader-rail')).toBeNull()
  })

  it('hero renders the audience scripture slide even on a livestream-variant display (#188 review)', async () => {
    const st = scriptureState('live', 2)
    installScriptureStub(st)
    const r = render(<LeaderView payload={{ ...payload(st), variant: 'livestream' }} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    // The livestream variant renders a chroma-key lower third with no verse body — the
    // leader hero must show the full verse regardless of the display's role. The verse
    // text appears in the rail too, so require BOTH (hero + rail card).
    expect(r.getAllByText('Verse two text').length).toBeGreaterThan(1)
  })

  it('rail sticks to the projected translation and never silently swaps versions (#188 review)', async () => {
    const st = scriptureState('live', 1)
    installScriptureStub(st)
    ;(window as unknown as { helm: { bibles: { manifest: () => unknown; getChapter: () => unknown } } }).helm.bibles = {
      manifest: () =>
        Promise.resolve([
          { id: 'web', abbr: 'WEB', name: 'World English', installed: true },
          { id: 'kjv', abbr: 'KJV', name: 'King James', installed: true }
        ]),
      getChapter: () =>
        Promise.resolve({
          book: 'John',
          chapter: 3,
          verseCount: 3,
          verses: {
            1: { kjv: 'K one', web: 'W one' },
            2: { web: 'W two' }, // absent from the projected (KJV) translation
            3: { kjv: 'K three', web: 'W three' }
          }
        })
    }
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    const rail = r.getByTestId('leader-rail')
    // Snap's primary column is KJV — the rail follows it, not manifest order.
    expect(rail.textContent).toContain('K one')
    expect(rail.textContent).toContain('K three')
    // A verse the projected translation omits stays blank rather than silently showing
    // another translation's text.
    expect(rail.textContent).not.toContain('W two')
  })

  it('auto-scrolls the live verse card into view (#188)', async () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    const st = scriptureState('live', 2)
    installScriptureStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    await waitFor(() => expect(spy).toHaveBeenCalled())
  })

  it('falls back to the slides render when the song has been deleted', async () => {
    const st: PresentationState = {
      output: 'live',
      liveKey: 'song:GONE:0',
      liveSnap: { kind: 'lyrics', accent: '#e0a341', label: 'x', lines: ['orphan line'] },
      cuedKey: 'song:GONE:0',
      cuedSnap: { kind: 'lyrics', accent: '#e0a341', label: 'x', lines: ['orphan line'] }
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
      },
      cuedKey: 'song:s1:0',
      cuedSnap: {
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
      },
      cuedKey: 'song:s2:0',
      cuedSnap: {
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
      },
      displays: { setLeaderSplit: vi.fn() }
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

  it('stays locked to the live section while a different section is cued (browsing cannot move it)', async () => {
    const st: PresentationState = {
      output: 'live',
      liveKey: 'song:s1:0',
      liveSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines },
      cuedKey: 'song:s1:1',
      cuedSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Verse 2', lines: SONG.sections[1].lines }
    }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    // Hero shows the LIVE section (Verse 1), not the cued one.
    expect(r.getByTestId('leader-section-0').dataset.live).toBe('true')
    expect(r.getByTestId('leader-section-1').dataset.live).toBe('false')
    expect(r.getByText('LIVE')).toBeTruthy()
    expect(r.queryByText('CUED')).toBeNull()
  })
  it('follows the cued selection while output is down (prep view)', async () => {
    const st: PresentationState = {
      output: 'black',
      liveKey: 'song:s1:0',
      liveSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines },
      cuedKey: 'song:s1:1',
      cuedSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Verse 2', lines: SONG.sections[1].lines }
    }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    expect(r.getByTestId('leader-section-1').dataset.live).toBe('true')
    expect(r.getByText('CUED')).toBeTruthy()
    expect(r.getByText('BLACK')).toBeTruthy()
  })

  it('shows LIVE when the displayed section is what the congregation sees', async () => {
    const snap = { kind: 'lyrics' as const, accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines }
    const st: PresentationState = { output: 'live', liveKey: 'song:s1:0', liveSnap: snap, cuedKey: 'song:s1:0', cuedSnap: snap }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByText('LIVE')).toBeTruthy())
  })

  it('renders every line of every section in the rail', async () => {
    const st: PresentationState = {
      output: 'live',
      liveKey: 'song:s1:2',
      liveSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Chorus', lines: SONG.sections[2].lines },
      cuedKey: 'song:s1:2',
      cuedSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Chorus', lines: SONG.sections[2].lines }
    }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    const rail = r.getByTestId('leader-rail')
    expect(rail.textContent).toContain('line two')
  })

  it('shows the song key in the title row when set', async () => {
    const st: PresentationState = {
      output: 'live',
      liveKey: 'song:s1:0',
      liveSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines },
      cuedKey: 'song:s1:0',
      cuedSnap: { kind: 'lyrics', accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines }
    }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    expect(r.getByText(/Key D/)).toBeTruthy()
  })

  it('sizes the rail from payload.leaderSplit', async () => {
    const snap = { kind: 'lyrics' as const, accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines }
    const st: PresentationState = { output: 'live', liveKey: 'song:s1:0', liveSnap: snap, cuedKey: 'song:s1:0', cuedSnap: snap }
    installHelmStub(st)
    const r = render(<LeaderView payload={{ ...payload(st), leaderSplit: 400 }} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    expect(r.getByTestId('leader-rail').style.width).toBe('400px')
  })

  it('gives hero lyric lines the nowrap contract', async () => {
    const snap = { kind: 'lyrics' as const, accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines }
    const st: PresentationState = { output: 'live', liveKey: 'song:s1:0', liveSnap: snap, cuedKey: 'song:s1:0', cuedSnap: snap }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    // The same line text appears in both the hero and the rail — the nowrap contract only
    // applies to the hero, so assert at least one match carries it rather than requiring
    // uniqueness.
    const lines = r.getAllByText('Amazing grace how sweet the sound')
    expect(lines.some((el) => (el as HTMLElement).style.whiteSpace === 'nowrap')).toBe(true)
  })

  it('pads the hero symmetrically so centered lyrics sit on the panel center', async () => {
    const snap = { kind: 'lyrics' as const, accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines }
    const st: PresentationState = { output: 'live', liveKey: 'song:s1:0', liveSnap: snap, cuedKey: 'song:s1:0', cuedSnap: snap }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    // The hero wrap is the first child of the root; its content centers within the padded
    // box, so unequal horizontal padding shifts the optical center off the panel center.
    const hero = r.getByTestId('leader-view').firstElementChild as HTMLElement
    expect(hero.style.paddingLeft).toBe(hero.style.paddingRight)
  })

  it('follows a changed payload.leaderSplit on rerender when not dragging', async () => {
    const snap = { kind: 'lyrics' as const, accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines }
    const st: PresentationState = { output: 'live', liveKey: 'song:s1:0', liveSnap: snap, cuedKey: 'song:s1:0', cuedSnap: snap }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    expect(r.getByTestId('leader-rail').style.width).toBe('320px')
    // A real prop change (not a drag) — e.g. another window's operator moved the split, or the
    // main process pushed a resolved default — must be picked up on the next render.
    r.rerender(<LeaderView payload={{ ...payload(st), leaderSplit: 450 }} />)
    expect(r.getByTestId('leader-rail').style.width).toBe('450px')
  })

  it('drags the divider to resize the rail and commits via setLeaderSplit on release', async () => {
    const snap = { kind: 'lyrics' as const, accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines }
    const st: PresentationState = { output: 'live', liveKey: 'song:s1:0', liveSnap: snap, cuedKey: 'song:s1:0', cuedSnap: snap }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    const divider = r.getByTestId('leader-divider')
    // Rail is right-anchored: dragging left (clientX decreases) grows it. Start split is 320
    // (from payload); moving 100px left should grow it to 420.
    fireEvent.mouseDown(divider, { clientX: 500 })
    fireEvent.mouseMove(window, { clientX: 400 })
    expect(r.getByTestId('leader-rail').style.width).toBe('420px')
    fireEvent.mouseUp(window)
    expect(r.getByTestId('leader-rail').style.width).toBe('420px')
    const helm = (window as unknown as { helm: { displays: { setLeaderSplit: (fp: string | null, px: number) => void } } }).helm
    expect(helm.displays.setLeaderSplit).toHaveBeenCalledWith(null, 420)
  })

  it('does not let a mid-drag payload.leaderSplit change (e.g. the commit echo) clobber the drag on release', async () => {
    const snap = { kind: 'lyrics' as const, accent: '#e0a341', label: 'Amazing Grace · Verse 1', lines: SONG.sections[0].lines }
    const st: PresentationState = { output: 'live', liveKey: 'song:s1:0', liveSnap: snap, cuedKey: 'song:s1:0', cuedSnap: snap }
    installHelmStub(st)
    const r = render(<LeaderView payload={payload(st)} />)
    await waitFor(() => expect(r.getByTestId('leader-rail')).toBeTruthy())
    const divider = r.getByTestId('leader-divider')
    fireEvent.mouseDown(divider, { clientX: 500 })
    fireEvent.mouseMove(window, { clientX: 400 }) // drags the rail to 420px
    expect(r.getByTestId('leader-rail').style.width).toBe('420px')
    // A stale payload value lands mid-drag (a real echo would eventually carry the drag's own
    // value, but any value arriving before release — including an unrelated update — must not
    // fight the live drag).
    r.rerender(<LeaderView payload={{ ...payload(st), leaderSplit: 275 }} />)
    expect(r.getByTestId('leader-rail').style.width).toBe('420px')
    fireEvent.mouseUp(window)
    // The dragged width survives release: the mid-drag payload value was absorbed into the
    // "already seen" mirror without being re-applied once dragging stops.
    expect(r.getByTestId('leader-rail').style.width).toBe('420px')
  })
})
