import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openTestDb } from './testDb';
import { createSongsRepo, type SongsRepo } from './songsRepo';
import { createSongImport, type SongImport } from './songImport';
import type { ImportSource } from './importSources/types';
import type { ScanOutcome, SongImportProgress } from '../shared/types';

const AMAZING = 'Verse 1\nAmazing grace! how sweet the sound\n\nChorus\nPraise God';
const BLESSED = 'Verse 1\nBlessed assurance, Jesus is mine';

function fakeSource(outcome: ScanOutcome, id = 'fake'): ImportSource {
  return {
    id,
    label: 'Fake',
    locate: () => Promise.resolve({ path: '/somewhere' }),
    scan: () => Promise.resolve(outcome)
  };
}

const outcome = (songs: ScanOutcome['songs'], unreadable: ScanOutcome['unreadable'] = []): ScanOutcome => ({
  songs,
  unreadable
});

let repo: SongsRepo;
beforeEach(() => {
  repo = createSongsRepo(openTestDb());
});

const build = (source: ImportSource, onProgress?: (p: SongImportProgress) => void): SongImport =>
  createSongImport(repo, [source], onProgress ? { onProgress } : {});

describe('songImport', () => {
  it('lists the registered sources', () => {
    expect(build(fakeSource(outcome([]))).sources()).toEqual([{ id: 'fake', label: 'Fake' }]);
  });

  it('rejects an unknown source id', async () => {
    expect(await build(fakeSource(outcome([]))).scan('nope')).toEqual({ error: 'unknown-source' });
  });

  it('passes a locate failure straight through, without scanning', async () => {
    const scan = vi.fn();
    const failing: ImportSource = {
      id: 'fake',
      label: 'Fake',
      locate: () => Promise.resolve({ error: 'no-source-files', expected: 'X' }),
      scan
    };
    expect(await build(failing).scan('fake')).toEqual({ error: 'no-source-files', expected: 'X' });
    expect(scan).not.toHaveBeenCalled();
  });

  it('reports every scanned song as new, with its stanza count', async () => {
    const result = await build(fakeSource(outcome([{ title: 'Amazing Grace', author: 'Newton', text: AMAZING }]))).scan('fake');
    expect('rows' in result && result.rows).toEqual([
      { title: 'Amazing Grace', author: 'Newton', stanzas: 2, status: 'new' }
    ]);
  });

  it('marks a song already in the library as a duplicate', async () => {
    repo.add({ title: 'Amazing Grace', author: 'Newton', text: AMAZING });
    const imp = build(fakeSource(outcome([{ title: 'Amazing Grace', author: 'Newton', text: AMAZING }])));
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    expect(result.rows[0].status).toBe('duplicate');
    expect(imp.commit(result.token)).toEqual({ imported: 0, skipped: 1, unreadable: [] });
    expect(repo.count()).toBe(1);
  });

  it('imports two arrangements that share a title', async () => {
    repo.add({ title: 'Amazing Grace', author: 'Newton', text: AMAZING });
    const imp = build(fakeSource(outcome([{ title: 'Amazing Grace', author: 'Other', text: BLESSED }])));
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    expect(result.rows[0].status).toBe('new');
    expect(imp.commit(result.token).imported).toBe(1);
    expect(repo.count()).toBe(2);
  });

  it('collapses duplicates inside the source library itself', async () => {
    const imp = build(
      fakeSource(
        outcome([
          { title: 'Amazing Grace', author: 'Newton', text: AMAZING },
          { title: 'Amazing Grace', author: 'Newton', text: AMAZING }
        ])
      )
    );
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    expect(result.rows.map((r) => r.status)).toEqual(['new', 'duplicate']);
    expect(imp.commit(result.token)).toEqual({ imported: 1, skipped: 1, unreadable: [] });
  });

  it('carries unreadable songs into the review rows and never imports them', async () => {
    const imp = build(
      fakeSource(outcome([], [{ title: 'Empty Song', reason: 'no lyrics found' }]))
    );
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    expect(result.rows).toEqual([
      { title: 'Empty Song', author: '', stanzas: 0, status: 'unreadable', reason: 'no lyrics found' }
    ]);
    expect(imp.commit(result.token)).toEqual({
      imported: 0,
      skipped: 0,
      unreadable: [{ title: 'Empty Song', reason: 'no lyrics found' }]
    });
    expect(repo.count()).toBe(0);
  });

  it('records the source id on imported songs', async () => {
    const imp = build(fakeSource(outcome([{ title: 'Amazing Grace', author: 'Newton', text: AMAZING }])));
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    imp.commit(result.token);
    expect(repo.list()[0].source).toBe('fake');
  });

  it('emits progress for each song committed', async () => {
    const seen: SongImportProgress[] = [];
    const imp = build(
      fakeSource(
        outcome([
          { title: 'A', author: '', text: 'one' },
          { title: 'B', author: '', text: 'two' }
        ])
      ),
      (p) => seen.push(p)
    );
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    imp.commit(result.token);
    expect(seen).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 }
    ]);
  });

  it('keeps importing when one song fails to commit', async () => {
    const imp = build(
      fakeSource(
        outcome([
          { title: 'Good', author: '', text: 'a real line' },
          { title: 'Bad', author: '', text: '' }, // repo.add throws "Song has no content"
          { title: 'Also good', author: '', text: 'another line' }
        ])
      )
    );
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    expect(imp.commit(result.token)).toEqual({
      imported: 2,
      skipped: 0,
      unreadable: [{ title: 'Bad', reason: 'Song has no content' }]
    });
    expect(repo.count()).toBe(2);
  });

  it('throws on an unknown or already-spent token', async () => {
    const imp = build(fakeSource(outcome([{ title: 'A', author: '', text: 'x' }])));
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    imp.commit(result.token);
    expect(() => imp.commit(result.token)).toThrow(/token/);
    expect(() => imp.commit('never-issued')).toThrow(/token/);
  });

  it('is idempotent across two full runs', async () => {
    const source = fakeSource(outcome([{ title: 'Amazing Grace', author: 'Newton', text: AMAZING }]));
    const imp = build(source);
    const first = await imp.scan('fake');
    if (!('rows' in first)) throw new Error('expected rows');
    imp.commit(first.token);
    const second = await imp.scan('fake');
    if (!('rows' in second)) throw new Error('expected rows');
    expect(imp.commit(second.token)).toEqual({ imported: 0, skipped: 1, unreadable: [] });
    expect(repo.count()).toBe(1);
  });

  it('discards an earlier scan\'s token when a new scan starts', async () => {
    const imp = build(fakeSource(outcome([{ title: 'A', author: '', text: 'x' }])));
    const first = await imp.scan('fake');
    if (!('rows' in first)) throw new Error('expected rows');
    const second = await imp.scan('fake');
    if (!('rows' in second)) throw new Error('expected rows');
    expect(() => imp.commit(first.token)).toThrow(/token/);
    expect(imp.commit(second.token)).toEqual({ imported: 1, skipped: 0, unreadable: [] });
  });

  it('carries a source slide-count disagreement onto the review row', async () => {
    const result = await build(
      fakeSource(
        outcome([
          { title: 'Flagged', author: '', text: AMAZING, sourceStanzas: 3 },
          { title: 'Clean', author: '', text: BLESSED }
        ])
      )
    ).scan('fake');
    if (!('rows' in result)) throw new Error('expected a scan result');
    expect(result.rows.find((r) => r.title === 'Flagged')?.sourceStanzas).toBe(3);
    expect(result.rows.find((r) => r.title === 'Clean')?.sourceStanzas).toBeUndefined();
  });

  it('imports a flagged song rather than skipping it', async () => {
    const imp = build(
      fakeSource(outcome([{ title: 'Flagged', author: '', text: AMAZING, sourceStanzas: 3 }]))
    );
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected a scan result');
    expect(result.rows[0].status).toBe('new');
    expect(imp.commit(result.token).imported).toBe(1);
  });

  it('passes the source layout count through to the scan result', async () => {
    const withLayouts = { ...outcome([{ title: 'A', author: '', text: AMAZING }]), withLayouts: 7 };
    const result = await build(fakeSource(withLayouts)).scan('fake');
    expect('withLayouts' in result && result.withLayouts).toBe(7);
  });
});
