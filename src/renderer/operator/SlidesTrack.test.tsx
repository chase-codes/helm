// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { SlidesTrack } from './SlidesTrack'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { MediaItem, PresentationState } from '../../shared/types'
import type { PanelWidthControl } from './usePanelWidth'

// This project's vitest config does not set `globals: true`, so
// @testing-library/react's auto afterEach(cleanup) never registers; without
// this, DOM from one test leaks into the next.
afterEach(cleanup)

const items: MediaItem[] = [
  { id: 'deck1', type: 'deck', title: 'Sermon.pptx', filePath: null, slides: ['deck1/1.png', 'deck1/2.png'], createdAt: 1 },
  { id: 'img1', type: 'image', title: 'Welcome.jpg', filePath: 'img1.jpg', slides: [], createdAt: 2 },
  { id: 'vid1', type: 'video', title: 'Promo.mp4', filePath: 'video/promo.mp4', slides: [], createdAt: 3 }
]

// Shared presentation/video sub-objects, used by both the default stub and any
// test that needs a variant helm (e.g. an empty library) without duplicating
// the whole shape.
type StubHelm = {
  presentation: {
    get: () => Promise<PresentationState>
    cue: ReturnType<typeof vi.fn>
    goLive: ReturnType<typeof vi.fn>
    setOutput: ReturnType<typeof vi.fn>
    onState: () => () => void
  }
  video: Record<string, unknown>
}

function baseHelm(): StubHelm {
  const state: PresentationState = { output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null }
  return {
    presentation: {
      get: () => Promise.resolve(state),
      cue: vi.fn(),
      goLive: vi.fn(),
      setOutput: vi.fn(),
      onState: () => () => {}
    },
    video: {
      get: () => Promise.resolve({ key: null, src: null, playing: false, positionMs: 0, durationMs: 0, volume: 1, muted: false }),
      onState: () => () => {},
      load: vi.fn(), play: vi.fn(), pause: vi.fn(),
      seek: vi.fn(), setVolume: vi.fn(), setMuted: vi.fn(), reportDuration: vi.fn()
    }
  }
}

function makeHelm(): StubHelm & { media: Record<string, unknown> } {
  return {
    ...baseHelm(),
    media: {
      list: () => Promise.resolve(items),
      importImages: vi.fn(() => Promise.resolve({ items })),
      importVideo: vi.fn(() => Promise.resolve({ items })),
      importDeck: vi.fn(() => Promise.resolve({ items })),
      remove: vi.fn(() => Promise.resolve(items)),
      onImportProgress: () => () => {}
    }
  }
}

function installHelmStub(): { goLive: ReturnType<typeof vi.fn>; cue: ReturnType<typeof vi.fn> } {
  const helm = makeHelm()
  ;(window as unknown as { helm: unknown }).helm = helm
  return { goLive: helm.presentation.goLive, cue: helm.presentation.cue }
}

const stubPanel = (width: number): PanelWidthControl => ({ width, dragging: false, startDrag: vi.fn() })

function renderTrack(opts?: { leftPanel?: PanelWidthControl; rightPanel?: PanelWidthControl }): ReturnType<typeof render> {
  return render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <SlidesTrack
        slidesKeyRef={{ current: null }}
        active
        track="slides"
        setTrack={() => {}}
        leftPanel={opts?.leftPanel ?? stubPanel(270)}
        rightPanel={opts?.rightPanel ?? stubPanel(330)}
      />
    </ThemeCtx.Provider>
  )
}

