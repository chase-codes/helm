// @vitest-environment jsdom
import { useRef, type JSX } from 'react'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SermonMode } from './SermonMode'
import type { ModeKeyHandlerRef } from './App'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { ChapterData, PresentationState, ScriptureReading } from '../../shared/types'

// This project's vitest config does not set `globals: true`, so
// @testing-library/react's auto afterEach(cleanup) never registers; without
// this, DOM from one test leaks into the next.
afterEach(cleanup)
beforeEach(() => localStorage.clear())

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

const NOTHING_LIVE: PresentationState = { output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null }
const GEN_1_1_LIVE: PresentationState = {
  output: 'live',
  liveKey: 'scr:Genesis:1:1',
  liveSnap: { kind: 'scripture', accent: '#6f9cf0', ref: 'Genesis 1:1', label: 'Genesis 1:1', columns: [] },
  cuedKey: null,
  cuedSnap: null
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
  pushState: (next: PresentationState) => void
} {
  const show = vi.fn()
  const goLive = vi.fn()
  const setOutput = vi.fn()
  const add = vi.fn(() => Promise.resolve([]))
  // Main broadcasts presentation state; usePresentationState subscribes via onState. Keep
  // the subscriber so a test can push a later state (logo -> live) after mount.
  let emit: (s: PresentationState) => void = () => {}
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
      onState: (cb: (s: PresentationState) => void) => {
        emit = cb
        return () => {
          emit = () => {}
        }
      },
      show,
      goLive,
      setOutput,
      cue: vi.fn()
    },
    // Minimal Message-track stubs: SermonMode.test.tsx only exercises the divider
    // count after switching to the Message tab (see the resizable-rails describe
    // block below), never MessageMode's own data-fetching behavior — an empty tape
    // list keeps its post-mount effects (get/timing/onAudioProgress) from firing.
    message: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(null),
      timing: () => Promise.resolve([]),
      onAudioProgress: () => () => {}
    },
    quoteSchedule: { list: () => Promise.resolve([]) }
  }
  return {
    show,
    goLive,
    setOutput,
    add,
    resolveChapter: release,
    pushState: (next) => act(() => emit(next))
  }
}

function Harness({
  active = true,
  lookupNonce = 0,
  keyHandlerRef
}: { active?: boolean; lookupNonce?: number; keyHandlerRef?: ModeKeyHandlerRef } = {}): JSX.Element {
  // Most tests never read the handler ref, so an internal one covers them; the
  // onAction/remount tests below pass their own external ref (SongsMode.test.tsx's
  // pattern) so they can invoke keyHandlerRef.current?.onAction directly.
  const ownRef = useRef(null)
  const ref = keyHandlerRef ?? ownRef
  return (
    <ThemeCtx.Provider value={themeFor('dark')}>
      <SermonMode
        themeMode="dark"
        keyHandlerRef={ref}
        active={active}
        onOpenSettings={() => {}}
        biblesRevision={0}
        lookupNonce={lookupNonce}
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
    // Assert synchronously, after flushing pending microtasks. A negative assertion inside
    // waitFor returns on its first successful pass and so waits for nothing — it would miss
    // a regression on goLiveFromBuilder's async `getChapter().then(...)` branch, which only
    // fires a tick later. The flush gives that branch its chance before we check.
    await act(async () => {})
    expect(goLive).not.toHaveBeenCalled()
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

describe('SermonMode — the book-name ghost is wired to the entry', () => {
  // refGhost and the overlay are each well tested in isolation, but nothing before this
  // asserted SermonMode actually threads `ghost={ghost}` through to SchedulePanel — deleting
  // that prop would drop the whole feature with a green suite otherwise (Finding 5).
  it('typing a book prefix shows the completion as dim ghost text', async () => {
    const { resolveChapter } = installHelmStub()
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByPlaceholderText('Add reading — John 3:16')).toBeTruthy())

    fireEvent.focus(entry())
    typeInEntry('ma')
    await waitFor(() =>
      expect((document.querySelector('[data-ghost-text]') as HTMLElement | null)?.textContent).toBe(
        'tthew'
      )
    )
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
    await waitFor(() => expect(screen.getByText('Take down')).toBeTruthy())

    fireEvent.click(screen.getByText('Take down'))
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
    await waitFor(() => expect(screen.getByText('Go live')).toBeTruthy())

    fireEvent.click(screen.getByText('Go live'))
    expect(goLive).toHaveBeenCalled()
    expect(goLive.mock.calls[0][0]).toBe('scr:Genesis:1:3')
    expect(setOutput).not.toHaveBeenCalled()
  })
})

