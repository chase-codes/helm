// @vitest-environment jsdom
import { useRef, type JSX } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SermonMode } from './SermonMode'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { ChapterData, PresentationState, ScriptureReading } from '../../shared/types'

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

function installHelmStub(
  pres: PresentationState = NOTHING_LIVE,
  schedule: ScriptureReading[] = []
): {
  show: ReturnType<typeof vi.fn>
  goLive: ReturnType<typeof vi.fn>
  setOutput: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  resolveChapter: () => void
} {
  const show = vi.fn()
  const goLive = vi.fn()
  const setOutput = vi.fn()
  const add = vi.fn(() => Promise.resolve([]))
  let release: () => void = () => {}
  // One pending promise shared by both getChapter call sites (live + preview), so the
  // chapter stays unresolved until the test releases it.
  const pending = new Promise<ChapterData>((res) => {
    release = () => res(GENESIS_1)
  })
  ;(window as unknown as { helm: unknown }).helm = {
    settings: { get: () => Promise.resolve(['kjv']), set: vi.fn() },
    schedule: { list: () => Promise.resolve(schedule), add, remove: vi.fn(() => Promise.resolve([])) },
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
      setOutput,
      cue: vi.fn()
    }
  }
  return { show, goLive, setOutput, add, resolveChapter: release }
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
const entryValue = (): string => (entry() as HTMLInputElement).value
const verseCard = (n: number): HTMLElement =>
  screen.getByText(`Verse ${n}`).closest('button') as HTMLElement
// The entry is driven by the structural builder, not by input events — every printable
// keystroke goes through onEntryKeyDown/applyKey — so type it a character at a time.
const typeInEntry = (text: string): void => {
  for (const ch of text) fireEvent.keyDown(entry(), { key: ch })
}

