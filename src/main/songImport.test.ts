import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openTestDb } from './testDb';
import { createSongsRepo, type SongsRepo } from './songsRepo';
import { createSongImport, type SongImport } from './songImport';
import type { ImportSource } from './importSources/types';
import type { ScanOutcome, Song, SongImportProgress, SongImportScan } from '../shared/types';

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

const build = (source: ImportSource, onProgress?: (p: SongImportProgress) => void, chunkSize?: number): SongImport =>
  createSongImport(repo, [source], { ...(onProgress ? { onProgress } : {}), ...(chunkSize ? { chunkSize } : {}) });

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
    expect(await imp.commit(result.token)).toEqual({ imported: 0, skipped: 1, unreadable: [] });
    expect(repo.count()).toBe(1);
  });

  it('imports two arrangements that share a title', async () => {
    repo.add({ title: 'Amazing Grace', author: 'Newton', text: AMAZING });
    const imp = build(fakeSource(outcome([{ title: 'Amazing Grace', author: 'Other', text: BLESSED }])));
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    expect(result.rows[0].status).toBe('new');
    expect((await imp.commit(result.token)).imported).toBe(1);
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
    expect(await imp.commit(result.token)).toEqual({ imported: 1, skipped: 1, unreadable: [] });
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
    expect(await imp.commit(result.token)).toEqual({
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
    await imp.commit(result.token);
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
    await imp.commit(result.token);
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
    expect(await imp.commit(result.token)).toEqual({
      imported: 2,
      skipped: 0,
      unreadable: [{ title: 'Bad', reason: 'Song has no content' }]
    });
    expect(repo.count()).toBe(2);
  });

  it('a bad song in the middle of a chunk rolls back alone; its neighbours land (#23)', async () => {
    const songs = Array.from({ length: 7 }, (_, i) => ({ title: `S${i}`, author: '', text: i === 3 ? '' : `line ${i}` }));
    const imp = build(fakeSource(outcome(songs)), undefined, 5);
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    const r = await imp.commit(result.token);
    expect(r.imported).toBe(6);
    expect(r.unreadable).toEqual([{ title: 'S3', reason: 'Song has no content' }]);
    expect(repo.count()).toBe(6);
    expect(repo.list().map((s) => s.title).sort()).toEqual(['S0', 'S1', 'S2', 'S4', 'S5', 'S6']);
  });

  it('yields to the event loop between chunks so queued work is serviced mid-import (#23)', async () => {
    const songs = Array.from({ length: 9 }, (_, i) => ({ title: `S${i}`, author: '', text: `line ${i}` }));
    const imp = build(fakeSource(outcome(songs)), undefined, 3);
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    // Something queued behind the import — a Go live IPC, say — must run before the
    // import finishes, and it must see a partially-committed library.
    let countWhenServiced = -1;
    setImmediate(() => { countWhenServiced = repo.count(); });
    await imp.commit(result.token);
    expect(countWhenServiced).toBeGreaterThan(0);
    expect(countWhenServiced).toBeLessThan(9);
    expect(repo.count()).toBe(9);
  });

  it('throws on an unknown or already-spent token', async () => {
    const imp = build(fakeSource(outcome([{ title: 'A', author: '', text: 'x' }])));
    const result = await imp.scan('fake');
    if (!('rows' in result)) throw new Error('expected rows');
    await imp.commit(result.token);
    await expect(imp.commit(result.token)).rejects.toThrow(/token/);
    await expect(imp.commit('never-issued')).rejects.toThrow(/token/);
  });

  it('is idempotent across two full runs', async () => {
    const source = fakeSource(outcome([{ title: 'Amazing Grace', author: 'Newton', text: AMAZING }]));
    const imp = build(source);
    const first = await imp.scan('fake');
    if (!('rows' in first)) throw new Error('expected rows');
    await imp.commit(first.token);
    const second = await imp.scan('fake');
    if (!('rows' in second)) throw new Error('expected rows');
    expect(await imp.commit(second.token)).toEqual({ imported: 0, skipped: 1, unreadable: [] });
    expect(repo.count()).toBe(1);
  });

  it('discards an earlier scan\'s token when a new scan starts', async () => {
    const imp = build(fakeSource(outcome([{ title: 'A', author: '', text: 'x' }])));
    const first = await imp.scan('fake');
    if (!('rows' in first)) throw new Error('expected rows');
    const second = await imp.scan('fake');
    if (!('rows' in second)) throw new Error('expected rows');
    await expect(imp.commit(first.token)).rejects.toThrow(/token/);
    expect(await imp.commit(second.token)).toEqual({ imported: 1, skipped: 0, unreadable: [] });
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
    expect((await imp.commit(result.token)).imported).toBe(1);
  });

  it('passes the source layout count through to the scan result', async () => {
    const withLayouts = { ...outcome([{ title: 'A', author: '', text: AMAZING }]), withLayouts: 7 };
    const result = await build(fakeSource(withLayouts)).scan('fake');
    expect('withLayouts' in result && result.withLayouts).toBe(7);
  });

  // Song keys spec, Phase 1d.
  describe('keys in titles', () => {
    const scanOf = async (imp: SongImport): Promise<SongImportScan> => {
      const r = await imp.scan('fake');
      if (!('rows' in r)) throw new Error('expected rows');
      return r;
    };

    it('offers each title key for review, flagged ones unchecked by default, and moves the checked ones', async () => {
      const imp = build(fakeSource(outcome([
        { title: 'A Child Of The King (Eb)', author: '', text: AMAZING, musicKey: 'Eb', ccli: '22025' },
        { title: 'Oceans (D - E)', author: '', text: BLESSED, musicKey: 'D', titleKeyNote: 'modulation' },
        { title: 'Plain', author: '', text: 'Verse 1\nplain' }
      ])));
      const r = await scanOf(imp);
      expect(r.titleKeys).toEqual([
        { ref: 0, title: 'A Child Of The King (Eb)', cleanTitle: 'A Child Of The King', key: 'Eb', status: 'new' },
        { ref: 1, title: 'Oceans (D - E)', cleanTitle: 'Oceans (D - E)', key: 'D', endKey: 'E', flag: 'modulation', status: 'new' }
      ]);
      await imp.commit(r.token); // no choice sent: the defaults
      const by = (t: string): Song | undefined => repo.list().find((s) => s.title === t);
      expect(by('A Child Of The King')).toMatchObject({ key: 'Eb', keySource: 'title', ccli: '22025' });
      expect(by('Oceans (D - E)')?.key).toBeUndefined();
      expect(by('Plain')?.key).toBeUndefined();
    });

    it('keeps the title and drops the key for an unchecked row, and moves a checked flagged one', async () => {
      const imp = build(fakeSource(outcome([
        { title: 'A Child Of The King (Eb)', author: '', text: AMAZING, musicKey: 'Eb' },
        { title: 'Oceans (D - E)', author: '', text: BLESSED, musicKey: 'D', titleKeyNote: 'modulation' }
      ])));
      const r = await scanOf(imp);
      await imp.commit(r.token, { titleKeys: [1] });
      const titles = repo.list().map((s) => [s.title, s.key, s.keySource]);
      expect(titles).toContainEqual(['A Child Of The King (Eb)', undefined, undefined]);
      // A modulation keeps its title; the start key moves in.
      expect(titles).toContainEqual(['Oceans (D - E)', 'D', 'title']);
    });

    it('rejects a commit whose titleKeys is not a list of refs, and leaves the token usable', async () => {
      const imp = build(fakeSource(outcome([{ title: 'X (Eb)', author: '', text: AMAZING, musicKey: 'Eb' }])));
      const r = await scanOf(imp);
      await expect(imp.commit(r.token, { titleKeys: ['0'] as unknown as number[] })).rejects.toThrow(/refs/);
      expect((await imp.commit(r.token)).imported).toBe(1);
    });

    it('still finds an "X (Eb)" stored before this change, and keeps "X (G)" and "X (Bb)" apart', async () => {
      repo.add({ title: 'A Child Of The King (Eb)', text: AMAZING });
      const imp = build(fakeSource(outcome([
        { title: 'A Child Of The King (Eb)', author: '', text: AMAZING, musicKey: 'Eb' },
        { title: 'Holy Spirit (G)', author: '', text: BLESSED, musicKey: 'G', titleKeyNote: 'single-letter' },
        { title: 'Holy Spirit (Bb)', author: '', text: BLESSED, musicKey: 'Bb' }
      ])));
      const r = await scanOf(imp);
      expect(r.rows.map((x) => x.status)).toEqual(['duplicate', 'new', 'new']);
    });

    it("re-import fills an empty key and CCLI number, never a person's key, and counts them", async () => {
      const empty = repo.add({ title: 'A Child Of The King (Eb)', text: AMAZING });
      const typed = repo.add({ title: 'Way Maker (Bb)', text: BLESSED });
      repo.setMusicKey(typed.id, 'C', 'typed');
      const imp = build(fakeSource(outcome([
        { title: 'A Child Of The King (Eb)', author: '', text: AMAZING, musicKey: 'Eb', ccli: '22025' },
        { title: 'Way Maker (Bb)', author: '', text: BLESSED, musicKey: 'Bb', ccli: '7115744' }
      ])));
      const r = await scanOf(imp);
      expect(r.fillable).toBe(2);
      // Only the empty key is offered; the person's C is not.
      expect(r.titleKeys).toEqual([
        { ref: 0, title: 'A Child Of The King (Eb)', cleanTitle: 'A Child Of The King', key: 'Eb', status: 'fill' }
      ]);
      expect(await imp.commit(r.token)).toEqual({ imported: 0, skipped: 2, unreadable: [], filledKeys: 1, filledCcli: 2 });
      expect(repo.get(empty.id)).toMatchObject({ key: 'Eb', keySource: 'title', ccli: '22025' });
      expect(repo.get(typed.id)).toMatchObject({ key: 'C', keySource: 'typed', ccli: '7115744' });
      expect(repo.count()).toBe(2);
    });

    it('fills a CCLI number but not an unchecked key', async () => {
      const empty = repo.add({ title: 'A Child Of The King (Eb)', text: AMAZING });
      const imp = build(fakeSource(outcome([
        { title: 'A Child Of The King (Eb)', author: '', text: AMAZING, musicKey: 'Eb', ccli: '22025' }
      ])));
      const r = await scanOf(imp);
      expect(await imp.commit(r.token, { titleKeys: [] })).toEqual({ imported: 0, skipped: 1, unreadable: [], filledCcli: 1 });
      expect(repo.get(empty.id)?.key).toBeUndefined();
    });
  });
});
