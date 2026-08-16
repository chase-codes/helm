// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HERO_LINE_FONT, SongsMode } from './SongsMode';
import { ThemeCtx } from './ThemeCtx';
import { themeFor } from '../../shared/theme';
import { dispatchModeKey } from './keyDispatch';
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

const NOTHING_LIVE: PresentationState = { output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null };

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
      search,
      update: vi.fn(),
      remove: vi.fn(() => Promise.resolve([]))
    },
    presentation: {
      get: () => Promise.resolve(NOTHING_LIVE),
      onState: () => () => {},
      cue: vi.fn(),
      goLive: vi.fn(),
      take: vi.fn(),
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
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <SongsMode keyHandlerRef={keyHandlerRef} active />
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

// Like installHelmStub but with configurable songs + live state, spies on every
// presentation call, and a pushState seam to drive onState mid-test.
function installHelmStubWith(
  songs: Song[],
  state: PresentationState
): {
  goLive: ReturnType<typeof vi.fn>;
  cue: ReturnType<typeof vi.fn>;
  take: ReturnType<typeof vi.fn>;
  setOutput: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  pushState: (s: PresentationState) => void;
} {
  const goLive = vi.fn();
  const cue = vi.fn();
  const take = vi.fn();
  const setOutput = vi.fn();
  const add = vi.fn();
  const search = vi.fn(() => Promise.resolve([]));
  const update = vi.fn((id: string, input: { title: string; sections: { label: string; lines: string[] }[] }) =>
    Promise.resolve({ ...songs.find((s) => s.id === id)!, title: input.title, sections: input.sections })
  );
  const remove = vi.fn((id: string) => Promise.resolve(songs.filter((s) => s.id !== id)));
  let stateCb: (s: PresentationState) => void = () => {};
  (window as unknown as { helm: unknown }).helm = {
    songs: { list: () => Promise.resolve(songs), search, add, update, remove },
    presentation: {
      get: () => Promise.resolve(state),
      onState: (cb: (s: PresentationState) => void) => {
        stateCb = cb;
        return () => {};
      },
      cue,
      goLive,
      take,
      setOutput
    },
    songImport: {
      sources: () => Promise.resolve([]),
      scan: vi.fn(),
      commit: vi.fn(),
      onProgress: () => () => {}
    }
  };
  return { goLive, cue, take, setOutput, add, search, update, remove, pushState: (s) => stateCb(s) };
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

    fireEvent.click(screen.getByText('Import a song library'));
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

    fireEvent.click(screen.getByText('Import a song library'));
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

    fireEvent.click(screen.getByText('Import a song library'));
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
    const live: PresentationState = { output: 'live', liveKey: 'song:s2:0', liveSnap: null, cuedKey: null, cuedSnap: null };
    const { goLive } = installHelmStubWith([CHORUS_SONG], live);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    // Wait on rendered proof that the library AND presentation state have both loaded —
    // onAction is registered (truthy) on the very first render, before either promise
    // resolves, so waiting on it alone races the closure below against stale pre-load state
    // (no active song / output still 'black'), and the live-follow branch never fires.
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }));
    await waitFor(() => expect(goLive).toHaveBeenCalledWith('song:s2:1', expect.objectContaining({ label: 'With Chorus · Chorus' })));
  });

  it('chorus jump onto the already-live section does not fire a same-key take-down', async () => {
    // liveKey sits on the Chorus (index 1) up front; selection starts at Verse 1 (index 0)
    // as usual. The chorus jump below lands exactly on that already-live section — a no-op
    // jump. Regression check for the guard's `liveKey !== key` clause: without it, this would
    // call goLive on the key that's already live, which main reads as "take down" and would
    // black the screen out from under the operator instead of leaving it alone.
    const live: PresentationState = { output: 'live', liveKey: 'song:s2:1', liveSnap: null, cuedKey: null, cuedSnap: null };
    const { goLive } = installHelmStubWith([CHORUS_SONG], live);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }));
    await waitFor(() => expect(screen.getByText('NOW SINGING · Chorus')).toBeTruthy());
    expect(goLive).not.toHaveBeenCalled();
  });

  it('stepping sections while this song is live keeps Go live ghosted during the broadcast gap', async () => {
    // The projector follows the cue within the live song (main's applyCue / sameFlow), so
    // a section change while live leaves the button with nothing to do. Between our cue
    // send and the state broadcast returning, liveKey still names the OLD section — the
    // verb must not light green for that round trip and then blank again (the flash).
    const live: PresentationState = { output: 'live', liveKey: 'song:s2:0', liveSnap: null, cuedKey: null, cuedSnap: null };
    installHelmStubWith([CHORUS_SONG], live);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Cue next ›'));
    await waitFor(() => expect(screen.getByText('NOW SINGING · Chorus')).toBeTruthy());
    // No pushState: the broadcast is still in flight.
    const btn = screen.getByText('Go live').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('repeat chorus press cycles to Chorus 2; verse digit matches label', async () => {
    installHelmStubWith([CHORUS_SONG], NOTHING_LIVE);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    // Same load-timing wait as above — let the library land (and render) before firing.
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }));
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }));
    await waitFor(() => expect(screen.getByText('NOW SINGING · Chorus 2')).toBeTruthy());
    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.verse', digit: 2 }));
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 2')).toBeTruthy());
  });

  it('opens QuickAdd with the search query prefilled as the title', async () => {
    installHelmStub();
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await screen.findByText(/John Newton ·/);

    fireEvent.change(screen.getByPlaceholderText('Title or a lyric line…'), {
      target: { value: 'Way Maker' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Add.*Way Maker.*new song/ }));

    const title = (await screen.findByPlaceholderText('Song title')) as HTMLInputElement;
    expect(title.value).toBe('Way Maker');
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

  it('focus.search and field.clear still work before any song has loaded', async () => {
    installHelmStubWith([], NOTHING_LIVE);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(keyHandlerRef.current?.onAction).toBeTruthy());
    const input = screen.getByPlaceholderText(/Title or a lyric line/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'grace' } });
    act(() => keyHandlerRef.current?.onAction?.({ id: 'field.clear' }));
    expect(input.value).toBe('');
    act(() => keyHandlerRef.current?.onAction?.({ id: 'focus.search' }));
    expect(document.activeElement).toBe(input);
  });
});

