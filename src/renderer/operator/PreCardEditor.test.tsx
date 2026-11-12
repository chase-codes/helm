// @vitest-environment jsdom
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JSX } from 'react'
import { PreCardEditor } from './PreCardEditor'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type {
  BibleManifestEntry,
  BookExtent,
  ChapterData,
  MediaItem,
  PreCard,
  VerseSearchResult
} from '../../shared/types'

afterEach(cleanup)

const KJV: BibleManifestEntry = { id: 'kjv', abbr: 'KJV', name: 'King James', installed: true }
const WEB: BibleManifestEntry = { id: 'web', abbr: 'WEB', name: 'World English', installed: true }

// A three-verse chapter served for whatever book and chapter is asked for, so a test can
// name any reference and still know the words it should get back.
const chapterFor = (book: string, chapter: number): ChapterData => ({
  book,
  chapter,
  verseCount: 3,
  verses: {
    1: { kjv: `${book} ${chapter}:1 kjv`, web: `${book} ${chapter}:1 web` },
    2: { kjv: `${book} ${chapter}:2 kjv`, web: `${book} ${chapter}:2 web` },
    3: { kjv: `${book} ${chapter}:3 kjv`, web: `${book} ${chapter}:3 web` }
  }
})
// Five chapters to a book, except the Psalms, which need their real length for Psalm 122.
const extentFor = (book: string): BookExtent => {
  const chapters = book.startsWith('Psalm') ? 150 : 5
  return { chapters, verseCounts: Array.from({ length: chapters }, () => 3) }
}

interface HelmOver {
  manifest?: BibleManifestEntry[]
  versions?: string[]
  getChapter?: (book: string, ch: number) => Promise<ChapterData>
  search?: (q: string, versionId: string) => Promise<VerseSearchResult>
  media?: MediaItem[]
  imported?: MediaItem[]
}

function installHelm(over: HelmOver = {}): {
  saveCard: ReturnType<typeof vi.fn>
  search: ReturnType<typeof vi.fn>
} {
  const saveCard = vi.fn()
  const search = vi.fn(
    over.search ?? ((_q: string, versionId: string) => Promise.resolve({ hits: [], total: 0, versionId }))
  )
  ;(window as unknown as { helm: unknown }).helm = {
    preservice: { saveCard, removeCard: vi.fn() },
    bibles: {
      manifest: () => Promise.resolve(over.manifest ?? [KJV]),
      getChapter: over.getChapter ?? ((book: string, ch: number) => Promise.resolve(chapterFor(book, ch))),
      bookExtent: (book: string) => Promise.resolve(extentFor(book)),
      search
    },
    settings: {
      get: (_key: string, fallback: unknown) => Promise.resolve(over.versions ?? fallback),
      set: vi.fn()
    },
    media: {
      list: () => Promise.resolve(over.media ?? []),
      importImages: () => Promise.resolve({ items: [...(over.media ?? []), ...(over.imported ?? [])] })
    }
  }
  return { saveCard, search }
}

function renderEditor(card: PreCard | null = null, onClose: () => void = () => {}): void {
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <PreCardEditor card={card} onClose={onClose} onRemove={() => {}} />
    </ThemeCtx.Provider>
  )
}

const entry = (): HTMLInputElement =>
  screen.getByPlaceholderText('John 3:16, or search a word') as HTMLInputElement
const verseText = (): HTMLTextAreaElement =>
  screen.getByPlaceholderText('Pick a verse on the left, or type the words here') as HTMLTextAreaElement
const items = (): HTMLTextAreaElement =>
  screen.getByPlaceholderText(/The Hollis family/) as HTMLTextAreaElement
const saveButton = (): HTMLButtonElement => document.querySelector('[data-save]') as HTMLButtonElement
const view = (): string | null =>
  document.querySelector('[data-verse-view]')?.getAttribute('data-verse-view') ?? null

/** Type into the reference entry one key at a time, as the builder receives it. */
function type(text: string): void {
  for (const key of text) fireEvent.keyDown(entry(), { key })
}

/** The editor reads the installed Bible as it opens; nothing resolves until it has. */
async function opened(): Promise<void> {
  await waitFor(() => expect(view()).not.toBeNull())
}

