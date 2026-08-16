// @vitest-environment jsdom
import { useRef, type JSX } from 'react'
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SermonMode } from './SermonMode'
import type { ModeKeyHandlerRef } from './App'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type {
  ChapterData,
  MediaItem,
  Message,
  PresentationState,
  QuoteRow,
  QuoteScheduleItem,
  ScriptureReading,
  TapeRow
} from '../../shared/types'

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
  schedule: ScriptureReading[] = [],
  opts: {
    media?: MediaItem[]
    tape?: Message
    quoteSchedule?: QuoteScheduleItem[]
    // What `message.search` resolves to for any query — lets a test drive MessageSearchRail's
    // TAPES/QUOTES result rows (the ones a double-click has to survive) without a real index.
    // A function form receives the query and the tape SCOPE, so a test can make the scoped
    // pass return different quotes than the unscoped one, the way a real FTS does.
    search?:
      | { tapes: TapeRow[]; quotes: QuoteRow[] }
      | ((q: string, scope: string | null) => { tapes: TapeRow[]; quotes: QuoteRow[] })
  } = {},
  // Optional second chapter, keyed by its own book/ch, with its own release — lets a test
  // fetch a DIFFERENT chapter than the default Genesis 1 (e.g. activateReading's async
  // getChapter branch for a reading outside the cache). Any book/ch not matching this pair
  // falls through to the original shared `pending` promise, so every existing caller (which
  // never names a second chapter) is unaffected.
  second?: { book: string; ch: number; data: ChapterData }
): {
  show: ReturnType<typeof vi.fn>
  goLive: ReturnType<typeof vi.fn>
  take: ReturnType<typeof vi.fn>
  setOutput: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  removeMany: ReturnType<typeof vi.fn>
  scheduleList: ReturnType<typeof vi.fn>
  cue: ReturnType<typeof vi.fn>
  mediaList: ReturnType<typeof vi.fn>
  messageList: ReturnType<typeof vi.fn>
  getChapter: ReturnType<typeof vi.fn>
  resolveChapter: () => void
  resolveSecondChapter: () => void
  pushState: (next: PresentationState) => void
} {
  const show = vi.fn()
  const goLive = vi.fn()
  const take = vi.fn()
  const setOutput = vi.fn()
  const add = vi.fn(() => Promise.resolve([]))
  const removeMany = vi.fn(() => Promise.resolve([]))
  // A spy, not an inline arrow: undo now restores by RE-READING the schedule rather than
  // re-adding rows, so tests need to see this call.
  const scheduleList = vi.fn(() => Promise.resolve(schedule))
  const cue = vi.fn()
  const mediaList = vi.fn(() => Promise.resolve(opts.media ?? []))
  const messageList = vi.fn(() =>
    Promise.resolve(
      opts.tape
        ? [{ id: opts.tape.id, tapeNo: opts.tape.tapeNo, title: opts.tape.title, date: opts.tape.date, durationS: opts.tape.durationS, hasAudio: false }]
        : []
    )
  )
  // Main broadcasts presentation state; usePresentationState subscribes via onState. Keep
  // the subscriber so a test can push a later state (logo -> live) after mount.
  let emit: (s: PresentationState) => void = () => {}
  let release: () => void = () => {}
  // One pending promise shared by both getChapter call sites (live + preview), so the
  // chapter stays unresolved until the test releases it.
  const pending = new Promise<ChapterData>((res) => {
    release = () => res(GENESIS_1)
  })
  let releaseSecond: () => void = () => {}
  const secondPending = second
    ? new Promise<ChapterData>((res) => {
        releaseSecond = () => res(second.data)
      })
    : null
  const getChapter = vi.fn((book: string, ch: number) =>
    second && book === second.book && ch === second.ch ? (secondPending as Promise<ChapterData>) : pending
  )
  ;(window as unknown as { helm: unknown }).helm = {
    settings: { get: () => Promise.resolve(['kjv']), set: vi.fn() },
    schedule: { list: scheduleList, add, remove: vi.fn(() => Promise.resolve([])), removeMany },
    bibles: {
      manifest: () => Promise.resolve([{ id: 'kjv', abbr: 'KJV', name: 'King James', installed: true }]),
      getChapter,
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
      take,
      setOutput,
      cue
    },
    // Message-track stubs: an empty tape list (the default) keeps MessageMode's
    // post-mount effects (get/timing/onAudioProgress) from firing; pass opts.tape
    // to exercise real Message-track behavior.
    message: {
      list: messageList,
      get: (id: string) => Promise.resolve(opts.tape && opts.tape.id === id ? opts.tape : null),
      timing: () => Promise.resolve([]),
      search: (q: string, scope: string | null) =>
        Promise.resolve(typeof opts.search === 'function' ? opts.search(q, scope) : (opts.search ?? { tapes: [], quotes: [] })),
      onAudioProgress: () => () => {}
    },
    quoteSchedule: { list: () => Promise.resolve(opts.quoteSchedule ?? []) },
    media: {
      list: mediaList,
      importImages: vi.fn(),
      importVideo: vi.fn(),
      importDeck: vi.fn(),
      remove: vi.fn(() => Promise.resolve([])),
      onImportProgress: () => () => {}
    },
    video: {
      get: () => Promise.resolve({ key: null, src: null, playing: false, positionMs: 0, durationMs: 0, volume: 1, muted: false }),
      onState: () => () => {},
      load: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      setVolume: vi.fn(),
      setMuted: vi.fn(),
      reportDuration: vi.fn()
    }
  }
  return {
    show,
    goLive,
    take,
    setOutput,
    add,
    removeMany,
    scheduleList,
    cue,
    mediaList,
    messageList,
    getChapter,
    resolveChapter: release,
    resolveSecondChapter: () => releaseSecond(),
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
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
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

// All three tracks stay mounted under SermonMode's keep-alive wrappers (#60), so a hidden
// track's DOM — including its TrackTabs and hero buttons — is still present. These helpers
// scope queries to one track's wrapper and read its shown/hidden state; clickTab picks any
// tab button since every TrackTabs instance drives the same setTrack.
const trackPanel = (t: 'scripture' | 'message' | 'slides'): HTMLElement =>
  document.querySelector(`[data-track-panel="${t}"]`) as HTMLElement
const panelHidden = (t: 'scripture' | 'message' | 'slides'): boolean =>
  trackPanel(t).style.display === 'none'
const clickTab = (label: string): void => {
  fireEvent.click(screen.getAllByText(label)[0])
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
    // The rail renders a single card until the chapter resolves (railVerseCount falls back
    // to 1), so a 'Verse 1' gate can pass before the other cards exist — gate on the
    // highest verse this test touches instead. Same for every gate below that a
    // pre-resolution surface (lone rail card, hero label) would satisfy.
    await waitFor(() => expect(screen.getByText('Verse 3')).toBeTruthy())

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

describe('SermonMode — double-click a verse goes live (#58)', () => {
  it('takes the verse on double-click', async () => {
    const { resolveChapter, take } = installHelmStub(NOTHING_LIVE, [])
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 2')).toBeTruthy())
    fireEvent.doubleClick(screen.getByText('Verse 2'))
    await waitFor(() => expect(take).toHaveBeenCalledWith('scr:Genesis:1:2', expect.anything()))
  })

  it('never blacks the screen when the verse is already live', async () => {
    const LIVE_1_1: PresentationState = {
      output: 'live', liveKey: 'scr:Genesis:1:1', liveSnap: null, cuedKey: null, cuedSnap: null
    }
    const { resolveChapter, take, goLive, setOutput } = installHelmStub(LIVE_1_1, [])
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    fireEvent.doubleClick(screen.getByText('Verse 1'))
    await waitFor(() => expect(take).toHaveBeenCalled())
    expect(goLive).not.toHaveBeenCalled()
    expect(setOutput).not.toHaveBeenCalledWith('black')
  })

  it('shift-double-click takes the range\'s start verse, not the clicked verse', async () => {
    const { resolveChapter, take } = installHelmStub(NOTHING_LIVE, [])
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 4')).toBeTruthy())

    // Cursor starts at verse 1. Shift-click verse 4 anchors the range at the cursor,
    // building Genesis 1:1-4 (railSelect's idempotent-anchor case, tested on its own in
    // selection.test.ts) — selectedRange now reads { from: 1, to: 4 }.
    fireEvent.click(verseCard(4), { shiftKey: true })
    await waitFor(() => expect(verseCard(4).dataset.selected).toBe('true'))

    // Shift-double-click the range's END verse (4). activateVerse must resolve the take
    // to the range's START (1) via `Math.min(selectedRange.from, v)` — if it took the
    // clicked verse instead, this would assert scr:Genesis:1:4 and the test would not
    // catch that regression.
    fireEvent.doubleClick(verseCard(4), { shiftKey: true })
    await waitFor(() => expect(take).toHaveBeenCalledWith('scr:Genesis:1:1', expect.anything()))
  })

  // A shift-click deliberately leaves the cursor where it is, so activateVerse has to move
  // it onto the verse it takes — the same "jump first, unconditionally" rule
  // goLiveFromBuilder follows. Two ways to get this wrong, one per output state, so both are
  // pinned here.
  //
  // From BLACK: the take flips main's output to 'live', that broadcast re-runs the show
  // effect (`output` is one of its deps), and a stale cursor would then push its OWN verse
  // over the one just taken — the projector flashes verse 2 and settles on verse 4.
  it('shift-double-click from black leaves the projector on the range start, not the cursor', async () => {
    const { resolveChapter, take, show, pushState } = installHelmStub(NOTHING_LIVE, [])
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 4')).toBeTruthy())

    // Cursor to verse 4, then shift-click verse 2 — a BACKWARD range, 2-4.
    fireEvent.click(verseCard(4))
    await waitFor(() => expect(screen.getByText('Genesis 1:4')).toBeTruthy())
    fireEvent.click(verseCard(2), { shiftKey: true })
    await waitFor(() => expect(verseCard(2).dataset.selected).toBe('true'))

    fireEvent.doubleClick(verseCard(2), { shiftKey: true })
    await waitFor(() => expect(take).toHaveBeenCalledWith('scr:Genesis:1:2', expect.anything()))

    // Main answers the take by broadcasting the new live state, exactly as stateStore does.
    show.mockClear()
    pushState({ output: 'live', liveKey: 'scr:Genesis:1:2', liveSnap: null, cuedKey: null, cuedSnap: null })
    await act(async () => {})
    for (const call of show.mock.calls) expect(call[0]).toBe('scr:Genesis:1:2')
  })

  // Already LIVE: the show effect does not re-run (no `output` change), so nothing corrects
  // the divergence — verse 2 sticks on the projector while the hero and the rail cursor both
  // read verse 4, and the next arrow press steps to verse 5.
  it('shift-double-click while live moves the cursor onto the verse it takes', async () => {
    const LIVE_1_1: PresentationState = {
      output: 'live', liveKey: 'scr:Genesis:1:1', liveSnap: null, cuedKey: null, cuedSnap: null
    }
    const { resolveChapter, take } = installHelmStub(LIVE_1_1, [])
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 4')).toBeTruthy())

    fireEvent.click(verseCard(4))
    await waitFor(() => expect(screen.getByText('Genesis 1:4')).toBeTruthy())
    fireEvent.click(verseCard(2), { shiftKey: true })
    await waitFor(() => expect(verseCard(2).dataset.selected).toBe('true'))

    fireEvent.doubleClick(verseCard(2), { shiftKey: true })
    await waitFor(() => expect(take).toHaveBeenCalledWith('scr:Genesis:1:2', expect.anything()))
    // The hero (and with it the cursor the arrows step) now names what is on the projector.
    await waitFor(() => expect(screen.getByText('Genesis 1:2')).toBeTruthy())
    expect(screen.queryByText('Genesis 1:4')).toBeNull()
  })

  // The double-click's second click runs railSelect again. Anchored on `builder.startVerse`
  // that collapsed a BACKWARD range onto the clicked verse, so the pending "+ Add Genesis
  // 1:2-4" the operator was building silently became "+ Add Genesis 1:2".
  it('shift-double-click keeps a backward range intact', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [])
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 4')).toBeTruthy())

    fireEvent.click(verseCard(4))
    await waitFor(() => expect(screen.getByText('Genesis 1:4')).toBeTruthy())
    fireEvent.click(verseCard(2), { shiftKey: true })
    await waitFor(() => expect(screen.getByText('+ Add Genesis 1:2–4')).toBeTruthy())

    fireEvent.click(verseCard(2), { shiftKey: true })
    fireEvent.doubleClick(verseCard(2), { shiftKey: true })
    await waitFor(() => expect(screen.getByText('+ Add Genesis 1:2–4')).toBeTruthy())
    expect(verseCard(3).dataset.selected).toBe('true')
  })

  it('double-clicking a schedule reading takes its first verse live', async () => {
    const SCHEDULE: ScriptureReading[] = [
      { id: 'r1', book: 'Genesis', ch: 1, from: 1, to: 1 },
      { id: 'r2', book: 'Genesis', ch: 1, from: 3, to: 3 }
    ]
    const { resolveChapter, take } = installHelmStub(NOTHING_LIVE, SCHEDULE)
    render(<Harness />)
    resolveChapter()
    // Gate on the row being clicked: 'Genesis 1:1' also matches the hero label, which
    // renders before the schedule list resolves.
    await waitFor(() => expect(screen.getAllByText('Genesis 1:3').length).toBeGreaterThan(0))
    fireEvent.doubleClick(screen.getAllByText('Genesis 1:3')[0])
    await waitFor(() => expect(take).toHaveBeenCalledWith('scr:Genesis:1:3', expect.anything()))
  })

  // `takeLive` starts projecting and never stops, so nothing in the app undoes a take that
  // lands late — an operator who backs out while the chapter is still in flight would watch
  // the projector re-light on the reading they just took down. These two drive the guard.
  const EXODUS_2_DATA: ChapterData = {
    book: 'Exodus',
    chapter: 2,
    verseCount: 3,
    verses: { 1: { kjv: 'Verse 1' }, 2: { kjv: 'Verse 2' }, 3: { kjv: 'Verse 3' } }
  }
  const RACE_SCHEDULE: ScriptureReading[] = [
    { id: 'r1', book: 'Genesis', ch: 1, from: 1, to: 1 },
    { id: 'r2', book: 'Exodus', ch: 2, from: 3, to: 3 }
  ]

  it('Escape before the chapter resolves cancels the take instead of re-lighting the screen', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    const { resolveChapter, resolveSecondChapter, take, setOutput, pushState } = installHelmStub(
      GEN_1_1_LIVE,
      RACE_SCHEDULE,
      {},
      { book: 'Exodus', ch: 2, data: EXODUS_2_DATA }
    )
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Exodus 2:3')).toBeTruthy())

    fireEvent.doubleClick(screen.getByText('Exodus 2:3'))
    await act(async () => {})
    expect(take).not.toHaveBeenCalled()

    // The operator backs out: Escape blacks the screen, and main broadcasts that back.
    act(() => {
      keyHandlerRef.current?.onEscape()
    })
    expect(setOutput).toHaveBeenCalledWith('black')
    pushState(NOTHING_LIVE)

    resolveSecondChapter()
    await act(async () => {})
    expect(take).not.toHaveBeenCalled()
  })

  it('the slower of two racing double-clicks never overrides the one taken second', async () => {
    const { resolveChapter, resolveSecondChapter, take } = installHelmStub(
      NOTHING_LIVE,
      RACE_SCHEDULE,
      {},
      { book: 'Exodus', ch: 2, data: EXODUS_2_DATA }
    )
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Exodus 2:3')).toBeTruthy())

    // Uncached reading first — its fetch stays in flight...
    fireEvent.doubleClick(screen.getByText('Exodus 2:3'))
    // ...then the cached one, which takes on the spot. That is the operator's last word.
    fireEvent.doubleClick(screen.getAllByText('Genesis 1:1')[0])
    await waitFor(() => expect(take).toHaveBeenCalledWith('scr:Genesis:1:1', expect.anything()))

    resolveSecondChapter()
    await act(async () => {})
    expect(take).toHaveBeenCalledTimes(1)
  })

  // The reading above shares SermonMode's default cue (Genesis 1), so `chapter` is already
  // cached by the time it's double-clicked and only activateReading's synchronous branch
  // runs. This one names a different book/chapter, forcing the `window.helm.bibles
  // .getChapter(...).then(...)` fetch branch: `take` must stay uncalled while that fetch is
  // in flight, then fire once it resolves.
  it('double-clicking a reading outside the cached chapter fetches it before taking the verse', async () => {
    const EXODUS_2: ChapterData = {
      book: 'Exodus',
      chapter: 2,
      verseCount: 3,
      verses: {
        1: { kjv: 'Verse 1' },
        2: { kjv: 'Verse 2' },
        3: { kjv: 'Verse 3' }
      }
    }
    const SCHEDULE: ScriptureReading[] = [
      { id: 'r1', book: 'Genesis', ch: 1, from: 1, to: 1 },
      { id: 'r2', book: 'Exodus', ch: 2, from: 3, to: 3 }
    ]
    const { resolveChapter, resolveSecondChapter, getChapter, take } = installHelmStub(NOTHING_LIVE, SCHEDULE, {}, {
      book: 'Exodus',
      ch: 2,
      data: EXODUS_2
    })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Exodus 2:3')).toBeTruthy())

    fireEvent.doubleClick(screen.getByText('Exodus 2:3'))
    expect(getChapter).toHaveBeenCalledWith('Exodus', 2)
    // The fetch is still pending — the synchronous branch must not have fired instead.
    await act(async () => {})
    expect(take).not.toHaveBeenCalled()

    resolveSecondChapter()
    // Assert the slide's text, not just the key — a bug that took the stale cached
    // Genesis chapter while still calling `take` with the right Exodus key would pass
    // an `expect.anything()` check here but show "And God said, Let there be light"
    // (Genesis 1:3's text) instead of Exodus 2:3's.
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith(
        'scr:Exodus:2:3',
        expect.objectContaining({ columns: [{ version: 'KJV', text: 'Verse 3' }] })
      )
    )
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

    // Move the cursor off the live verse; the label flips back to "● Go live". Scoped to
    // the scripture panel — the hidden message/slides heroes render their own Go live.
    const scripture = within(trackPanel('scripture'))
    fireEvent.click(verseCard(3))
    await waitFor(() => expect(scripture.getByText('Go live')).toBeTruthy())

    fireEvent.click(scripture.getByText('Go live'))
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

    // Scoped to the scripture panel — the kept-alive message/slides tracks render their
    // own dividers too.
    const dividers = within(trackPanel('scripture')).getAllByTitle('Drag to resize')
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

    clickTab('Message')
    await waitFor(() => expect(panelHidden('message')).toBe(false))
    expect(within(trackPanel('message')).getAllByTitle('Drag to resize')).toHaveLength(2)
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

    // Move off the scripture track first — the panel (kept alive, #60) hides while the
    // Message track is active.
    clickTab('Message')
    await waitFor(() => expect(panelHidden('scripture')).toBe(true))

    // Simulate App's Mod+L: bump lookupNonce. Part 1's setTrack is deferred a real tick,
    // so wait (rather than assert synchronously) for the scripture panel to come back,
    // then check focus landed on the entry.
    rerender(<Harness lookupNonce={1} />)
    await waitFor(() => expect(panelHidden('scripture')).toBe(false))
    await waitFor(() => expect(document.activeElement).toBe(entry()))
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
    // Both scheduled readings sit in the rail permanently, so a bare getByText on either
    // reference proves nothing about where the cue is — it matches the rail row whether or
    // not the jump fired. The hero label is the second occurrence: one match = rail only,
    // two = rail + hero. Waiting for 1:1 to reach two is also the real "chapter resolved
    // and reading 1 is cued" precondition this jump needs.
    await waitFor(() => expect(screen.getAllByText('Genesis 1:1')).toHaveLength(2))

    act(() => keyHandlerRef.current?.onAction?.({ id: 'scripture.reading', digit: 2 }))
    await waitFor(() => expect(screen.getAllByText('Genesis 1:3')).toHaveLength(2))
    expect(screen.getAllByText('Genesis 1:1')).toHaveLength(1) // hero left reading 1
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

    // Move off the scripture track — TrackTabs is rendered by every track, so
    // 'Scripture'/'Message' stay clickable throughout.
    clickTab('Message')
    await waitFor(() => expect(panelHidden('scripture')).toBe(true))

    // Fire the reading hotkey while on the Message track — the `track !== 'scripture'`
    // guard must swallow it rather than moving the (currently invisible) cursor.
    act(() => keyHandlerRef.current?.onAction?.({ id: 'scripture.reading', digit: 1 }))

    // The hero label is the cursor's own text ("Genesis 1:1"); the schedule row for
    // reading 1 ("Genesis 1:3") stays on screen regardless, so asserting the hero still
    // reads the untouched cursor is the unambiguous check that the action was swallowed.
    clickTab('Scripture')
    await waitFor(() => expect(screen.getByText('Genesis 1:1')).toBeTruthy())
  })
})

