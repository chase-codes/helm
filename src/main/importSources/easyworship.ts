import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
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

// Spelled with a lowercase `w` on disk, though the product is branded "EasyWorship" — it
// matters when a copied folder is read on a case-sensitive filesystem.
export const EW_ROOT = 'C:\\Users\\Public\\Documents\\Softouch\\Easyworship';

// A SHAPE, not a location. The profile may be `Default_1`, the version directory may be
// `v6.1` or `v6.1.2`, and a version directory can hold a full schema with zero songs — so
// this is only ever shown to orient the operator, never probed as if it existed.
export const EW_DEFAULT_PATH = `${EW_ROOT}\\<Profile>\\<Version>\\Databases\\Data\\`;

// Exactly the distance from the EasyWorship root down to Data
// (<root>/<profile>/<version>/Databases/Data), so picking the topmost sensible folder still
// finds every library while a mis-picked home directory cannot become a whole-disk walk.
const MAX_DEPTH = 4;

// None of these ever holds the live library. Archive is the one that matters: it can hold a
// real-looking library that is not the one in use.
const SKIP_DIRS = new Set(['resources', 'datacache', 'archive', 'locks', 'thumbnails', 'posterframes', 'temp']);

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
  listDir: (path: string) => { name: string; isDir: boolean }[];
  readText: (path: string) => string | null;
  /** Which library to import when more than one holds songs. Returns null when the operator
   *  backs out. Injected so the choice is testable without Electron. */
  pickCandidate: (candidates: LibraryCandidate[]) => Promise<LibraryCandidate | null>;
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
    if (existsSync(EW_ROOT)) opts.defaultPath = EW_ROOT;
    const parent = getParentWindow?.() ?? null;
    // Without a parent, the dialog isn't modal to the operator window on Windows — the
    // target platform for this migration — and can surface behind it, which reads as a hang.
    const result = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };
}

function defaultPickCandidate(
  getParentWindow?: () => Electron.BrowserWindow | null
): (candidates: LibraryCandidate[]) => Promise<LibraryCandidate | null> {
  return async (candidates) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dialog } = require('electron') as typeof import('electron');
    const buttons = [...candidates.map((c) => c.label), 'Cancel'];
    const opts: Electron.MessageBoxOptions = {
      type: 'question',
      title: 'Choose a library',
      message: 'More than one EasyWorship library was found.',
      detail: 'Pick the one to import from. They are listed with the largest first.',
      buttons,
      cancelId: buttons.length - 1 // no defaultId: the operator chooses, nothing is preselected
    };
    const parent = getParentWindow?.() ?? null;
    const { response } = parent
      ? await dialog.showMessageBox(parent, opts)
      : await dialog.showMessageBox(opts);
    return response === buttons.length - 1 ? null : candidates[response];
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

export interface LibraryCandidate {
  /** The directory holding Songs.db and SongWords.db. */
  path: string;
  /** On-disk filenames, preserved with their real case so a case-sensitive filesystem can
   *  still open what a case-insensitive match found. */
  songsFile: string;
  wordsFile: string;
  songs: number;
  label: string;
}

function libraryFilesIn(entries: { name: string; isDir: boolean }[]): [string, string] | null {
  const files = entries.filter((e) => !e.isDir);
  const songs = files.find((f) => f.name.toLowerCase() === SONGS_DB.toLowerCase());
  const words = files.find((f) => f.name.toLowerCase() === WORDS_DB.toLowerCase());
  return songs && words ? [songs.name, words.name] : null;
}

