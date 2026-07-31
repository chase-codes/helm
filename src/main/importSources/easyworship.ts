import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Located, LocateResult, ScanOutcome, ScannedSong, UnreadableSong } from '../../shared/types';
import { rtfToText } from '../../shared/songs/rtfToText';
import { importTidy } from '../../shared/songs/importTidy';
import type { ImportSource, SourceDb } from './types';

const SONGS_DB = 'Songs.db';
const WORDS_DB = 'SongWords.db';

// A template literal cannot end in a single unescaped backslash right before the closing
// backtick (the lexer reads `\`` as an escaped backtick and never finds the terminator), so
// the trailing separator is expressed as an escaped string literal instead of String.raw.
export const EW_DEFAULT_PATH =
  'C:\\Users\\Public\\Documents\\Softouch\\EasyWorship\\Default\\Databases\\Data\\';

interface SongRow { rowid: number; title: string | null; author: string | null }
interface WordRow { song_id: number; words: string | Uint8Array | null }

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
// never a JS string — decode it as UTF-8 rather than dropping the row. RTF is frequently
// stored as a blob, and the PHP reference tool this schema was derived from used PDO, which
// coerces everything to string, so it could never have surfaced a blob column.
function wordsToText(words: string | Uint8Array | null): string | undefined {
  if (typeof words === 'string') return words;
  if (words instanceof Uint8Array) return Buffer.from(words).toString('utf8');
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
        deps.copy(join(located.path, SONGS_DB), join(temp, SONGS_DB));
        deps.copy(join(located.path, WORDS_DB), join(temp, WORDS_DB));

        const songsDb = deps.openDb(join(temp, SONGS_DB));
        let wordsDb: SourceDb | null = null;
        try {
          wordsDb = deps.openDb(join(temp, WORDS_DB));
          // No WHERE and no ORDER BY: EasyWorship declares COLLATE UTF8_U_CI on its text
          // columns and better-sqlite3 cannot register it, so any comparison or sort throws
          // "no such collation sequence". Sorting happens in JS below.
          const rows = songsDb.all<SongRow>('SELECT rowid, title, author FROM song');
          const words = new Map<number, string>();
          for (const w of wordsDb.all<WordRow>('SELECT song_id, words FROM word')) {
            const text = wordsToText(w.words);
            if (text === undefined) continue;
            // If the real schema stores one row per slide/verse rather than one per song
            // (unverified in the spec), append rather than overwrite so every stanza
            // survives. The join happens on the still-raw RTF, before rtfToText runs, so
            // a plain "\n\n" would be swallowed as source-file line wrapping (rtfToText
            // discards bare \r/\n); two RTF paragraph marks are what actually survive
            // through to a blank-line slide break in the tidied output. The trailing space
            // after the marks is a required RTF word delimiter, not stray content — without
            // it, a control-word letter scan has no boundary and silently fuses the second
            // \par with the next fragment's first word (e.g. "\par\parVerse" is read as one
            // unrecognized control word, dropping "Verse" entirely).
            const prev = words.get(w.song_id);
            words.set(w.song_id, prev === undefined ? text : `${prev}\\par\\par ${text}`);
          }

          const songs: ScannedSong[] = [];
          const unreadable: UnreadableSong[] = [];
          for (const row of rows) {
            const title = (row.title ?? '').trim() || 'Untitled Song';
            const raw = words.get(row.rowid);
            if (raw === undefined) {
              unreadable.push({ title, reason: 'no lyrics found' });
              continue;
            }
            const text = importTidy(rtfToText(raw));
            if (!text) {
              unreadable.push({ title, reason: 'no lyrics left after removing formatting' });
              continue;
            }
            songs.push({ title, author: (row.author ?? '').trim(), text });
          }
          songs.sort((a, b) => a.title.localeCompare(b.title));
          return { songs, unreadable };
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