describe('SermonMode — direct preview to live', () => {
  it('does not touch the projector while the chapter fetch is unresolved', async () => {
    const { show, resolveChapter } = installHelmStub()
    render(<Harness />)
    // The entry field is rendered by SchedulePanel unconditionally, synchronously on
    // mount, regardless of the chapter fetch — so waiting for it is a cheap way to let
    // mount effects run without depending on anything chapter-fetch-shaped.
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

  it('Shift+Enter on the reference already live still moves the cursor to it', async () => {
    const { goLive, resolveChapter } = installHelmStub(GEN_1_1_LIVE)
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 3')).toBeTruthy())

    // Cursor to verse 3, so the hero and the projector (Genesis 1:1) disagree.
    fireEvent.click(verseCard(3))
    await waitFor(() => expect(screen.getByText('Genesis 1:3')).toBeTruthy())

    // Name the reference that is already live. The early return must not skip the jump,
    // or the hero would keep reading Genesis 1:3 while Genesis 1:1 is on the projector.
    typeInEntry('Genesis 1:1')
    fireEvent.keyDown(entry(), { key: 'Enter', shiftKey: true })
    await waitFor(() => expect(screen.getByText('Genesis 1:1')).toBeTruthy())
    expect(screen.queryByText('Genesis 1:3')).toBeNull()
    expect(goLive).not.toHaveBeenCalled()
  })

  // Pins that Shift+Enter genuinely routes to goLiveFromBuilder — without this, the
  // negative test above (goLive not called when the target is already live) can't tell
  // "the guard suppressed it" from "the Shift+Enter path is dead."
  it('Shift+Enter on a different verse than the one live reaches the projector', async () => {
    const { goLive, resolveChapter } = installHelmStub(GEN_1_1_LIVE)
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    // Move the cursor off the live verse (1) via a rail tap on verse 3, same as test 2 —
    // now addRef (the cursor) is Genesis 1:3, which is not the live key.
    fireEvent.click(verseCard(3))
    await waitFor(() => expect(screen.getByPlaceholderText('Add reading — John 3:16')).toBeTruthy())

    fireEvent.keyDown(entry(), { key: 'Enter', shiftKey: true })
    await waitFor(() => expect(goLive).toHaveBeenCalled())
    expect(goLive.mock.calls[0][0]).toBe('scr:Genesis:1:3')
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

describe('SermonMode — a half-typed reference is not a commit', () => {
  it('Shift+Enter on an unresolved book neither goes live nor clears the typing', async () => {
    const { goLive, resolveChapter } = installHelmStub()
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    // "Rom" has not resolved to a book yet — no space typed, so builder.book is still null.
    typeInEntry('Rom')
    expect(entryValue()).toBe('Rom')

    fireEvent.keyDown(entry(), { key: 'Enter', shiftKey: true })
    // Nothing on screen, and the half-typed reference survives so it can be finished.
    expect(goLive).not.toHaveBeenCalled()
    expect(entryValue()).toBe('Rom')
  })

  it('Enter on an unresolved book files nothing and keeps the typing', async () => {
    const { add, resolveChapter } = installHelmStub()
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    typeInEntry('Rom')
    fireEvent.keyDown(entry(), { key: 'Enter' })
    expect(add).not.toHaveBeenCalled()
    expect(entryValue()).toBe('Rom')
  })

  // A resolved book with no chapter yet ("Romans") substitutes the cursor exactly the way
  // "Rom" does — the entry reads Romans, the commit would file Genesis. Same refusal.
  it('Enter on a book with no chapter yet files nothing and keeps the typing', async () => {
    const { add, resolveChapter } = installHelmStub()
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    typeInEntry('Romans ')
    await waitFor(() => expect(entryValue()).toBe('Romans'))

    fireEvent.keyDown(entry(), { key: 'Enter' })
    expect(add).not.toHaveBeenCalled()
    expect(entryValue()).toBe('Romans')
  })

  // The refusal is on the blind Enter keystroke, NOT on the labelled button. `+ Add` is
  // always rendered — a GUI-only operator must never lose it — and it says which verse it
  // files, so clicking it while a partial reference is typed is honest, not a surprise.
  it('keeps + Add clickable with a partial reference typed, filing the cursor it names', async () => {
    const { add, resolveChapter } = installHelmStub()
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    typeInEntry('Rom')
    expect(entryValue()).toBe('Rom')

    // Label still names the cursor's verse, and the click files exactly that.
    const addButton = screen.getByText('+ Add Genesis 1:1')
    fireEvent.click(addButton)
    await waitFor(() => expect(add).toHaveBeenCalled())
    expect(add.mock.calls[0][0]).toEqual({ book: 'Genesis', ch: 1, from: 1, to: 1 })
  })

  it('a resolved reference still commits (the guard is about half-typed, not typed)', async () => {
    const { add, resolveChapter } = installHelmStub()
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    // Space resolves the book; the chapter/verse digits then clamp against that book's
    // extent, so let the extent fetch land before typing them (see the prefetch effect's
    // comment in SermonMode.tsx — digits typed against an absent extent are swallowed).
    typeInEntry('Romans ')
    await waitFor(() => expect(entryValue()).toBe('Romans'))
    typeInEntry('8:2')
    await waitFor(() => expect(entryValue()).toBe('Romans 8:2'))

    fireEvent.keyDown(entry(), { key: 'Enter' })
    await waitFor(() => expect(add).toHaveBeenCalled())
    expect(add.mock.calls[0][0]).toEqual({ book: 'Romans', ch: 8, from: 2, to: 2 })
    expect(entryValue()).toBe('')
  })
})

describe('SermonMode — the Go live button does what its label says', () => {
  it('takes the screen down, and does not toggle via goLive, when the cursor is live', async () => {
    const { goLive, setOutput, resolveChapter } = installHelmStub(GEN_1_1_LIVE)
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('■ Take down')).toBeTruthy())

    fireEvent.click(screen.getByText('■ Take down'))
    expect(setOutput).toHaveBeenCalledWith('black')
    expect(goLive).not.toHaveBeenCalled()
  })

  it('sends the cursor when the cursor is not what is live', async () => {
    const { goLive, setOutput, resolveChapter } = installHelmStub(GEN_1_1_LIVE)
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 3')).toBeTruthy())

    // Move the cursor off the live verse; the label flips back to "● Go live".
    fireEvent.click(verseCard(3))
    await waitFor(() => expect(screen.getByText('● Go live')).toBeTruthy())

    fireEvent.click(screen.getByText('● Go live'))
    expect(goLive).toHaveBeenCalled()
    expect(goLive.mock.calls[0][0]).toBe('scr:Genesis:1:3')
    expect(setOutput).not.toHaveBeenCalled()
  })
})

describe('SermonMode — arrows during the stale-chapter tick', () => {
  it('ignores Next verse rather than collapsing the cursor to verse 1', async () => {
    // Chapter deliberately left unresolved for the whole interaction: liveChapter is null,
    // so verseCount falls back to 1 and an unguarded step would clamp the cursor to 1.
    const { show, resolveChapter } = installHelmStub(NOTHING_LIVE, [
      { id: 'r1', book: 'Genesis', ch: 1, from: 5, to: 5 }
    ])
    render(<Harness />)

    const row = await screen.findByText('Genesis 1:5')
    fireEvent.click(row.closest('button') as HTMLElement)
    fireEvent.click(screen.getByText('Next verse ›'))
    expect(show).not.toHaveBeenCalled()

    resolveChapter()
    await waitFor(() => expect(show).toHaveBeenCalled())
    expect(show.mock.calls[0][0]).toBe('scr:Genesis:1:5')
  })
})
