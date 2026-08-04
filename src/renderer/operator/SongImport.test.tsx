// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SongImport } from './SongImport';
import { ThemeCtx } from './ThemeCtx';
import { themeFor } from '../../shared/theme';
import type { ImportReviewRow, SongImportScanResult, SongImportResult } from '../../shared/types';

afterEach(cleanup);

const ROWS: ImportReviewRow[] = [
  { title: 'Amazing Grace', author: 'John Newton', stanzas: 2, status: 'new' },
  { title: 'Blessed Assurance', author: 'Fanny Crosby', stanzas: 1, status: 'duplicate' },
  { title: 'Empty Song', author: '', stanzas: 0, status: 'unreadable', reason: 'no lyrics found' }
];

function installHelm(
  scan: SongImportScanResult,
  commit: SongImportResult = { imported: 1, skipped: 1, unreadable: [{ title: 'Empty Song', reason: 'no lyrics found' }] }
): { scan: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn> } {
  const scanFn = vi.fn().mockResolvedValue(scan);
  const commitFn = vi.fn().mockResolvedValue(commit);
  (window as unknown as { helm: unknown }).helm = {
    songImport: {
      sources: () => Promise.resolve([{ id: 'easyworship', label: 'EasyWorship' }]),
      scan: scanFn,
      commit: commitFn,
      onProgress: () => () => {}
    }
  };
  return { scan: scanFn, commit: commitFn };
}

const renderModal = (onImported = vi.fn()): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('dark')}>
      <SongImport open onClose={vi.fn()} onImported={onImported} />
    </ThemeCtx.Provider>
  );