const NEXT_SONG: Song = {
  id: 's3',
  title: 'Blessed Assurance',
  author: 'Fanny Crosby',
  sections: [{ label: 'Verse 1', lines: ['Blessed assurance'] }],
  source: 'manual',
  createdAt: 1
};
const LIVE_ON_S2: PresentationState = {
  output: 'live', liveKey: 'song:s2:0',
  liveSnap: { kind: 'lyrics', label: 'With Chorus · Verse 1', lines: ['v1'] },
  cuedKey: 'song:s2:0', cuedSnap: null
};

describe('SongsMode armed switching', () => {
  it('clicking another song while live arms it: center stays, no cue, Switch button appears', async () => {
    const { cue, goLive } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    // The initial-selection cue of s2:0 is a passive effect of the same commit that renders
    // the hero, and waitFor's MutationObserver can resolve on the DOM before that effect
    // flushes (it did, on the loaded Windows release runner) — so wait for the cue itself
    // before dropping it, or the late cue lands after the clear and fails the no-cue assert.
    await waitFor(() => expect(cue).toHaveBeenCalledWith('song:s2:0', expect.anything()));
    cue.mockClear(); // drop the initial-selection cue of s2:0

    fireEvent.click(screen.getByText('Blessed Assurance'));
    // Center unchanged: hero still shows the live song (title appears twice — rail row + hero header).
    expect(screen.getAllByText('With Chorus').length).toBeGreaterThan(1);
    expect(screen.getByText('⇄ Switch')).toBeTruthy();
    expect(screen.getByText('NEXT')).toBeTruthy();
    // Arming is silent: no cue, no goLive.
    expect(cue).not.toHaveBeenCalled();
    expect(goLive).not.toHaveBeenCalled();
  });

  it('the Switch button commits: armed song goes live at section 0 and becomes the selection', async () => {
    const { goLive } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    fireEvent.click(screen.getByText('⇄ Switch'));
    expect(goLive).toHaveBeenCalledWith('song:s3:0', expect.objectContaining({ label: 'Blessed Assurance · Verse 1' }));
    // Selection followed the commit; arm cleared.
    await waitFor(() => expect(screen.getAllByText('Blessed Assurance').length).toBeGreaterThan(1)); // rail row + hero header
    expect(screen.queryByText('⇄ Switch')).toBeNull();
  });

  it('re-arming the just-committed song before its broadcast lands, then switching, disarms without a second goLive', async () => {
    const { goLive, pushState } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());

    // Arm and commit: goLive fires, selection moves to s3, but the stub's live state
    // (liveKey) hasn't been pushed yet — the broadcast round-trip is still in flight.
    fireEvent.click(screen.getByText('Blessed Assurance'));
    fireEvent.click(screen.getByText('⇄ Switch'));
    expect(goLive).toHaveBeenCalledTimes(1);

    // Click the same (now-selected) row again before the broadcast lands: still `locked`
    // on the OLD liveKey (song:s2:0), so this arms s3 rather than treating it as the live
    // row. "Blessed Assurance" now also appears in the (unclickable) hero header — target
    // the rail row specifically.
    const s3RowBtn = screen
      .getAllByText('Blessed Assurance')
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)!;
    fireEvent.click(s3RowBtn);
    expect(screen.getByText('⇄ Switch')).toBeTruthy();

    // Now the broadcast lands: liveKey catches up to the song that was already re-armed.
    act(() => pushState({ ...LIVE_ON_S2, liveKey: 'song:s3:0', cuedKey: 'song:s3:0' }));
    await waitFor(() => expect(screen.getByText('⇄ Switch')).toBeTruthy());

    // Pressing Switch now must NOT send a second goLive on the already-live key (main
    // reads a same-key goLive as take-down) — it just disarms.
    fireEvent.click(screen.getByText('⇄ Switch'));
    expect(goLive).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('⇄ Switch')).toBeNull();
    // Selection landed on (stayed on) the armed song — rail row + hero header.
    expect(screen.getAllByText('Blessed Assurance').length).toBeGreaterThan(1);
  });

  it('re-arming and re-committing the same song before its broadcast lands sends only one goLive', async () => {
    const { goLive } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());

    // Arm and commit: goLive fires once, pendingSwitchRef latches to s3. The stub's live
    // state is never pushed in this test, so liveParsed stays on the OLD key (song:s2:0)
    // throughout — this is the pre-broadcast window the pendingSwitchRef guard covers.
    fireEvent.click(screen.getByText('Blessed Assurance'));
    fireEvent.click(screen.getByText('⇄ Switch'));
    expect(goLive).toHaveBeenCalledTimes(1);

    // Re-arm the same (now-selected) song and commit again, still before any broadcast.
    const s3RowBtn = screen
      .getAllByText('Blessed Assurance')
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)!;
    fireEvent.click(s3RowBtn);
    expect(screen.getByText('⇄ Switch')).toBeTruthy();
    fireEvent.click(screen.getByText('⇄ Switch'));

    // Guarded by pendingSwitchRef (liveParsed is still stale): no second goLive.
    expect(goLive).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('⇄ Switch')).toBeNull();
  });

  it('Enter (onGoLive) commits the switch while armed', async () => {
    const { goLive } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    act(() => keyHandlerRef.current?.onGoLive());
    expect(goLive).toHaveBeenCalledWith('song:s3:0', expect.anything());
  });

  it('clicking the armed row again, or the live row, disarms', async () => {
    installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    expect(screen.getByText('NEXT')).toBeTruthy();
    fireEvent.click(screen.getByText('Blessed Assurance')); // armed row toggles off
    expect(screen.queryByText('NEXT')).toBeNull();
    fireEvent.click(screen.getByText('Blessed Assurance')); // re-arm
    // "With Chorus" also appears in the (unclickable) hero header — target the rail row specifically.
    const liveRowBtn = screen
      .getAllByText('With Chorus')
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)!;
    fireEvent.click(liveRowBtn); // live row disarms
    expect(screen.queryByText('NEXT')).toBeNull();
  });

  it('both Take down and Switch render while armed; Take down sends output black', async () => {
    const { setOutput } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    expect(screen.getByText('Take down')).toBeTruthy();
    expect(screen.getByText('⇄ Switch')).toBeTruthy();
    fireEvent.click(screen.getByText('Take down'));
    expect(setOutput).toHaveBeenCalledWith('black');
  });

  it('take-down while armed converts the arm to the selection', async () => {
    const { pushState, cue } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    cue.mockClear();
    act(() => pushState({ ...LIVE_ON_S2, output: 'black' }));
    // Hero transitions to the armed song, the arm clears, and the cue effect stages it.
    await waitFor(() => expect(screen.getByText('Fanny Crosby')).toBeTruthy());
    expect(screen.queryByText('⇄ Switch')).toBeNull();
    await waitFor(() => expect(cue).toHaveBeenCalledWith('song:s3:0', expect.anything()));
  });

  it('a cross-kind takeover (scripture live) plain-disarms without moving the selection', async () => {
    const { pushState } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    act(() => pushState({ ...LIVE_ON_S2, liveKey: 'scr:kjv:John:3', liveSnap: { kind: 'scripture' } }));
    await waitFor(() => expect(screen.queryByText('⇄ Switch')).toBeNull());
    expect(screen.getAllByText('With Chorus').length).toBeGreaterThan(1); // rail row + hero header — selection untouched
  });

  it('an external live-song change (nothing armed) snaps the center to the new live song', async () => {
    const { pushState } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    // Someone else (or another view) puts a different song live — nothing was armed here.
    act(() => pushState({ ...LIVE_ON_S2, liveKey: 'song:s3:0', cuedKey: 'song:s3:0' }));
    // The reconciler follows: the center snaps to the new live song without any click here.
    await waitFor(() => expect(screen.getByText('Fanny Crosby')).toBeTruthy());
  });

  it('clicks while output is down select exactly as before (no arming)', async () => {
    const { cue } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], NOTHING_LIVE);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    await waitFor(() => expect(screen.getByText('Fanny Crosby')).toBeTruthy());
    expect(screen.queryByText('⇄ Switch')).toBeNull();
    await waitFor(() => expect(cue).toHaveBeenCalledWith('song:s3:0', expect.anything()));
  });

  it('QuickAdd save while live arms the new song instead of selecting it', async () => {
    const { add } = installHelmStubWith([CHORUS_SONG], LIVE_ON_S2);
    add.mockResolvedValue(NEXT_SONG);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('+ Add a song'));
    fireEvent.change(await screen.findByPlaceholderText(/Paste lyrics here/), { target: { value: 'Blessed assurance' } });
    fireEvent.click(screen.getByText('Add to library'));
    // The new song lands armed; the center never left the live song.
    await waitFor(() => expect(screen.getByText('⇄ Switch')).toBeTruthy());
    expect(screen.getAllByText('With Chorus').length).toBeGreaterThan(1); // rail row + hero header
  });
});

