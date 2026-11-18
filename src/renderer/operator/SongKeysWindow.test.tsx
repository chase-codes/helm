// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SongsMode } from './SongsMode';
import { SongKeysWindow } from './SongKeysWindow';
import { progressLine } from './songKeysText';
import { ThemeCtx } from './ThemeCtx';
import { themeFor } from '../../shared/theme';
import { dispatchModeKey } from './keyDispatch';
import { settleAndClear } from '../../test/mocks';
import type { ModeKeyHandlerRef } from './App';
import type { MusicKeyCounts, MusicKeyListQuery, MusicKeyRow, PresentationState, Song } from '../../shared/types';
import type { MusicKey, MusicKeySource } from '../../shared/songs/musicKey';

afterEach(cleanup);

const NOTHING_LIVE: PresentationState = { output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null };
const DAY = 24 * 60 * 60 * 1000;

interface FakeSong extends Song {
  liveDays?: number;
  lastLiveAt?: number | null;
  skippedAt?: number | null;
}
const song = (id: string, title: string, extra: Partial<FakeSong> = {}): FakeSong => ({
  id,
  title,
  author: `${title} Author`,
  sections: [{ label: 'Verse 1', lines: [`${title} line one`, `${title} line two`] }],
  source: 'manual',
  createdAt: 0,
  ...extra
});

type Mock = ReturnType<typeof vi.fn>;
type FakeHelm = Record<'keyList' | 'keyCounts' | 'setMusicKey' | 'skipMusicKey' | 'restoreMusicKey' | 'get' | 'cue' | 'goLive' | 'take' | 'setOutput', Mock>;
/** An in-memory stand-in for main's song keys calls, with the repo's tab rules. */
function installFake(seed: FakeSong[], state: PresentationState = NOTHING_LIVE): FakeHelm {
  const db = new Map(seed.map((s) => [s.id, { ...s }]));
  const out = (s: FakeSong): Song => {
    const { liveDays: _d, lastLiveAt: _l, skippedAt: _s, ...rest } = s;
    void _d; void _l; void _s;
    return { ...rest };
  };
  const toRow = (s: FakeSong): MusicKeyRow => ({
    id: s.id, title: s.title, author: s.author, firstLine: s.sections[0]?.lines[0] ?? '',
    key: s.key ?? '', keySource: s.key ? (s.keySource ?? '') : '',
    liveDays: s.liveDays ?? 0, lastLiveAt: s.lastLiveAt ?? null, skippedAt: s.skippedAt ?? null
  });
  const noKey = (r: MusicKeyRow): boolean => r.key === '' || r.keySource === 'legacy';
  const lately = (r: MusicKeyRow): boolean => r.lastLiveAt !== null && r.lastLiveAt >= Date.now() - 56 * DAY;
  const keyList = vi.fn(({ tab, q }: MusicKeyListQuery) => {
    let rows = [...db.values()].map(toRow);
    const needle = (q ?? '').trim().toLowerCase();
    if (needle) rows = rows.filter((r) => `${r.title} ${r.author}`.toLowerCase().includes(needle));
    const byTitle = (a: MusicKeyRow, b: MusicKeyRow): number => a.title.localeCompare(b.title);
    if (tab === 'all') rows.sort(byTitle);
    else if (tab === 'lately') rows = rows.filter(lately).sort((a, b) => b.lastLiveAt! - a.lastLiveAt!);
    else rows = rows.filter(noKey).sort((a, b) => Number(a.skippedAt !== null) - Number(b.skippedAt !== null) || b.liveDays - a.liveDays || byTitle(a, b));
    return Promise.resolve(rows);
  });
  const keyCounts = vi.fn((): Promise<MusicKeyCounts> => {
    const rows = [...db.values()].map(toRow);
    return Promise.resolve({
      total: rows.length,
      noKey: rows.filter(noKey).length,
      lately: rows.filter(lately).length,
      latelyWithKey: rows.filter((r) => lately(r) && !noKey(r)).length,
      anyLive: rows.some((r) => r.lastLiveAt !== null)
    });
  });
  const setMusicKey = vi.fn((id: string, key: MusicKey | null, source: MusicKeySource) => {
    const s = db.get(id)!;
    if (key) Object.assign(s, { key, keySource: source, skippedAt: null });
    else { delete s.key; delete s.keySource; }
    return Promise.resolve(out(s));
  });
  const skipMusicKey = vi.fn((id: string) => {
    db.get(id)!.skippedAt = Date.now();
    return Promise.resolve();
  });
  const restoreMusicKey = vi.fn((id: string, raw: string, source: MusicKeySource | '', skippedAt?: number | null) => {
    const s = db.get(id)!;
    if (raw) Object.assign(s, { key: raw, keySource: source || undefined });
    else { delete s.key; delete s.keySource; }
    if (skippedAt !== undefined) s.skippedAt = skippedAt;
    return Promise.resolve(out(s));
  });
  const get = vi.fn((id: string) => Promise.resolve(db.has(id) ? out(db.get(id)!) : null));
  const cue = vi.fn();
  const goLive = vi.fn();
  const take = vi.fn();
  const setOutput = vi.fn();
  (window as unknown as { helm: unknown }).helm = {
    songs: {
      list: () => Promise.resolve([...db.values()].map(out)),
      search: vi.fn(() => Promise.resolve([])),
      get, add: vi.fn(), update: vi.fn(), remove: vi.fn(),
      keyList, keyCounts, setMusicKey, skipMusicKey, restoreMusicKey
    },
    presentation: { get: () => Promise.resolve(state), onState: () => () => {}, cue, goLive, take, setOutput },
    songImport: { sources: () => Promise.resolve([]), scan: vi.fn(), commit: vi.fn(), onProgress: () => () => {} }
  };
  return { keyList, keyCounts, setMusicKey, skipMusicKey, restoreMusicKey, get, cue, goLive, take, setOutput };
}