describe('PreCardEditor verse finder', () => {
  it('opens with the caret in the reference entry', async () => {
    installHelm()
    renderEditor()
    await opened()
    expect(document.activeElement).toBe(entry())
  })

  it('completes a book name the way the Scripture track does', async () => {
    installHelm()
    renderEditor()
    await opened()
    type('joh')
    expect(document.querySelector('[data-ghost-text]')?.textContent).toBe('n')
    type(' ')
    expect(entry().value).toBe('John')
  })

  it('fills the card as soon as the reference names a verse', async () => {
    installHelm()
    renderEditor()
    await opened()
    type('joh 3:2')
    await waitFor(() => expect(verseText().value).toBe('John 3:2 kjv'))
    expect(screen.getByTestId('pre-card-preview').textContent).toContain('John 3:2')
  })

  it('offers the chapters of a book, then its verses to read', async () => {
    installHelm()
    renderEditor()
    await opened()
    type('joh ')
    await waitFor(() => expect(document.querySelectorAll('[data-pick-chapter]').length).toBe(5))
    fireEvent.click(document.querySelector('[data-pick-chapter="4"]') as HTMLElement)
    await waitFor(() => expect(document.querySelectorAll('[data-pick-verse]').length).toBe(3))
    expect(screen.getByText('John 4:3 kjv')).toBeTruthy()
    // Opening a chapter is reading, not picking: nothing is on the card yet.
    expect(verseText().value).toBe('')
  })

  it('a click picks a verse and a Shift-click builds a range onto one card', async () => {
    const { saveCard } = installHelm()
    renderEditor()
    await opened()
    type('joh 3')
    await waitFor(() => expect(document.querySelectorAll('[data-pick-verse]').length).toBe(3))
    fireEvent.click(document.querySelector('[data-pick-verse="1"]') as HTMLElement)
    await waitFor(() => expect(verseText().value).toBe('John 3:1 kjv'))
    fireEvent.click(document.querySelector('[data-pick-verse="3"]') as HTMLElement, { shiftKey: true })
    await waitFor(() => expect(verseText().value).toBe('John 3:1 kjv John 3:2 kjv John 3:3 kjv'))
    expect(document.querySelectorAll('[data-pick-verse][data-selected]').length).toBe(3)
    fireEvent.click(saveButton())
    expect(saveCard).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'verse', ref: 'John 3:1–3', title: 'John 3:1–3', version: 'KJV' })
    )
  })

  it('steps to the next chapter and ghosts ‹ Previous on the first', async () => {
    installHelm()
    renderEditor()
    await opened()
    type('joh 1')
    await waitFor(() => expect(document.querySelectorAll('[data-pick-verse]').length).toBe(3))
    expect((screen.getByTitle('Previous chapter') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTitle('Next chapter'))
    await waitFor(() => expect(screen.getByText('John 2:1 kjv')).toBeTruthy())
    expect(entry().value).toBe('John 2')
  })

  it('searches words, shows a clicked hit on the card, and keeps the results up', async () => {
    const hit = { book: 'John', chapter: 3, verse: 2, text: 'love one another', score: 1 }
    const { search } = installHelm({
      search: (_q, versionId) =>
        Promise.resolve({ hits: [hit], total: 1, versionId } as unknown as VerseSearchResult)
    })
    renderEditor()
    await opened()
    type('love one')
    await waitFor(() => expect(search).toHaveBeenCalledWith('love one', 'kjv'))
    const row = await waitFor(() => {
      const r = [...document.querySelectorAll('[data-search-row]')].find((el) =>
        el.textContent?.includes('John 3:2')
      )
      expect(r).toBeTruthy()
      return r as HTMLElement
    })
    fireEvent.click(row)
    await waitFor(() => expect(verseText().value).toBe('John 3:2 kjv'))
    expect(view()).toBe('search')
    expect(entry().value).toBe('love one')
  })

  it('Enter on a hit opens its chapter around it', async () => {
    const hit = { book: 'John', chapter: 3, verse: 2, text: 'love one another', score: 1 }
    installHelm({
      search: (_q, versionId) =>
        Promise.resolve({ hits: [hit], total: 1, versionId } as unknown as VerseSearchResult)
    })
    renderEditor()
    await opened()
    type('love one')
    await waitFor(() => expect(screen.getByText('1 VERSE · KJV')).toBeTruthy())
    // The story table may list passages above the verse hit; arrow to the last row.
    const rows = document.querySelectorAll('[data-search-row]').length
    for (let i = 1; i < rows; i++) fireEvent.keyDown(entry(), { key: 'ArrowDown' })
    fireEvent.keyDown(entry(), { key: 'Enter' })
    await waitFor(() => expect(entry().value).toBe('John 3:2'))
    expect(view()).toBe('verses')
    await waitFor(() => expect(verseText().value).toBe('John 3:2 kjv'))
  })

  it("reads from the Scripture track's primary translation", async () => {
    installHelm({ manifest: [KJV, WEB], versions: ['web', 'kjv'] })
    renderEditor()
    await opened()
    type('joh 3:2')
    await waitFor(() => expect(verseText().value).toBe('John 3:2 web'))
  })

  it('Escape clears the entry first and leaves the press there', async () => {
    installHelm()
    const onDocEscape = vi.fn()
    const onDocKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDocEscape()
    }
    document.addEventListener('keydown', onDocKey)
    renderEditor()
    await opened()
    type('joh')
    fireEvent.keyDown(entry(), { key: 'Escape' })
    expect(entry().value).toBe('')
    expect(onDocEscape).not.toHaveBeenCalled()
    // Already empty: the press goes on to the page ladder, which closes the editor.
    fireEvent.keyDown(entry(), { key: 'Escape' })
    expect(onDocEscape).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', onDocKey)
  })

  it('says so when the Bible cannot be reached, and leaves the card alone', async () => {
    installHelm({ getChapter: () => Promise.reject(new Error('ipc down')) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderEditor()
    await opened()
    type('joh 3:2')
    expect(await screen.findByText('Couldn’t reach the Bible. Try again.')).toBeTruthy()
    expect(verseText().value).toBe('')
    vi.restoreAllMocks()
  })

  it('points at Settings when no Bible is installed, and still takes typed words', async () => {
    const { saveCard } = installHelm({ manifest: [] })
    renderEditor()
    await opened()
    expect(screen.getByText('Install a Bible in Settings → Bibles')).toBeTruthy()
    type('acts 2:3')
    await waitFor(() => expect(screen.getByDisplayValue('Acts 2:3')).toBeTruthy())
    fireEvent.change(verseText(), { target: { value: 'Repent…' } })
    fireEvent.click(saveButton())
    expect(saveCard).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'verse', ref: 'Acts 2:3', text: 'Repent…' })
    )
    expect(saveCard.mock.calls[0][0].version).toBeUndefined()
  })

  it('ghosts Add to loop until there is a verse, and says why', async () => {
    const { saveCard } = installHelm()
    renderEditor()
    await opened()
    expect(saveButton().disabled).toBe(true)
    expect(saveButton().title).toBe('Pick a verse first')
    expect(document.querySelector('[data-preview-empty]')).toBeTruthy()
    fireEvent.keyDown(entry(), { key: 'Enter', metaKey: true })
    expect(saveCard).not.toHaveBeenCalled()
  })
})

