import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Located, LocateResult, ScanOutcome, ScannedSong, UnreadableSong } from '../../shared/types';
import { rtfToParagraphs } from '../../shared/songs/rtfToText';
import { ewSlideBreaks } from '../../shared/songs/ewSlideBreaks';
import { importTidy } from '../../shared/songs/importTidy';
import { decodeCp1252 } from '../../shared/songs/cp1252';
import type { ImportSource, SourceDb } from './types';

const SONGS_DB = 'Songs.db';
const WORDS_DB = 'SongWords.db';

// SQLite's WAL and rollback-journal sidecars, in the order they're most likely to exist.
// EasyWorship holds Songs.db/SongWords.db open, and if either is in WAL mode, recent writes
// live only in the `-wal` file — a copy of the .db alone would silently miss them. A
// rollback-journal-mode `-journal` is copied for the same reason (a mid-transaction hot
// journal). Their absence is the common case and must not be an error.
const SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'];

// A template literal cannot end in a single unescaped backslash right before the closing
// backtick (the lexer reads `\`` as an escaped backtick and never finds the terminator), so
// the trailing separator is expressed as an escaped string literal instead of String.raw.
export const EW_DEFAULT_PATH =
  'C:\\Users\\Public\\Documents\\Softouch\\EasyWorship\\Default\\Databases\\Data\\';

interface SongRow {
  rowid: number;
  title: string | null;
  author: string | null;
  presentation_id?: number | null;
}
interface WordRow { song_id: number; words: string | Uint8Array | null; slide_uids?: string | null }

export interface EasyWorshipDeps {
  openDb: (path: string) => SourceDb;
  pickFolder: () => Promise<string | null>;
  mkdtemp: () => string;
  rmTemp: (dir: string) => void;
  exists: (path: string) => boolean;
  copy: (src: string, dest: string) => void;
  /** Parent for the folder-picker dialog, so it's modal to the operator window instead of
   *  able to surface behind it (which reads as a hang). Mirrors mediaImport's seam. */
  getParentWindow?: () => Electron.BrowserWindow | null;
}

// A BLOB-affinity column comes back as a Buffer (better-sqlite3) or Uint8Array (node:sqlite),
// never a JS string — decode it rather than dropping the row. RTF is frequently stored as a
// blob, and the PHP reference tool this schema was derived from used PDO, which coerces
// everything to string, so it could never have surfaced a blob column.
//
// The bytes are an \ansi RTF stream, which EasyWorship writes as Windows-1252 — the same
// encoding rtfToText's `\'xx` escape path already assumes (see cp1252.ts). Decoding as UTF-8
// instead would turn any literal high byte (a curly apostrophe, an accented letter — both
// legal directly in an \ansi stream, not just via \'xx) into a U+FFFD replacement character.
function wordsToText(words: string | Uint8Array | null): string | undefined {
  if (typeof words === 'string') return words;
  if (words instanceof Uint8Array) return decodeCp1252(words);
  return undefined;
}

// better-sqlite3 is required lazily: importing it at module scope would load the native
// binary during `npm test`, where it is compiled for the wrong ABI (see testDb.ts).
function defaultOpenDb(path: string): SourceDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const db = new Database(path, { readonly: true, fileMustExist: true });
  return {
    all: <T,>(sql: string) => db.prepare(sql).all() as T[],
    close: () => db.close()
  };
}

function defaultPickFolder(getParentWindow?: () => Electron.BrowserWindow | null): () => Promise<string | null> {
  return async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dialog } = require('electron') as typeof import('electron');
    const opts = { properties: ['openDirectory'] } as Electron.OpenDialogOptions;
    const parent = getParentWindow?.() ?? null;
    // Without a parent, the dialog isn't modal to the operator window on Windows — the
    // target platform for this migration — and can surface behind it, which reads as a hang.
    const result = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };
}

// Copies `name` plus whichever WAL/SHM/journal sidecars exist beside it, so a copy taken
// while EasyWorship is mid-write is as self-consistent as the live library. Missing sidecars
// (the common case — a library that isn't mid-write, or is in the default rollback-journal
// mode with no journal currently open) are silently skipped, not an error.
function copyWithSidecars(deps: EasyWorshipDeps, srcDir: string, destDir: string, name: string): void {
  deps.copy(join(srcDir, name), join(destDir, name));
  for (const suffix of SIDECAR_SUFFIXES) {
    const sidecar = `${name}${suffix}`;
    if (deps.exists(join(srcDir, sidecar))) {
      deps.copy(join(srcDir, sidecar), join(destDir, sidecar));
    }
  }
}

// EW8 spec §2.4 is emphatic: two libraries both reporting data schema 6.5.1.0 differed in 15
// columns and tables, so a version string never implies a shape. Build every optional column
// into the SELECT at runtime and treat it as nullable when absent.
function columnsOf(db: SourceDb, table: string): Set<string> {
  try {
    return new Set(db.all<{ name: string }>(`PRAGMA table_info('${table}')`).map((c) => c.name));
  } catch {
    return new Set();
  }
}

// `slide_uids` is a comma-separated GUID list, one per slide — the authoritative count, free.
// Anything unparseable yields null, which means "no cross-check for this song", never zero.
function slideUidCount(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const n = value.split(',').filter((s) => s.trim() !== '').length;
  return n > 0 ? n : null;
}

