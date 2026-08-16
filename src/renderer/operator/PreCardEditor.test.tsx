// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreCardEditor } from './PreCardEditor'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { BibleManifestEntry, ChapterData } from '../../shared/types'

afterEach(cleanup)

const KJV: BibleManifestEntry = { id: 'kjv', abbr: 'KJV', name: 'King James', installed: true }
const PS122: ChapterData = {
  book: 'Psalm', chapter: 122, verseCount: 2,
  verses: { 1: { kjv: 'I was glad when they said unto me' }, 2: { kjv: 'Our feet shall stand' } }
}

function installHelm(over: {
  manifest?: BibleManifestEntry[]
  getChapter?: (book: string, ch: number) => Promise<ChapterData>
} = {}): { saveCard: ReturnType<typeof vi.fn> } {
  const saveCard = vi.fn()
  ;(window as unknown as { helm: unknown }).helm = {
    preservice: { saveCard, removeCard: vi.fn() },
    bibles: {
      manifest: () => Promise.resolve(over.manifest ?? [KJV]),
      getChapter: over.getChapter ?? (() => Promise.resolve(PS122))
    }
  }
  return { saveCard }
}

function renderEditor(): void {
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <PreCardEditor card={null} onClose={() => {}} onRemove={() => {}} />
    </ThemeCtx.Provider>
  )
}

async function lookUp(ref: string): Promise<void> {
  const refInput = screen.getByPlaceholderText('Psalm 122:1') as HTMLInputElement
  fireEvent.change(refInput, { target: { value: ref } })
  fireEvent.click(screen.getByText('Look up'))
}

describe('PreCardEditor verse look-up', () => {
  it('fills verse text, canonicalizes the reference, and shows the version', async () => {
    installHelm()
    renderEditor()
    await lookUp('psalm 122:1')
    const textArea = await screen.findByPlaceholderText('I was glad when they said unto me…') as HTMLTextAreaElement
    await waitFor(() => expect(textArea.value).toBe('I was glad when they said unto me'))
    expect((screen.getByPlaceholderText('Psalm 122:1') as HTMLInputElement).value).toBe('Psalm 122:1')
    expect(screen.getByText('✓ KJV')).toBeTruthy()
  })

  it('rejects a range and leaves the fields unchanged', async () => {
    installHelm()
    renderEditor()
    await lookUp('psalm 122:1-2')
    expect(await screen.findByText('Enter a single verse, e.g. James 1:1')).toBeTruthy()
    expect((screen.getByPlaceholderText('I was glad when they said unto me…') as HTMLTextAreaElement).value).toBe('')
  })

  it('shows a message when no Bible is installed', async () => {
    installHelm({ manifest: [] })
    renderEditor()
    await lookUp('psalm 122:1')
    expect(await screen.findByText('Install a Bible first (Settings → Bibles)')).toBeTruthy()
  })

  it('shows a message when the verse is absent from the chapter', async () => {
    installHelm()
    renderEditor()
    await lookUp('psalm 122:9')
    expect(await screen.findByText('Psalm 122 has no verse 9 in KJV')).toBeTruthy()
  })

  it('flags a non-existent chapter distinctly from a missing verse', async () => {
    installHelm({ getChapter: () => Promise.resolve({ book: 'Psalm', chapter: 200, verseCount: 0, verses: {} }) })
    renderEditor()
    await lookUp('psalm 200:1')
    expect(await screen.findByText('Psalm has no chapter 200 in KJV')).toBeTruthy()
  })

  it('shows a message when the Bible lookup fails', async () => {
    installHelm({ getChapter: () => Promise.reject(new Error('ipc down')) })
    renderEditor()
    await lookUp('psalm 122:1')
    expect(await screen.findByText('Couldn’t reach the Bible — try again')).toBeTruthy()
  })

  it('saves a hand-typed verse card with no version', async () => {
    const { saveCard } = installHelm()
    renderEditor()
    fireEvent.change(screen.getByPlaceholderText('Psalm 122:1'), { target: { value: 'Acts 2:38' } })
    fireEvent.change(screen.getByPlaceholderText('I was glad when they said unto me…'), { target: { value: 'Repent…' } })
    fireEvent.click(screen.getByText('Add to loop'))
    expect(saveCard).toHaveBeenCalledWith(expect.objectContaining({ type: 'verse', ref: 'Acts 2:38', text: 'Repent…' }))
    expect(saveCard.mock.calls[0][0].version).toBeUndefined()
  })

  it('strips typed list markers when saving a list card (#50)', () => {
    const { saveCard } = installHelm()
    renderEditor()
    fireEvent.click(screen.getByText('List of items'))
    fireEvent.change(screen.getByPlaceholderText('Fellowship dinner — next Sunday after service'), {
      target: { value: '- Potluck sign-up\n* Prayer meeting\n1. Building fund\nBare item\n-' }
    })
    fireEvent.click(screen.getByText('Add to loop'))
    expect(saveCard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'list',
        points: ['Potluck sign-up', 'Prayer meeting', 'Building fund', 'Bare item']
      })
    )
  })

  it('previews the draft as the operator types, not the saved card', () => {
    // The preview is the real renderer fed by draft state: the operator sees what saving
    // WOULD project, keystroke by keystroke — including cleanListPoints stripping the
    // typed "- " marker (#50) before it ever reaches the screen.
    installHelm()
    renderEditor()
    fireEvent.click(screen.getByText('List of items'))
    fireEvent.change(screen.getByPlaceholderText('Fellowship dinner — next Sunday after service'), {
      target: { value: '- Potluck sign-up' }
    })
    const preview = screen.getByTestId('pre-card-preview')
    expect(preview.textContent).toContain('Potluck sign-up')
    expect(preview.textContent).not.toContain('- Potluck')
  })

  it('preview tracks the message card headline live', () => {
    installHelm()
    renderEditor()
    fireEvent.click(screen.getByText('Big message'))
    fireEvent.change(screen.getByPlaceholderText('Welcome'), { target: { value: 'Happy Easter' } })
    expect(screen.getByTestId('pre-card-preview').textContent).toContain('Happy Easter')
  })

  it('leaves pre-existing verse text intact when a look-up fails', async () => {
    installHelm()
    render(
      <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
        <PreCardEditor
          card={{ id: 'c1', type: 'verse', title: 'Psalm 122:1', ref: 'Psalm 122:1', text: 'existing verse text', version: 'KJV', enabled: true }}
          onClose={() => {}}
          onRemove={() => {}}
        />
      </ThemeCtx.Provider>
    )
    fireEvent.change(screen.getByPlaceholderText('Psalm 122:1'), { target: { value: 'psalm 122:1-2' } })
    fireEvent.click(screen.getByText('Look up'))
    expect(await screen.findByText('Enter a single verse, e.g. James 1:1')).toBeTruthy()
    expect((screen.getByPlaceholderText('I was glad when they said unto me…') as HTMLTextAreaElement).value).toBe('existing verse text')
  })
})