describe('PreCardEditor editing a saved verse card', () => {
  const saved: PreCard = {
    id: 'c1',
    type: 'verse',
    title: 'Psalm 122:1',
    ref: 'Psalm 122:1',
    text: 'hand-corrected words',
    version: 'KJV',
    enabled: true
  }

  it('opens on its chapter without overwriting the stored words', async () => {
    installHelm()
    renderEditor(saved)
    await waitFor(() => expect(document.querySelectorAll('[data-pick-verse]').length).toBe(3))
    // Flush the fill that would have run had opening counted as a pick.
    await act(async () => {})
    expect(entry().value).toBe('Psalm 122:1')
    expect(verseText().value).toBe('hand-corrected words')
    expect(document.querySelector('[data-pick-verse="1"]')?.getAttribute('data-selected')).toBe('true')
  })

  it('clicking the verse again restores the Bible’s words', async () => {
    installHelm()
    renderEditor(saved)
    await waitFor(() => expect(document.querySelectorAll('[data-pick-verse]').length).toBe(3))
    fireEvent.click(document.querySelector('[data-pick-verse="1"]') as HTMLElement)
    await waitFor(() => expect(verseText().value).toBe('Psalm 122:1 kjv'))
  })

  it('renames an automatically named card when its verse changes', async () => {
    const { saveCard } = installHelm()
    renderEditor(saved)
    await waitFor(() => expect(document.querySelectorAll('[data-pick-verse]').length).toBe(3))
    fireEvent.click(document.querySelector('[data-pick-verse="2"]') as HTMLElement)
    await waitFor(() => expect(verseText().value).toBe('Psalm 122:2 kjv'))
    fireEvent.click(saveButton())
    expect(saveCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', ref: 'Psalm 122:2', title: 'Psalm 122:2' })
    )
  })

  it('keeps a name the operator gave the card', async () => {
    const { saveCard } = installHelm()
    renderEditor({ ...saved, title: 'Call to worship' })
    await waitFor(() => expect(document.querySelectorAll('[data-pick-verse]').length).toBe(3))
    fireEvent.click(document.querySelector('[data-pick-verse="2"]') as HTMLElement)
    await waitFor(() => expect(verseText().value).toBe('Psalm 122:2 kjv'))
    fireEvent.click(saveButton())
    expect(saveCard).toHaveBeenCalledWith(expect.objectContaining({ title: 'Call to worship' }))
  })
})