function findCandidateDirs(deps: EasyWorshipDeps, dir: string, depth: number): string[] {
  let entries: { name: string; isDir: boolean }[];
  try {
    entries = deps.listDir(dir);
  } catch {
    return []; // unreadable directory (permissions, a vanished mount) is not a failure
  }
  const found = libraryFilesIn(entries) ? [dir] : [];
  if (depth >= MAX_DEPTH) return found;
  for (const entry of entries) {
    if (!entry.isDir || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
    found.push(...findCandidateDirs(deps, join(dir, entry.name), depth + 1));
  }
  return found;
}

// "<profile> (<version>)" pulled off the path, since that is how the operator recognises which
// library is which. Falls back to the full path when the folder is not laid out that way.
function describeCandidate(dataDir: string, songs: number, appVersion: string | null): string {
  const parts = dataDir.split(/[\\/]/).filter(Boolean);
  const dbIdx = parts.findIndex((p) => p.toLowerCase() === 'databases');
  const where = dbIdx >= 2 ? `${parts[dbIdx - 2]} (${parts[dbIdx - 1]})` : dataDir;
  const count = `${songs.toLocaleString()} ${songs === 1 ? 'song' : 'songs'}`;
  return appVersion ? `${where} — ${count} — EasyWorship ${appVersion}` : `${where} — ${count}`;
}

// version.dat is two lines: app version, then data schema version. Shown to help the operator
// tell two libraries apart — never used to infer the schema, which EW8 spec §2.4 proves it
// cannot do (two libraries reporting 6.5.1.0 differed in 15 columns).
function appVersionOf(deps: EasyWorshipDeps, dataDir: string): string | null {
  const raw = deps.readText(join(dataDir, 'version.dat'));
  const first = raw?.split(/\r?\n/)[0]?.trim();
  return first ? first : null;
}

// Counts on a temp copy for the same reason scan does: EasyWorship holds the live files open.
// COUNT(*) compares no text, so it never NEEDS the UTF8_U_CI collation — but without `NOT
// INDEXED`, SQLite's planner may still pick the smallest available index (EasyWorship indexes
// title, per the committed fixture) to satisfy the count, and merely considering that index
// trips "no such collation sequence" on a connection that never registered it. `NOT INDEXED`
// forces a plain table scan so the count never looks at the index at all.
function countCandidate(deps: EasyWorshipDeps, dataDir: string): LibraryCandidate | null {
  const entries = deps.listDir(dataDir);
  const names = libraryFilesIn(entries);
  if (!names) return null;
  const [songsFile, wordsFile] = names;
  const temp = deps.mkdtemp();
  try {
    copyWithSidecars(deps, dataDir, temp, songsFile);
    const db = deps.openDb(join(temp, songsFile));
    try {
      const songs = db.all<{ n: number }>('SELECT COUNT(*) AS n FROM song NOT INDEXED')[0]?.n ?? 0;
      return {
        path: dataDir,
        songsFile,
        wordsFile,
        songs,
        label: describeCandidate(dataDir, songs, appVersionOf(deps, dataDir))
      };
    } finally {
      db.close();
    }
  } catch (err) {
    // Dropped, never fatal to the whole locate — but said out loud, because "this folder was
    // silently not offered" is otherwise indistinguishable from "this folder does not exist".
    console.warn(`easyworship: skipping unreadable library at "${dataDir}"`, err);
    return null;
  } finally {
    deps.rmTemp(temp);
  }
}

export function createEasyWorshipSource(overrides: Partial<EasyWorshipDeps> = {}): ImportSource {
  const deps: EasyWorshipDeps = {
    openDb: defaultOpenDb,
    pickFolder: defaultPickFolder(overrides.getParentWindow),
    mkdtemp: () => mkdtempSync(join(tmpdir(), 'helm-ew-')),
    rmTemp: (dir) => rmSync(dir, { recursive: true, force: true }),
    exists: existsSync,
    copy: copyFileSync,
    listDir: (p) => readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() })),
    readText: (p) => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    },
    pickCandidate: defaultPickCandidate(overrides.getParentWindow),
    ...overrides
  };

  return {
    id: 'easyworship',
    label: 'EasyWorship',

    async locate(): Promise<LocateResult> {
      const picked = await deps.pickFolder();
      if (!picked) return { error: 'canceled' };

      const dirs = findCandidateDirs(deps, picked, 0);
      if (dirs.length === 0) return { error: 'no-source-files', expected: EW_DEFAULT_PATH };

      const candidates = dirs
        .map((d) => countCandidate(deps, d))
        .filter((c): c is LibraryCandidate => c !== null && c.songs > 0);

      // Distinct from 'no-source-files' on purpose. A version directory holding a complete
      // schema and zero songs is a real, observed state (Default_1\v6.1.2 in EW8 spec §1.2),
      // and reporting it as "not found" would send the operator hunting for a folder they
      // already found.
      if (candidates.length === 0) return { error: 'all-candidates-empty', expected: EW_DEFAULT_PATH };
      if (candidates.length === 1) return { path: candidates[0].path };

      // Ranked by song count, never by version string: the higher version directory was the
      // empty one in the real sample.
      candidates.sort((a, b) => b.songs - a.songs);
      const chosen = await deps.pickCandidate(candidates);
      return chosen ? { path: chosen.path } : { error: 'canceled' };
    },

    async scan(located: Located): Promise<ScanOutcome> {
      // EasyWorship holds its files open, so we work on copies and never open the church's
      // live library for writing.
      const temp = deps.mkdtemp();
      try {
        const entries = deps.listDir(located.path);
        const names = libraryFilesIn(entries);
        if (!names) throw new Error(`easyworship.scan: no library at "${located.path}"`);
        const [songsFile, wordsFile] = names;
        copyWithSidecars(deps, located.path, temp, songsFile);
        copyWithSidecars(deps, located.path, temp, wordsFile);

        const songsDb = deps.openDb(join(temp, songsFile));
        let wordsDb: SourceDb | null = null;
        try {
          wordsDb = deps.openDb(join(temp, wordsFile));
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