describe('SongsMode escape chain', () => {
  it('Escape disarms first, then takes the screen down on a second press', async () => {
    const { setOutput } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));

    let handled: boolean | undefined;
    act(() => { handled = keyHandlerRef.current?.onEscape(); });
    expect(handled).toBe(true);
    expect(screen.queryByText('⇄ Switch')).toBeNull();
    expect(setOutput).not.toHaveBeenCalled();

    act(() => { handled = keyHandlerRef.current?.onEscape(); });
    expect(handled).toBe(true);
    expect(setOutput).toHaveBeenCalledWith('black');
  });

  it('Escape in the search field is one key, one action: clears the query without also disarming', async () => {
    const { setOutput } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    expect(screen.getByText('⇄ Switch')).toBeTruthy();

    // Wire a REAL document-level keydown listener via dispatchModeKey, mirroring App.tsx's
    // own wiring exactly. This is the only way to actually prove e.stopPropagation() in the
    // input's React handler stops the native bubble from reaching the document dispatcher
    // (React 19 delegates its synthetic events at the root container — a DOM descendant of
    // document — so a stopPropagation() there does stop the native bubble past it) rather
    // than just assuming it based on the render tree.
    const onKeyDown = (e: KeyboardEvent): void =>
      dispatchModeKey(e, {
        settingsOpen: false,
        closeSettings: () => {},
        handler: keyHandlerRef.current,
        scope: 'songs',
        overrides: {},
        onAppAction: () => {}
      });
    document.addEventListener('keydown', onKeyDown);
    try {
      const input = screen.getByPlaceholderText(/Title or a lyric line/) as HTMLInputElement;
      input.focus();
      fireEvent.change(input, { target: { value: 'abc' } });

      // First Escape: query non-empty, so the field consumes it (clears only) and stops
      // propagation — the document dispatcher's onEscape must never run, so the arm survives.
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(input.value).toBe('');
      expect(screen.getByText('⇄ Switch')).toBeTruthy();
      expect(setOutput).not.toHaveBeenCalled();

      // Second Escape: query already empty, so the field is a no-op and the press reaches
      // the global chain, which disarms (progressive back-out, next step).
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByText('⇄ Switch')).toBeNull();
      expect(setOutput).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', onKeyDown);
    }
  });

  it('Escape while typing blurs the field and never takes the screen down', async () => {
    const { setOutput } = installHelmStubWith([CHORUS_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    const input = screen.getByPlaceholderText(/Title or a lyric line/) as HTMLInputElement;
    input.focus();
    let handled: boolean | undefined;
    act(() => { handled = keyHandlerRef.current?.onEscape(); });
    expect(handled).toBe(true);
    expect(document.activeElement).not.toBe(input);
    expect(setOutput).not.toHaveBeenCalled();
  });

  it('Escape with output down and nothing armed stays unhandled (App fallthrough)', async () => {
    installHelmStubWith([CHORUS_SONG], NOTHING_LIVE);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    expect(keyHandlerRef.current?.onEscape()).toBe(false);
  });
});

