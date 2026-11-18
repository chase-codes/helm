import { randomUUID } from 'crypto';
import type { SongsRepo } from './songsRepo';
import type { ImportSource } from './importSources/types';
import { scannedImportKey, songImportKeys } from '../shared/songs/importKey';
import { splitToSlides } from '../shared/songs/splitToSlides';
import { extractKeyFromTitle, type MusicKey } from '../shared/songs/musicKey';
import type {
  ImportReviewRow,
  ImportSourceInfo,
  ImportTitleKey,
  ScannedSong,
  Song,
  SongImportCommitOptions,
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
  commit(token: string, opts?: SongImportCommitOptions): Promise<SongImportResult>;
}

/** A song classified 'new', with its title-key `ref` (its index in the scan) and the title it
 * gets if its key moves out. */
interface FreshSong { song: ScannedSong; ref: number; cleanTitle: string }
/** A duplicate of a library song with an empty key or CCLI number: re-import fills blanks. */
interface Fill { ref: number; songId: string; key?: MusicKey; ccli?: string }

interface Pending {
  sourceId: string;
  songs: FreshSong[];   // only the rows classified 'new'
  fills: Fill[];
  /** The title keys offered checked: every unflagged one. Commit uses these unless told. */
  defaultTitleKeys: number[];
  skipped: number;      // duplicates
  unreadable: { title: string; reason: string }[]; // could not be read from the source
}

/** The clean title, once the scanned key moves out, or the title as it is. */
const cleanTitleOf = (song: ScannedSong): { title: string; endKey?: MusicKey } => {
  const t = extractKeyFromTitle(song.title);
  return t.key && t.key === song.musicKey ? { title: t.title, ...(t.endKey ? { endKey: t.endKey } : {}) } : { title: song.title };
};

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
      // collapse under the same rule. A library entry remembers its song, for filling blanks;
      // a scanned one maps to null.
      const seen = new Map<string, Song | null>();
      for (const s of repo.list()) for (const k of songImportKeys(s)) if (!seen.has(k)) seen.set(k, s);

      const rows: ImportReviewRow[] = [];
      const fresh: FreshSong[] = [];
      const fills: Fill[] = [];
      const titleKeys: ImportTitleKey[] = [];
      let skipped = 0;
      outcome.songs.forEach((song, ref) => {
        const key = scannedImportKey(song.title, song.text);
        const duplicate = seen.has(key);
        const clean = cleanTitleOf(song);
        const offer = (status: ImportTitleKey['status']): void => {
          titleKeys.push({
            ref, title: song.title, cleanTitle: clean.title, status,
            ...(song.musicKey ? { key: song.musicKey } : {}),
            ...(clean.endKey ? { endKey: clean.endKey } : {}),
            ...(song.titleKeyNote ? { flag: song.titleKeyNote } : {})
          });
        };
        if (duplicate) {
          skipped++;
          // Re-import fills blanks: only an empty key (a legacy value is a person's to
          // decide) and an empty CCLI number. The key is offered in the review like any
          // other title key; the number needs no look.
          const stored = seen.get(key);
          if (stored) {
            const fillKey = song.musicKey && !stored.key ? song.musicKey : undefined;
            const fillCcli = song.ccli && !stored.ccli ? song.ccli : undefined;
            if (fillKey || fillCcli) {
              fills.push({ ref, songId: stored.id, ...(fillKey ? { key: fillKey } : {}), ...(fillCcli ? { ccli: fillCcli } : {}) });
            }
            if (fillKey) offer('fill');
          }
        } else {
          seen.set(key, null);
          fresh.push({ song, ref, cleanTitle: clean.title });
          if (song.musicKey || song.titleKeyNote) offer('new');
        }
        rows.push({
          title: song.title,
          author: song.author,
          stanzas: splitToSlides(song.text).length,
          status: duplicate ? 'duplicate' : 'new',
          ...(song.sourceStanzas === undefined ? {} : { sourceStanzas: song.sourceStanzas }),
          ...(song.parsedStanzas === undefined ? {} : { parsedStanzas: song.parsedStanzas })
        });
      });
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
        fills,
        defaultTitleKeys: titleKeys.filter((t) => t.key && !t.flag).map((t) => t.ref),
        skipped,
        unreadable: outcome.unreadable.map((u) => ({ title: u.title, reason: u.reason }))
      });
      return {
        token,
        rows,
        ...(titleKeys.length ? { titleKeys } : {}),
        ...(fills.length ? { fillable: new Set(fills.map((f) => f.songId)).size } : {}),
        ...(outcome.withLayouts === undefined ? {} : { withLayouts: outcome.withLayouts })
      };
    },

    async commit(token, opts) {
      const job = pending.get(token);
      if (!job) throw new Error(`songImport.commit: unknown or already-spent token "${token}"`);
      const chosen = opts?.titleKeys;
      if (chosen !== undefined && !(Array.isArray(chosen) && chosen.every((r) => Number.isInteger(r)))) {
        throw new Error('songImport.commit: titleKeys must be a list of refs');
      }
      pending.delete(token);
      const moveKey = new Set(chosen ?? job.defaultTitleKeys);

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
          chunk.map(({ song, ref, cleanTitle }) => {
            // A checked title key moves out: the clean title, and the key with source 'title'.
            const move = !!song.musicKey && moveKey.has(ref);
            return {
              title: move ? cleanTitle : song.title,
              author: song.author,
              text: song.text,
              source: job.sourceId,
              ...(move ? { key: song.musicKey, musicKeySource: 'title' as const } : {}),
              ...(song.ccli ? { ccli: song.ccli } : {})
            };
          })
        );
        results.forEach((r, j) => {
          if ('song' in r) imported++;
          // The operator still needs to know which song and why, not just a count.
          else unreadable.push({ title: chunk[j].song.title, reason: r.error });
          emit({ done: start + j + 1, total });
        });
        if (start + chunkSize < total) await new Promise<void>((r) => setImmediate(r));
      }
      // Blanks last, in one batch: a key only where it was checked, a CCLI number always.
      // fillBlanks re-checks emptiness in the UPDATE, so nothing a person set is replaced.
      const entries = job.fills
        .map((f) => ({ id: f.songId, ...(f.key && moveKey.has(f.ref) ? { key: f.key } : {}), ...(f.ccli ? { ccli: f.ccli } : {}) }))
        .filter((e) => 'key' in e || 'ccli' in e);
      const filled = entries.length ? repo.fillBlanks(entries, 'title') : { keys: 0, ccli: 0 };
      return {
        imported,
        skipped: job.skipped,
        unreadable,
        ...(filled.keys ? { filledKeys: filled.keys } : {}),
        ...(filled.ccli ? { filledCcli: filled.ccli } : {})
      };
    }
  };
}
