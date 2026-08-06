// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
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

describe('QuickAdd author field', () => {
  it('renders an optional author input, blank by default', () => {
    renderQuickAdd();
    const author = screen.getByPlaceholderText('Author (optional)') as HTMLInputElement;
    expect(author.value).toBe('');
  });

  it('passes the typed author to songs.add on save', async () => {
    const add = vi.fn().mockResolvedValue({
      id: 's1', title: 'Way Maker', author: 'Sinach', sections: [], source: 'web', createdAt: 1,
    });
    (window as unknown as { helm: unknown }).helm = { songs: { add } };
    renderQuickAdd('Way Maker');
    fireEvent.change(screen.getByPlaceholderText('Author (optional)'), { target: { value: 'Sinach' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste lyrics here/), { target: { value: 'Some line\nAnother line' } });
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        title: 'Way Maker', author: 'Sinach', text: 'Some line\nAnother line',
      })
    );
  });
});
