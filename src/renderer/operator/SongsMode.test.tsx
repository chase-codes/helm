// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SongsMode } from './SongsMode';
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
  setOutput: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
  pushState: (s: PresentationState) => void;
} {
  const goLive = vi.fn();
  const cue = vi.fn();
  const setOutput = vi.fn();
  const add = vi.fn();
  let stateCb: (s: PresentationState) => void = () => {};
  (window as unknown as { helm: unknown }).helm = {
    songs: { list: () => Promise.resolve(songs), search: vi.fn(() => Promise.resolve([])), add },
    presentation: {
      get: () => Promise.resolve(state),
      onState: (cb: (s: PresentationState) => void) => {
        stateCb = cb;
        return () => {};
      },
      cue,
      goLive,
      setOutput
    },
    songImport: {
      sources: () => Promise.resolve([]),
      scan: vi.fn(),
      commit: vi.fn(),
      onProgress: () => () => {}
    }
  };
  return { goLive, cue, setOutput, add, pushState: (s) => stateCb(s) };
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
    cue.mockClear(); // drop the initial-selection cue of s2:0

    fireEvent.click(screen.getByText('Blessed Assurance'));
    // Center unchanged: hero still shows the live song (title appears twice — rail row + hero header).
    expect(screen.getAllByText('With Chorus').length).toBeGreaterThan(1);
    expect(screen.getByText(/⇄ Switch to Blessed Assurance/)).toBeTruthy();
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
    fireEvent.click(screen.getByText(/⇄ Switch to Blessed Assurance/));
    expect(goLive).toHaveBeenCalledWith('song:s3:0', expect.objectContaining({ label: 'Blessed Assurance · Verse 1' }));
    // Selection followed the commit; arm cleared.
    await waitFor(() => expect(screen.getAllByText('Blessed Assurance').length).toBeGreaterThan(1)); // rail row + hero header
    expect(screen.queryByText(/⇄ Switch to/)).toBeNull();
  });

  it('re-arming the just-committed song before its broadcast lands, then switching, disarms without a second goLive', async () => {
    const { goLive, pushState } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());

    // Arm and commit: goLive fires, selection moves to s3, but the stub's live state
    // (liveKey) hasn't been pushed yet — the broadcast round-trip is still in flight.
    fireEvent.click(screen.getByText('Blessed Assurance'));
    fireEvent.click(screen.getByText(/⇄ Switch to Blessed Assurance/));
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
    expect(screen.getByText(/⇄ Switch to Blessed Assurance/)).toBeTruthy();

    // Now the broadcast lands: liveKey catches up to the song that was already re-armed.
    act(() => pushState({ ...LIVE_ON_S2, liveKey: 'song:s3:0', cuedKey: 'song:s3:0' }));
    await waitFor(() => expect(screen.getByText(/⇄ Switch to Blessed Assurance/)).toBeTruthy());

    // Pressing Switch now must NOT send a second goLive on the already-live key (main
    // reads a same-key goLive as take-down) — it just disarms.
    fireEvent.click(screen.getByText(/⇄ Switch to Blessed Assurance/));
    expect(goLive).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/⇄ Switch to/)).toBeNull();
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
    fireEvent.click(screen.getByText(/⇄ Switch to Blessed Assurance/));
    expect(goLive).toHaveBeenCalledTimes(1);

    // Re-arm the same (now-selected) song and commit again, still before any broadcast.
    const s3RowBtn = screen
      .getAllByText('Blessed Assurance')
      .map((el) => el.closest('button'))
      .find((b): b is HTMLButtonElement => !!b)!;
    fireEvent.click(s3RowBtn);
    expect(screen.getByText(/⇄ Switch to Blessed Assurance/)).toBeTruthy();
    fireEvent.click(screen.getByText(/⇄ Switch to Blessed Assurance/));

    // Guarded by pendingSwitchRef (liveParsed is still stale): no second goLive.
    expect(goLive).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/⇄ Switch to/)).toBeNull();
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
    expect(screen.getByText(/⇄ Switch to Blessed Assurance/)).toBeTruthy();
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
    expect(screen.queryByText(/⇄ Switch to/)).toBeNull();
    await waitFor(() => expect(cue).toHaveBeenCalledWith('song:s3:0', expect.anything()));
  });

  it('a cross-kind takeover (scripture live) plain-disarms without moving the selection', async () => {
    const { pushState } = installHelmStubWith([CHORUS_SONG, NEXT_SONG], LIVE_ON_S2);
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    renderMode(keyHandlerRef);
    await waitFor(() => expect(screen.getByText('NOW SINGING · Verse 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Blessed Assurance'));
    act(() => pushState({ ...LIVE_ON_S2, liveKey: 'scr:kjv:John:3', liveSnap: { kind: 'scripture' } }));
    await waitFor(() => expect(screen.queryByText(/⇄ Switch to/)).toBeNull());
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
    expect(screen.queryByText(/⇄ Switch to/)).toBeNull();
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
    await waitFor(() => expect(screen.getByText(/⇄ Switch to Blessed Assurance/)).toBeTruthy());
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
    expect(screen.queryByText(/⇄ Switch to/)).toBeNull();
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
    expect(screen.getByText(/⇄ Switch to Blessed Assurance/)).toBeTruthy();

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
      expect(screen.getByText(/⇄ Switch to Blessed Assurance/)).toBeTruthy();
      expect(setOutput).not.toHaveBeenCalled();

      // Second Escape: query already empty, so the field is a no-op and the press reaches
      // the global chain, which disarms (progressive back-out, next step).
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByText(/⇄ Switch to/)).toBeNull();
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
