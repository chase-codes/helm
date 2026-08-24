import { randomUUID } from 'crypto';
import type { SongsRepo } from './songsRepo';
import type { ImportSource } from './importSources/types';
import { scannedImportKey, songImportKey } from '../shared/songs/importKey';
import { splitToSlides } from '../shared/songs/splitToSlides';
import type {
  ImportReviewRow,
  ImportSourceInfo,
  ScannedSong,
  SongImportProgress,
  SongImportResult,
  SongImportScanResult
} from '../shared/types';

export interface SongImportDeps {
  onProgress?: (p: SongImportProgress) => void;
  /** Songs per transaction / per event-loop turn (tests shrink it). */
  chunkSize?: number;
}

/** Default commit chunk: one fsync and one event-loop yield per this many songs. Large
 * enough that a 3000-song library is ~30 transactions, small enough that the main
 * process answers a Go live / blank IPC within a few ms of it arriving. */
export const COMMIT_CHUNK = 100;

export interface SongImport {
  sources(): ImportSourceInfo[];
  scan(sourceId: string): Promise<SongImportScanResult>;
  commit(token: string): Promise<SongImportResult>;
}

interface Pending {
  sourceId: string;
  songs: ScannedSong[]; // only the rows classified 'new'
  skipped: number;      // duplicates
  unreadable: { title: string; reason: string }[]; // could not be read from the source
}

// Source-agnostic: everything here operates on ScannedSong and never learns where the songs
// came from. Adding a source means implementing ImportSource, not touching this file.
export function createSongImport(
  repo: SongsRepo,
  sources: ImportSource[],
  deps: SongImportDeps = {}
): SongImport {
  const emit = deps.onProgress ?? ((): void => {});
  const chunkSize = Math.max(1, deps.chunkSize ?? COMMIT_CHUNK);
  const pending = new Map<string, Pending>();

  return {
    sources: () => sources.map((s) => ({ id: s.id, label: s.label })),

    async scan(sourceId) {
      const source = sources.find((s) => s.id === sourceId);
      if (!source) return { error: 'unknown-source' };

      const located = await source.locate();
      if ('error' in located) return located;

      const outcome = await source.scan(located);

      // Seeded from the library, then grown as we go, so duplicates *within* the source
      // collapse under the same rule.
      const seen = new Set(repo.list().map(songImportKey));

      const rows: ImportReviewRow[] = [];
      const fresh: ScannedSong[] = [];
      let skipped = 0;
      for (const song of outcome.songs) {
        const key = scannedImportKey(song.title, song.text);
        const duplicate = seen.has(key);
        if (duplicate) skipped++;
        else {
          seen.add(key);
          fresh.push(song);
        }
        rows.push({
          title: song.title,
          author: song.author,
          stanzas: splitToSlides(song.text).length,
          status: duplicate ? 'duplicate' : 'new',
          ...(song.sourceStanzas === undefined ? {} : { sourceStanzas: song.sourceStanzas }),
          ...(song.parsedStanzas === undefined ? {} : { parsedStanzas: song.parsedStanzas })
        });
      }
      for (const u of outcome.unreadable) {
        rows.push({ title: u.title, author: '', stanzas: 0, status: 'unreadable', reason: u.reason });
      }

      // At most one outstanding scan at a time: a fresh scan's dedupe classification can
      // already be stale for an older, still-pending token, so that token must stop being
      // committable rather than silently importing against an out-of-date picture.
      pending.clear();

      const token = randomUUID();
      pending.set(token, {
        sourceId,
        songs: fresh,
        skipped,
        unreadable: outcome.unreadable.map((u) => ({ title: u.title, reason: u.reason }))
      });
      return { token, rows, ...(outcome.withLayouts === undefined ? {} : { withLayouts: outcome.withLayouts }) };
    },

    async commit(token) {
      const job = pending.get(token);
      if (!job) throw new Error(`songImport.commit: unknown or already-spent token "${token}"`);
      pending.delete(token);

      let imported = 0;
      const unreadable = [...job.unreadable];
      const total = job.songs.length;
      // Chunked, not one big loop (#23): a few thousand per-song transactions run back to
      // back held the main process's only thread for the whole import, so every
      // presentation IPC (Go live, blank, video) queued behind it. Each chunk is one
      // transaction (one fsync instead of `chunkSize`), and between chunks the loop
      // yields a macrotask so queued IPC — and the progress events — get serviced.
      //
      // NOT one transaction for the whole run: one bad song must never abort a library
      // migration. `addBatch` keeps per-song isolation with a SAVEPOINT each.
      for (let start = 0; start < total; start += chunkSize) {
        const chunk = job.songs.slice(start, start + chunkSize);
        // repo owns splitToSlides, the insert transaction and the FTS index; going around
        // it yields songs that exist but can never be found by search.
        const results = repo.addBatch(
          chunk.map((song) => ({ title: song.title, author: song.author, text: song.text, source: job.sourceId }))
        );
        results.forEach((r, j) => {
          if ('song' in r) imported++;
          // The operator still needs to know which song and why, not just a count.
          else unreadable.push({ title: chunk[j].title, reason: r.error });
          emit({ done: start + j + 1, total });
        });
        if (start + chunkSize < total) await new Promise<void>((r) => setImmediate(r));
      }
      return { imported, skipped: job.skipped, unreadable };
    }
  };
}