describe('SermonMode — Escape backs out progressively (#54)', () => {
  it('takes the screen to black when scripture is live', async () => {
    const { setOutput, resolveChapter } = installHelmStub(GEN_1_1_LIVE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    // 'Take down' proves the live presentation state reached the handler's closure —
    // 'Verse 1' only proves the chapter fetch resolved.
    await waitFor(() => expect(screen.getByText('Take down')).toBeTruthy())

    act(() => void keyHandlerRef.current?.onEscape())
    expect(setOutput).toHaveBeenCalledWith('black')
  })

  it('blurs a focused text field first and only blacks on the next press', async () => {
    const { setOutput, resolveChapter } = installHelmStub(GEN_1_1_LIVE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Take down')).toBeTruthy())

    entry().focus()
    act(() => void keyHandlerRef.current?.onEscape())
    expect(document.activeElement).not.toBe(entry())
    expect(setOutput).not.toHaveBeenCalled()

    act(() => void keyHandlerRef.current?.onEscape())
    expect(setOutput).toHaveBeenCalledWith('black')
  })

  it('clearing typed text, leaving the field, and blacking are three separate presses', async () => {
    const { setOutput, resolveChapter } = installHelmStub(GEN_1_1_LIVE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Take down')).toBeTruthy())

    // Mirror App's wiring: the document-level dispatcher forwards a bubbled Escape to the
    // mode handler — unless the entry's own handler consumed the press.
    const onDoc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void keyHandlerRef.current?.onEscape()
    }
    document.addEventListener('keydown', onDoc)
    try {
      entry().focus()
      typeInEntry('Rom')
      expect(entryValue()).toBe('Rom')

      // Press 1: clears the typing, keeps focus so it can be retyped, screen untouched.
      fireEvent.keyDown(entry(), { key: 'Escape' })
      expect(entryValue()).toBe('')
      expect(document.activeElement).toBe(entry())
      expect(setOutput).not.toHaveBeenCalled()

      // Press 2: leaves the field, screen still untouched.
      fireEvent.keyDown(entry(), { key: 'Escape' })
      expect(document.activeElement).not.toBe(entry())
      expect(setOutput).not.toHaveBeenCalled()

      // Press 3: now, and only now, the screen goes to black.
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(setOutput).toHaveBeenCalledWith('black')
    } finally {
      document.removeEventListener('keydown', onDoc)
    }
  })

  it('works from the slides track too', async () => {
    const DECK_1_LIVE: PresentationState = {
      output: 'live',
      liveKey: 'pres:d1:0',
      liveSnap: { kind: 'image', src: 'helm-media://d1/1.png' },
      cuedKey: null,
      cuedSnap: null
    }
    const { setOutput, resolveChapter } = installHelmStub(DECK_1_LIVE, [], { media: [DECK] })
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    clickTab('Slides')
    // 'Take down' (the cued slide is the live one) proves both the media load and the
    // live presentation state have landed.
    await waitFor(() => expect(screen.getByText('Take down')).toBeTruthy())
    act(() => void keyHandlerRef.current?.onEscape())
    expect(setOutput).toHaveBeenCalledWith('black')
  })

  // Regression for a CI flake: SermonMode's isModalOpen delegates straight through to
  // SlidesTrack's own handle, so BOTH have to be attached with layout timing. Registered
  // as passive effects the chain runs a commit behind, and a MutationObserver callback —
  // the microtask right after a commit, exactly where RTL's waitFor resolves and where a
  // real keypress can land — still gets the previous render's closure, so Escape would
  // black the screen instead of closing the modal that just appeared.
  it('answers isModalOpen for the commit on screen, not the previous one', async () => {
    const DECK_1_LIVE: PresentationState = {
      output: 'live',
      liveKey: 'pres:d1:0',
      liveSnap: { kind: 'image', src: 'helm-media://d1/1.png' },
      cuedKey: null,
      cuedSnap: null
    }
    const { resolveChapter } = installHelmStub(DECK_1_LIVE, [], { media: [DECK] })
    ;(window.helm.media.importDeck as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      error: 'no-libreoffice'
    })
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    clickTab('Slides')
    await waitFor(() => expect(screen.getByText('Take down')).toBeTruthy())

    const disagreements: string[] = []
    const observer = new MutationObserver(() => {
      const onScreen = screen.queryByText('PowerPoint import unavailable') !== null
      const handlerSays = keyHandlerRef.current?.isModalOpen() ?? false
      if (onScreen !== handlerSays) disagreements.push(`dom=${onScreen} handler=${handlerSays}`)
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    fireEvent.click(screen.getByText('+ Import'))
    // importDeck resolves outside act(), so the modal commits with no surrounding act()
    // to force an effect flush — the same shape as the real IPC round-trip.
    fireEvent.click(screen.getByText('Slides / PDF'))
    await waitFor(() => expect(screen.getByText('PowerPoint import unavailable')).toBeTruthy())
    observer.disconnect()
    expect(disagreements).toEqual([])
  })

  // SlidesTrack owns two overlay surfaces (the import popover and the deck-fallback
  // modal). Escape must close those before it can ever touch the screen — the same
  // modals-first ordering SongsMode's ladder gives QuickAdd/the import wizard.
  it('closes the deck-fallback modal instead of blacking the screen', async () => {
    const DECK_1_LIVE: PresentationState = {
      output: 'live',
      liveKey: 'pres:d1:0',
      liveSnap: { kind: 'image', src: 'helm-media://d1/1.png' },
      cuedKey: null,
      cuedSnap: null
    }
    const { setOutput, resolveChapter } = installHelmStub(DECK_1_LIVE, [], { media: [DECK] })
    ;(window.helm.media.importDeck as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      error: 'no-libreoffice'
    })
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    clickTab('Slides')
    await waitFor(() => expect(screen.getByText('Take down')).toBeTruthy())
    fireEvent.click(screen.getByText('+ Import'))
    fireEvent.click(screen.getByText('Slides / PDF'))
    await waitFor(() => expect(screen.getByText('PowerPoint import unavailable')).toBeTruthy())
    // The deck-fallback modal is a blocking modal: Enter/Delete must not fire behind it.
    expect(keyHandlerRef.current?.isModalOpen()).toBe(true)

    // Press 1: closes the modal, screen untouched.
    act(() => void keyHandlerRef.current?.onEscape())
    expect(screen.queryByText('PowerPoint import unavailable')).toBeNull()
    expect(setOutput).not.toHaveBeenCalled()

    // Press 2: nothing left to close — now the screen comes down.
    act(() => void keyHandlerRef.current?.onEscape())
    expect(setOutput).toHaveBeenCalledWith('black')
  })

  it('closes the import popover instead of blacking the screen', async () => {
    const DECK_1_LIVE: PresentationState = {
      output: 'live',
      liveKey: 'pres:d1:0',
      liveSnap: { kind: 'image', src: 'helm-media://d1/1.png' },
      cuedKey: null,
      cuedSnap: null
    }
    const { setOutput, resolveChapter } = installHelmStub(DECK_1_LIVE, [], { media: [DECK] })
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    clickTab('Slides')
    await waitFor(() => expect(screen.getByText('Take down')).toBeTruthy())
    fireEvent.click(screen.getByText('+ Import'))
    expect(screen.getByText('Slides / PDF')).toBeTruthy()

    act(() => void keyHandlerRef.current?.onEscape())
    expect(screen.queryByText('Slides / PDF')).toBeNull()
    expect(setOutput).not.toHaveBeenCalled()
  })

  it('does nothing destructive with nothing live', async () => {
    const { setOutput, resolveChapter } = installHelmStub(NOTHING_LIVE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    act(() => void keyHandlerRef.current?.onEscape())
    expect(setOutput).not.toHaveBeenCalled()
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

// One deck of three slides / one tape of three paragraphs — enough to step off the
// initial position and detect a reset back to it.
const DECK: MediaItem = {
  id: 'd1',
  type: 'deck',
  title: 'Easter',
  filePath: null,
  slides: ['d1/1.png', 'd1/2.png', 'd1/3.png'],
  createdAt: 0
}
const TAPE: Message = {
  id: 'm1',
  tapeNo: '47-0412',
  title: 'Faith Is The Substance',
  date: '47-0412',
  durationS: 60,
  audioPath: null,
  source: 'test',
  paragraphs: [
    { ord: 0, label: '1', text: 'First paragraph' },
    { ord: 1, label: '2', text: 'Second paragraph' },
    { ord: 2, label: '3', text: 'Third paragraph' }
  ]
}

// One tape match and one quote match for `message.search`, so the rail renders both kinds
// of result row.
const SEARCH_HITS: { tapes: TapeRow[]; quotes: QuoteRow[] } = {
  tapes: [{ id: 'm1', tapeNo: '47-0412', title: 'Faith Is The Substance', date: '47-0412' }],
  quotes: [
    { msgId: 'm1', tapeNo: '47-0412', title: 'Faith Is The Substance', ord: 2, label: '3', text: 'Third paragraph' }
  ]
}

const searchBox = (): HTMLInputElement => screen.getByPlaceholderText('Search tapes & quotes…') as HTMLInputElement
const runSearch = async (): Promise<void> => {
  fireEvent.change(await screen.findByPlaceholderText('Search tapes & quotes…'), { target: { value: 'faith' } })
}

// MessageSearchRail renders EITHER the TAPES/QUOTES result rows or the QUOTE SCHEDULE rows,
// so anything the first click does that flips `hasSearch` (or empties `tapeRows`) unmounts
// the very button being double-clicked — and in a real browser the second click then lands
// on a different element, so `dblclick` never reaches the row and its handler is dead code.
// MessageSearchRail.test.tsx cannot see this: it hands the presentational component its
// props directly. These drive the gesture the way a browser does — click, then click AGAIN
// on the same node — which only works if that node survived the first click.
describe('SermonMode — double-clicking a message search row (#58)', () => {
  it('takes a quote result live, with the row still mounted for the second click', async () => {
    const { resolveChapter, take } = installHelmStub(NOTHING_LIVE, [], { tape: TAPE, search: SEARCH_HITS })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    clickTab('Message')
    await runSearch()
    const row = (await screen.findByText('Faith Is The Substance — ¶3')).closest('button') as HTMLButtonElement

    fireEvent.click(row)
    await act(async () => {})
    expect(row.isConnected).toBe(true)

    fireEvent.click(row)
    fireEvent.doubleClick(row)
    await waitFor(() => expect(take).toHaveBeenCalledWith('msg:m1:2', expect.anything()))
  })

  it('takes a tape result\'s first quote live, with the row still mounted for the second click', async () => {
    const { resolveChapter, take } = installHelmStub(NOTHING_LIVE, [], { tape: TAPE, search: SEARCH_HITS })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    clickTab('Message')
    await runSearch()
    const row = (await screen.findByText('Tape 47-0412 · 47-0412')).closest('button') as HTMLButtonElement

    // A tape row click also SCOPES the search, which empties `tapeRows` on its own — so this
    // row has two independent ways to vanish out from under the second click.
    fireEvent.click(row)
    await act(async () => {})
    expect(row.isConnected).toBe(true)

    fireEvent.click(row)
    fireEvent.doubleClick(row)
    await waitFor(() => expect(take).toHaveBeenCalledWith('msg:m1:0', expect.anything()))
  })

  // The other half of the contract: keeping the row alive must not cost the single click its
  // meaning. It still selects the quote on the spot — it just no longer takes the results
  // away, which is what made the double-click unreachable.
  it('a plain single click selects the quote without going live or disturbing the results', async () => {
    const { resolveChapter, take, goLive } = installHelmStub(NOTHING_LIVE, [], { tape: TAPE, search: SEARCH_HITS })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    clickTab('Message')
    await runSearch()
    const row = (await screen.findByText('Faith Is The Substance — ¶3')).closest('button') as HTMLButtonElement

    fireEvent.click(row)
    // Selection is immediate — the hero names the clicked paragraph on the same commit.
    await waitFor(() => expect(screen.getByText('Tape 47-0412 — ¶3')).toBeTruthy())
    expect(take).not.toHaveBeenCalled()
    expect(goLive).not.toHaveBeenCalled()
    expect(searchBox().value).toBe('faith')
    expect(row.isConnected).toBe(true)
  })

  // The regression that retired the deferred-clear approach: a clear scheduled by the click
  // fired later with nothing re-checking whether the operator had typed since, so a query
  // started within the window was silently wiped mid-service. Nothing may empty the box but
  // the operator.
  it('a query typed after clicking a result is not wiped', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [], { tape: TAPE, search: SEARCH_HITS })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    clickTab('Message')
    await runSearch()
    const row = (await screen.findByText('Faith Is The Substance — ¶3')).closest('button') as HTMLButtonElement

    fireEvent.click(row)
    fireEvent.change(searchBox(), { target: { value: 'substance' } })
    expect(searchBox().value).toBe('substance')

    // Well past any double-click threshold: the box still holds what the operator typed.
    await new Promise((r) => setTimeout(r, 700))
    expect(searchBox().value).toBe('substance')
  })

  // The rail's only route back to the idle view is the search box itself — emptying it flips
  // `hasSearch` and the QUOTE SCHEDULE rows return. MessageSearchRail has no Esc handler and
  // no clear-the-query affordance of its own (its ✕ chip clears the tape SCOPE, not the
  // query), so this is the gesture, and it is unchanged by any of the above.
  it('emptying the search box returns the rail to the QUOTE SCHEDULE view', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [], { tape: TAPE, search: SEARCH_HITS })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    clickTab('Message')
    await runSearch()
    await screen.findByText('Faith Is The Substance — ¶3')

    fireEvent.change(searchBox(), { target: { value: '' } })
    await waitFor(() => expect(screen.getByText('QUOTE SCHEDULE')).toBeTruthy())
    expect(screen.queryByText('Faith Is The Substance — ¶3')).toBeNull()
  })

  // Clicking a tape row sets `scope` on that commit, but the re-scoped search is a round trip
  // away and nothing clears `q` any more (#58) — so for one round trip the PREVIOUS unscoped
  // quotes are still in hand. Rendering them drops their tape title and the section retitles
  // itself "QUOTES IN THIS TAPE", which says quotes from other tapes belong to this one.
  it('never shows another tape\'s quotes under the newly scoped tape', async () => {
    const TAPES: TapeRow[] = [
      { id: 'm1', tapeNo: '47-0412', title: 'Faith Is The Substance', date: '47-0412' },
      { id: 'm2', tapeNo: '65-1128', title: 'God Is Identified', date: '65-1128' }
    ]
    const QUOTES: QuoteRow[] = [
      { msgId: 'm1', tapeNo: '47-0412', title: 'Faith Is The Substance', ord: 2, label: '3', text: 'Third paragraph' },
      { msgId: 'm2', tapeNo: '65-1128', title: 'God Is Identified', ord: 4, label: '5', text: 'A different tape entirely' }
    ]
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [], {
      tape: TAPE,
      search: (_q, scope) => ({ tapes: TAPES, quotes: scope ? QUOTES.filter((x) => x.msgId === scope) : QUOTES })
    })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    clickTab('Message')
    await runSearch()
    await screen.findByText('A different tape entirely')

    // Scope to tape m1 — m2's quote must not survive into the scoped view, not even for the
    // one commit before the re-scoped results land.
    fireEvent.click(screen.getByText('Tape 47-0412 · 47-0412').closest('button') as HTMLButtonElement)
    expect(screen.queryByText('A different tape entirely')).toBeNull()
    expect(screen.queryByText('¶5')).toBeNull()

    // Once the scoped pass lands, this tape's own quote is listed under the scoped header.
    await waitFor(() => expect(screen.getByText('¶3')).toBeTruthy())
    expect(screen.getByText('QUOTES IN THIS TAPE')).toBeTruthy()
    expect(screen.queryByText('A different tape entirely')).toBeNull()
  })
})

describe('SermonMode — track state survives switching away (#60)', () => {
  it('returning to the slides track restores the same deck slide', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [], { media: [DECK] })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    clickTab('Slides')
    // Deck loaded, cued on slide 1 → the on-deck strip previews slide 2.
    await waitFor(() => expect(screen.getByText('Slide 2 of 3')).toBeTruthy())
    fireEvent.click(screen.getByText('Next slide ›'))
    await waitFor(() => expect(screen.getByText('Slide 3 of 3')).toBeTruthy())

    clickTab('Scripture')
    clickTab('Slides')
    await waitFor(() => expect(screen.getByText('Slide 3 of 3')).toBeTruthy())
  })

  it('returning to the message track restores the same paragraph', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, [], { tape: TAPE })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    clickTab('Message')
    await waitFor(() => expect(screen.getByText('Tape 47-0412 — ¶1')).toBeTruthy())
    fireEvent.click(screen.getByText('Next ¶ ›'))
    await waitFor(() => expect(screen.getByText('Tape 47-0412 — ¶2')).toBeTruthy())

    clickTab('Scripture')
    clickTab('Message')
    await waitFor(() => expect(screen.getByText('Tape 47-0412 — ¶2')).toBeTruthy())
  })

  it('double-clicking a paragraph takes it live', async () => {
    const { resolveChapter, take } = installHelmStub(NOTHING_LIVE, [], { tape: TAPE })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    clickTab('Message')
    // "Second paragraph" also appears in the on-deck preview (msgIdx 0's next paragraph),
    // so disambiguate to the ParagraphRail's row button specifically.
    await waitFor(() => expect(screen.getAllByText('Second paragraph').some((el) => el.closest('button'))).toBe(true))
    const row = screen.getAllByText('Second paragraph').find((el) => el.closest('button'))
    fireEvent.doubleClick(row as HTMLElement)
    await waitFor(() => expect(take).toHaveBeenCalledWith('msg:m1:1', expect.anything()))
  })

  it('double-clicking a quote-schedule row takes that quote live', async () => {
    const QS: QuoteScheduleItem[] = [
      { id: 'q1', msgId: 'm1', ord: 1, label: '2', tapeNo: '47-0412', title: 'Faith Is The Substance' }
    ]
    const { resolveChapter, take } = installHelmStub(NOTHING_LIVE, [], { tape: TAPE, quoteSchedule: QS })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    clickTab('Message')
    const row = await screen.findByText('¶2 · Tape 47-0412')
    fireEvent.doubleClick(row.closest('button') as HTMLButtonElement)
    await waitFor(() => expect(take).toHaveBeenCalledWith('msg:m1:1', expect.anything()))
  })

  // Keeping the tracks mounted must not let them drive main's presentation/video state
  // while another track is the surface the operator is using — the same hazard the
  // scripture show effect's `active && track === 'scripture'` gate closes one level up.
  it('hidden tracks do not cue or load video while scripture drives', async () => {
    const VIDEO: MediaItem = { id: 'v1', type: 'video', title: 'Promo', filePath: 'video/promo.mp4', slides: [], createdAt: 0 }
    const { cue, resolveChapter } = installHelmStub(NOTHING_LIVE, [], { media: [VIDEO], tape: TAPE })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())
    // Let the media/message loads land — then nothing may have been cued or loaded.
    await act(async () => {})
    expect(cue).not.toHaveBeenCalled()
    expect(window.helm.video.load).not.toHaveBeenCalled()

    // Revealing the slides track is what cues its selection and arms the video preview.
    clickTab('Slides')
    await waitFor(() => expect(cue).toHaveBeenCalledWith('pres:v1:0', expect.anything()))
    expect(window.helm.video.load).toHaveBeenCalledWith('pres:v1:0', 'helm-media://video/promo.mp4')
  })

  it('revealing the slides track again re-cues the slide the operator was on', async () => {
    const { cue, resolveChapter } = installHelmStub(NOTHING_LIVE, [], { media: [DECK] })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    clickTab('Slides')
    await waitFor(() => expect(cue).toHaveBeenCalledWith('pres:d1:0', expect.anything()))
    fireEvent.click(screen.getByText('Next slide ›'))
    await waitFor(() => expect(cue).toHaveBeenCalledWith('pres:d1:1', expect.anything()))

    clickTab('Scripture')
    cue.mockClear()
    // Coming back must restore main's cued state to the slide the track is showing —
    // another surface may have cued something else in between.
    clickTab('Slides')
    await waitFor(() => expect(cue).toHaveBeenCalledWith('pres:d1:1', expect.anything()))
  })

  // The tape deliberately keeps playing while its track is hidden (an operator may keep
  // listening while prepping slides, and a live follow-along must not freeze) — but its
  // paragraph-boundary cues must not stomp the cued preview another surface owns.
  it('a playing tape on a hidden message track does not stomp the cued preview', async () => {
    const { cue, resolveChapter } = installHelmStub(NOTHING_LIVE, [], { tape: TAPE })
    render(<Harness />)
    resolveChapter()
    // The message track is mounted (hidden) from the start; wait for its tape to load.
    await waitFor(() => expect(document.querySelector('audio')).toBeTruthy())
    cue.mockClear()

    // A timeupdate computes ord 0 (≠ TapePlayer's initial -1) and fires onActiveOrd.
    fireEvent.timeUpdate(document.querySelector('audio') as HTMLElement)
    expect(cue).not.toHaveBeenCalled()
  })

  it('the same playing tape keeps a LIVE reading view scrolling', async () => {
    const READING_LIVE: PresentationState = {
      output: 'live',
      liveKey: 'read:m1',
      liveSnap: { kind: 'blank' },
      cuedKey: null,
      cuedSnap: null
    }
    const { cue, resolveChapter } = installHelmStub(READING_LIVE, [], { tape: TAPE })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(document.querySelector('audio')).toBeTruthy())
    cue.mockClear()

    fireEvent.timeUpdate(document.querySelector('audio') as HTMLElement)
    await waitFor(() => expect(cue).toHaveBeenCalledWith('read:m1', expect.anything()))
  })

  it('switching tracks does not re-run the media or message list fetches', async () => {
    const { mediaList, messageList, resolveChapter } = installHelmStub(NOTHING_LIVE, [], {
      media: [DECK],
      tape: TAPE
    })
    render(<Harness />)
    resolveChapter()
    await waitFor(() => expect(screen.getByText('Verse 1')).toBeTruthy())

    clickTab('Slides')
    await waitFor(() => expect(mediaList).toHaveBeenCalled())
    clickTab('Message')
    await waitFor(() => expect(messageList).toHaveBeenCalled())
    clickTab('Scripture')
    clickTab('Slides')
    clickTab('Message')
    await act(async () => {})
    expect(mediaList).toHaveBeenCalledTimes(1)
    expect(messageList).toHaveBeenCalledTimes(1)
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

    // Flip away to Message and back. Under keep-alive (#60) ChapterRail no longer
    // remounts on a track switch, but the consumedNonce guard still matters for any
    // path that does remount it — either way, the already-satisfied request must not
    // replay after a track roundtrip.
    clickTab('Message')
    await waitFor(() => expect(panelHidden('scripture')).toBe(true))
    clickTab('Scripture')
    await waitFor(() => expect(panelHidden('scripture')).toBe(false))

    expect(scrollSpy).not.toHaveBeenCalled()
  })
})