describe('SermonMode — cursor moves made under the logo', () => {
  // Genesis 1:1 is live, then the operator presses Logo. Main keeps the liveSnap so Logo
  // off can restore it; `showLive` no-ops while output isn't live.
  const LOGO_OVER_GEN_1_1: PresentationState = { ...GEN_1_1_LIVE, output: 'logo' }

  it('re-sends the navigated verse when the logo comes back down', async () => {
    const { show, goLive, setOutput, resolveChapter, pushState } = installHelmStub(LOGO_OVER_GEN_1_1)
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 3')).toBeTruthy())

    // Navigate the rail while the logo is up. Nothing may reach the screen from here —
    // the renderer's `show` is a no-op in main while output isn't live, and neither the
    // screen-reaching verbs fire.
    fireEvent.click(verseCard(3))
    await waitFor(() => expect(screen.getByText('Genesis 1:3')).toBeTruthy())
    expect(goLive).not.toHaveBeenCalled()
    expect(setOutput).not.toHaveBeenCalled()
    show.mockClear()

    // Logo off. Main restores the OLD liveSnap (Genesis 1:1), so unless the show effect
    // re-fires, the projector reads Genesis 1:1 while the hero reads Genesis 1:3.
    pushState({ ...LOGO_OVER_GEN_1_1, output: 'live' })
    await waitFor(() => expect(show).toHaveBeenCalled())
    expect(show.mock.calls[show.mock.calls.length - 1][0]).toBe('scr:Genesis:1:3')
  })
})

describe('SermonMode — inactive/off-track does not reach the projector', () => {
  // Fresh session: nothing has ever been taken live, so liveKey is null. Main's showLive
  // allows an update in that state (a fresh rail must be able to fill an empty screen) —
  // which is exactly the hole this gate closes for a mode that isn't the one in use.
  const LOGO_NOTHING_LIVE: PresentationState = { output: 'logo', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null }

  it('an output flip to live does not push the cursor while SermonMode is inactive', async () => {
    const { show, resolveChapter, pushState } = installHelmStub(LOGO_NOTHING_LIVE)
    render(<Harness active={false} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    expect(show).not.toHaveBeenCalled()

    // Songs mode flips output logo -> live while SermonMode merely sits mounted in the
    // background. Without the active/track gate, this reaches the projector because
    // liveKey is still null.
    pushState({ ...LOGO_NOTHING_LIVE, output: 'live' })
    await act(async () => {})
    expect(show).not.toHaveBeenCalled()
  })

  it('the same output flip pushes the cursor when SermonMode is active on the scripture track', async () => {
    const { show, resolveChapter, pushState } = installHelmStub(LOGO_NOTHING_LIVE)
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(show).toHaveBeenCalled())
    show.mockClear()

    pushState({ ...LOGO_NOTHING_LIVE, output: 'live' })
    await waitFor(() => expect(show).toHaveBeenCalled())
    expect(show.mock.calls[0][0]).toBe('scr:Genesis:1:1')
  })
})

