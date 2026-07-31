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
interface WordRow { song_id: number; words: string | null }

export interface EasyWorshipDeps {
  openDb: (path: string) => SourceDb;
  pickFolder: () => Promise<string | null>;
  mkdtemp: () => string;
  rmTemp: (dir: string) => void;
  exists: (path: string) => boolean;
  copy: (src: string, dest: string) => void;
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

async function defaultPickFolder(): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dialog } = require('electron') as typeof import('electron');
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
}

export function createEasyWorshipSource(overrides: Partial<EasyWorshipDeps> = {}): ImportSource {
  const deps: EasyWorshipDeps = {
    openDb: defaultOpenDb,
    pickFolder: defaultPickFolder,
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
            if (typeof w.words === 'string') words.set(w.song_id, w.words);
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
