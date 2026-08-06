// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuickAdd } from './QuickAdd'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

const renderQuickAdd = (initialTitle?: string): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('dark')}>
      <QuickAdd open initialTitle={initialTitle} onClose={vi.fn()} onSaved={vi.fn()} />
    </ThemeCtx.Provider>
  )

describe('QuickAdd initialTitle', () => {
  it('prefills the title and focuses the lyrics box when initialTitle is given', () => {
    renderQuickAdd('Way Maker')
    const title = screen.getByPlaceholderText('Song title') as HTMLInputElement
    expect(title.value).toBe('Way Maker')
    const lyrics = screen.getByPlaceholderText(/Paste lyrics here/) as HTMLTextAreaElement
    expect(document.activeElement).toBe(lyrics)
  })

  it('starts blank with focus on the title field without initialTitle', () => {
    renderQuickAdd()
    const title = screen.getByPlaceholderText('Song title') as HTMLInputElement
    expect(title.value).toBe('')
    expect(document.activeElement).toBe(title)
  })
})