describe('SermonMode — scripture track rails are resizable', () => {
  it('scripture track rails resize from the dividers and persist the sermon-wide keys', async () => {
    const { resolveChapter } = installHelmStub()
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    const dividers = screen.getAllByTitle('Drag to resize')
    expect(dividers).toHaveLength(2)
    fireEvent.mouseDown(dividers[0], { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 160 })
    fireEvent.mouseUp(window)
    expect(localStorage.getItem('helmSermonLeftW')).toBe('330') // 270 + 60
    fireEvent.mouseDown(dividers[1], { clientX: 500 })
    fireEvent.mouseMove(window, { clientX: 440 })
    fireEvent.mouseUp(window)
    expect(localStorage.getItem('helmSermonRightW')).toBe('390') // 330 + 60 (right-anchored)
  })

  // MessageMode's own drag mechanics are covered by usePanelWidth/PanelDivider's unit
  // tests plus the scripture-track case just above — this only pins that SermonMode
  // threads the SAME leftPanel/rightPanel controls into MessageMode (Task 4), not a
  // fresh pair, by asserting both dividers render once the Message tab is active.
  it('message track also renders both resize dividers', async () => {
    const { resolveChapter } = installHelmStub()
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    fireEvent.click(screen.getByText('Message'))
    await waitFor(() => expect(screen.getAllByTitle('Drag to resize')).toHaveLength(2))
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

describe('SermonMode — the scripture-lookup hotkey (App bumps lookupNonce)', () => {
  // App wires Mod+L to bump lookupNonce; SermonMode's two-effect split (part 1 defers
  // setTrack('scripture') into a timeout, part 2 focuses the entry once `track` actually
  // reads 'scripture') is exactly the code path the lint fix restructured — this pins the
  // requirement it exists to serve, not just that it typechecks.
  it('flips off the message track back to scripture and focuses the entry', async () => {
    const { resolveChapter } = installHelmStub()
    const { rerender } = render(<Harness lookupNonce={0} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    // Move off the scripture track first — SchedulePanel, and the entry with it, unmount
    // entirely while the Message track is active (see the track-switch in SermonMode's
    // render).
    fireEvent.click(screen.getByText('Message'))
    await waitFor(() => expect(screen.queryByPlaceholderText('Add reading — John 3:16')).toBeNull())

    // Simulate App's Mod+L: bump lookupNonce. Part 1's setTrack is deferred a real tick, so
    // the entry doesn't exist yet on the next render — wait (rather than assert
    // synchronously) for it to remount, then check focus landed on it.
    rerender(<Harness lookupNonce={1} />)
    await waitFor(() => expect(entry()).toBeTruthy())
    expect(document.activeElement).toBe(entry())
  })

  it('re-focuses the entry when already on the scripture track', async () => {
    const { resolveChapter } = installHelmStub()
    const { rerender } = render(<Harness lookupNonce={0} />)
    resolveChapter()
    await waitFor(() => expect(entry()).toBeTruthy())
    expect(document.activeElement).not.toBe(entry())

    rerender(<Harness lookupNonce={1} />)
    await waitFor(() => expect(document.activeElement).toBe(entry()))
  })
})

describe('SermonMode — onAction wiring (scripture track hotkeys)', () => {
  it('scripture.reading digit 2 jumps to the 2nd scheduled reading', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [
      { id: 'r1', book: 'Genesis', ch: 1, from: 1, to: 1 },
      { id: 'r2', book: 'Genesis', ch: 1, from: 3, to: 3 }
    ])
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Genesis 1:1')).toBeTruthy())

    act(() => keyHandlerRef.current?.onAction?.({ id: 'scripture.reading', digit: 2 }))
    await waitFor(() => expect(screen.getByText('Genesis 1:3')).toBeTruthy())
  })

  it('focus.search focuses the entry input', async () => {
    const { resolveChapter } = installHelmStub()
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(entry()).toBeTruthy())
    expect(document.activeElement).not.toBe(entry())

    act(() => keyHandlerRef.current?.onAction?.({ id: 'focus.search' }))
    expect(document.activeElement).toBe(entry())
  })

  it('field.clear resets the builder', async () => {
    const { resolveChapter } = installHelmStub()
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(entry()).toBeTruthy())

    typeInEntry('Rom')
    expect(entryValue()).toBe('Rom')
    act(() => keyHandlerRef.current?.onAction?.({ id: 'field.clear' }))
    expect(entryValue()).toBe('')
  })

  it('is inert while another track is active', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [
      { id: 'r1', book: 'Genesis', ch: 1, from: 3, to: 3 }
    ])
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Genesis 1:1')).toBeTruthy())

    // Move off the scripture track — TrackTabs is rendered by MessageMode too, so
    // 'Scripture'/'Message' stay clickable throughout.
    fireEvent.click(screen.getByText('Message'))
    await waitFor(() => expect(screen.queryByPlaceholderText('Add reading — John 3:16')).toBeNull())

    // Fire the reading hotkey while on the Message track — the `track !== 'scripture'`
    // guard must swallow it rather than moving the (currently invisible) cursor.
    act(() => keyHandlerRef.current?.onAction?.({ id: 'scripture.reading', digit: 1 }))

    // The hero label is the cursor's own text ("Genesis 1:1"); the schedule row for
    // reading 1 ("Genesis 1:3") stays on screen regardless, so asserting the hero still
    // reads the untouched cursor is the unambiguous check that the action was swallowed.
    fireEvent.click(screen.getByText('Scripture'))
    await waitFor(() => expect(screen.getByText('Genesis 1:1')).toBeTruthy())
  })
})

