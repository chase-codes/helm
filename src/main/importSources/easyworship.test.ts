import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { createEasyWorshipSource, EW_DEFAULT_PATH } from './easyworship';
import type { ImportSource, SourceDb } from './types';

const FIXTURE = join(__dirname, '__fixtures__', 'ew');
const SONGS_DB_NAME = 'Songs.db';
const WORDS_DB_NAME = 'SongWords.db';

// A minimal fake SourceDb pair, bypassing real sqlite entirely, for tests that only care
// about how `word` rows are turned into ScannedSong.text (BLOB decoding, row collisions).
//
// NOTE: `all` ignores the SQL it's handed, including `PRAGMA table_info(...)` calls — so
// `columnsOf` gets song/word rows back instead of column-name rows, and builds
// `new Set([undefined])`. Every fake-based test therefore runs as if `author`, `slide_uids`
// and `presentation_id` were all absent from the schema (harmless for what these tests check,
// but the reason `withLayouts`/`sourceStanzas` never appear here — don't go looking for a bug
// in the adapter if a fake-based test doesn't see them).
const fakeSource = (songRows: unknown[], wordRows: unknown[]): ImportSource =>
  createEasyWorshipSource({
    pickFolder: () => Promise.resolve('/src'),
    mkdtemp: () => '/fake-tmp',
    rmTemp: () => {},
    copy: () => {},
    exists: () => true,
    listDir: () => [{ name: 'Songs.db', isDir: false }, { name: 'SongWords.db', isDir: false }],
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

// Builds a real on-disk EasyWorship-shaped library. Unlike the committed binary fixture, the
// column set is parameterised, which is the only way to test the schema drift the EW8 spec
// found between two libraries both reporting schema 6.5.1.0.
//
// NOTE: no `COLLATE UTF8_U_CI` here — node:sqlite rejects CREATE TABLE with an unregistered
// collation ("no such collation sequence"). The committed __fixtures__/ew library is what
// pins the collation hazard; these fixtures pin column presence.
interface FixtureSong {
  title: string;
  author?: string;
  rtf?: string;
  slideUids?: string;
  /** song.presentation_id — > 0 means the song carries a laid-out slide set. */
  layout?: number;
}

const makeLibrary = (
  dir: string,
  songs: FixtureSong[],
  opts: { presentationId?: boolean; slideUids?: boolean } = {}
): string => {
  mkdirSync(dir, { recursive: true });
  const withPid = opts.presentationId !== false;
  const withUids = opts.slideUids !== false;

  const s = new DatabaseSync(join(dir, SONGS_DB_NAME));
  s.exec(
    'CREATE TABLE song (rowid integer PRIMARY KEY AUTOINCREMENT NOT NULL UNIQUE, ' +
      `title text NOT NULL, author text${withPid ? ', presentation_id integer' : ''})`
  );
  const insertSong = s.prepare(
    withPid
      ? 'INSERT INTO song (title, author, presentation_id) VALUES (?, ?, ?)'
      : 'INSERT INTO song (title, author) VALUES (?, ?)'
  );
  songs.forEach((song) =>
    withPid
      ? insertSong.run(song.title, song.author ?? '', song.layout ?? 0)
      : insertSong.run(song.title, song.author ?? '')
  );
  s.close();

  const w = new DatabaseSync(join(dir, WORDS_DB_NAME));
  w.exec(
    'CREATE TABLE word (rowid integer PRIMARY KEY NOT NULL UNIQUE, song_id integer, ' +
      `words rtf${withUids ? ', slide_uids text' : ''})`
  );
  const insertWord = w.prepare(
    withUids
      ? 'INSERT INTO word (song_id, words, slide_uids) VALUES (?, ?, ?)'
      : 'INSERT INTO word (song_id, words) VALUES (?, ?)'
  );
  songs.forEach((song, i) => {
    const args: unknown[] = [i + 1, song.rtf ?? '{\\rtf1 words\\par}'];
    if (withUids) args.push(song.slideUids ?? '1-A');
    insertWord.run(...(args as [number, string, string?]));
  });
  w.close();
  return dir;
};

const tempLibrary = (name: string): string =>
  join(mkdtempSync(join(tmpdir(), `ew-${name}-`)), 'Data');

describe('easyworship source', () => {
  it('reports the two expected files when the folder does not hold them', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'ew-empty-'));
    const located = await source(empty).locate();
    expect(located).toEqual({
      error: 'no-source-files',
      // A shape, not a path: the profile and version segments both vary in the wild, and a
      // version directory can exist while holding zero songs.
      expected:
        'C:\\Users\\Public\\Documents\\Softouch\\Easyworship\\<Profile>\\<Version>\\Databases\\Data\\'
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

  // The reason the fixture declares COLLATE UTF8_U_CI on `word.words` too: this proves that
  // the unfiltered, unordered `SELECT song_id, words FROM word` scan doesn't trip the
  // "no such collation sequence" crash that a WHERE/ORDER BY/DISTINCT/GROUP BY against a text
  // column would.
  it('reads the word table without tripping its words-table collation', async () => {
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

  it('does not break a slide on a paragraph holding a single space', async () => {
    // \fntnamaut swallows one space as its delimiter, so the second space is content.
    const rtf = '{\\rtf1 CHORUS\\par line one\\par \\fntnamaut  \\par line two\\par}';
    const outcome = await fakeSource(
      [{ rowid: 1, title: 'Spacer', author: '' }],
      [{ song_id: 1, words: rtf }]
    ).scan({ path: '/src' });
    expect(outcome.songs[0].text).toBe('CHORUS\nline one\nline two');
  });

  it('does not break a slide on a doubled \\line', async () => {
    const rtf = '{\\rtf1 Verse 1\\par first\\line\\line second\\par}';
    const outcome = await fakeSource(
      [{ rowid: 1, title: 'Soft', author: '' }],
      [{ song_id: 1, words: rtf }]
    ).scan({ path: '/src' });
    expect(outcome.songs[0].text).toBe('Verse 1\nfirst\nsecond');
  });

  it('collapses runs of internal whitespace in a title', async () => {
    const outcome = await fakeSource(
      [{ rowid: 1, title: 'A Child Of The King      (Eb)  ', author: '' }],
      [{ song_id: 1, words: '{\\rtf1 words\\par}' }]
    ).scan({ path: '/src' });
    expect(outcome.songs[0].title).toBe('A Child Of The King (Eb)');
  });

  it('keeps the first word row and never fuses two songs when song_id repeats', async () => {
    // word_song_id is UNIQUE, so this cannot happen in a real library — but if it ever did,
    // silently concatenating two songs is the one outcome nobody would catch in review.
    const outcome = await fakeSource(
      [{ rowid: 1, title: 'First', author: '' }],
      [
        { song_id: 1, words: '{\\rtf1 keep me\\par}' },
        { song_id: 1, words: '{\\rtf1 not me\\par}' }
      ]
    ).scan({ path: '/src' });
    expect(outcome.songs[0].text).toBe('keep me');
  });

  it('flags a song whose split disagrees with the source slide count', async () => {
    const dir = makeLibrary(tempLibrary('uids'), [
      // Two slides by our rules; EasyWorship claims three.
      { title: 'Disagrees', rtf: '{\\rtf1 A\\par \\par B\\par}', slideUids: '1-A,1-B,1-C' },
      { title: 'Agrees', rtf: '{\\rtf1 A\\par \\par B\\par}', slideUids: '1-A,1-B' }
    ]);
    const outcome = await source(dir).scan({ path: dir });
    expect(outcome.songs.find((s) => s.title === 'Disagrees')?.sourceStanzas).toBe(3);
    expect(outcome.songs.find((s) => s.title === 'Agrees')).not.toHaveProperty('sourceStanzas');
    rmSync(dir, { recursive: true, force: true });
  });

  // The review badge renders parsedStanzas beside sourceStanzas — the two numbers actually
  // compared — never `splitToSlides(text).length`, which excludes empty slides and can equal
  // sourceStanzas even when the two counts that were actually compared disagree. The two
  // fields must appear together and be absent together, or the UI could render one without
  // the other.
  it('sets parsedStanzas alongside sourceStanzas only when they disagree, never one without the other', async () => {
    const dir = makeLibrary(tempLibrary('parsed'), [
      // Two slides by our rules; EasyWorship claims three.
      { title: 'Disagrees', rtf: '{\\rtf1 A\\par \\par B\\par}', slideUids: '1-A,1-B,1-C' },
      { title: 'Agrees', rtf: '{\\rtf1 A\\par \\par B\\par}', slideUids: '1-A,1-B' }
    ]);
    const outcome = await source(dir).scan({ path: dir });
    const disagrees = outcome.songs.find((s) => s.title === 'Disagrees');
    expect(disagrees).toMatchObject({ sourceStanzas: 3, parsedStanzas: 2 });
    const agrees = outcome.songs.find((s) => s.title === 'Agrees');
    expect(agrees).not.toHaveProperty('sourceStanzas');
    expect(agrees).not.toHaveProperty('parsedStanzas');
    rmSync(dir, { recursive: true, force: true });
  });

  it("compares against EasyWorship's slide count, not Helm's section count", async () => {
    // A leading blank paragraph is what pulls the two counts apart: paragraphs
    // ["", "A", "", "B", ""] give ewSlideBreaks a slideCount of 3 (rule 3 — a leading break
    // still yields a leading empty slide), but the imported text ('A\n\nB') has no leading
    // blank line, so splitToSlides(text).length is only 2. slide_uids agrees with the FORMER.
    // If the adapter ever compared against splitToSlides(text).length instead, this fixture
    // would wrongly gain a sourceStanzas flag (3 !== 2) despite the source and our parse
    // actually agreeing (3 === 3) — don't "simplify" this fixture, that's the point of it.
    const dir = makeLibrary(tempLibrary('leadingblank'), [
      {
        title: 'Leading Blank',
        rtf: '{\\rtf1 \\par A\\par \\par B\\par}',
        slideUids: '1-A,1-B,1-C'
      }
    ]);
    const outcome = await source(dir).scan({ path: dir });
    const song = outcome.songs.find((s) => s.title === 'Leading Blank');
    expect(song).not.toHaveProperty('sourceStanzas');
    rmSync(dir, { recursive: true, force: true });
  });

  it('imports normally when the slide_uids column is absent', async () => {
    const dir = makeLibrary(tempLibrary('nouids'), [{ title: 'Bare' }], { slideUids: false });
    const outcome = await source(dir).scan({ path: dir });
    expect(outcome.songs).toHaveLength(1);
    expect(outcome.songs[0]).not.toHaveProperty('sourceStanzas');
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts how many songs carry an EasyWorship layout', async () => {
    // This number decides whether Path A (exact slides from PresentationLayouts.db) is worth
    // building at all: real libraries ranged from 22% coverage to zero.
    const dir = makeLibrary(tempLibrary('layouts'), [
      { title: 'Laid Out', layout: 17 },
      { title: 'Plain', layout: 0 },
      { title: 'Also Plain', layout: 0 }
    ]);
    const outcome = await source(dir).scan({ path: dir });
    expect(outcome.withLayouts).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('imports normally, with no layout count, when presentation_id is absent', async () => {
    // The older schema in the EW8 spec §2.4 has no song.presentation_id, while reporting the
    // same schema version as one that does. Absent must mean "unknown", not "zero".
    const dir = makeLibrary(tempLibrary('nopid'), [{ title: 'Old Schema' }], {
      presentationId: false
    });
    const outcome = await source(dir).scan({ path: dir });
    expect(outcome.songs.map((s) => s.title)).toEqual(['Old Schema']);
    expect(outcome).not.toHaveProperty('withLayouts');
    rmSync(dir, { recursive: true, force: true });
  });

  it('ignores an unparseable slide_uids value rather than failing the song', async () => {
    const dir = makeLibrary(tempLibrary('baduids'), [
      { title: 'Empty', slideUids: '' },
      { title: 'Null', slideUids: undefined },
      { title: 'Whitespace', slideUids: ' , ' }
    ]);
    // node:sqlite has no way to bind an explicit SQL NULL through the fixture's positional
    // `?` insert, so the NULL case is produced by updating the row after insert.
    const w = new DatabaseSync(join(dir, WORDS_DB_NAME));
    w.exec('UPDATE word SET slide_uids = NULL WHERE song_id = 2');
    w.close();

    const outcome = await source(dir).scan({ path: dir });
    expect(outcome.songs.map((s) => s.title)).toEqual(['Empty', 'Null', 'Whitespace']);
    for (const song of outcome.songs) expect(song).not.toHaveProperty('sourceStanzas');
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds a library nested below the folder the operator picked', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-nested-'));
    const data = join(root, 'Default_1', 'v6.1', 'Databases', 'Data');
    makeLibrary(data, [{ title: 'Nested' }]);
    expect(await source(root).locate()).toEqual({ path: data });
    rmSync(root, { recursive: true, force: true });
  });

  it('ignores a library buried in Archive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-archive-'));
    makeLibrary(join(root, 'Default', 'v6.1', 'Databases', 'Archive'), [{ title: 'Stale' }]);
    expect(await source(root).locate()).toEqual({
      error: 'no-source-files',
      expected: EW_DEFAULT_PATH
    });
    rmSync(root, { recursive: true, force: true });
  });

  it('skips a candidate that has zero songs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-empty-cand-'));
    makeLibrary(join(root, 'Default_1', 'v6.1.2', 'Databases', 'Data'), []);
    const live = join(root, 'Default_1', 'v6.1', 'Databases', 'Data');
    makeLibrary(live, [{ title: 'Real' }]);
    // Only one non-empty candidate remains, so no picker is shown.
    expect(await source(root).locate()).toEqual({ path: live });
    rmSync(root, { recursive: true, force: true });
  });

  it('reports the empty-library case distinctly from a missing one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-all-empty-'));
    makeLibrary(join(root, 'Default', 'v6.1', 'Databases', 'Data'), []);
    expect(await source(root).locate()).toEqual({
      error: 'all-candidates-empty',
      expected: EW_DEFAULT_PATH
    });
    rmSync(root, { recursive: true, force: true });
  });

  // The distinction FIX 1 exists for: a candidate that opened fine and genuinely has zero
  // songs must not be reported the same way as one that could not be read at all (locked
  // file, corrupt database, EBUSY) — the wizard's copy for the two is different and the wrong
  // one sends the operator hunting for a folder that does exist.
  it('reports a candidate that fails to open as unreadable, not as empty', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-unreadable-'));
    const data = join(root, 'Default', 'v6.1', 'Databases', 'Data');
    makeLibrary(data, [{ title: 'Locked' }]);
    const s = createEasyWorshipSource({
      openDb: () => {
        throw new Error('EBUSY: resource busy or locked');
      },
      pickFolder: () => Promise.resolve(root)
    });
    expect(await s.locate()).toEqual({ error: 'candidates-unreadable', expected: EW_DEFAULT_PATH });
    rmSync(root, { recursive: true, force: true });
  });

  it('does not let a broken candidate block a good sibling', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-mixed-'));
    const broken = join(root, 'Default', 'v6.1', 'Databases', 'Data');
    const good = join(root, 'Default_1', 'v6.1', 'Databases', 'Data');
    makeLibrary(broken, [{ title: 'Locked' }]);
    makeLibrary(good, [{ title: 'Fine' }]);
    const s = createEasyWorshipSource({
      openDb: openTestSourceDb,
      pickFolder: () => Promise.resolve(root),
      // `copy`'s source path names the original library directory, unlike `openDb`'s (which
      // only ever sees an anonymous temp-dir path) — so this is the seam that can single out
      // the broken candidate deterministically regardless of traversal order.
      copy: (src, dest) => {
        if (src.startsWith(broken)) throw new Error('EBUSY: resource busy or locked');
        copyFileSync(src, dest);
      }
    });
    expect(await s.locate()).toEqual({ path: good });
    rmSync(root, { recursive: true, force: true });
  });

  it('does not reject the whole locate when a candidate cannot even be counted (mkdtemp throws)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-mkdtemp-fail-'));
    const data = join(root, 'Default', 'v6.1', 'Databases', 'Data');
    makeLibrary(data, [{ title: 'One' }]);
    const s = createEasyWorshipSource({
      openDb: openTestSourceDb,
      pickFolder: () => Promise.resolve(root),
      mkdtemp: () => {
        throw new Error('ENOSPC: no space left on device');
      }
    });
    // Before FIX 1, mkdtemp sat outside countCandidate's try, so this rejected the whole
    // locate() promise instead of returning a typed error.
    await expect(s.locate()).resolves.toEqual({ error: 'candidates-unreadable', expected: EW_DEFAULT_PATH });
    rmSync(root, { recursive: true, force: true });
  });

  it('asks which library to use when more than one holds songs, ranked by song count', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-two-'));
    const small = join(root, 'Default', 'v6.1', 'Databases', 'Data');
    const big = join(root, 'Default_1', 'v6.1', 'Databases', 'Data');
    makeLibrary(small, [{ title: 'One' }]);
    makeLibrary(big, [{ title: 'A' }, { title: 'B' }, { title: 'C' }]);

    let offered: string[] = [];
    const s = createEasyWorshipSource({
      openDb: openTestSourceDb,
      pickFolder: () => Promise.resolve(root),
      pickCandidate: (cands) => {
        offered = cands.map((c) => c.label);
        return Promise.resolve(cands[0]);
      }
    });
    expect(await s.locate()).toEqual({ path: big });
    expect(offered[0]).toContain('Default_1 (v6.1)');
    expect(offered[0]).toContain('3 songs');
    expect(offered[1]).toContain('Default (v6.1)');
    rmSync(root, { recursive: true, force: true });
  });

  it('treats backing out of the library picker as cancellation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-pick-cancel-'));
    makeLibrary(join(root, 'Default', 'v6.1', 'Databases', 'Data'), [{ title: 'One' }]);
    makeLibrary(join(root, 'Default_1', 'v6.1', 'Databases', 'Data'), [{ title: 'Two' }]);
    const s = createEasyWorshipSource({
      openDb: openTestSourceDb,
      pickFolder: () => Promise.resolve(root),
      pickCandidate: () => Promise.resolve(null)
    });
    expect(await s.locate()).toEqual({ error: 'canceled' });
    rmSync(root, { recursive: true, force: true });
  });

  it('does not descend more than four levels below the picked folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ew-deep-'));
    makeLibrary(join(root, 'a', 'b', 'c', 'd', 'e'), [{ title: 'Too Deep' }]);
    expect(await source(root).locate()).toEqual({
      error: 'no-source-files',
      expected: EW_DEFAULT_PATH
    });
    rmSync(root, { recursive: true, force: true });
  });
});