describe('SlidesTrack', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders both library item titles from media.list', async () => {
    installHelmStub()
    renderTrack()
    expect(await screen.findByText('▤ Sermon.pptx')).toBeTruthy()
    expect(await screen.findByText('▣ Welcome.jpg')).toBeTruthy()
  })

  it('selecting the deck shows its numbered slide rail', async () => {
    installHelmStub()
    renderTrack()
    const deckRow = (await screen.findByText('▤ Sermon.pptx')).closest('button') as HTMLButtonElement
    fireEvent.click(deckRow)
    expect(await screen.findByText('1')).toBeTruthy()
    expect(await screen.findByText('2')).toBeTruthy()
  })

  it('does not show a slide rail for a single-slide image item', async () => {
    installHelmStub()
    renderTrack()
    const imgRow = (await screen.findByText('▣ Welcome.jpg')).closest('button') as HTMLButtonElement
    fireEvent.click(imgRow)
    expect(screen.queryByText('1')).toBeNull()
  })

  it('Go Live calls presentation.goLive with a pres: key', async () => {
    const { goLive } = installHelmStub()
    renderTrack()
    await screen.findByText('▤ Sermon.pptx')
    const goLiveBtn = (await screen.findByText('Go live')).closest('button') as HTMLButtonElement
    fireEvent.click(goLiveBtn)
    expect(goLive).toHaveBeenCalledWith(expect.stringMatching(/^pres:/), expect.anything())
  })

  it('shows the LibreOffice-missing fallback modal when importDeck reports no-libreoffice', async () => {
    installHelmStub()
    window.helm.media.importDeck = vi.fn(async () => ({ items: [], error: 'no-libreoffice' as const }))
    renderTrack()
    const importBtn = (await screen.findByText('+ Import')).closest('button') as HTMLButtonElement
    fireEvent.click(importBtn)
    const pptBtn = (await screen.findByText('Slides / PDF')).closest('button') as HTMLButtonElement
    fireEvent.click(pptBtn)
    expect(
      await screen.findByText(
        'Install LibreOffice to import PowerPoint decks, or export your slides as images and add them individually.'
      )
    ).toBeTruthy()
  })

  it('shows an importing spinner while a deck import is in flight, then clears it', async () => {
    installHelmStub()
    let resolveImport!: (r: { items: MediaItem[] }) => void
    window.helm.media.importDeck = vi.fn(() => new Promise<{ items: MediaItem[] }>((res) => { resolveImport = res }))
    renderTrack()
    await screen.findByText('▤ Sermon.pptx')
    fireEvent.click((await screen.findByText('+ Import')).closest('button') as HTMLButtonElement)
    fireEvent.click((await screen.findByText('Slides / PDF')).closest('button') as HTMLButtonElement)
    expect(await screen.findByText(/Importing/i)).toBeTruthy()
    resolveImport({ items })
    await waitFor(() => expect(screen.queryByText(/Importing/i)).toBeNull())
  })

  it('a canceled import (canceled:true) leaves the current selection untouched', async () => {
    const { cue } = installHelmStub()
    // Select the image item first, so we can prove a canceled deck-import doesn't
    // silently steal selection back to the deck (items[0]).
    renderTrack()
    const imgRow = (await screen.findByText('▣ Welcome.jpg')).closest('button') as HTMLButtonElement
    fireEvent.click(imgRow)
    await screen.findByText('▣ Welcome.jpg')
    cue.mockClear()

    // Simulate a cancelled OS file picker via the explicit `canceled` flag (Task 2's
    // MediaImportResult), not an id-diff heuristic.
    window.helm.media.importDeck = vi.fn(async () => ({ items, canceled: true }))
    const importBtn = (await screen.findByText('+ Import')).closest('button') as HTMLButtonElement
    fireEvent.click(importBtn)
    const pptBtn = (await screen.findByText('Slides / PDF')).closest('button') as HTMLButtonElement
    fireEvent.click(pptBtn)

    // Give the resolved promise a tick to flush.
    await screen.findByText('▣ Welcome.jpg')
    // No slide rail (deck rail only renders when a deck is selected) — selection is
    // still the image, not silently reassigned to items[0] (the deck).
    expect(screen.queryByText('1')).toBeNull()
    expect(screen.queryByText('2')).toBeNull()
    // The cue effect must not have re-fired for the deck as a result of the cancel.
    expect(cue).not.toHaveBeenCalledWith(expect.stringContaining('deck1'), expect.anything())
  })

  it('auto-selects a newly imported image (non-empty library) instead of keeping the old selection', async () => {
    installHelmStub()
    const newItem: MediaItem = { id: 'imgNEW', type: 'image', title: 'New.jpg', filePath: 'imgNEW.jpg', slides: [], createdAt: 9 }
    window.helm.media.importImages = vi.fn(async () => ({ items: [newItem, ...items] }))
    renderTrack()
    await screen.findByText('▤ Sermon.pptx')       // library loaded, deck selected by default
    fireEvent.click((await screen.findByText('+ Import')).closest('button') as HTMLButtonElement)
    fireEvent.click((await screen.findByText('Images')).closest('button') as HTMLButtonElement)
    // The new image becomes selected (its row shows the live dot), old deck no longer selected.
    await screen.findByText('▣ New.jpg')
    await waitFor(() => {
      const row = (screen.getByText('▣ New.jpg').closest('button')) as HTMLButtonElement
      expect(row.querySelector('span[style*="border-radius: 50%"]')).toBeTruthy()
    })
  })

  it('shows a brief "Imported ✓" confirmation after a successful import', async () => {
    installHelmStub()
    const newItem: MediaItem = { id: 'imgNEW', type: 'image', title: 'New.jpg', filePath: 'imgNEW.jpg', slides: [], createdAt: 9 }
    window.helm.media.importImages = vi.fn(async () => ({ items: [newItem, ...items] }))
    renderTrack()
    await screen.findByText('▤ Sermon.pptx')
    fireEvent.click((await screen.findByText('+ Import')).closest('button') as HTMLButtonElement)
    fireEvent.click((await screen.findByText('Images')).closest('button') as HTMLButtonElement)
    expect(await screen.findByText(/Imported/)).toBeTruthy()
  })

  it('selecting a video item loads it into the shared video state', async () => {
    installHelmStub()
    renderTrack()
    const vidRow = (await screen.findByText('▶ Promo.mp4')).closest('button') as HTMLButtonElement
    fireEvent.click(vidRow)
    await waitFor(() =>
      expect(window.helm.video.load).toHaveBeenCalledWith('pres:vid1:0', 'helm-media://video/promo.mp4')
    )
  })

  it('going live on a video lands it paused (no surprise audio on go-live)', async () => {
    installHelmStub()
    renderTrack()
    const vidRow = (await screen.findByText('▶ Promo.mp4')).closest('button') as HTMLButtonElement
    fireEvent.click(vidRow)
    const goLiveBtn = (await screen.findByText('Go live')).closest('button') as HTMLButtonElement
    fireEvent.click(goLiveBtn)
    await waitFor(() => expect(window.helm.video.pause).toHaveBeenCalled())
    expect(window.helm.presentation.goLive).toHaveBeenCalledWith('pres:vid1:0', expect.anything())
  })

  it('a selected video item renders the synced VideoCanvas (not just a poster) in the hero', async () => {
    installHelmStub()
    renderTrack()
    const vidRow = (await screen.findByText('▶ Promo.mp4')).closest('button') as HTMLButtonElement
    fireEvent.click(vidRow)
    // VideoCanvas renders <video playsInline> with NO preload attribute; SlideCanvas
    // posters (e.g. the left-rail thumbnails) always have preload="metadata". A video
    // element lacking preload="metadata" therefore proves the heroMedia/VideoCanvas
    // wiring is present — a bare querySelector('video') would match a rail poster instead.
    await waitFor(() => {
      const videos = Array.from(document.querySelectorAll('video'))
      expect(videos.some((v) => v.getAttribute('preload') !== 'metadata')).toBe(true)
    })
  })

  it('shows an empty-state hint when the library has no items', async () => {
    const empty = { ...makeHelm(), media: { list: () => Promise.resolve([]),
      importImages: vi.fn(() => Promise.resolve({ items: [] })),
      importVideo: vi.fn(() => Promise.resolve({ items: [] })),
      importDeck: vi.fn(() => Promise.resolve({ items: [] })),
      remove: vi.fn(() => Promise.resolve([])),
      onImportProgress: () => () => {} } };
    (window as unknown as { helm: unknown }).helm = empty;
    renderTrack()
    expect(await screen.findByText(/No media yet/i)).toBeTruthy()
  })

  it('the import menu opens downward (top-anchored, not bottom-anchored)', async () => {
    installHelmStub()
    renderTrack()
    const importBtn = (await screen.findByText('+ Import')).closest('button') as HTMLButtonElement
    fireEvent.click(importBtn)
    const menu = (await screen.findByText('Images')).closest('div') as HTMLElement
    // The popover container carries an explicit top offset and no bottom offset.
    expect(menu.style.bottom).toBe('')
    expect(menu.style.top).not.toBe('')
  })

  it('right-click Delete drops the row locally and arms an Undo toast without an immediate IPC remove', async () => {
    installHelmStub()
    renderTrack()
    const row = (await screen.findByText('▣ Welcome.jpg')).closest('button') as HTMLButtonElement
    fireEvent.contextMenu(row)
    fireEvent.click(await screen.findByText('Delete'))
    // Optimistically gone from the list, undo offered, but nothing deleted on disk yet.
    await waitFor(() => expect(screen.queryByText('▣ Welcome.jpg')).toBeNull())
    expect(await screen.findByText(/Removed/)).toBeTruthy()
    expect(window.helm.media.remove).not.toHaveBeenCalled()
  })

  it('Undo restores the row and never calls media.remove', async () => {
    installHelmStub()
    renderTrack()
    const row = (await screen.findByText('▣ Welcome.jpg')).closest('button') as HTMLButtonElement
    fireEvent.contextMenu(row)
    fireEvent.click(await screen.findByText('Delete'))
    fireEvent.click(await screen.findByText('Undo'))
    expect(await screen.findByText('▣ Welcome.jpg')).toBeTruthy()
    expect(window.helm.media.remove).not.toHaveBeenCalled()
  })

  it('after the undo window expires, the removal commits via media.remove', async () => {
    vi.useFakeTimers()
    try {
      installHelmStub()
      renderTrack()
      // findByText uses real timers internally; query synchronously after flushing microtasks.
      await vi.waitFor(() => expect(screen.getByText('▣ Welcome.jpg')).toBeTruthy())
      fireEvent.contextMenu(screen.getByText('▣ Welcome.jpg').closest('button') as HTMLButtonElement)
      fireEvent.click(screen.getByText('Delete'))
      act(() => { vi.advanceTimersByTime(5200) }) // useTimedUndo default 5000ms
      expect(window.helm.media.remove).toHaveBeenCalledWith('img1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('deleting a second item while one is pending commits the first immediately (no dropped delete)', async () => {
    installHelmStub()
    renderTrack()
    // Delete deck1 (arms undo), then delete img1 before the toast expires.
    fireEvent.contextMenu((await screen.findByText('▤ Sermon.pptx')).closest('button') as HTMLButtonElement)
    fireEvent.click(await screen.findByText('Delete'))
    fireEvent.contextMenu((await screen.findByText('▣ Welcome.jpg')).closest('button') as HTMLButtonElement)
    fireEvent.click(await screen.findByText('Delete'))
    // The superseded first delete committed now; the second is still pending (not yet committed).
    await waitFor(() => expect(window.helm.media.remove).toHaveBeenCalledWith('deck1'))
    expect(window.helm.media.remove).not.toHaveBeenCalledWith('img1')
  })

  it('unmounting with a pending delete commits it (no dropped delete on track switch)', async () => {
    installHelmStub()
    const view = render(
      <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
        <SlidesTrack
          slidesKeyRef={{ current: null }}
          active
          track="slides"
          setTrack={() => {}}
          leftPanel={stubPanel(270)}
          rightPanel={stubPanel(330)}
        />
      </ThemeCtx.Provider>
    )
    fireEvent.contextMenu((await screen.findByText('▣ Welcome.jpg')).closest('button') as HTMLButtonElement)
    fireEvent.click(await screen.findByText('Delete'))
    view.unmount()
    await waitFor(() => expect(window.helm.media.remove).toHaveBeenCalledWith('img1'))
  })

  it('renders both resize dividers wired to the panel controls', async () => {
    installHelmStub()
    const left = stubPanel(270)
    const right = stubPanel(330)
    const r = renderTrack({ leftPanel: left, rightPanel: right })
    await screen.findByText('▤ Sermon.pptx')
    const dividers = r.getAllByTitle('Drag to resize')
    expect(dividers).toHaveLength(2)
    fireEvent.mouseDown(dividers[0], { clientX: 10 })
    expect(left.startDrag).toHaveBeenCalled()
    fireEvent.mouseDown(dividers[1], { clientX: 10 })
    expect(right.startDrag).toHaveBeenCalled()
  })

  it('renders only the left divider when the selected item has no right panel', async () => {
    installHelmStub()
    const left = stubPanel(270)
    const right = stubPanel(330)
    const r = renderTrack({ leftPanel: left, rightPanel: right })
    // An image item has no right-hand panel (unlike a deck or video), so the right
    // divider must not render alongside nothing to divide.
    const imgRow = (await r.findByText('▣ Welcome.jpg')).closest('button') as HTMLButtonElement
    fireEvent.click(imgRow)
    await waitFor(() => expect(r.queryByText('1')).toBeNull()) // no deck slide rail up
    const dividers = r.getAllByTitle('Drag to resize')
    expect(dividers).toHaveLength(1)
    fireEvent.mouseDown(dividers[0], { clientX: 10 })
    expect(left.startDrag).toHaveBeenCalled()
    expect(right.startDrag).not.toHaveBeenCalled()
  })
})
