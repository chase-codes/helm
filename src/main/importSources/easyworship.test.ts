import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { createEasyWorshipSource } from './easyworship';
import type { ImportSource, SourceDb } from './types';

const FIXTURE = join(__dirname, '__fixtures__', 'ew');
const SONGS_DB_NAME = 'Songs.db';
const WORDS_DB_NAME = 'SongWords.db';

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
      [{ rowid: 1, song_id: 1, words: Buffer.from(rtf, 'utf8') }]
    );
    const outcome = await s.scan({ path: '/src' });
    expect(outcome.unreadable).toEqual([]);
    expect(outcome.songs).toEqual([{ title: 'Blob Song', author: 'A. Author', text: 'Verse 1\nAmazing grace' }]);
  });

  // IMPORTANT: the BLOB bytes are an \ansi RTF stream, which EasyWorship writes as
  // Windows-1252, not UTF-8. A literal high byte is legal directly in an \ansi stream (not
  // just via a \'xx escape), and decoding it as UTF-8 turns it into a lone invalid byte
  // sequence — U+FFFD — which reaches the projector as a replacement-character glyph instead
  // of the punctuation/letter the church actually typed.
  it('decodes literal high bytes in a BLOB as cp1252, not UTF-8', async () => {
    const rtf = Buffer.concat([
      Buffer.from(String.raw`{\rtf1\ansi It`, 'ascii'),
      Buffer.from([0x92]), // cp1252 curly apostrophe (U+2019)
      Buffer.from('s caf', 'ascii'),
      Buffer.from([0xe9]), // cp1252 e-acute (U+00E9)
      Buffer.from(String.raw` song\par}`, 'ascii')
    ]);
    const s = fakeSource(
      [{ rowid: 1, title: 'CP1252 Song', author: '' }],
      [{ rowid: 1, song_id: 1, words: rtf }]
    );
    const outcome = await s.scan({ path: '/src' });
    // importTidy normalises the curly apostrophe to a straight one (see importTidy.ts) — the
    // point being proven here is the café/é byte, which only survives at all when 0xE9 is
    // decoded as cp1252 rather than turned into a UTF-8 replacement character.
    expect(outcome.songs).toEqual([{ title: 'CP1252 Song', author: '', text: "It's café song" }]);
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
        { rowid: 1, song_id: 1, words: String.raw`Verse 1\par First stanza\par` },
        { rowid: 2, song_id: 1, words: String.raw`Verse 2\par Second stanza\par` }
      ]
    );
    const outcome = await s.scan({ path: '/src' });
    expect(outcome.songs).toEqual([
      { title: 'Two Stanza Song', author: '', text: 'Verse 1\nFirst stanza\n\nVerse 2\nSecond stanza' }
    ]);
  });

  // IMPORTANT: a bare scan (no ORDER BY) gives SQLite no ordering guarantee, and the loop
  // above concatenates whatever order `wordsDb.all()` hands back — so if the rows arrive in
  // anything other than rowid order, a song's stanzas would silently shuffle. Feeding rows in
  // reverse-of-rowid order here proves assembly is keyed on rowid, not on whatever order they
  // happened to arrive in.
  it('assembles multi-row stanzas in rowid order, even when rows arrive in a different order', async () => {
    const s = fakeSource(
      [{ rowid: 1, title: 'Reordered Song', author: '' }],
      [
        { rowid: 20, song_id: 1, words: String.raw`Verse 2\par Second stanza\par` },
        { rowid: 7, song_id: 1, words: String.raw`Verse 1\par First stanza\par` }
      ]
    );
    const outcome = await s.scan({ path: '/src' });
    expect(outcome.songs).toEqual([
      { title: 'Reordered Song', author: '', text: 'Verse 1\nFirst stanza\n\nVerse 2\nSecond stanza' }
    ]);
  });

  // The reason the fixture declares COLLATE UTF8_U_CI on `word.words` too: this proves that
  // ordering by rowid (INTEGER affinity, untouched by the collation) doesn't reintroduce the
  // "no such collation sequence" crash that a naive ORDER BY on a text column would.
  it('orders word rows by rowid without tripping the words-table collation', async () => {
    const outcome = await source(FIXTURE).scan({ path: FIXTURE });
    expect(outcome.songs.map((s) => s.title)).toEqual(['Amazing Grace', 'Blessed Assurance']);
  });

  // EasyWorship holds its files open, and copying only the .db would silently miss anything
  // still sitting in a WAL/journal sidecar if the live library is mid-write — an operator
  // would just see "Couldn't read that library," or a migration missing recent songs.
  it('copies WAL/SHM/journal sidecars alongside each source db when present', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'ew-wal-src-'));
    copyFileSync(join(FIXTURE, SONGS_DB_NAME), join(srcDir, SONGS_DB_NAME));
    copyFileSync(join(FIXTURE, WORDS_DB_NAME), join(srcDir, WORDS_DB_NAME));
    writeFileSync(join(srcDir, `${SONGS_DB_NAME}-wal`), 'wal-bytes');
    writeFileSync(join(srcDir, `${SONGS_DB_NAME}-shm`), 'shm-bytes');
    writeFileSync(join(srcDir, `${WORDS_DB_NAME}-journal`), 'journal-bytes');

    const copied: string[] = [];
    const s = createEasyWorshipSource({
      openDb: openTestSourceDb,
      pickFolder: () => Promise.resolve(srcDir),
      copy: (src, dest) => {
        copied.push(basename(src));
        copyFileSync(src, dest);
      }
    });

    await s.scan({ path: srcDir });

    expect(copied.sort()).toEqual(
      [SONGS_DB_NAME, `${SONGS_DB_NAME}-shm`, `${SONGS_DB_NAME}-wal`, WORDS_DB_NAME, `${WORDS_DB_NAME}-journal`].sort()
    );
    rmSync(srcDir, { recursive: true, force: true });
  });

  // The common case: no sidecars sitting beside the source files. Their absence must not be
  // an error, and only the two .db files should be copied.
  it('still imports normally when no WAL/SHM/journal sidecars exist', async () => {
    const copied: string[] = [];
    const s = createEasyWorshipSource({
      openDb: openTestSourceDb,
      pickFolder: () => Promise.resolve(FIXTURE),
      copy: (src, dest) => {
        copied.push(basename(src));
        copyFileSync(src, dest);
      }
    });

    const outcome = await s.scan({ path: FIXTURE });

    expect(outcome.songs.map((s) => s.title)).toEqual(['Amazing Grace', 'Blessed Assurance']);
    expect(copied.sort()).toEqual([SONGS_DB_NAME, WORDS_DB_NAME].sort());
  });
});
