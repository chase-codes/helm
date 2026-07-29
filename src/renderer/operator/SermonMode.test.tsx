// @vitest-environment jsdom
import { useRef, type JSX } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SermonMode } from './SermonMode'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { ChapterData, PresentationState } from '../../shared/types'

// This project's vitest config does not set `globals: true`, so
// @testing-library/react's auto afterEach(cleanup) never registers; without
// this, DOM from one test leaks into the next.
afterEach(cleanup)

const GENESIS_1: ChapterData = {
  book: 'Genesis',
  chapter: 1,
  verseCount: 5,
  verses: {
    1: { kjv: 'In the beginning' },
    2: { kjv: 'And the earth was without form' },
    3: { kjv: 'And God said, Let there be light' },
    4: { kjv: 'And God saw the light' },
    5: { kjv: 'And God called the light Day' }
  }
}

const NOTHING_LIVE: PresentationState = { output: 'black', liveKey: null, liveSnap: null }
const GEN_1_1_LIVE: PresentationState = {
  output: 'live',
  liveKey: 'scr:Genesis:1:1',
  liveSnap: { kind: 'scripture', accent: '#6f9cf0', ref: 'Genesis 1:1', label: 'Genesis 1:1', columns: [] }
}

function installHelmStub(pres: PresentationState = NOTHING_LIVE): {
  show: ReturnType<typeof vi.fn>
  goLive: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  resolveChapter: () => void
} {
  const show = vi.fn()
  const goLive = vi.fn()
  const add = vi.fn(() => Promise.resolve([]))
  let release: () => void = () => {}
  // One pending promise shared by both getChapter call sites (live + preview), so the
  // chapter stays unresolved until the test releases it.
  const pending = new Promise<ChapterData>((res) => {
    release = () => res(GENESIS_1)
  })
  ;(window as unknown as { helm: unknown }).helm = {
    settings: { get: () => Promise.resolve(['kjv']), set: vi.fn() },
    schedule: { list: () => Promise.resolve([]), add, remove: vi.fn(() => Promise.resolve([])) },
    bibles: {
      manifest: () => Promise.resolve([{ id: 'kjv', abbr: 'KJV', name: 'King James', installed: true }]),
      getChapter: () => pending,
      bookExtent: () => Promise.resolve({ chapters: 50, verseCounts: Array(50).fill(31) }),
      onProgress: () => () => {}
    },
    presentation: {
      get: () => Promise.resolve(pres),
      onState: () => () => {},
      show,
      goLive,
      setOutput: vi.fn(),
      cue: vi.fn()
    }
  }
  return { show, goLive, add, resolveChapter: release }
}

function Harness(): JSX.Element {
  const keyHandlerRef = useRef(null)
  return (
    <ThemeCtx.Provider value={themeFor('dark')}>
      <SermonMode
        themeMode="dark"
        keyHandlerRef={keyHandlerRef}
        active
        onOpenSettings={() => {}}
        biblesRevision={0}
      />
    </ThemeCtx.Provider>
  )
}

const entry = (): HTMLElement => screen.getByPlaceholderText('Add reading — John 3:16')
const verseCard = (n: number): HTMLElement =>
  screen.getByText(`Verse ${n}`).closest('button') as HTMLElement

describe('SermonMode — direct preview to live', () => {
  it('does not touch the projector while the chapter fetch is unresolved', async () => {
    const { show, resolveChapter } = installHelmStub()
    render(<Harness />)
    // Let every mount effect run and settle with the chapter still pending.
    await waitFor(() => expect(screen.getByPlaceholderText('Add reading — John 3:16')).toBeTruthy())
    expect(show).not.toHaveBeenCalled()

    resolveChapter()
    await waitFor(() => expect(show).toHaveBeenCalled())
    expect(show.mock.calls[0][0]).toBe('scr:Genesis:1:1')
  })

  it('a rail tap shows the tapped verse and writes no schedule row', async () => {
    const { show, add, resolveChapter } = installHelmStub()
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(show).toHaveBeenCalled())
    show.mockClear()

    fireEvent.click(verseCard(3))
    await waitFor(() => expect(show).toHaveBeenCalled())
    expect(show.mock.calls[0][0]).toBe('scr:Genesis:1:3')
    expect(add).not.toHaveBeenCalled()
  })

  it('Shift+Enter on the reference already live does not blank the projector', async () => {
    const { goLive, resolveChapter } = installHelmStub(GEN_1_1_LIVE)
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    // Empty entry -> addRef is the cursor, Genesis 1:1, which is what's already live.
    fireEvent.keyDown(entry(), { key: 'Enter', shiftKey: true })
    await waitFor(() => expect(goLive).not.toHaveBeenCalled())
  })

  it('Enter files a schedule row and never reaches the projector', async () => {
    const { goLive, show, add, resolveChapter } = installHelmStub()
    render(<Harness />)
    resolveChapter()
    // Settle on `show` itself, not a DOM signal like "Verse 1" text — the mount-time
    // passive effect that calls `show` can still be pending after the chapter text
    // has already painted, and mockClear() below would then clear zero calls while
    // that effect is still in flight, letting it fire later and land right after Enter.
    await waitFor(() => expect(show).toHaveBeenCalled())
    show.mockClear()

    fireEvent.keyDown(entry(), { key: 'Enter' })
    await waitFor(() => expect(add).toHaveBeenCalled())
    expect(add.mock.calls[0][0]).toEqual({ book: 'Genesis', ch: 1, from: 1, to: 1 })
    expect(goLive).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()
  })
})
