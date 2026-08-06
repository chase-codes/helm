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

const CANDIDATES = [
  {
    title: 'Way Maker', author: 'Sinach', album: 'Way Maker', duration: 300,
    text: 'You are here, moving in our midst\nI worship You\n\nChorus\nWay Maker, Miracle Worker\nPromise Keeper',
  },
  {
    title: 'Way Maker (Live)', author: 'Leeland', album: 'Better Word', duration: 322,
    text: 'Leeland first line here\nLeeland second line\n\nChorus\nLeeland chorus line\nLeeland chorus two',
  },
];

const stubSources = (over: Partial<Record<'search' | 'fromUrl', ReturnType<typeof vi.fn>>> = {}): {
  search: ReturnType<typeof vi.fn>; fromUrl: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn>;
} => {
  const search = over.search ?? vi.fn().mockResolvedValue({ candidates: CANDIDATES });
  const fromUrl = over.fromUrl ?? vi.fn().mockResolvedValue({ candidate: CANDIDATES[0] });
  const add = vi.fn().mockResolvedValue({ id: 's1', title: 'Way Maker', author: 'Sinach', sections: [], source: 'web', createdAt: 1 });
  (window as unknown as { helm: unknown }).helm = { songs: { add }, songSources: { search, fromUrl } };
  return { search, fromUrl, add };
};

describe('QuickAdd Search online tab', () => {
  it('runs the search eagerly when opening the tab with a prefilled title', async () => {
    const { search } = stubSources();
    renderQuickAdd('Way Maker');
    fireEvent.click(screen.getByText('Search online'));
    expect(search).toHaveBeenCalledWith('Way Maker');
    // Query by result titles — the author renders inside a concatenated metadata line
    // ("Sinach · Way Maker · 5:00 · 2 stanzas"), which exact-match getByText won't hit.
    expect(await screen.findByText('Way Maker (Live)')).toBeTruthy();
    expect(screen.getByText('Way Maker')).toBeTruthy();
  });

  it('does not search eagerly without a query', () => {
    const { search } = stubSources();
    renderQuickAdd();
    fireEvent.click(screen.getByText('Search online'));
    expect(search).not.toHaveBeenCalled();
  });

  it('previews the highlighted result as slides and moves highlight with arrow keys', async () => {
    stubSources();
    renderQuickAdd('Way Maker');
    fireEvent.click(screen.getByText('Search online'));
    await screen.findByText('Way Maker (Live)');
    // First result highlighted by default — its chorus is in the preview panel.
    expect(screen.getByText(/Way Maker, Miracle Worker/)).toBeTruthy();
    // Keyboard drives the highlight (deterministic in jsdom, unlike mouseEnter
    // delegation); ArrowDown moves to the second result and the preview follows.
    fireEvent.keyDown(screen.getByPlaceholderText(/Search by title/), { key: 'ArrowDown' });
    expect(await screen.findByText(/Leeland chorus line/)).toBeTruthy();
  });

  it('pick fills the editor, flips to Paste lyrics, and saves with source web', async () => {
    const { add } = stubSources();
    renderQuickAdd('Way Maker');
    fireEvent.click(screen.getByText('Search online'));
    // Click the first result's title row (Sinach's "Way Maker") — the click bubbles
    // from the title div to the result button.
    fireEvent.click(await screen.findByText('Way Maker'));
    const titleInput = screen.getByPlaceholderText('Song title') as HTMLInputElement;
    const authorInput = screen.getByPlaceholderText('Author (optional)') as HTMLInputElement;
    const lyrics = screen.getByPlaceholderText(/Paste lyrics here/) as HTMLTextAreaElement;
    expect(titleInput.value).toBe('Way Maker');
    expect(authorInput.value).toBe('Sinach');
    expect(lyrics.value).toContain('Chorus\nWay Maker, Miracle Worker');
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Way Maker', author: 'Sinach', source: 'web' })
      )
    );
  });

  it('routes URL input to fromUrl and fills the editor from the parse', async () => {
    const { search, fromUrl } = stubSources();
    renderQuickAdd();
    fireEvent.click(screen.getByText('Search online'));
    const box = screen.getByPlaceholderText(/Search by title/) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'https://genius.com/Sinach-way-maker-lyrics' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(fromUrl).toHaveBeenCalledWith('https://genius.com/Sinach-way-maker-lyrics');
    expect(search).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((screen.getByPlaceholderText('Song title') as HTMLInputElement).value).toBe('Way Maker')
    );
  });

  it('shows the empty-state copy when the search has no matches', async () => {
    stubSources({ search: vi.fn().mockResolvedValue({ candidates: [] }) });
    renderQuickAdd('zzz unfindable');
    fireEvent.click(screen.getByText('Search online'));
    expect(await screen.findByText('No matches — paste lyrics or try a URL.')).toBeTruthy();
  });

  it('shows the network error with a retry that re-runs the search', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce({ error: 'network' })
      .mockResolvedValueOnce({ candidates: CANDIDATES });
    stubSources({ search });
    renderQuickAdd('Way Maker');
    fireEvent.click(screen.getByText('Search online'));
    expect(await screen.findByText('Couldn’t reach the lyrics service — try again.')).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByText('Way Maker (Live)')).toBeTruthy();
  });

  it('shows the page-error copy when a URL yields no lyrics', async () => {
    stubSources({ fromUrl: vi.fn().mockResolvedValue({ error: 'no-lyrics' }) });
    renderQuickAdd();
    fireEvent.click(screen.getByText('Search online'));
    const box = screen.getByPlaceholderText(/Search by title/) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'https://somesite.com/x' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText('Couldn’t read lyrics from that page — copy them and use Paste lyrics.')).toBeTruthy();
  });
});
