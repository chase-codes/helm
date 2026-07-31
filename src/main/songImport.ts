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
}

export interface SongImport {
  sources(): ImportSourceInfo[];
  scan(sourceId: string): Promise<SongImportScanResult>;
  commit(token: string): SongImportResult;
}

interface Pending {
  sourceId: string;
  songs: ScannedSong[]; // only the rows classified 'new'
  skipped: number;      // duplicates
  unreadable: number;   // could not be read from the source
}

// Source-agnostic: everything here operates on ScannedSong and never learns where the songs
// came from. Adding a source means implementing ImportSource, not touching this file.
export function createSongImport(
  repo: SongsRepo,
  sources: ImportSource[],
  deps: SongImportDeps = {}
): SongImport {
  const emit = deps.onProgress ?? ((): void => {});
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
          status: duplicate ? 'duplicate' : 'new'
        });
      }
      for (const u of outcome.unreadable) {
        rows.push({ title: u.title, author: '', stanzas: 0, status: 'unreadable', reason: u.reason });
      }

      const token = randomUUID();
      pending.set(token, {
        sourceId,
        songs: fresh,
        skipped,
        unreadable: outcome.unreadable.length
      });
      return { token, rows };
    },

    commit(token) {
      const job = pending.get(token);
      if (!job) throw new Error(`songImport.commit: unknown or already-spent token "${token}"`);
      pending.delete(token);

      let imported = 0;
      let unreadable = job.unreadable;
      const total = job.songs.length;
      for (let i = 0; i < total; i++) {
        const song = job.songs[i];
        try {
          // repo.add owns splitToSlides, the insert transaction and the FTS index; going
          // around it yields songs that exist but can never be found by search.
          repo.add({
            title: song.title,
            author: song.author,
            text: song.text,
            source: job.sourceId
          });
          imported++;
        } catch {
          // One bad song must never abort a library migration.
          unreadable++;
        }
        emit({ done: i + 1, total });
      }
      return { imported, skipped: job.skipped, unreadable };
    }
  };
}
