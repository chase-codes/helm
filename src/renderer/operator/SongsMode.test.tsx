// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SongsMode } from './SongsMode';
import { ThemeCtx } from './ThemeCtx';
import { themeFor } from '../../shared/theme';
import type { ModeKeyHandlerRef } from './App';
import type {
  ImportReviewRow,
  PresentationState,
  Song,
  SongImportResult,
  SongImportScanResult,
  SongSearchResult
} from '../../shared/types';

// This project's vitest config does not set `globals: true`, so
// @testing-library/react's auto afterEach(cleanup) never registers; without
// this, DOM from one test leaks into the next.
afterEach(cleanup);

const NOTHING_LIVE: PresentationState = { output: 'black', liveKey: null, liveSnap: null };

const SONGS: Song[] = [
  {
    id: 's1',
    title: 'Amazing Grace',
    author: 'John Newton',
    sections: [{ label: 'Verse 1', lines: ['Amazing grace'] }],
    source: 'manual',
    createdAt: 0
  }
];

function installHelmStub(searchImpl?: (q: string, field: string) => Promise<SongSearchResult[]>): {
  scan: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn(searchImpl ?? (() => Promise.resolve([])));
  const scan = vi.fn();
  const commit = vi.fn();
  (window as unknown as { helm: unknown }).helm = {
    songs: {
      list: () => Promise.resolve(SONGS),
      search
    },
    presentation: {
      get: () => Promise.resolve(NOTHING_LIVE),
      onState: () => () => {},
      cue: vi.fn(),
      goLive: vi.fn(),
      setOutput: vi.fn()
    },
    songImport: {
      sources: () => Promise.resolve([{ id: 'easyworship', label: 'EasyWorship' }]),
      scan,
      commit,
      onProgress: () => () => {}
    }
  };
  return { scan, commit, search };
}

const renderMode = (keyHandlerRef: ModeKeyHandlerRef): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('dark')}>
      <SongsMode themeMode="dark" keyHandlerRef={keyHandlerRef} active />
    </ThemeCtx.Provider>
  );

const CHORUS_SONG: Song = {
  id: 's2',
  title: 'With Chorus',
  author: 'A',
  sections: [
    { label: 'Verse 1', lines: ['v1'] },
    { label: 'Chorus', lines: ['c1'] },
    { label: 'Verse 2', lines: ['v2'] },
    { label: 'Chorus 2', lines: ['c2'] }
  ],
  source: 'manual',
  createdAt: 0
};

// Like installHelmStub but with a chorus-bearing song and a configurable live state.
function installHelmStubWith(songs: Song[], state: PresentationState): { goLive: ReturnType<typeof vi.fn> } {
  const goLive = vi.fn();
  (window as unknown as { helm: unknown }).helm = {
    songs: { list: () => Promise.resolve(songs), search: vi.fn(() => Promise.resolve([])) },
    presentation: {
      get: () => Promise.resolve(state),
      onState: () => () => {},
      cue: vi.fn(),
      goLive,
      setOutput: vi.fn()
    },
    songImport: {
      sources: () => Promise.resolve([]),
      scan: vi.fn(),
      commit: vi.fn(),
      onProgress: () => () => {}
    }
  };
  return { goLive };
}