describe('SermonMode — schedule multi-select and bulk delete', () => {
  const THREE: ScriptureReading[] = [
    { id: 'r1', book: 'Genesis', ch: 1, from: 1, to: 1 },
    { id: 'r2', book: 'Genesis', ch: 1, from: 2, to: 2 },
    { id: 'r3', book: 'Genesis', ch: 1, from: 3, to: 3 }
  ]
  // Schedule-row titles ("Genesis 1:1"/"1:2") can also appear as the hero's cursor
  // label or the on-deck "next verse" preview, neither of which is a <button> — only
  // the schedule row itself is, so scoping to a button ancestor disambiguates without
  // caring which non-row surface happens to echo the same text at a given cursor
  // position.
  const rowButton = (title: string): HTMLElement => {
    const match = screen.getAllByText(title).find((el) => el.closest('button'))
    if (!match) throw new Error(`no row button found for "${title}"`)
    return match.closest('button') as HTMLElement
  }
  // The schedule's rows, in rail order. Reads the rows' own marker rather than matching
  // on text, for the same reason rowButton scopes to a button: the hero and the on-deck
  // preview echo the same reference strings.
  const scheduleRowTitles = (): string[] =>
    Array.from(document.querySelectorAll('[data-schedule-row]')).map(
      (el) => el.querySelector('div > div')?.textContent ?? ''
    )

  it('shift-click selects the contiguous run without moving the rail cursor', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, THREE)
    render(<Harness />)
    resolveChapter()
    await waitFor(() => rowButton('Genesis 1:1'))

    fireEvent.click(rowButton('Genesis 1:1'))
    fireEvent.click(rowButton('Genesis 1:3'), { shiftKey: true })

    for (const t of ['Genesis 1:1', 'Genesis 1:2', 'Genesis 1:3']) {
      expect(rowButton(t).getAttribute('data-selected')).toBe('true')
    }
  })

  // Two quick shift-clicks on a row register as a double-click; #58's take must not
  // fire mid-range-selection or extending a selection could put a verse on screen.
  it('shift-double-click on a schedule row never takes the screen', async () => {
    const { resolveChapter, take } = installHelmStub(NOTHING_LIVE, THREE)
    render(<Harness />)
    resolveChapter()
    await waitFor(() => rowButton('Genesis 1:1'))

    fireEvent.click(rowButton('Genesis 1:1'))
    fireEvent.click(rowButton('Genesis 1:3'), { shiftKey: true })
    fireEvent.doubleClick(rowButton('Genesis 1:3'), { shiftKey: true })

    expect(take).not.toHaveBeenCalled()
    for (const t of ['Genesis 1:1', 'Genesis 1:2', 'Genesis 1:3']) {
      expect(rowButton(t).getAttribute('data-selected')).toBe('true')
    }
  })

  it('Delete drops the whole selection from the rail at once and arms a batch undo', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, THREE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => rowButton('Genesis 1:1'))

    fireEvent.click(rowButton('Genesis 1:1'))
    fireEvent.click(rowButton('Genesis 1:2'), { shiftKey: true })
    act(() => keyHandlerRef.current?.onDelete?.())

    // The rail leads the round trip — mid-service a delete must not visibly lag (#86).
    expect(scheduleRowTitles()).toEqual(['Genesis 1:3'])
    await screen.findByText(/2 readings/)
  })

  it('defers the real removeMany until the undo window closes, then sends one call', async () => {
    const { resolveChapter, removeMany } = installHelmStub(NOTHING_LIVE, THREE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => rowButton('Genesis 1:1'))

    // Fake timers only from here: installed before the delete, so the undo window's own
    // timeout is the one being advanced (the async mount above needs real timers).
    vi.useFakeTimers()
    try {
      fireEvent.click(rowButton('Genesis 1:1'))
      fireEvent.click(rowButton('Genesis 1:2'), { shiftKey: true })
      act(() => keyHandlerRef.current?.onDelete?.())

      // Nothing has actually been deleted yet — that is what makes the undo exact.
      expect(removeMany).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(removeMany).toHaveBeenCalledTimes(1)
      expect(removeMany).toHaveBeenCalledWith(['r1', 'r2'])
    } finally {
      vi.useRealTimers()
    }
  })

  // The behaviour #86 asks for: undo used to re-add via schedule.add, which APPENDS, so
  // undoing a delete silently moved the reading to the bottom of the service. It now
  // cancels a delete that never happened and re-reads the list, which is exact.
  it('undo restores by re-reading the schedule, never by re-adding', async () => {
    const { resolveChapter, add, scheduleList } = installHelmStub(NOTHING_LIVE, THREE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => rowButton('Genesis 1:1'))
    const listCallsBefore = scheduleList.mock.calls.length

    fireEvent.click(rowButton('Genesis 1:1'))
    fireEvent.click(rowButton('Genesis 1:2'), { shiftKey: true })
    act(() => keyHandlerRef.current?.onDelete?.())
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(scheduleList.mock.calls.length).toBe(listCallsBefore + 1))
    expect(add).not.toHaveBeenCalled()
    // The rows come back in their original order, not appended after Genesis 1:3.
    await waitFor(() => rowButton('Genesis 1:1'))
    expect(scheduleRowTitles()).toEqual(['Genesis 1:1', 'Genesis 1:2', 'Genesis 1:3'])
  })

  it('a taken undo never commits the delete, however long the operator waits', async () => {
    const { resolveChapter, removeMany } = installHelmStub(NOTHING_LIVE, THREE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => rowButton('Genesis 1:1'))

    vi.useFakeTimers()
    try {
      fireEvent.click(rowButton('Genesis 1:1'))
      act(() => keyHandlerRef.current?.onDelete?.())
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      act(() => {
        vi.advanceTimersByTime(60000)
      })
      expect(removeMany).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('single-item delete still works and keeps its formatRef toast label', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, THREE)
    const keyHandlerRef: ModeKeyHandlerRef = { current: null }
    render(<Harness keyHandlerRef={keyHandlerRef} />)
    resolveChapter()
    await waitFor(() => rowButton('Genesis 1:2'))

    fireEvent.click(rowButton('Genesis 1:2'))
    act(() => keyHandlerRef.current?.onDelete?.())

    // Toast label is the ref, not "1 readings". Anchor on the toast's own "Removed"
    // text — the row title also reads "Genesis 1:2", so matching the ref alone could
    // pass against the not-yet-unmounted row.
    await waitFor(() => expect(screen.getByText(/Removed/).textContent).toMatch(/Genesis 1:2/))
    expect(screen.queryByText(/1 readings/)).toBeNull()
    expect(scheduleRowTitles()).toEqual(['Genesis 1:1', 'Genesis 1:3'])
  })

  it('Clear all empties the rail in one batch, recoverable via undo', async () => {
    const { resolveChapter, removeMany } = installHelmStub(NOTHING_LIVE, THREE)
    render(<Harness />)
    resolveChapter()
    await screen.findByText('Genesis 1:1')

    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

      expect(scheduleRowTitles()).toEqual([])
      expect(screen.getByText(/3 readings/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()

      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(removeMany).toHaveBeenCalledTimes(1)
      expect(removeMany).toHaveBeenCalledWith(['r1', 'r2', 'r3'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('Clear all is a real button, and is offered only while the schedule has rows', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, THREE)
    render(<Harness />)
    resolveChapter()
    await screen.findByText('Genesis 1:1')

    // #86: the most destructive in-service control must not be the smallest target.
    const clear = screen.getByRole('button', { name: 'Clear all' })
    expect(clear.style.height).toBe('26px')

    vi.useFakeTimers()
    try {
      fireEvent.click(clear)
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear all' })).toBeTruthy())
  })

  it('shows an inviting empty state once the schedule is cleared', async () => {
    const { resolveChapter } = installHelmStub(NOTHING_LIVE, THREE)
    render(<Harness />)
    resolveChapter()
    await screen.findByText('Genesis 1:1')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

    // #88: an empty list names what belongs here AND how to put something in it.
    const empty = await screen.findByText(/Readings you add will wait here/)
    expect(empty.textContent).toMatch(/\+ Add/)
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()
  })
})