const theme = themeFor('classic', 'dark');
/** SongsMode with the real document dispatcher, wired the way App.tsx wires it. */
function renderPage(keyHandlerRef: ModeKeyHandlerRef = { current: null }): () => void {
  render(
    <ThemeCtx.Provider value={theme}>
      <SongsMode keyHandlerRef={keyHandlerRef} active />
    </ThemeCtx.Provider>
  );
  const onKeyDown = (e: KeyboardEvent): void =>
    dispatchModeKey(e, { settingsOpen: false, closeSettings: () => {}, handler: keyHandlerRef.current, scope: 'songs', overrides: {}, onAppAction: () => {} });
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}

const windowTitle = (): HTMLElement | null => screen.queryByText('Song keys');
const shownTitle = (): string | null | undefined => document.querySelector('[data-key-song-title]')?.textContent;
const search = (): HTMLInputElement => screen.getByLabelText('Search songs') as HTMLInputElement;
const progress = (): string => document.querySelector('[data-progress-line]')!.textContent!;
const listTitles = (): string[] =>
  [...document.querySelectorAll('[data-key-row]')].map((b) => b.querySelector('div > div')!.textContent!);
const press = (key: string, init: KeyboardEventInit = {}): void => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
};
const libSlot = (title: string): string => {
  const row = screen.getAllByText(title).map((el) => el.closest('button')).find((b) => b?.querySelector('[data-key-slot]') && !b.hasAttribute('data-key-row'));
  return row!.querySelector('[data-key-slot]')!.textContent!;
};

async function openWindow(): Promise<void> {
  fireEvent.click(await screen.findByText('Fill in song keys'));
  await waitFor(() => expect(windowTitle()).toBeTruthy());
  await waitFor(() => expect(shownTitle()).toBeTruthy());
}

const A = song('a', 'Amazing Grace', { liveDays: 3, lastLiveAt: Date.now() - 2 * DAY });
const B = song('b', 'Build My Life', { liveDays: 1, lastLiveAt: Date.now() - 9 * DAY });
const C = song('c', 'Cornerstone', { key: 'Eb', keySource: 'title', liveDays: 2, lastLiveAt: Date.now() - DAY });
const L = song('l', 'Lord I Need You', { key: 'G or A', keySource: 'legacy' });

