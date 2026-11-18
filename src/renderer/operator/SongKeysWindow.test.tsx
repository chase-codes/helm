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
import type {
  KeysImportResult, MusicKeyChange, MusicKeyCounts, MusicKeyListQuery, MusicKeyRestore, MusicKeyRow, PresentationState, Song,
  TitleKeyCandidate
} from '../../shared/types';
import { buildKeyImportReview, readKeySheet } from '../../shared/songs/keySheet';
import { extractKeyFromTitle, type MusicKey, type MusicKeySource } from '../../shared/songs/musicKey';

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
type FakeHelm = Record<
  'keyList' | 'keyCounts' | 'setMusicKey' | 'skipMusicKey' | 'restoreMusicKey' | 'get' | 'cue' | 'goLive' | 'take' | 'setOutput'
  | 'titleKeyCandidates' | 'setMusicKeys' | 'restoreMusicKeys' | 'exportKeys' | 'importKeys',
  Mock
> & { db: Map<string, FakeSong> };
/** An in-memory stand-in for main's song keys calls, with the repo's tab rules. */
function installFake(seed: FakeSong[], state: PresentationState = NOTHING_LIVE): FakeHelm {
  const db = new Map(seed.map((s) => [s.id, { ...s }]));
  const out = (s: FakeSong): Song => {
    const { liveDays: _d, lastLiveAt: _l, skippedAt: _s, ...rest } = s;
    void _d; void _l; void _s;
    return { ...rest };
  };
  const toRow = (s: FakeSong): MusicKeyRow => ({
    id: s.id, title: s.title, author: s.author, firstLine: s.sections[0]?.lines[0] ?? '', ccli: s.ccli ?? '',
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
  // The repo's sweep rules, in short: a key or a flag in the title, has-key for another key.
  const titleKeyCandidates = vi.fn((): Promise<TitleKeyCandidate[]> => {
    const rows: TitleKeyCandidate[] = [];
    for (const s of db.values()) {
      const t = extractKeyFromTitle(s.title);
      const current = s.key ?? '';
      if ((!t.key && !t.flag) || (t.key && current === t.key && t.title === s.title)) continue;
      const flag = t.key && current && current !== t.key ? 'has-key' : t.flag;
      rows.push({
        id: s.id, title: s.title, cleanTitle: t.title, ...(t.key ? { key: t.key } : {}), ...(t.endKey ? { endKey: t.endKey } : {}),
        ...(flag ? { flag } : {}), currentKey: current, currentSource: current ? (s.keySource ?? '') : '', skippedAt: s.skippedAt ?? null
      });
    }
    return Promise.resolve(rows.sort((a, b) => Number(!a.flag) - Number(!b.flag) || a.title.localeCompare(b.title)));
  });
  const setMusicKeys = vi.fn((batch: MusicKeyChange[]) =>
    Promise.resolve(batch.map((c) => {
      const s = db.get(c.id)!;
      if (c.key) Object.assign(s, { key: c.key, keySource: c.source, skippedAt: null });
      else { delete s.key; delete s.keySource; }
      if (c.title !== undefined) s.title = c.title;
      return out(s);
    })));
  const restoreMusicKeys = vi.fn((batch: MusicKeyRestore[]) =>
    Promise.resolve(batch.map((r) => {
      const s = db.get(r.id)!;
      if (r.key) Object.assign(s, { key: r.key, keySource: r.source || undefined });
      else { delete s.key; delete s.keySource; }
      s.skippedAt = r.skippedAt;
      if (r.title !== undefined) s.title = r.title;
      return out(s);
    })));
  const exportKeys = vi.fn(() => Promise.resolve({ canceled: true }));
  // Main's import, over the fake library: a test hands it the file's text with sheetText().
  const importKeys = vi.fn((): Promise<KeysImportResult> => Promise.resolve({ canceled: true }));
  const cue = vi.fn();
  const goLive = vi.fn();
  const take = vi.fn();
  const setOutput = vi.fn();
  (window as unknown as { helm: unknown }).helm = {
    songs: {
      list: () => Promise.resolve([...db.values()].map(out)),
      search: vi.fn(() => Promise.resolve([])),
      get, add: vi.fn(), update: vi.fn(), remove: vi.fn(),
      keyList, keyCounts, setMusicKey, skipMusicKey, restoreMusicKey, titleKeyCandidates, setMusicKeys, restoreMusicKeys,
      exportKeys, importKeys
    },
    presentation: { get: () => Promise.resolve(state), onState: () => () => {}, cue, goLive, take, setOutput },
    songImport: { sources: () => Promise.resolve([]), scan: vi.fn(), commit: vi.fn(), onProgress: () => () => {} }
  };
  return {
    keyList, keyCounts, setMusicKey, skipMusicKey, restoreMusicKey, get, cue, goLive, take, setOutput,
    titleKeyCandidates, setMusicKeys, restoreMusicKeys, exportKeys, importKeys, db
  };
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
  it('opens from the rail row under + Add a song, with the search focused and No key first', async () => {
    const { keyList, keyCounts } = installFake([A, B, C]);
    const off = renderPage();
    try {
      const fill = await screen.findByText('Fill in song keys');
      // Import moved to Settings → Songs (#5), so the row sits right under the add chip.
      expect(fill.previousElementSibling?.textContent).toContain('+ Add a song');
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
      expect(document.querySelector('[data-key-source]')!.textContent).toBe("From the song's title");

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
      await waitFor(() => expect(document.querySelector('[data-key-source]')!.textContent).toBe("From the song's title"));
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

  // Song keys spec, Phase 1d: the library sweep.
  describe('Move keys out of titles', () => {
    const banner = (): Element | null => document.querySelector('[data-title-key-banner]');
    const reviewRows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-title-key-row]')];
    const box = (title: string): HTMLInputElement =>
      reviewRows().find((r) => r.textContent!.startsWith(title))!.querySelector('input')!;
    const KING = song('k', 'A Child Of The King (Eb)');
    const OCEANS = song('o', 'Oceans (D - E)');
    const FEMALE = song('f', 'Song (F)');
    const LIVE_T = song('h', 'Holy Ground (Live)');
    const MAKER = song('m', 'Way Maker (Bb)', { key: 'C', keySource: 'typed', skippedAt: 123 });

    it('shows no banner when no title ends in a key', async () => {
      const { titleKeyCandidates } = installFake([A, LIVE_T]);
      renderWindow();
      await waitFor(() => expect(titleKeyCandidates).toHaveBeenCalled());
      await waitFor(() => expect(listTitles().length).toBeGreaterThan(0));
      await act(async () => {});
      expect(banner()).toBeNull();
      expect(screen.queryByText('Move keys out of titles')).toBeNull();
    });

    it('shows one banner line with a count and an example when some do', async () => {
      installFake([KING, OCEANS, LIVE_T, A]);
      renderWindow();
      await waitFor(() => expect(banner()).toBeTruthy());
      // Counts and shows only titles that move by default; the flagged modulation is left out.
      expect(banner()!.textContent).toBe('1 title ends in a key, like A Child Of The King (Eb).Move keys out of titles');
    });

    it('shows no banner when only flagged titles are left, so a kept "Song (F)" never nags', async () => {
      const { titleKeyCandidates } = installFake([OCEANS, FEMALE, MAKER, A]);
      renderWindow();
      await waitFor(() => expect(titleKeyCandidates).toHaveBeenCalled());
      await waitFor(() => expect(listTitles().length).toBeGreaterThan(0));
      await act(async () => {});
      expect(banner()).toBeNull();
    });

    it('reviews title → key → clean title: flagged rows on top and unchecked, any row can be unchecked', async () => {
      installFake([KING, OCEANS, FEMALE, MAKER, A]);
      renderWindow();
      fireEvent.click(await screen.findByRole('button', { name: 'Move keys out of titles' }));
      await waitFor(() => expect(reviewRows()).toHaveLength(4));
      expect(reviewRows().map((r) => r.querySelector('[data-title-key-note]')!.textContent)).toEqual([
        'Changes key: the title stays', 'One letter: a key, or a version?', 'Already has key C', ''
      ]);
      expect(reviewRows().map((r) => r.querySelector('input')!.checked)).toEqual([false, false, false, true]);
      expect(reviewRows()[3].textContent).toBe('A Child Of The King (Eb)EbA Child Of The King');
      expect(reviewRows()[0].textContent).toContain('D → E');
      expect(screen.getByRole('button', { name: 'Move 1 key' })).toBeTruthy();
      fireEvent.click(box('A Child Of The King (Eb)'));
      expect(box('A Child Of The King (Eb)').checked).toBe(false);
      expect((screen.getByRole('button', { name: 'Move 0 keys' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(box('Song (F)'));
      expect(screen.getByRole('button', { name: 'Move 1 key' })).toBeTruthy();
      // Escape steps back out of the review to the list; the window stays.
      press('Escape');
      expect(document.querySelector('[data-title-key-review]')).toBeNull();
      expect(windowTitle()).toBeTruthy();
      expect(banner()).toBeTruthy();
    });

    it('applies one batch with source title and the clean title, then Undo restores every title, key and source', async () => {
      const onKeySaved = vi.fn();
      const fake = installFake([KING, OCEANS, MAKER]);
      render(
        <ThemeCtx.Provider value={theme}>
          <SongKeysWindow onClose={() => {}} onKeySaved={onKeySaved} />
        </ThemeCtx.Provider>
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Move keys out of titles' }));
      await waitFor(() => expect(reviewRows()).toHaveLength(3));
      fireEvent.click(box('Oceans (D - E)'));
      fireEvent.click(box('Way Maker (Bb)'));
      fireEvent.click(screen.getByRole('button', { name: 'Move 3 keys' }));
      await waitFor(() => expect(fake.setMusicKeys).toHaveBeenCalledTimes(1));
      expect(fake.setMusicKeys).toHaveBeenCalledWith([
        { id: 'o', key: 'D', source: 'title' }, // a modulation keeps its title
        { id: 'm', key: 'Bb', source: 'title', title: 'Way Maker' },
        { id: 'k', key: 'Eb', source: 'title', title: 'A Child Of The King' }
      ]);
      expect(await screen.findByText('Moved 3 keys')).toBeTruthy();
      expect(onKeySaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'k', title: 'A Child Of The King', key: 'Eb' }));
      await waitFor(() => expect(banner()).toBeNull());

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(fake.restoreMusicKeys).toHaveBeenCalledTimes(1));
      expect(fake.restoreMusicKeys).toHaveBeenCalledWith([
        { id: 'o', key: '', source: '', skippedAt: null },
        { id: 'm', key: 'C', source: 'typed', skippedAt: 123, title: 'Way Maker (Bb)' },
        { id: 'k', key: '', source: '', skippedAt: null, title: 'A Child Of The King (Eb)' }
      ]);
      await waitFor(() => expect(onKeySaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'm', title: 'Way Maker (Bb)', key: 'C' })));
      expect(fake.db.get('k')).toMatchObject({ title: 'A Child Of The King (Eb)' });
      expect(fake.db.get('k')!.key).toBeUndefined();
      await waitFor(() => expect(banner()).toBeTruthy());
    });

    it('windows the review: three thousand titles mount a few dozen rows', async () => {
      installFake(Array.from({ length: 3000 }, (_, i) => song(`s${i}`, `Song ${i} (Eb)`)));
      renderWindow();
      fireEvent.click(await screen.findByRole('button', { name: 'Move keys out of titles' }));
      await waitFor(() => expect(reviewRows().length).toBeGreaterThan(0));
      expect(reviewRows().length).toBeLessThan(60);
      expect(screen.getByRole('button', { name: 'Move 3,000 keys' })).toBeTruthy();
    });

    it('keeps the source of a key that is already the title key: only the title changes', async () => {
      const fake = installFake([song('s', 'Cornerstone (Db)', { key: 'Db', keySource: 'typed' })]);
      renderWindow();
      fireEvent.click(await screen.findByRole('button', { name: 'Move keys out of titles' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Move 1 key' }));
      await waitFor(() => expect(fake.setMusicKeys).toHaveBeenCalledWith([{ id: 's', key: 'Db', source: 'typed', title: 'Cornerstone' }]));
    });
  });
});

describe('Song keys window — the spreadsheet round-trip', () => {
  const renderWindow = (onKeySaved: (s: Song) => void = () => {}): void => {
    render(
      <ThemeCtx.Provider value={theme}>
        <SongKeysWindow onClose={() => {}} onKeySaved={onKeySaved} />
      </ThemeCtx.Provider>
    );
  };
  /** What main's import would return for this file over the fake library. */
  const importing = (fake: FakeHelm, text: string, fileName = 'Song keys to fill in.csv'): void => {
    fake.importKeys.mockImplementation(async () => {
      const read = readKeySheet(text);
      if ('error' in read) return read;
      const songs = (await (fake.keyList as (q: MusicKeyListQuery) => Promise<MusicKeyRow[]>)({ tab: 'all' }));
      return { fileName, ...buildKeyImportReview(read.rows, songs) };
    });
  };
  const sheetRows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-sheet-row]')];
  const groupTab = (g: string): HTMLElement => document.querySelector<HTMLElement>(`[data-sheet-group="${g}"]`)!;
  const boxOf = (row: HTMLElement): HTMLInputElement => row.querySelector('input[type="checkbox"]')!;
  const noteOf = (row: HTMLElement): string => row.querySelector('[data-sheet-note]')!.textContent!;

  const WM = song('wm', 'Way Maker', { skippedAt: 5 });
  const OC = song('oc', 'Oceans', { key: 'D', keySource: 'typed' });
  const GG = song('gg', 'Goodness Of God', { key: 'capo 2 G', keySource: 'legacy' });
  const CS1 = song('cs1', 'Cornerstone', { author: 'Edward Mote' });
  const CS2 = song('cs2', 'Cornerstone', { author: 'Reuben Morgan' });
  const IW = song('iw', 'It Is Well');
  const GY = song('gy', 'Great Are You Lord', { key: 'Ab', keySource: 'typed' });
  const HF = song('hf', 'Holy, Holy Forevermore');
  const LIBRARY = [WM, OC, GG, CS1, CS2, IW, GY, HF];
  const FILE = [
    'Title,Author,Key',
    'Way Maker,,Bb',
    'Oceans,,E',
    'Goodness of God,,A',
    'Cornerstone,Hillsong,C',
    'It Is Well With My Soul,,D',
    'Holy Forever,,G',
    'Way Maker,,G or A',
    'Way Maker,,A (capo 2)',
    'Way Maker,,D - E',
    'Way Maker,,Live',
    'Great Are You Lord,,G#',
    'Oceans,,',
    ''
  ].join('\r\n');

  it('shows both buttons; Export saves through main and says where', async () => {
    const fake = installFake([WM, OC]);
    fake.exportKeys.mockResolvedValue({ saved: 2814, fileName: 'Song keys to fill in.csv' });
    renderWindow();
    await screen.findByRole('button', { name: '+ Import keys from a spreadsheet' });
    await waitFor(() => expect(progress()).not.toBe(''));
    fireEvent.click(screen.getByRole('button', { name: 'Export songs without a key…' }));
    await waitFor(() => expect(progress()).toBe('Saved 2,814 songs to Song keys to fill in.csv'));
    expect(fake.exportKeys).toHaveBeenCalledTimes(1);
  });

  it('Export is off when every song has a key', async () => {
    installFake([OC]);
    renderWindow();
    const btn = await screen.findByRole('button', { name: 'Export songs without a key…' });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
  });

  it('a file Helm cannot use gets its one plain sentence, and no review', async () => {
    const fake = installFake(LIBRARY);
    fake.importKeys.mockResolvedValue({ error: "Helm can't open Excel files. Save it as CSV first (File → Save As → CSV), then import that." });
    renderWindow();
    fireEvent.click(await screen.findByRole('button', { name: '+ Import keys from a spreadsheet' }));
    await waitFor(() => expect(progress()).toBe("Helm can't open Excel files. Save it as CSV first (File → Save As → CSV), then import that."));
    expect(document.querySelector('[data-key-sheet]')).toBeNull();
    importing(fake, 'Song,Notes\nWay Maker,x');
    fireEvent.click(screen.getByRole('button', { name: '+ Import keys from a spreadsheet' }));
    await waitFor(() => expect(progress()).toBe('This file has no Key column. The first row should name the columns, like Title and Key.'));
  });

  it('sorts the rows into the five groups; only Ready starts checked; reasons are plain words', async () => {
    const fake = installFake(LIBRARY);
    importing(fake, FILE);
    renderWindow();
    fireEvent.click(await screen.findByRole('button', { name: '+ Import keys from a spreadsheet' }));
    await waitFor(() => expect(document.querySelector('[data-key-sheet]')).toBeTruthy());
    expect(document.querySelector('[data-key-sheet-line]')!.textContent).toBe(
      'Song keys to fill in.csv · 1 row had no key and 1 already had that key; they were left out.'
    );
    expect([...document.querySelectorAll('[data-sheet-group]')].map((t) => t.textContent)).toEqual([
      'Ready2', 'Pick one2', 'Already has a different key1', 'Not a key4', 'Not found1'
    ]);
    // Ready: checked, matched by title (a legacy value counts as no key).
    expect(sheetRows().map((r) => [r.textContent, boxOf(r).checked])).toEqual([
      ['Way MakerBbMatched by title', true],
      ['Goodness of GodAMatched by title', true]
    ]);
    expect(screen.getByRole('button', { name: 'Set 2 keys' })).toBeTruthy();

    fireEvent.click(groupTab('different'));
    const diff = sheetRows()[0];
    expect(diff.querySelector('[data-sheet-key]')!.textContent).toBe('Helm: D · Sheet: E');
    expect(boxOf(diff).checked).toBe(false);
    expect(noteOf(diff)).toBe('Keeps D');

    fireEvent.click(groupTab('not-a-key'));
    expect(sheetRows().map((r) => [r.querySelector('[data-sheet-key]')!.textContent, noteOf(r)])).toEqual([
      ['“G or A”', 'two keys'], ['“A (capo 2)”', 'capo: which is it?'], ['“D - E”', 'a key change'], ['“Live”', 'not a key']
    ]);
    expect(sheetRows().every((r) => boxOf(r).disabled)).toBe(true);
  });

  it('checking a different key switches it; Pick one needs a song chosen, from up to three', async () => {
    const fake = installFake(LIBRARY);
    importing(fake, FILE);
    renderWindow();
    fireEvent.click(await screen.findByRole('button', { name: '+ Import keys from a spreadsheet' }));
    await waitFor(() => expect(document.querySelector('[data-key-sheet]')).toBeTruthy());
    fireEvent.click(groupTab('different'));
    fireEvent.click(boxOf(sheetRows()[0]));
    expect(noteOf(sheetRows()[0])).toBe('Switches to E');
    expect(screen.getByRole('button', { name: 'Set 3 keys' })).toBeTruthy();

    fireEvent.click(groupTab('pick'));
    const [corner, well] = sheetRows();
    expect(boxOf(corner).disabled).toBe(true);
    expect(noteOf(corner)).toBe('Pick the song');
    expect(noteOf(well)).toBe('A close title: pick the song');
    const choices = [...corner.querySelectorAll<HTMLElement>('[data-sheet-choice]')];
    expect(choices.map((c) => c.textContent)).toEqual([
      'CornerstoneEdward MoteNo keyCornerstone line one',
      'CornerstoneReuben MorganNo keyCornerstone line one'
    ]);
    fireEvent.click(choices[1].querySelector('input')!);
    expect(boxOf(sheetRows()[0]).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Set 4 keys' })).toBeTruthy();
    // Unchecking clears the choice.
    fireEvent.click(boxOf(sheetRows()[0]));
    expect(screen.getByRole('button', { name: 'Set 3 keys' })).toBeTruthy();
  });

  it('Not found: a type-ahead over the library matches a row by hand', async () => {
    const fake = installFake(LIBRARY);
    importing(fake, FILE);
    renderWindow();
    fireEvent.click(await screen.findByRole('button', { name: '+ Import keys from a spreadsheet' }));
    await waitFor(() => expect(document.querySelector('[data-key-sheet]')).toBeTruthy());
    fireEvent.click(groupTab('not-found'));
    const row = sheetRows()[0];
    expect(row.textContent).toContain('Type a few words of the title to find it.');
    fireEvent.change(row.querySelector('[data-sheet-find]')!, { target: { value: 'holy for' } });
    await waitFor(() => expect(fake.keyList).toHaveBeenCalledWith({ tab: 'all', q: 'holy for' }));
    const choice = await waitFor(() => {
      const c = sheetRows()[0].querySelector<HTMLElement>('[data-sheet-choice="hf"]');
      expect(c).toBeTruthy();
      return c!;
    });
    fireEvent.click(choice.querySelector('input')!);
    expect(boxOf(sheetRows()[0]).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Set 3 keys' })).toBeTruthy();
  });

  it('applies one batch with source csv, toasts Set N keys, and Undo restores each key, source and skip exactly', async () => {
    const onKeySaved = vi.fn();
    const fake = installFake(LIBRARY);
    importing(fake, FILE);
    renderWindow(onKeySaved);
    fireEvent.click(await screen.findByRole('button', { name: '+ Import keys from a spreadsheet' }));
    await waitFor(() => expect(document.querySelector('[data-key-sheet]')).toBeTruthy());
    fireEvent.click(groupTab('different'));
    fireEvent.click(boxOf(sheetRows()[0]));
    fireEvent.click(screen.getByRole('button', { name: 'Set 3 keys' }));
    await waitFor(() => expect(fake.setMusicKeys).toHaveBeenCalledTimes(1));
    expect(fake.setMusicKeys).toHaveBeenCalledWith([
      { id: 'wm', key: 'Bb', source: 'csv' },
      { id: 'oc', key: 'E', source: 'csv' },
      { id: 'gg', key: 'A', source: 'csv' }
    ]);
    expect(await screen.findByText('Set 3 keys')).toBeTruthy();
    expect(document.querySelector('[data-key-sheet]')).toBeNull();
    expect(onKeySaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'oc', key: 'E', keySource: 'csv' }));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(fake.restoreMusicKeys).toHaveBeenCalledTimes(1));
    expect(fake.restoreMusicKeys).toHaveBeenCalledWith([
      { id: 'wm', key: '', source: '', skippedAt: 5 },
      { id: 'oc', key: 'D', source: 'typed', skippedAt: null },
      { id: 'gg', key: 'capo 2 G', source: 'legacy', skippedAt: null }
    ]);
    await waitFor(() => expect(fake.db.get('oc')).toMatchObject({ key: 'D', keySource: 'typed' }));
    expect(fake.db.get('gg')).toMatchObject({ key: 'capo 2 G', keySource: 'legacy' });
    expect(fake.db.get('wm')).toMatchObject({ skippedAt: 5 });
    expect(fake.db.get('wm')!.key).toBeUndefined();
  });

  it('Escape leaves a search field first, then the review, writing nothing', async () => {
    const fake = installFake(LIBRARY);
    importing(fake, FILE);
    renderWindow();
    fireEvent.click(await screen.findByRole('button', { name: '+ Import keys from a spreadsheet' }));
    await waitFor(() => expect(document.querySelector('[data-key-sheet]')).toBeTruthy());
    fireEvent.click(groupTab('not-found'));
    const find = sheetRows()[0].querySelector<HTMLInputElement>('[data-sheet-find]')!;
    find.focus();
    press('Escape');
    expect(document.activeElement).not.toBe(find);
    expect(document.querySelector('[data-key-sheet]')).toBeTruthy();
    press('Escape');
    expect(document.querySelector('[data-key-sheet]')).toBeNull();
    expect(windowTitle()).toBeTruthy();
    expect(fake.setMusicKeys).not.toHaveBeenCalled();
  });

  it('windows the review: three thousand Ready rows mount a few dozen', async () => {
    const many = Array.from({ length: 3000 }, (_, i) => song(`s${i}`, `Song number ${i}`));
    const fake = installFake(many);
    importing(fake, ['Title,Key', ...many.map((s) => `${s.title},G`)].join('\n'));
    renderWindow();
    fireEvent.click(await screen.findByRole('button', { name: '+ Import keys from a spreadsheet' }));
    await waitFor(() => expect(sheetRows().length).toBeGreaterThan(0));
    expect(sheetRows().length).toBeLessThan(60);
    expect(screen.getByRole('button', { name: 'Set 3,000 keys' })).toBeTruthy();
  });
});
