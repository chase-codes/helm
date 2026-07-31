import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createEasyWorshipSource } from './easyworship';
import type { ImportSource, SourceDb } from './types';

const FIXTURE = join(__dirname, '__fixtures__', 'ew');

// A minimal fake SourceDb pair, bypassing real sqlite entirely, for tests that only care
// about how `word` rows are turned into ScannedSong.text (BLOB decoding, row collisions).
const fakeSource = (songRows: unknown[], wordRows: unknown[]): ImportSource =>
  createEasyWorshipSource({
    pickFolder: () => Promise.resolve('/src'),
    mkdtemp: () => '/fake-tmp',
    rmTemp: () => {},
    copy: () => {},
    exists: () => true,
    openDb: (path) => {
      const rows = path.endsWith('SongWords.db') ? wordRows : songRows;
      return { all: <T,>() => rows as T[], close: () => {} };
    }
  });

// Mirrors the production opener's contract using node:sqlite, so the test never loads
// better-sqlite3 (wrong ABI under stock Node — see testDb.ts).
const openTestSourceDb = (path: string): SourceDb => {
  const db = new DatabaseSync(path);
  return {
    all: <T,>(sql: string) => db.prepare(sql).all() as T[],
    close: () => db.close()
  };
};

const source = (path: string): ImportSource =>
  createEasyWorshipSource({
    openDb: openTestSourceDb,
    pickFolder: () => Promise.resolve(path)
  });