describe('Song keys window', () => {
  it('opens from the rail row under + Import a song library, with the search focused and No key first', async () => {
    const { keyList, keyCounts } = installFake([A, B, C]);
    const off = renderPage();
    try {
      const fill = await screen.findByText('Fill in song keys');
      expect(fill.previousElementSibling?.textContent).toContain('+ Import a song library');
      await openWindow();
      expect(document.activeElement).toBe(search());
      expect(keyList).toHaveBeenCalledWith({ tab: 'none', q: '' });
      expect(keyCounts).toHaveBeenCalled();
      expect(listTitles()).toEqual(['Amazing Grace', 'Build My Life']);
      expect(shownTitle()).toBe('Amazing Grace');
      // Title, author, the first two lyric lines (from the full song), no source for no key.
      await waitFor(() => expect(document.querySelector('[data-key-lyrics]')!.textContent).toBe('Amazing Grace line oneAmazing Grace line two'));
      expect(screen.getAllByText('Amazing Grace Author').length).toBeGreaterThan(0);
      expect(document.querySelector('[data-key-source]')!.textContent).toBe('');
      expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    } finally {
      off();
    }
  });

  it('tabs: No key shows its count; Sung lately and All list their own songs; the progress line is scoped', async () => {
    const { keyList } = installFake([A, B, C, L]);
    const off = renderPage();
    try {
      await openWindow();
      await waitFor(() => expect(document.querySelector('[data-tab-count]')?.textContent).toBe('3'));
      expect(listTitles()).toEqual(['Amazing Grace', 'Build My Life', 'Lord I Need You']);
      expect(progress()).toBe('Sung lately: 1 of 3 have a key.');

      fireEvent.click(screen.getByRole('tab', { name: 'Sung lately' }));
      expect(keyList).toHaveBeenLastCalledWith({ tab: 'lately', q: '' });
      await waitFor(() => expect(listTitles()).toEqual(['Cornerstone', 'Amazing Grace', 'Build My Life']));
      expect(shownTitle()).toBe('Cornerstone');
      expect(document.querySelector('[data-key-source]')!.textContent).toBe('From the title in EasyWorship');

      fireEvent.click(screen.getByRole('tab', { name: 'All' }));
      await waitFor(() => expect(listTitles()).toEqual(['Amazing Grace', 'Build My Life', 'Cornerstone', 'Lord I Need You']));
      fireEvent.click(screen.getByText('Lord I Need You', { selector: '[data-key-row] div' }));
      expect(document.querySelector('[data-key-source]')!.textContent).toBe('Was: G or A');
    } finally {
      off();
    }
  });

  it('on No key a save moves to the next song, and the Songs page shows the key; nothing touches the screen', async () => {
    const { setMusicKey, cue, goLive, take, setOutput } = installFake([A, B, C]);
    const off = renderPage();
    try {
      await settleAndClear(cue, 'song:a:0', expect.anything());
      await openWindow();
      fireEvent.click(screen.getByRole('button', { name: 'Key G' }));
      expect(setMusicKey).toHaveBeenCalledWith('a', 'G', 'typed');
      expect(shownTitle()).toBe('Build My Life');
      await waitFor(() => expect(listTitles()).toEqual(['Build My Life']));
      await waitFor(() => expect(libSlot('Amazing Grace')).toBe('G'));
      expect(screen.queryByText(/Key changed/)).toBeNull(); // nothing was replaced
      expect(cue).not.toHaveBeenCalled();
      expect(goLive).not.toHaveBeenCalled();
      expect(take).not.toHaveBeenCalled();
      expect(setOutput).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });

  it('on All a save stays on the song; replacing a key offers Undo for exactly that', async () => {
    const { setMusicKey, restoreMusicKey } = installFake([A, B, C]);
    const off = renderPage();
    try {
      await openWindow();
      fireEvent.click(screen.getByRole('tab', { name: 'All' }));
      await waitFor(() => expect(listTitles()).toHaveLength(3));
      fireEvent.click(screen.getByText('Cornerstone', { selector: '[data-key-row] div' }));
      fireEvent.click(screen.getByRole('button', { name: 'Key E' }));
      expect(setMusicKey).toHaveBeenCalledWith('c', 'E', 'typed');
      expect(await screen.findByText('Key changed to E')).toBeTruthy();
      expect(shownTitle()).toBe('Cornerstone');
      await waitFor(() => expect(document.querySelector('[data-key-source]')!.textContent).toBe('Typed in Helm'));

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(restoreMusicKey).toHaveBeenCalledWith('c', 'Eb', 'title', null);
      await waitFor(() => expect(document.querySelector('[data-key-source]')!.textContent).toBe('From the title in EasyWorship'));
      expect(screen.queryByText('Key changed to E')).toBeNull();
      await waitFor(() => expect(libSlot('Cornerstone')).toBe('Eb'));
    } finally {
      off();
    }
  });

  it('Undo after replacing a legacy value restores the text and its legacy source, and the song comes back to No key', async () => {
    const { restoreMusicKey } = installFake([L, B]);
    const off = renderPage();
    try {
      await openWindow();
      expect(listTitles()).toEqual(['Build My Life', 'Lord I Need You']);
      fireEvent.click(screen.getByText('Lord I Need You', { selector: '[data-key-row] div' }));
      expect(document.querySelector('[data-key-source]')!.textContent).toBe('Was: G or A');
      fireEvent.click(screen.getByRole('button', { name: 'Key G' }));
      expect(await screen.findByText('Key changed to G')).toBeTruthy();
      await waitFor(() => expect(listTitles()).toEqual(['Build My Life']));

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(restoreMusicKey).toHaveBeenCalledWith('l', 'G or A', 'legacy', null);
      await waitFor(() => expect(listTitles()).toEqual(['Build My Life', 'Lord I Need You']));
      expect(shownTitle()).toBe('Lord I Need You');
      expect(document.querySelector('[data-key-source]')!.textContent).toBe('Was: G or A');
    } finally {
      off();
    }
  });

  it('Skip leaves the key blank, moves on, and the skipped song drops to the end of No key', async () => {
    const { skipMusicKey, setMusicKey } = installFake([A, B]);
    const off = renderPage();
    try {
      await openWindow();
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
      expect(skipMusicKey).toHaveBeenCalledWith('a');
      expect(setMusicKey).not.toHaveBeenCalled();
      expect(shownTitle()).toBe('Build My Life');
      await waitFor(() => expect(listTitles()).toEqual(['Build My Life', 'Amazing Grace']));
    } finally {
      off();
    }
  });

  it('keyboard: / focuses the search, Mod+Backspace clears it, ↑/↓ move rows, letters and Enter save outside the search', async () => {
    const { setMusicKey } = installFake([A, B, C]);
    const off = renderPage();
    try {
      await openWindow();
      fireEvent.change(search(), { target: { value: 'build' } });
      await waitFor(() => expect(listTitles()).toEqual(['Build My Life']));
      press('e'); // typed into the field, not the picker
      press('Enter'); // leaves the field
      expect(document.activeElement).not.toBe(search());
      expect(setMusicKey).not.toHaveBeenCalled();

      press('/');
      expect(document.activeElement).toBe(search());
      press('Backspace', { ctrlKey: true });
      expect(search().value).toBe('');
      await waitFor(() => expect(listTitles()).toEqual(['Amazing Grace', 'Build My Life']));
      press('ArrowDown'); // from the search field too
      expect(shownTitle()).toBe('Build My Life');
      press('ArrowUp');
      expect(shownTitle()).toBe('Amazing Grace');

      press('Escape'); // out of the search field
      for (const key of ['f', '#', 'm']) press(key);
      expect(document.querySelector('[data-key-picker] [aria-current="true"]')?.getAttribute('data-key')).toBe('F#m');
      press('Enter');
      expect(setMusicKey).toHaveBeenCalledWith('a', 'F#m', 'typed');
    } finally {
      off();
    }
  });

  it('Escape steps back one layer at a time and closes the window, never taking down the live screen', async () => {
    const LIVE: PresentationState = { output: 'live', liveKey: 'song:a:0', liveSnap: null, cuedKey: 'song:a:0', cuedSnap: null };
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const { setOutput, goLive, take } = installFake([A, B], LIVE);
    const off = renderPage(keyHandlerRef);
    try {
      await openWindow();
      expect(keyHandlerRef.current?.isModalOpen()).toBe(true);
      press('Escape'); // 1: leave the search field
      expect(document.activeElement).not.toBe(search());
      expect(windowTitle()).toBeTruthy();
      press('d');
      fireEvent.click(screen.getByText('Capo…'));
      expect(document.querySelector('[data-capo-line]')).toBeTruthy();
      press('Escape'); // 2: the Capo… line
      expect(document.querySelector('[data-capo-line]')).toBeNull();
      expect(document.querySelector('[data-key-picker] [aria-current="true"]')?.getAttribute('data-key')).toBe('D');
      press('Escape'); // 3: the typed highlight
      expect(document.querySelector('[data-key-picker] [aria-current="true"]')).toBeNull();
      expect(windowTitle()).toBeTruthy();
      press('Escape'); // 4: the window
      expect(windowTitle()).toBeNull();
      expect(keyHandlerRef.current?.isModalOpen()).toBe(false);
      expect(setOutput).not.toHaveBeenCalled();
      expect(goLive).not.toHaveBeenCalled();
      expect(take).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });

  it('Enter never reaches Go live, and digits and the side arrows do nothing behind the window', async () => {
    const keyHandlerRef: ModeKeyHandlerRef = { current: null };
    const { goLive, take, cue, setMusicKey } = installFake([song('w', 'With Verses', {
      sections: [{ label: 'Verse 1', lines: ['one'] }, { label: 'Verse 2', lines: ['two'] }, { label: 'Verse 3', lines: ['three'] }]
    })]);
    const off = renderPage(keyHandlerRef);
    try {
      await settleAndClear(cue, 'song:w:0', expect.anything());
      await openWindow();
      press('Enter'); // in the search field: leaves it
      press('Enter'); // nothing highlighted: nothing to save
      for (const key of ['2', '3', 'ArrowRight', 'ArrowLeft']) press(key);
      // Straight to the dispatcher too, as if a press slipped past the window and the picker.
      const onGoLive = vi.spyOn(keyHandlerRef.current!, 'onGoLive');
      dispatchModeKey(new KeyboardEvent('keydown', { key: 'Enter' }), {
        settingsOpen: false, closeSettings: () => {}, handler: keyHandlerRef.current, scope: 'songs', overrides: {}, onAppAction: () => {}
      });
      dispatchModeKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }), {
        settingsOpen: false, closeSettings: () => {}, handler: keyHandlerRef.current, scope: 'songs', overrides: {}, onAppAction: () => {}
      });
      await act(async () => {});
      expect(onGoLive).not.toHaveBeenCalled();
      expect(goLive).not.toHaveBeenCalled();
      expect(take).not.toHaveBeenCalled();
      expect(cue).not.toHaveBeenCalled();
      expect(setMusicKey).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });
});