export function createEasyWorshipSource(overrides: Partial<EasyWorshipDeps> = {}): ImportSource {
  const deps: EasyWorshipDeps = {
    openDb: defaultOpenDb,
    pickFolder: defaultPickFolder(overrides.getParentWindow),
    mkdtemp: () => mkdtempSync(join(tmpdir(), 'helm-ew-')),
    rmTemp: (dir) => rmSync(dir, { recursive: true, force: true }),
    exists: existsSync,
    copy: copyFileSync,
    ...overrides
  };

  return {
    id: 'easyworship',
    label: 'EasyWorship',

    async locate(): Promise<LocateResult> {
      const path = await deps.pickFolder();
      if (!path) return { error: 'canceled' };
      const hasBoth = deps.exists(join(path, SONGS_DB)) && deps.exists(join(path, WORDS_DB));
      return hasBoth ? { path } : { error: 'no-source-files', expected: EW_DEFAULT_PATH };
    },

    async scan(located: Located): Promise<ScanOutcome> {
      // EasyWorship holds its files open, so we work on copies and never open the church's
      // live library for writing.
      const temp = deps.mkdtemp();
      try {
        copyWithSidecars(deps, located.path, temp, SONGS_DB);
        copyWithSidecars(deps, located.path, temp, WORDS_DB);

        const songsDb = deps.openDb(join(temp, SONGS_DB));
        let wordsDb: SourceDb | null = null;
        try {
          wordsDb = deps.openDb(join(temp, WORDS_DB));
          // Neither query below may use WHERE, ORDER BY, DISTINCT, or GROUP BY against a TEXT
          // column: EasyWorship declares COLLATE UTF8_U_CI on its text columns (title, author,
          // words) and better-sqlite3 cannot register it, so any comparison or sort touching
          // one of those throws "no such collation sequence" at runtime. Both queries below
          // are plain unfiltered, unordered scans for exactly that reason.
          const songCols = columnsOf(songsDb, 'song');
          const wordCols = columnsOf(wordsDb, 'word');
          const hasUids = wordCols.has('slide_uids');
          const hasLayouts = songCols.has('presentation_id');
          const songSelect = [
            'rowid',
            'title',
            songCols.has('author') ? 'author' : "'' AS author",
            ...(hasLayouts ? ['presentation_id'] : [])
          ];
          const wordSelect = ['song_id', 'words', ...(hasUids ? ['slide_uids'] : [])];

          const rows = songsDb.all<SongRow>(`SELECT ${songSelect.join(', ')} FROM song`);
          // Exactly one `word` row per song: SongWords.db declares
          // `CREATE UNIQUE INDEX word_song_id ON word (song_id)`, and the EW8 library spec
          // verified 1:1 with no orphans in either direction across both real libraries
          // (1,997↔1,997 and 223↔223). No ORDER BY is needed, and appending on a repeat would
          // fuse two songs — so a repeat keeps the first row and discards the rest.
          const words = new Map<number, WordRow>();
          for (const w of wordsDb.all<WordRow>(`SELECT ${wordSelect.join(', ')} FROM word`)) {
            if (!words.has(w.song_id)) words.set(w.song_id, w);
          }

          const songs: ScannedSong[] = [];
          const unreadable: UnreadableSong[] = [];
          for (const row of rows) {
            // 869 of 1,997 titles in one real library carry runs of two or more spaces
            // ('A Child Of The King      (Eb)'). Collapse for display and matching; the
            // EasyWorship library still holds the original if it is ever wanted.
            const title = (row.title ?? '').replace(/\s+/g, ' ').trim() || 'Untitled Song';
            const wordRow = words.get(row.rowid);
            const raw = wordRow === undefined ? undefined : wordsToText(wordRow.words);
            if (raw === undefined) {
              unreadable.push({ title, reason: 'no lyrics found' });
              continue;
            }
            const { slideCount, text: joined } = ewSlideBreaks(rtfToParagraphs(raw));
            const text = importTidy(joined);
            if (!text) {
              unreadable.push({ title, reason: 'no lyrics left after removing formatting' });
              continue;
            }
            // Compare EasyWorship's count against OUR count of the same thing — both include
            // empty slides. Helm's eventual section count is a different, smaller number, and
            // comparing against that would flag hundreds of songs that are perfectly fine.
            const expected = hasUids ? slideUidCount(wordRow?.slide_uids) : null;
            songs.push({
              title,
              author: (row.author ?? '').trim(),
              text,
              ...(expected !== null && expected !== slideCount ? { sourceStanzas: expected } : {})
            });
          }
          songs.sort((a, b) => a.title.localeCompare(b.title));
          // Counted over every row, not just the importable ones, because this is a fact about
          // the source library rather than about this run. Omitted entirely when the column is
          // absent: "unknown" and "none" are different answers, and a zero here would wrongly
          // retire the question of whether to import EasyWorship's exact layouts.
          const withLayouts = hasLayouts
            ? rows.filter((r) => (r.presentation_id ?? 0) > 0).length
            : undefined;
          return { songs, unreadable, ...(withLayouts === undefined ? {} : { withLayouts }) };
        } finally {
          songsDb.close();
          wordsDb?.close();
        }
      } finally {
        deps.rmTemp(temp);
      }
    }
  };
}