describe('section quick-edit', () => {
  const openSectionEditor = async (): Promise<HTMLTextAreaElement> => {
    // SONGS has one section, 'Verse 1' / ['Amazing grace']. The line renders twice at
    // once (hero "NOW SINGING" panel + the SectionRail row) — findAllByText, not
    // findByText, since a singular query throws on that pre-existing duplicate.
    await screen.findAllByText('Amazing grace');
    fireEvent.contextMenu(screen.getAllByText('Amazing grace').at(-1)!);
    fireEvent.click(screen.getByText('Edit'));
    return (await screen.findByDisplayValue('Amazing grace')) as HTMLTextAreaElement;
  };

  it('right-click → Edit swaps the card lines for a textarea, without cueing elsewhere', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    const box = await openSectionEditor();
    expect(box.value).toBe('Amazing grace');
    expect(document.activeElement).toBe(box);
  });

  it('Enter saves: songs.update gets the patched section and the fresh slide is re-cued', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    const box = await openSectionEditor();
    fireEvent.change(box, { target: { value: 'Amazing grace fixed\nsecond line' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() =>
      expect(h.update).toHaveBeenCalledWith('s1', {
        title: 'Amazing Grace',
        author: 'John Newton',
        sections: [{ label: 'Verse 1', lines: ['Amazing grace fixed', 'second line'] }]
      })
    );
    // re-cue carries the corrected lines; goLive is never used from a save path
    await waitFor(() =>
      expect(h.cue).toHaveBeenCalledWith(
        'song:s1:0',
        expect.objectContaining({ lines: ['Amazing grace fixed', 'second line'] })
      )
    );
    expect(h.goLive).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByDisplayValue(/fixed/)).toBeNull());
  });

  it('Shift+Enter does not save', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    const box = await openSectionEditor();
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(h.update).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Amazing grace')).toBeTruthy();
  });

  it('Escape cancels the edit, keeps the old lines, and never blacks the screen', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    const box = await openSectionEditor();
    fireEvent.change(box, { target: { value: 'half-typed junk' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByDisplayValue('half-typed junk')).toBeNull();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.setOutput).not.toHaveBeenCalled();
    expect(screen.getAllByText('Amazing grace').length).toBeGreaterThan(0);
  });

  it('a blank-only draft cancels instead of saving', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    const box = await openSectionEditor();
    fireEvent.change(box, { target: { value: '   \n  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(h.update).not.toHaveBeenCalled();
    // Not queryByRole('textbox') — the search <input> is a textbox too, so that query
    // never goes null; the section editor's <textarea> is what actually has to close.
    await waitFor(() => expect(document.querySelector('textarea')).toBeNull());
  });

  it('a failed save keeps the editor and the draft, and shows an error', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    h.update.mockImplementation(() => Promise.reject(new Error('boom')));
    renderMode(keyHandlerRef);
    const box = await openSectionEditor();
    fireEvent.change(box, { target: { value: 'Amazing grace fixed' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByText(/Couldn’t save/);
    expect(screen.getByDisplayValue('Amazing grace fixed')).toBeTruthy();
  });

  it('saving refreshes an active search so results reflect the edit', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    fireEvent.change(await screen.findByPlaceholderText('Title or a lyric line…'), { target: { value: 'grace' } });
    await waitFor(() => expect(h.search).toHaveBeenCalledWith('grace', 'all'));
    h.search.mockClear();
    const box = await openSectionEditor();
    fireEvent.change(box, { target: { value: 'Amazing grace fixed' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(h.search).toHaveBeenCalledWith('grace', 'all'));
  });
});

describe('whole-song edit', () => {
  it('right-click a song row → Edit opens the edit modal prefilled, with no console stub', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    installHelmStubWith(SONGS, NOTHING_LIVE);
    const info = vi.spyOn(console, 'info');
    renderMode(keyHandlerRef);
    // 'Amazing Grace' renders in the rail row AND the center header; the rail comes
    // first in DOM order, so [0] is the row.
    fireEvent.contextMenu((await screen.findAllByText('Amazing Grace'))[0]);
    fireEvent.click(screen.getByText('Edit'));
    expect(await screen.findByText('Edit song')).toBeTruthy();
    expect((screen.getByPlaceholderText('Song title') as HTMLInputElement).value).toBe('Amazing Grace');
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('saving from the modal updates the library row in place', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    fireEvent.contextMenu((await screen.findAllByText('Amazing Grace'))[0]); // [0] = rail row (rail precedes the center header in DOM order)
    fireEvent.click(screen.getByText('Edit'));
    await screen.findByText('Edit song');
    fireEvent.change(screen.getByPlaceholderText('Song title'), { target: { value: 'Amazing Grace (2nd ed.)' } });
    fireEvent.click(screen.getByText('Save changes'));
    // modal closes and the retitled song is in the rail + header
    await waitFor(() => expect(screen.queryByText('Edit song')).toBeNull());
    expect((await screen.findAllByText('Amazing Grace (2nd ed.)')).length).toBeGreaterThan(0);
  });

  // Regression for a CI flake (SongsMode chorus-jump / edit-modal Escape, SermonMode
  // deck-fallback): the mode key handler is an imperative handle, so it has to be attached
  // with layout timing. Registered in a passive effect it runs one commit behind, and a
  // MutationObserver callback — the microtask right after a commit, exactly where RTL's
  // waitFor resolves and where a real keypress can land — still gets the previous render's
  // closure. That is App.tsx's stated contract ("always reflects current state") broken:
  // Escape would keep answering for a modal that is already off screen.
  it('answers isModalOpen for the commit on screen, not the previous one', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    fireEvent.contextMenu((await screen.findAllByText('Amazing Grace'))[0]);
    fireEvent.click(screen.getByText('Edit'));
    await screen.findByText('Edit song');

    const disagreements: string[] = [];
    const observer = new MutationObserver(() => {
      const onScreen = screen.queryByText('Edit song') !== null;
      const handlerSays = keyHandlerRef.current?.isModalOpen() ?? false;
      if (onScreen !== handlerSays) disagreements.push(`dom=${onScreen} handler=${handlerSays}`);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    // songs.update resolves outside act(), so the close commits with no surrounding act()
    // to force an effect flush — the same shape as the real IPC round-trip.
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(screen.queryByText('Edit song')).toBeNull());
    observer.disconnect();
    expect(disagreements).toEqual([]);
  });

  it('Escape closes the edit modal before touching anything else', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    fireEvent.contextMenu((await screen.findAllByText('Amazing Grace'))[0]); // [0] = rail row (rail precedes the center header in DOM order)
    fireEvent.click(screen.getByText('Edit'));
    await screen.findByText('Edit song');
    expect(keyHandlerRef.current?.onEscape()).toBe(true);
    await waitFor(() => expect(screen.queryByText('Edit song')).toBeNull());
    expect(h.setOutput).not.toHaveBeenCalled();
    expect(keyHandlerRef.current?.isModalOpen()).toBe(false);
  });
});

describe('double-click to go live (#58)', () => {
  it('takes a section on double-click', async () => {
    const { take } = installHelmStubWith([CHORUS_SONG], NOTHING_LIVE);
    renderMode({ current: null });
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.doubleClick(screen.getAllByText('Chorus')[0]);
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith('song:s2:1', expect.objectContaining({ kind: 'lyrics' }))
    );
  });

  it('never blacks the screen when that section is already live', async () => {
    const live: PresentationState = { output: 'live', liveKey: 'song:s2:0', liveSnap: null, cuedKey: null, cuedSnap: null };
    const { take, goLive, setOutput } = installHelmStubWith([CHORUS_SONG], live);
    renderMode({ current: null });
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.doubleClick(screen.getAllByText('Verse 1')[0]);
    await waitFor(() => expect(take).toHaveBeenCalledWith('song:s2:0', expect.anything()));
    expect(goLive).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalledWith('black');
  });

  it('takes a search result live at section 0 instead of arming it', async () => {
    const live: PresentationState = { output: 'live', liveKey: 'song:s1:0', liveSnap: null, cuedKey: null, cuedSnap: null };
    const { take } = installHelmStubWith([...SONGS, CHORUS_SONG], live);
    renderMode({ current: null });
    const row = (await screen.findAllByText('With Chorus'))[0];
    fireEvent.doubleClick(row);
    await waitFor(() => expect(take).toHaveBeenCalledWith('song:s2:0', expect.anything()));
    expect(screen.queryByText('NEXT')).toBeNull(); // took it, did not merely arm it
  });

  // The divergence window: `take` is sent and the selection moves in one commit, but
  // `liveParsed` keeps naming the OLD song until main's broadcast lands. The live-lock
  // reconciliation effect fires a 0ms timer, which always beats that round trip — so
  // without the pendingSwitchRef latch it snaps the selection back to the previous song
  // and re-cues it. On the leader display that is the WRONG SONG (cuedKey = the old song
  // while liveKey = the new one), plus a center-panel flicker.
  it('does not re-cue the previous song after taking another one live', async () => {
    const live: PresentationState = { output: 'live', liveKey: 'song:s1:0', liveSnap: null, cuedKey: null, cuedSnap: null };
    const { take, cue } = installHelmStubWith([...SONGS, CHORUS_SONG], live);
    renderMode({ current: null });
    const row = (await screen.findAllByText('With Chorus'))[0];
    fireEvent.doubleClick(row);
    await waitFor(() => expect(take).toHaveBeenCalledWith('song:s2:0', expect.anything()));

    // Well past the reconciliation effect's setTimeout(…, 0), still before any broadcast.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(cue.mock.calls.map((c) => c[0])).toEqual(['song:s1:0', 'song:s2:0']);
  });
});

describe('SongsMode — Remove from library confirms rather than undoing (#90)', () => {
  const TWO: Song[] = [
    { id: 's1', title: 'Amazing Grace', author: 'Newton', sections: [{ label: 'Verse 1', lines: ['a'] }], source: 'manual', createdAt: 0 },
    { id: 's2', title: 'Only Believe', author: 'Rader', sections: [{ label: 'Verse 1', lines: ['b'] }], source: 'manual', createdAt: 1 }
  ];
  // The big preview header repeats the selected song's bare title, so matching on text
  // alone is ambiguous — only the search rail renders its rows as buttons.
  const rowFor = (title: string): HTMLElement => {
    const match = screen.getAllByText(title).find((el) => el.closest('button'));
    if (!match) throw new Error(`no song row found for "${title}"`);
    return match.closest('button') as HTMLElement;
  };
  const awaitRow = async (title: string): Promise<void> => {
    await waitFor(() => rowFor(title));
  };
  // Right-click the row and arm the confirm, then step past the arm-guard window (which
  // exists to swallow the tail of a double-click) so the NEXT click is a real decision.
  // Fake timers must be installed before arming, since that is when the guard timer starts.
  const armRemoveConfirm = (title: string): void => {
    vi.useFakeTimers();
    try {
      fireEvent.contextMenu(rowFor(title));
      fireEvent.click(screen.getByText('Remove from library'));
      act(() => {
        vi.advanceTimersByTime(400); // > CONFIRM_ARM_GUARD_MS
      });
    } finally {
      vi.useRealTimers();
    }
  };

  it('offers Remove from library on the row menu, alongside Edit', async () => {
    installHelmStubWith(TWO, NOTHING_LIVE);
    renderMode({ current: null });
    await awaitRow('Only Believe');
    fireEvent.contextMenu(rowFor('Only Believe'));

    expect(await screen.findByText('Edit')).toBeTruthy();
    expect(screen.getByText('Remove from library')).toBeTruthy();
  });

  it('the first click only arms — the song survives and the menu stays open', async () => {
    const { remove } = installHelmStubWith(TWO, NOTHING_LIVE);
    renderMode({ current: null });
    await awaitRow('Only Believe');
    fireEvent.contextMenu(rowFor('Only Believe'));
    fireEvent.click(await screen.findByText('Remove from library'));

    // The library is precious: no single click may take a song out of it.
    expect(remove).not.toHaveBeenCalled();
    expect(await screen.findByText('Remove — sure?')).toBeTruthy();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByText('Only Believe')).toBeTruthy();
  });

  it('the second click removes the song and drops it from the rail', async () => {
    const { remove } = installHelmStubWith(TWO, NOTHING_LIVE);
    renderMode({ current: null });
    await awaitRow('Only Believe');
    armRemoveConfirm('Only Believe');
    fireEvent.click(screen.getByText('Remove — sure?'));

    expect(remove).toHaveBeenCalledWith('s2');
    await waitFor(() => expect(screen.queryByText('Only Believe')).toBeNull());
    expect(rowFor('Amazing Grace')).toBeTruthy();
    // Confirm-grammar surfaces do not also offer an undo.
    expect(screen.queryByText(/Removed/)).toBeNull();
  });

  it('the arm lapses back to the plain label after the confirm window', async () => {
    installHelmStubWith(TWO, NOTHING_LIVE);
    renderMode({ current: null });
    await awaitRow('Only Believe');

    vi.useFakeTimers();
    try {
      fireEvent.contextMenu(rowFor('Only Believe'));
      fireEvent.click(screen.getByText('Remove from library'));
      expect(screen.getByText('Remove — sure?')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.queryByText('Remove — sure?')).toBeNull();
      expect(screen.getByText('Remove from library')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('right-clicking another row disarms a confirm left armed on the first', async () => {
    const { remove } = installHelmStubWith(TWO, NOTHING_LIVE);
    renderMode({ current: null });
    await awaitRow('Only Believe');

    fireEvent.contextMenu(rowFor('Only Believe'));
    fireEvent.click(await screen.findByText('Remove from library'));
    fireEvent.contextMenu(rowFor('Amazing Grace'));

    // The fresh menu must open disarmed, or one click would remove a song the operator
    // never confirmed.
    expect(await screen.findByText('Remove from library')).toBeTruthy();
    expect(screen.queryByText('Remove — sure?')).toBeNull();
    fireEvent.click(screen.getByText('Remove from library'));
    expect(remove).not.toHaveBeenCalled();
  });

  it('moves the selection to a neighbour when the selected song is removed', async () => {
    installHelmStubWith(TWO, NOTHING_LIVE);
    renderMode({ current: null });
    await awaitRow('Amazing Grace');

    // Amazing Grace is selected on load (first song); remove it.
    armRemoveConfirm('Amazing Grace');
    fireEvent.click(screen.getByText('Remove — sure?'));

    await waitFor(() => expect(screen.queryByText('Amazing Grace')).toBeNull());
    // The heading tracks the selection, so it having moved on is what proves it.
    await waitFor(() => expect(screen.getAllByText('Only Believe').length).toBeGreaterThan(1));
  });

  // The confirm re-labels in place, so without a guard the second half of a double-click
  // lands on 'Remove — sure?' at the same coordinates and deletes in one gesture.
  it('a double-click arms without also confirming', async () => {
    const { remove } = installHelmStubWith(TWO, NOTHING_LIVE);
    renderMode({ current: null });
    await awaitRow('Only Believe');

    vi.useFakeTimers();
    try {
      fireEvent.contextMenu(rowFor('Only Believe'));
      fireEvent.click(screen.getByText('Remove from library'));
      // The very next click, landing immediately on the re-labelled item, is the tail of
      // the double-click — not a decision.
      fireEvent.click(screen.getByText('Remove — sure?'));
      expect(remove).not.toHaveBeenCalled();
      expect(screen.getByText('Remove — sure?')).toBeTruthy();

      // A deliberate click after the guard elapses still works.
      act(() => {
        vi.advanceTimersByTime(400);
      });
      fireEvent.click(screen.getByText('Remove — sure?'));
      expect(remove).toHaveBeenCalledWith('s2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a confirm timer left running never rewrites a different menu', async () => {
    installHelmStubWith(TWO, NOTHING_LIVE);
    renderMode({ current: null });
    await awaitRow('Only Believe');

    vi.useFakeTimers();
    try {
      fireEvent.contextMenu(rowFor('Only Believe'));
      fireEvent.click(screen.getByText('Remove from library'));
      // Escape out, then open the SECTION menu, which offers only Edit.
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      fireEvent.contextMenu(screen.getByText('Verse 1').closest('button') as HTMLElement);
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(4000);
      });
      // The lapsing song-confirm must not turn this into the song menu.
      expect(screen.queryByText('Remove from library')).toBeNull();
      expect(screen.queryByText('Remove — sure?')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to remove the song currently on screen, and says why', async () => {
    const LIVE_S2: PresentationState = {
      output: 'live',
      liveKey: 'song:s2:0',
      liveSnap: { kind: 'lyrics', label: 'Only Believe', lines: ['b'] },
      cuedKey: null,
      cuedSnap: null
    };
    const { remove } = installHelmStubWith(TWO, LIVE_S2);
    renderMode({ current: null });
    await awaitRow('Only Believe');

    fireEvent.contextMenu(rowFor('Only Believe'));
    const item = await screen.findByRole('menuitem', { name: /take it down first/i });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(item);
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByText('Remove from library')).toBeNull();
  });

  it('still offers removal for songs that are not the live one', async () => {
    const LIVE_S2: PresentationState = {
      output: 'live',
      liveKey: 'song:s2:0',
      liveSnap: { kind: 'lyrics', label: 'Only Believe', lines: ['b'] },
      cuedKey: null,
      cuedSnap: null
    };
    installHelmStubWith(TWO, LIVE_S2);
    renderMode({ current: null });
    await awaitRow('Amazing Grace');

    fireEvent.contextMenu(rowFor('Amazing Grace'));
    expect(await screen.findByText('Remove from library')).toBeTruthy();
  });

  it('never answers the Delete key — no keystroke removes a library song', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const { remove } = installHelmStubWith(TWO, NOTHING_LIVE);
    renderMode(keyHandlerRef);
    await awaitRow('Only Believe');

    fireEvent.click(rowFor('Only Believe'));
    act(() => keyHandlerRef.current?.onDelete?.());
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('SongsMode — empty library invites the operator to fill it (#88)', () => {
  it('names both affordances when the library holds nothing', async () => {
    installHelmStubWith([], NOTHING_LIVE);
    renderMode({ current: null });

    const empty = await screen.findByText(/No songs yet/);
    expect(empty.textContent).toMatch(/\+ Add a song/);
    expect(empty.textContent).toMatch(/Import a song library/);
  });

  it('shows no empty state once the library has songs', async () => {
    installHelmStubWith(
      [{ id: 's1', title: 'Amazing Grace', author: 'Newton', sections: [{ label: 'Verse 1', lines: ['a'] }], source: 'manual', createdAt: 0 }],
      NOTHING_LIVE
    );
    renderMode({ current: null });
    await waitFor(() => expect(screen.getAllByText('Amazing Grace').length).toBeGreaterThan(0));
    expect(screen.queryByText(/No songs yet/)).toBeNull();
  });
});

// #85. Same contract SermonCenter holds, verified here because Songs has the extra state
// the issue was written about: an armed switch used to grow the bar by the width of a song
// title, and shove Take down sideways on its way in.
describe('SongsMode — the transport is stable ground (#85)', () => {
  const bar = (): HTMLElement => document.querySelector('[data-transport-bar]') as HTMLElement;
  const verb = (name: RegExp): HTMLButtonElement =>
    within(bar()).getByRole('button', { name }) as HTMLButtonElement;

  it('renders Take down in every state, ghosted while nothing is on screen', async () => {
    installHelmStubWith([CHORUS_SONG], NOTHING_LIVE);
    renderMode({ current: null });
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    expect(verb(/Take down/).disabled).toBe(true);
  });

  it('keeps the primary slot saying Go live once the cued section is on screen', async () => {
    const { goLive } = installHelmStubWith([CHORUS_SONG], LIVE_ON_S2);
    renderMode({ current: null });
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    const primary = verb(/Go live/);
    expect(primary.disabled).toBe(true);
    fireEvent.click(primary);
    expect(goLive).not.toHaveBeenCalled();
  });

  // Enter is the button's keyboard twin, so it stops where the button stops. Escape is
  // still the way down — see the onEscape ladder.
  it('makes Enter a no-op — not a take-down — when the cued section is already live', async () => {
    const { goLive, setOutput } = installHelmStubWith([CHORUS_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());

    act(() => keyHandlerRef.current?.onGoLive());
    expect(goLive).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalled();
  });

  it('carries no logo toggle', async () => {
    installHelmStubWith([CHORUS_SONG], LIVE_ON_S2);
    renderMode({ current: null });
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /logo/i })).toBeNull();
  });

  it('ends with Take down then the primary slot, at a fixed width, armed or not', async () => {
    installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    renderMode({ current: null });
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());

    const order = (): (string | undefined)[] =>
      within(bar())
        .getAllByRole('button')
        .map((b) => b.textContent?.trim());
    expect(order().slice(-2)).toEqual(['Take down', 'Go live']);
    const idleWidth = verb(/Go live/).style.width;
    expect(idleWidth).toBeTruthy();

    // Arming used to insert a second button AND size the primary by the song's title.
    fireEvent.click(screen.getByText('Blessed Assurance'));
    expect(order().slice(-2)).toEqual(['Take down', '⇄ Switch']);
    expect(verb(/Switch/).style.width).toBe(idleWidth);
  });

  it('names the armed song in the tooltip, never in the button width', async () => {
    installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    renderMode({ current: null });
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));

    const primary = verb(/Switch/);
    expect(primary.textContent?.trim()).toBe('⇄ Switch');
    expect(primary.title).toBe('Switch to Blessed Assurance');
  });
});

describe('SongsMode — the rail forecasts what a click will do (#89)', () => {
  it('offers NEXT? on hover only while a song holds the screen', async () => {
    installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    renderMode({ current: null });
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());

    const railRow = screen.getByText('Blessed Assurance').closest('button') as HTMLButtonElement;
    fireEvent.mouseEnter(railRow);
    expect(screen.getByText('NEXT?')).toBeTruthy();

    // Committing the arm replaces the forecast with the real badge.
    fireEvent.click(railRow);
    expect(screen.queryByText('NEXT?')).toBeNull();
    expect(screen.getByText('NEXT')).toBeTruthy();
  });

  it('stays quiet when nothing is live — a click there only moves the cue', async () => {
    installHelmStubWith([CHORUS_SONG, NEXT_SONG], NOTHING_LIVE);
    renderMode({ current: null });
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());

    fireEvent.mouseEnter(screen.getByText('Blessed Assurance').closest('button') as HTMLButtonElement);
    expect(screen.queryByText('NEXT?')).toBeNull();
  });
});

describe('SongsMode hero — auto-fit confidence monitor', () => {
  it('hero lines carry the projector contract: nowrap + the fitted font formula', async () => {
    installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode({ current: null });
    await screen.findAllByText('Amazing grace');

    const hero = screen.getByTestId('song-hero');
    const line = within(hero).getByText('Amazing grace') as HTMLElement;
    // nowrap distinguishes the hero copy from the rail copy, which wraps freely.
    expect(line.style.whiteSpace).toBe('nowrap');
    // jsdom's cssstyle drops declarations with container-query units, so the font
    // formula is pinned via the exported constant (same pattern as SLIDE_HERO_WIDTH).
    expect(HERO_LINE_FONT).toBe('max(14px, var(--helm-fit-size, 7.4cqmin))');
  });

  it('the rail copy of the same line does NOT get nowrap (cards keep wrapping)', async () => {
    installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode({ current: null });
    const copies = await screen.findAllByText('Amazing grace');
    expect(copies.some((el) => (el as HTMLElement).style.whiteSpace !== 'nowrap')).toBe(true);
  });
});

describe('SongsMode — collapsible section rail', () => {
  afterEach(() => {
    localStorage.removeItem('helmSectionRailCollapsed');
  });

  it('collapses to a stub, restores on stub click, and never loses the hero', async () => {
    installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode({ current: null });
    await screen.findAllByText('Amazing grace');

    fireEvent.click(screen.getByTitle('Hide sections — bigger lyrics'));
    expect(screen.queryByText('SECTIONS — TAP TO SING')).toBeNull();
    // The hero (the confidence monitor) is untouched.
    expect(within(screen.getByTestId('song-hero')).getByText('Amazing grace')).toBeTruthy();
    // The wrapper GLIDES shut rather than snapping — the width transition is what lets
    // the hero's auto-fit (re-measured per frame via its ResizeObserver) scale smoothly.
    const wrap = screen.getByTestId('rail-wrap');
    expect(wrap.style.width).toBe('30px');
    expect(wrap.style.transition).toContain('width');

    fireEvent.click(screen.getByTitle('Show sections'));
    expect(screen.getByText('SECTIONS — TAP TO SING')).toBeTruthy();
    // Default rail width (380) + the divider's 12px hit area.
    expect(screen.getByTestId('rail-wrap').style.width).toBe('392px');
  });

  it('persists the collapsed state across a remount', async () => {
    installHelmStubWith(SONGS, NOTHING_LIVE);
    const first = renderMode({ current: null });
    await screen.findAllByText('Amazing grace');
    fireEvent.click(screen.getByTitle('Hide sections — bigger lyrics'));
    first.unmount();

    installHelmStubWith(SONGS, NOTHING_LIVE);
    renderMode({ current: null });
    await screen.findAllByText('Amazing grace');
    expect(screen.queryByText('SECTIONS — TAP TO SING')).toBeNull();
    expect(screen.getByTitle('Show sections')).toBeTruthy();
  });

  it('section hotkey jumps still work while the rail is collapsed', async () => {
    localStorage.setItem('helmSectionRailCollapsed', '1');
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const h = installHelmStubWith([CHORUS_SONG], NOTHING_LIVE);
    renderMode(keyHandlerRef);
    await screen.findByText('NOW SINGING · Verse 1');

    act(() => keyHandlerRef.current?.onAction?.({ id: 'song.chorus' }));
    await waitFor(() => expect(screen.getByText('NOW SINGING · Chorus')).toBeTruthy());
    expect(h.cue).toHaveBeenCalledWith('song:s2:1', expect.objectContaining({ sectionLabel: 'Chorus' }));
  });
});
