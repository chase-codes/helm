// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SongsMode } from './SongsMode';
import { ThemeCtx } from './ThemeCtx';
import { themeFor } from '../../shared/theme';
import type { ModeKeyHandlerRef } from './App';
import type { PresentationState, Song } from '../../shared/types';

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

function installHelmStub(): void {
  (window as unknown as { helm: unknown }).helm = {
    songs: {
      list: () => Promise.resolve(SONGS),
      search: () => Promise.resolve([])
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
      scan: vi.fn(),
      commit: vi.fn(),
      onProgress: () => () => {}
    }
  };
}

const renderMode = (keyHandlerRef: ModeKeyHandlerRef): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('dark')}>
      <SongsMode themeMode="dark" keyHandlerRef={keyHandlerRef} active />
    </ThemeCtx.Provider>
  );

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
});