describe('SermonMode — jumpToReading resets a stale builder preview (Finding 4)', () => {
  // A half-typed ref in the entry resolves a book ("Romans") but no chapter yet, so the
  // rail previews Romans (builder.book) over the CUED chapter (scrCh, since builder.chapter
  // is still null) — a foreign preview that a reading jump into a different book must clear,
  // or the fresh scroll request lands the wrong chapter's verse number on the rail.
  it('clears the entry and the rail follows the reading, not the abandoned builder book', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [
      { id: 'r1', book: 'Genesis', ch: 1, from: 3, to: 3 }
    ])
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Genesis 1:3')).toBeTruthy())

    // Resolve the book only — chapter/verse left untyped, mirroring the reported repro.
    typeInEntry('Romans ')
    await waitFor(() => expect(entryValue()).toBe('Romans'))
    // The rail is now previewing the abandoned builder book instead of the cued chapter.
    await waitFor(() => expect(screen.getByText('Romans 1')).toBeTruthy())

    // Reading 1 hotkey (digit press) jumps into Genesis — a different book than the builder.
    act(() => keyHandlerRef.current?.onAction?.({ id: 'scripture.reading', digit: 1 }))

    expect(entryValue()).toBe('')
    await waitFor(() => expect(screen.getByText('Genesis 1')).toBeTruthy())
    expect(screen.queryByText('Romans 1')).toBeNull()
  })

  it('a schedule-row click also resets the builder', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [
      { id: 'r1', book: 'Genesis', ch: 1, from: 3, to: 3 }
    ])
    render(<Harness />)
    resolveChapter()
    const row = await screen.findByText('Genesis 1:3')

    typeInEntry('Romans ')
    await waitFor(() => expect(entryValue()).toBe('Romans'))
    await waitFor(() => expect(screen.getByText('Romans 1')).toBeTruthy())

    fireEvent.click(row.closest('button') as HTMLElement)

    expect(entryValue()).toBe('')
    await waitFor(() => expect(screen.getByText('Genesis 1')).toBeTruthy())
  })
})

describe('SermonMode — ChapterRail scroll requests', () => {
  it('does not re-fire an already-consumed scroll request when ChapterRail remounts', async () => {
    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [
      { id: 'r1', book: 'Genesis', ch: 1, from: 3, to: 3 }
    ])
    render(<Harness />)
    resolveChapter()
    const row = await screen.findByText('Genesis 1:3')
    scrollSpy.mockClear()

    // A schedule-row click requests a 'start' scroll and it lands (the rows are already
    // loaded) — this is the request that must NOT replay later.
    fireEvent.click(row.closest('button') as HTMLElement)
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' }))
    scrollSpy.mockClear()

    // Flip away to Message and back — ChapterRail unmounts, then remounts fresh. Its
    // mount effect runs unconditionally regardless of prior deps, so without
    // consumedNonceRef this replays the same, already-satisfied, request.
    fireEvent.click(screen.getByText('Message'))
    await waitFor(() => expect(screen.queryByText('Verse 3')).toBeNull())
    fireEvent.click(screen.getByText('Scripture'))
    await waitFor(() => expect(screen.getByText('Verse 3')).toBeTruthy())

    expect(scrollSpy).not.toHaveBeenCalled()
  })
})