describe('easyworship source', () => {
  it('reports the two expected files when the folder does not hold them', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'ew-empty-'));
    const located = await source(empty).locate();
    expect(located).toEqual({
      error: 'no-source-files',
      // A template literal cannot end in a single unescaped backslash right before the
      // closing backtick (the lexer reads `\`` as an escaped backtick and never finds the
      // terminator), so the trailing separator is expressed as an escaped string literal.
      expected: 'C:\\Users\\Public\\Documents\\Softouch\\EasyWorship\\Default\\Databases\\Data\\'
    });
    rmSync(empty, { recursive: true, force: true });
  });

  it('reports cancellation when no folder is chosen', async () => {
    const canceled = createEasyWorshipSource({
      openDb: openTestSourceDb,
      pickFolder: () => Promise.resolve(null)
    });
    expect(await canceled.locate()).toEqual({ error: 'canceled' });
  });

  it('locates a folder holding both databases', async () => {
    expect(await source(FIXTURE).locate()).toEqual({ path: FIXTURE });
  });

  // The reason the fixture declares COLLATE UTF8_U_CI: this fails the moment anyone adds an
  // ORDER BY or WHERE against a text column.
  it('reads songs without tripping the custom collation', async () => {
    const outcome = await source(FIXTURE).scan({ path: FIXTURE });
    expect(outcome.songs.map((s) => s.title)).toEqual(['Amazing Grace', 'Blessed Assurance']);
  });

  it('strips RTF, tidies, and preserves section structure', async () => {
    const outcome = await source(FIXTURE).scan({ path: FIXTURE });
    const amazing = outcome.songs.find((s) => s.title === 'Amazing Grace');
    expect(amazing).toEqual({
      title: 'Amazing Grace',
      author: 'John Newton',
      text: 'Verse 1\nAmazing grace! how sweet the sound\nThat saved a wretch like me\n\nChorus\nPraise God'
    });
  });

  it('decodes unicode and cp1252 escapes in lyrics', async () => {
    const outcome = await source(FIXTURE).scan({ path: FIXTURE });
    const blessed = outcome.songs.find((s) => s.title === 'Blessed Assurance');
    expect(blessed?.text).toContain("It's a foretaste");
    expect(blessed?.text).toContain('caf\u00e9 song');
  });

  it('reports a song whose lyrics vanish after stripping, by name', async () => {
    const outcome = await source(FIXTURE).scan({ path: FIXTURE });
    expect(outcome.unreadable).toContainEqual({
      title: 'Empty Song',
      reason: 'no lyrics left after removing formatting'
    });
  });

  it('reports a song with no lyric row at all, by name', async () => {
    const outcome = await source(FIXTURE).scan({ path: FIXTURE });
    expect(outcome.unreadable).toContainEqual({
      title: 'No Words Song',
      reason: 'no lyrics found'
    });
  });

  it('never opens the source files themselves, and removes its copies', async () => {
    const opened: string[] = [];
    const temps: string[] = [];
    const s = createEasyWorshipSource({
      openDb: (p) => {
        opened.push(p);
        return openTestSourceDb(p);
      },
      pickFolder: () => Promise.resolve(FIXTURE),
      mkdtemp: () => {
        const d = mkdtempSync(join(tmpdir(), 'ew-scan-'));
        temps.push(d);
        return d;
      }
    });
    await s.scan({ path: FIXTURE });
    // .every() on an empty array is vacuously true, so pair each with a length assertion —
    // otherwise a regression that opened nothing (or made no temp dir) would still pass.
    expect(opened).toHaveLength(2);
    expect(opened.every((p) => !p.startsWith(FIXTURE))).toBe(true);
    expect(temps).toHaveLength(1);
    expect(temps.every((d) => !existsSync(d))).toBe(true);
  });

  it('removes its copies even when opening the copy fails', async () => {
    const temps: string[] = [];
    const s = createEasyWorshipSource({
      openDb: () => {
        throw new Error('boom');
      },
      pickFolder: () => Promise.resolve(FIXTURE),
      mkdtemp: () => {
        const d = mkdtempSync(join(tmpdir(), 'ew-fail-'));
        temps.push(d);
        return d;
      }
    });
    await expect(s.scan({ path: FIXTURE })).rejects.toThrow('boom');
    expect(temps).toHaveLength(1);
    expect(temps.every((d) => !existsSync(d))).toBe(true);
  });

  // IMPORTANT: both better-sqlite3 and node:sqlite return a Buffer/Uint8Array (not a JS
  // string) for a BLOB-affinity column. RTF is frequently stored as a blob, so a naive
  // `typeof w.words === 'string'` check would drop every row and land the whole library in
  // `unreadable`.
  it('imports lyrics whose words column comes back as a BLOB (Buffer/Uint8Array)', async () => {
    const rtf = String.raw`{\rtf1\ansi Verse 1\par Amazing grace\par}`;
    const s = fakeSource(
      [{ rowid: 1, title: 'Blob Song', author: 'A. Author' }],
      [{ song_id: 1, words: Buffer.from(rtf, 'utf8') }]
    );
    const outcome = await s.scan({ path: '/src' });
    expect(outcome.unreadable).toEqual([]);
    expect(outcome.songs).toEqual([{ title: 'Blob Song', author: 'A. Author', text: 'Verse 1\nAmazing grace' }]);
  });

  // IMPORTANT: Map.set on collision silently keeps only the last `word` row for a song_id.
  // If the real schema stores one row per slide/verse (unverified in the spec), every song
  // would import carrying only its final stanza — and the bug is invisible in review since
  // the song still looks normal, just short.
  it('appends rather than overwrites when a song has more than one word row', async () => {
    // Word rows are raw RTF (as SongWords.db actually stores them), not plain text — a
    // literal "\n" in that raw string is source-file wrapping that rtfToText discards, so
    // the fixture (and the fix's join separator) both use RTF paragraph marks.
    const s = fakeSource(
      [{ rowid: 1, title: 'Two Stanza Song', author: '' }],
      [
        { song_id: 1, words: String.raw`Verse 1\par First stanza\par` },
        { song_id: 1, words: String.raw`Verse 2\par Second stanza\par` }
      ]
    );
    const outcome = await s.scan({ path: '/src' });
    expect(outcome.songs).toEqual([
      { title: 'Two Stanza Song', author: '', text: 'Verse 1\nFirst stanza\n\nVerse 2\nSecond stanza' }
    ]);
  });
});