describe('SongsMode', () => {
  // CRITICAL: the import wizard (Task 7) must be wired into the same isModalOpen/onEscape
  // contract as QuickAdd. Without it, keyDispatch's typing guard never trips inside the
  // wizard (it has no <input>/<textarea>) so a focused button's Space/Enter falls through
  // to onGoLive instead of being suppressed, and Escape does nothing.
  it('reports isModalOpen true while the import wizard is open, and Escape closes it', async () => {
    installHelmStub();
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);

    // The search-rail row is the unique match ("John Newton · 1 stanza"); the big preview
    // header repeats the bare title/author, so waiting on "Amazing Grace" alone is ambiguous.
    await screen.findByText(/John Newton ·/);
    expect(keyHandlerRef.current?.isModalOpen()).toBe(false);

    fireEvent.click(screen.getByText('↓ Import a song library'));
    expect(await screen.findByText('Import songs')).toBeTruthy();

    expect(keyHandlerRef.current?.isModalOpen()).toBe(true);

    let handled: boolean | undefined;
    act(() => {
      handled = keyHandlerRef.current?.onEscape();
    });
    expect(handled).toBe(true);
    expect(screen.queryByText('Import songs')).toBeNull();
    expect(keyHandlerRef.current?.isModalOpen()).toBe(false);
  });

  it('does not report a modal open, and onEscape is a no-op, when neither modal is up', async () => {
    installHelmStub();
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);

    await screen.findByText(/John Newton ·/);
    expect(keyHandlerRef.current?.isModalOpen()).toBe(false);
    expect(keyHandlerRef.current?.onEscape()).toBe(false);
  });

  const NEW_ROW: ImportReviewRow = { title: 'New Song', author: '', stanzas: 1, status: 'new' };
  const SCAN_ONE_NEW: SongImportScanResult = { token: 'tok', rows: [NEW_ROW] };

  // The commit keeps running in main and still writes every song even if the wizard is
  // dismissed, so losing the screen mid-import loses the operator's only view of the
  // done-step summary and the list naming which songs could not be read.
  it('does not close the import wizard on Escape while a commit is in flight', async () => {
    const helm = installHelmStub();
    helm.scan.mockResolvedValue(SCAN_ONE_NEW);
    let resolveCommit: (r: SongImportResult) => void = () => {};
    helm.commit.mockImplementation(
      () =>
        new Promise<SongImportResult>((resolve) => {
          resolveCommit = resolve;
        })
    );
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await screen.findByText(/John Newton ·/);

    fireEvent.click(screen.getByText('↓ Import a song library'));
    fireEvent.click(await screen.findByText('EasyWorship'));
    fireEvent.click(await screen.findByText(/Import 1 song/));
    await screen.findByText(/Importing…/);

    let handled: boolean | undefined;
    act(() => {
      handled = keyHandlerRef.current?.onEscape();
    });
    // Handled (so it doesn't fall through to some other key action), but the wizard stays up.
    expect(handled).toBe(true);
    expect(screen.queryByText('Import songs')).toBeTruthy();
    expect(screen.getByText(/Importing…/)).toBeTruthy();

    await act(async () => {
      resolveCommit({ imported: 1, skipped: 0, unreadable: [] });
      // Reaching the done step and SongsMode noticing (onImportingChange -> setImportInFlight)
      // are two separate, cross-component render passes; give the second one a tick to land
      // before asserting on it, same as a real Escape press well after the promise settles.
      await new Promise((r) => setTimeout(r, 0));
    });
    await screen.findByText(/Imported 1 song/);

    act(() => {
      handled = keyHandlerRef.current?.onEscape();
    });
    expect(handled).toBe(true);
    expect(screen.queryByText('Import songs')).toBeNull();
  });

  it('re-runs the active search, not just the library refresh, once an import completes', async () => {
    const NEW_RESULT: SongSearchResult = {
      song: { ...SONGS[0], id: 's2', title: 'Newly Imported Song' },
      score: 1,
      snippet: ''
    };
    const search = vi
      .fn<(q: string, field: string) => Promise<SongSearchResult[]>>()
      .mockResolvedValueOnce([]) // the keystroke search, before the import
      .mockResolvedValueOnce([NEW_RESULT]); // the re-run search, after the import completes
    const helm = installHelmStub();
    (window as unknown as { helm: { songs: { search: typeof search } } }).helm.songs.search = search;
    helm.scan.mockResolvedValue(SCAN_ONE_NEW);
    helm.commit.mockResolvedValue({ imported: 1, skipped: 0, unreadable: [] });

    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await screen.findByText(/John Newton ·/);

    const input = screen.getByPlaceholderText(/Title or a lyric line/);
    fireEvent.change(input, { target: { value: 'amazing' } });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('↓ Import a song library'));
    fireEvent.click(await screen.findByText('EasyWorship'));
    fireEvent.click(await screen.findByText(/Import 1 song/));
    await screen.findByText(/Imported 1 song/);

    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(search).toHaveBeenNthCalledWith(2, 'amazing', 'all');
    fireEvent.click(screen.getByText('Close'));
    await waitFor(() => expect(screen.getByText('Newly Imported Song')).toBeTruthy());
  });
});

describe('SongsMode hotkey jumps', () => {
  it('chorus jump moves the selection without going live when output is not live', async () => {
    installHelmStubWith([CHORUS_SONG], NOTHING_LIVE);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }));
    await waitFor(() => expect(screen.getByText('NOW SINGING · Chorus')).toBeTruthy());
  });

  it('chorus jump goes live in the same press when this song is already live', async () => {
    const live: PresentationState = { output: 'live', liveKey: 'song:s2:0', liveSnap: null };
    const { goLive } = installHelmStubWith([CHORUS_SONG], live);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(keyHandlerRef.current?.onAction).toBeTruthy());
    // onAction is registered on the very first render, before the library/presentation-state
    // promises resolve — so their setState calls land in a later macrotask flush that a plain
    // microtask `await` doesn't wait through (see the identical tick above in "does not close
    // the import wizard…"). Without this, the handler closure below still sees the pre-load
    // state (no active song / output still 'black') and the live-follow branch never fires.
    await new Promise((r) => setTimeout(r, 0));
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }));
    await waitFor(() => expect(goLive).toHaveBeenCalledWith('song:s2:1', expect.objectContaining({ label: 'With Chorus · Chorus' })));
  });

  it('repeat chorus press cycles to Chorus 2; verse digit matches label', async () => {
    installHelmStubWith([CHORUS_SONG], NOTHING_LIVE);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(keyHandlerRef.current?.onAction).toBeTruthy());
    // Same load-timing tick as above — let the library promise land before firing.
    await new Promise((r) => setTimeout(r, 0));
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }));
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }));
    await waitFor(() => expect(screen.getByText('NOW SINGING · Chorus 2')).toBeTruthy());
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.verse', digit: 2 }));
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 2')).toBeTruthy());
  });

  it('field.clear empties the search query', async () => {
    installHelmStubWith([CHORUS_SONG], NOTHING_LIVE);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(keyHandlerRef.current?.onAction).toBeTruthy());
    const input = screen.getByPlaceholderText(/Title or a lyric line/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'grace' } });
    act(() => keyHandlerRef.current?.onAction?.({ id: 'field.clear' }));
    await waitFor(() => expect(input.value).toBe(''));
  });
});