describe('PreCardEditor list cards', () => {
  it('strips typed list markers when saving a list card (#50)', async () => {
    const { saveCard } = installHelm()
    renderEditor()
    await opened()
    fireEvent.click(screen.getByText('List of items'))
    fireEvent.change(items(), {
      target: { value: '- Potluck sign-up\n* Prayer meeting\n1. Building fund\nBare item\n-' }
    })
    fireEvent.click(saveButton())
    expect(saveCard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'list',
        points: ['Potluck sign-up', 'Prayer meeting', 'Building fund', 'Bare item']
      })
    )
  })

  it('previews the draft as the operator types, not the saved card', async () => {
    // The preview is the real renderer fed by draft state: the operator sees what saving
    // WOULD project, keystroke by keystroke — including cleanListPoints stripping the
    // typed "- " marker (#50) before it ever reaches the screen.
    installHelm()
    renderEditor()
    await opened()
    fireEvent.click(screen.getByText('List of items'))
    fireEvent.change(items(), { target: { value: '- Potluck sign-up' } })
    const preview = screen.getByTestId('pre-card-preview')
    expect(preview.textContent).toContain('Potluck sign-up')
    expect(preview.textContent).not.toContain('- Potluck')
  })

  it('a new list starts in the heading, and a suggested heading moves on to the items', async () => {
    const { saveCard } = installHelm()
    renderEditor()
    await opened()
    fireEvent.click(screen.getByText('List of items'))
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Prayer requests'))
    fireEvent.click(screen.getByRole('button', { name: 'Prayer requests' }))
    expect(document.activeElement).toBe(items())
    fireEvent.change(items(), { target: { value: 'The Hollis family' } })
    fireEvent.click(saveButton())
    expect(saveCard).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'list', title: 'Prayer requests', points: ['The Hollis family'] })
    )
  })

  it('Enter in the heading moves to the items instead of saving', async () => {
    const { saveCard } = installHelm()
    renderEditor()
    await opened()
    fireEvent.click(screen.getByText('List of items'))
    const heading = screen.getByPlaceholderText('Prayer requests')
    fireEvent.change(heading, { target: { value: 'Announcements' } })
    fireEvent.keyDown(heading, { key: 'Enter' })
    expect(document.activeElement).toBe(items())
    expect(saveCard).not.toHaveBeenCalled()
  })

  it('a saved list opens in the items on a fresh last line', async () => {
    installHelm()
    renderEditor({ id: 'p1', type: 'list', title: 'Prayer Requests', points: ['One', 'Two'], enabled: true })
    await act(async () => {})
    expect(document.activeElement).toBe(items())
    expect(items().value).toBe('One\nTwo\n')
    expect(items().selectionStart).toBe(items().value.length)
  })

  it('Mod+Enter saves from the items', async () => {
    const { saveCard } = installHelm()
    const onClose = vi.fn()
    renderEditor({ id: 'p1', type: 'list', title: 'Prayer Requests', points: ['One'], enabled: true }, onClose)
    await act(async () => {})
    fireEvent.change(items(), { target: { value: 'One\nBro. Allen' } })
    fireEvent.keyDown(items(), { key: 'Enter', metaKey: true })
    expect(saveCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', points: ['One', 'Bro. Allen'] })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('ghosts Add to loop on an empty list, and warns when a list gets long', async () => {
    installHelm()
    renderEditor()
    await opened()
    fireEvent.click(screen.getByText('List of items'))
    expect(saveButton().disabled).toBe(true)
    expect(saveButton().title).toBe('Add at least one item first')
    fireEvent.change(items(), { target: { value: 'a\nb\nc\nd\ne\nf\ng\nh' } })
    expect(saveButton().disabled).toBe(false)
    expect(document.querySelector('[data-list-note]')?.textContent).toContain('8 items')
    expect(document.querySelector('[data-list-note]')?.textContent).toContain('two cards')
  })
})