describe('Song keys window — empty states and the progress line', () => {
  const renderWindow = (): void => {
    render(
      <ThemeCtx.Provider value={theme}>
        <SongKeysWindow onClose={() => {}} onKeySaved={() => {}} />
      </ThemeCtx.Provider>
    );
  };

  it('a finished No key tab invites a check on Sung lately', async () => {
    installFake([C]);
    renderWindow();
    expect(await screen.findByText(/Every song has a key\. Check the ones you sing on/)).toBeTruthy();
    expect(screen.getByText('Sung lately', { selector: 'b' })).toBeTruthy();
  });

  it('an empty library points at + Import a song library, with no progress line', async () => {
    installFake([]);
    renderWindow();
    expect(await screen.findByText(/No songs yet\. Bring them in with/)).toBeTruthy();
    expect(screen.getByText('+ Import a song library', { selector: 'b' })).toBeTruthy();
    expect(progress()).toBe('');
  });

  it('a search with no match says so', async () => {
    installFake([A]);
    renderWindow();
    await waitFor(() => expect(listTitles()).toEqual(['Amazing Grace']));
    fireEvent.change(search(), { target: { value: 'zzz' } });
    expect(await screen.findByText('No match for “zzz”. Try another word.')).toBeTruthy();
  });

  it('before any song has gone live, the progress line says where to start', async () => {
    installFake([song('n', 'Never Live')]);
    renderWindow();
    await waitFor(() =>
      expect(progress()).toBe("Helm hasn't seen a song go live yet. Search for this Sunday's songs, or start at the top.")
    );
  });

  it('progressLine wording', () => {
    const c = { total: 10, noKey: 4, lately: 14, latelyWithKey: 9, anyLive: true };
    expect(progressLine(c)).toBe('Sung lately: 9 of 14 have a key.');
    expect(progressLine({ ...c, lately: 1, latelyWithKey: 0 })).toBe('Sung lately: 0 of 1 has a key.');
    expect(progressLine({ ...c, lately: 0, latelyWithKey: 0 })).toBe('No song has gone live in the last eight weeks.');
    expect(progressLine(null)).toBe('');
  });
});