describe('SongImport', () => {
  it('offers the registered sources first', async () => {
    installHelm({ token: 't', rows: ROWS });
    renderModal();
    expect(await screen.findByText('EasyWorship')).toBeTruthy();
  });

  it('shows every scanned song with its status once a source is chosen', async () => {
    installHelm({ token: 't', rows: ROWS });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText('Amazing Grace')).toBeTruthy();
    expect(screen.getByText('Blessed Assurance')).toBeTruthy();
    expect(screen.getByText('Empty Song')).toBeTruthy();
    expect(screen.getByText(/no lyrics found/)).toBeTruthy();
  });

  it('says how many songs will actually be imported', async () => {
    installHelm({ token: 't', rows: ROWS });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText(/Import 1 song/)).toBeTruthy();
  });

  it('surfaces a missing-files error instead of a review list', async () => {
    installHelm({ error: 'no-source-files', expected: 'C:\\somewhere\\Data\\' });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText(/Couldn't find/)).toBeTruthy();
    expect(screen.getByText(/C:\\somewhere\\Data\\/)).toBeTruthy();
  });

  it('returns to the source step silently when the picker is cancelled', async () => {
    installHelm({ error: 'canceled' });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    await waitFor(() => expect(screen.getByText('EasyWorship')).toBeTruthy());
    expect(screen.queryByText(/Couldn't find/)).toBeNull();
  });

  it('commits with the scan token, reports the summary, and names what did not come through', async () => {
    const helm = installHelm({ token: 'tok-1', rows: ROWS });
    const onImported = vi.fn();
    renderModal(onImported);
    fireEvent.click(await screen.findByText('EasyWorship'));
    fireEvent.click(await screen.findByText(/Import 1 song/));
    await waitFor(() => expect(helm.commit).toHaveBeenCalledWith('tok-1'));
    expect(await screen.findByText(/Imported 1 song/)).toBeTruthy();
    // The rendered strings are "1 song already in Helm." and "1 song couldn't be read." —
    // match what is actually on screen, not a paraphrase of it.
    expect(screen.getByText(/1 song already in Helm/)).toBeTruthy();
    expect(screen.getByText(/1 song couldn't be read/)).toBeTruthy();
    // The spec requires the Done step to name what did not come through, not just count it —
    // the failed song's title and its reason must both be on screen.
    expect(screen.getByText('Empty Song')).toBeTruthy();
    expect(screen.getByText('no lyrics found')).toBeTruthy();
    expect(onImported).toHaveBeenCalled();
  });

  it('does not close on overlay click while an import is in flight, but does once done', async () => {
    const helm = installHelm({ token: 't', rows: ROWS });
    let resolveCommit: (r: SongImportResult) => void = () => {};
    helm.commit.mockImplementation(
      () =>
        new Promise<SongImportResult>((resolve) => {
          resolveCommit = resolve;
        })
    );
    const onClose = vi.fn();
    const { container } = render(
      <ThemeCtx.Provider value={themeFor('dark')}>
        <SongImport open onClose={onClose} onImported={vi.fn()} />
      </ThemeCtx.Provider>
    );
    fireEvent.click(await screen.findByText('EasyWorship'));
    fireEvent.click(await screen.findByText(/Import 1 song/));
    await screen.findByText(/Importing…/);

    // The overlay is the outer element; anything rendered inside the modal box already stops
    // propagation before it gets there (see SongImport's `stop` handler), so the click has to
    // land on container.firstChild directly to actually exercise the overlay's own handler.
    fireEvent.click(container.firstChild as Element);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Importing…/)).toBeTruthy();

    resolveCommit({ imported: 1, skipped: 0, unreadable: [] });
    await screen.findByText(/Imported 1 song/);

    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    installHelm({ token: 't', rows: ROWS });
    const { container } = render(
      <ThemeCtx.Provider value={themeFor('dark')}>
        <SongImport open={false} onClose={vi.fn()} onImported={vi.fn()} />
      </ThemeCtx.Provider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('marks a row whose stanza count disagrees with the source, showing the numbers actually compared', async () => {
    installHelm({
      token: 't',
      rows: [
        // stanzas (splitToSlides' count, excludes empty slides) deliberately differs from both
        // parsedStanzas and sourceStanzas here, so the test fails if the badge's text ever
        // regresses to rendering `r.stanzas` instead of the compared pair.
        { title: 'Flagged', author: '', stanzas: 5, status: 'new', sourceStanzas: 3, parsedStanzas: 2 },
        { title: 'Clean', author: '', stanzas: 2, status: 'new' }
      ]
    });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText('CHECK')).toBeTruthy();
    // The two numbers beside CHECK are the ones actually compared (parsedStanzas vs
    // sourceStanzas), and they disagree — never two equal numbers beside a CHECK badge.
    expect(screen.getByText('2 slides · EasyWorship counts 3')).toBeTruthy();
    expect(screen.queryByText(/^5 /)).toBeNull();
    expect(screen.getByText('2 stanzas')).toBeTruthy();
  });

  it('renders NONE for a zero layout count, distinct from saying nothing at all', async () => {
    installHelm({ token: 't', rows: ROWS, withLayouts: 0 });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText(/NONE WITH EASYWORSHIP LAYOUTS/)).toBeTruthy();
  });

  it('explains a candidates-unreadable failure without calling the library empty', async () => {
    installHelm({ error: 'candidates-unreadable', expected: 'C:\\Softouch\\Easyworship\\' });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText(/couldn't be read/)).toBeTruthy();
    expect(screen.queryByText(/holds no songs/)).toBeNull();
  });

  it('reports how many songs carry a layout in the source', async () => {
    installHelm({ token: 't', rows: ROWS, withLayouts: 438 });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText(/438 WITH EASYWORSHIP LAYOUTS/)).toBeTruthy();
  });

  it('says nothing about layouts when the source cannot report them', async () => {
    installHelm({ token: 't', rows: ROWS });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    await screen.findByText('Amazing Grace');
    expect(screen.queryByText(/LAYOUTS/)).toBeNull();
  });

  it('explains an empty library differently from a missing one', async () => {
    installHelm({ error: 'all-candidates-empty', expected: 'C:\\Softouch\\Easyworship\\' });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText(/holds no songs/)).toBeTruthy();
  });

  it('tells the operator a broad pick was too wide to search, distinct from a missing library', async () => {
    installHelm({ error: 'search-too-broad', expected: 'C:\\Softouch\\Easyworship\\' });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText(/too broad to search/)).toBeTruthy();
    expect(screen.queryByText(/holds no songs/)).toBeNull();
  });

  // FIX (SongImport.tsx ~line 226): the detail text was gated on `sourceStanzas !== undefined`
  // but interpolated `parsedStanzas`, so a malformed row carrying one field without the other
  // rendered the literal string "undefined slides · EasyWorship counts N". ImportReviewRow
  // declares the two fields independently optional, so this shape is representable even though
  // the EasyWorship adapter never actually produces it (see easyworship.ts). The CHECK badge
  // stays gated on `sourceStanzas` alone; only the detail text must fall back.
  it('never renders "undefined" when a row carries sourceStanzas without parsedStanzas', async () => {
    installHelm({
      token: 't',
      rows: [{ title: 'Malformed', author: '', stanzas: 4, status: 'new', sourceStanzas: 3 }]
    });
    renderModal();
    fireEvent.click(await screen.findByText('EasyWorship'));
    expect(await screen.findByText('Malformed')).toBeTruthy();
    expect(screen.getByText('CHECK')).toBeTruthy();
    expect(screen.getByText('4 stanzas')).toBeTruthy();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });
});