describe('PreCardEditor frame', () => {
  it('preview tracks the message card headline live', async () => {
    installHelm()
    renderEditor()
    await opened()
    fireEvent.click(screen.getByText('Big message'))
    fireEvent.change(screen.getByPlaceholderText('Welcome'), { target: { value: 'Happy Easter' } })
    expect(screen.getByTestId('pre-card-preview').textContent).toContain('Happy Easter')
  })

  it('Cancel and a click beside the editor both go to onCancel, never onClose', async () => {
    // onClose means "saved or deleted". The page keeps a cancelled draft behind Undo, so
    // it has to be able to tell the two apart.
    installHelm()
    const onClose = vi.fn()
    const onCancel = vi.fn()
    render(
      <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
        <PreCardEditor card={null} onClose={onClose} onCancel={onCancel} onRemove={() => {}} />
      </ThemeCtx.Provider>
    )
    await opened()
    const backdrop = screen.getByText('Add a card to the loop').closest('[style*="position: fixed"]') as HTMLElement
    fireEvent.click(backdrop)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports whether there is anything to lose', async () => {
    installHelm()
    const onDirtyChange = vi.fn()
    render(
      <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
        <PreCardEditor card={null} onClose={() => {}} onRemove={() => {}} onDirtyChange={onDirtyChange} />
      </ThemeCtx.Provider>
    )
    await opened()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByText('Big message'))
    fireEvent.change(screen.getByPlaceholderText('Welcome'), { target: { value: 'Hi' } })
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))
  })

  it('draws nothing while hidden, and keeps its draft for when it comes back', async () => {
    installHelm()
    const ui = (hidden: boolean): JSX.Element => (
      <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
        <PreCardEditor card={null} onClose={() => {}} onRemove={() => {}} hidden={hidden} />
      </ThemeCtx.Provider>
    )
    const { rerender } = render(ui(false))
    await opened()
    fireEvent.click(screen.getByText('Big message'))
    fireEvent.change(screen.getByPlaceholderText('Welcome'), { target: { value: 'Happy Easter' } })
    rerender(ui(true))
    expect(screen.queryByText('Add a card to the loop')).toBeNull()
    rerender(ui(false))
    expect((screen.getByPlaceholderText('Welcome') as HTMLInputElement).value).toBe('Happy Easter')
  })

  it('an untouched editor still closes on a click beside it', async () => {
    installHelm()
    const onClose = vi.fn()
    renderEditor(null, onClose)
    await opened()
    const backdrop = screen.getByText('Add a card to the loop').closest('[style*="position: fixed"]') as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('PreCardEditor translations', () => {
  it('offers no chips with one Bible installed', async () => {
    installHelm()
    renderEditor()
    await opened()
    expect(document.querySelectorAll('[data-bible]').length).toBe(0)
  })

  it('a chip re-reads the card from that translation', async () => {
    installHelm({ manifest: [KJV, WEB] })
    renderEditor()
    await opened()
    type('joh 3:2')
    await waitFor(() => expect(verseText().value).toBe('John 3:2 kjv'))
    fireEvent.click(document.querySelector('[data-bible="web"]') as HTMLElement)
    await waitFor(() => expect(verseText().value).toBe('John 3:2 web'))
    expect(document.querySelector('[data-bible="web"]')?.getAttribute('data-selected')).toBe('true')
  })
})

describe('PreCardEditor a card per verse', () => {
  const pickRange = async (): Promise<void> => {
    type('joh 3')
    await waitFor(() => expect(document.querySelectorAll('[data-pick-verse]').length).toBe(3))
    fireEvent.click(document.querySelector('[data-pick-verse="1"]') as HTMLElement)
    fireEvent.click(document.querySelector('[data-pick-verse="3"]') as HTMLElement, { shiftKey: true })
    await waitFor(() => expect(document.querySelector('[data-split]')).toBeTruthy())
  }

  it('is offered only for a range', async () => {
    installHelm()
    renderEditor()
    await opened()
    type('joh 3:2')
    await waitFor(() => expect(verseText().value).toBe('John 3:2 kjv'))
    expect(document.querySelector('[data-split]')).toBeNull()
  })

  it('adds one card for each verse, in order, each named for its reference', async () => {
    const { saveCard } = installHelm()
    renderEditor()
    await opened()
    await pickRange()
    fireEvent.click(screen.getByRole('button', { name: 'A card per verse' }))
    expect(document.querySelector('[data-split-note]')?.textContent).toContain('Adds 3 cards')
    // The preview is the first of them, not the joined passage.
    expect(screen.getByTestId('pre-card-preview').textContent).not.toContain('John 3:2 kjv')
    fireEvent.click(saveButton())
    expect(saveCard.mock.calls.map((c) => [c[0].ref, c[0].title, c[0].text, c[0].id])).toEqual([
      ['John 3:1', 'John 3:1', 'John 3:1 kjv', undefined],
      ['John 3:2', 'John 3:2', 'John 3:2 kjv', undefined],
      ['John 3:3', 'John 3:3', 'John 3:3 kjv', undefined]
    ])
  })

  it('still saves the range as one card by default', async () => {
    const { saveCard } = installHelm()
    renderEditor()
    await opened()
    await pickRange()
    fireEvent.click(saveButton())
    expect(saveCard).toHaveBeenCalledTimes(1)
  })
})

describe('PreCardEditor picture cards', () => {
  const pic = (id: string, title: string): MediaItem => ({
    id,
    type: 'image',
    title,
    filePath: `images/${id}.jpg`,
    slides: [],
    createdAt: 0
  })
  const VIDEO: MediaItem = { id: 'v', type: 'video', title: 'Clip', filePath: 'video/v.mp4', slides: [], createdAt: 0 }

  it('lists the pictures in the media library, and a click puts one on the card', async () => {
    const { saveCard } = installHelm({ media: [pic('a', 'Baptism Sunday'), VIDEO] })
    renderEditor()
    await opened()
    fireEvent.click(screen.getByText('Picture'))
    await waitFor(() => expect(document.querySelectorAll('[data-picture]').length).toBe(1))
    expect(saveButton().disabled).toBe(true)
    expect(saveButton().title).toBe('Pick a picture first')
    fireEvent.click(document.querySelector('[data-picture="a"]') as HTMLElement)
    fireEvent.click(saveButton())
    expect(saveCard).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image', title: 'Baptism Sunday', src: 'helm-media://images/a.jpg' })
    )
  })

  it('invites an import when the library has no pictures, and picks what was imported', async () => {
    installHelm({ imported: [pic('n', 'New flyer')] })
    renderEditor()
    await opened()
    fireEvent.click(screen.getByText('Picture'))
    const empty = await screen.findByText(/No pictures in the media library yet/)
    expect(empty.querySelector('b')?.textContent).toBe('+ Import')
    fireEvent.click(screen.getByRole('button', { name: '+ Import' }))
    await waitFor(() => expect(document.querySelector('[data-picture="n"]')?.getAttribute('data-selected')).toBe('true'))
    expect(saveButton().disabled).toBe(false)
  })

  it('opens a saved picture card on the Picture editor', async () => {
    installHelm({ media: [pic('a', 'Baptism Sunday')] })
    renderEditor({ id: 'i1', type: 'image', title: 'Baptism Sunday', src: 'helm-media://images/a.jpg', enabled: true })
    await waitFor(() => expect(document.querySelector('[data-picture="a"]')?.getAttribute('data-selected')).toBe('true'))
  })
})
