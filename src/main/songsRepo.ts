import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type {
  MusicKeyChange, MusicKeyCounts, MusicKeyListQuery, MusicKeyRow, MusicKeyTab, NewSongInput, SearchField, Song, SongSearchResult, UpdateSongInput,
} from '../shared/types';
import { isMusicKey, normalizeKey, type MusicKey, type MusicKeySource } from '../shared/songs/musicKey';
import { SONG_FTS_COLUMNS } from './schema';
import { norm, matchDist, matchTol } from '../shared/search/fuzzy';
import { rankSongs } from '../shared/search/songScore';
import { splitToSlides } from '../shared/songs/splitToSlides';
import { lyricsOf, lyricsOfSections } from '../shared/songs/lyrics';
import { orPrefixMatch, ftsTerm, FTS_CANDIDATE_LIMIT } from './ftsQuery';
import { nextUsage } from './songUsage';

export interface SongsRepo {
  list(): Song[];
  get(id: string): Song | null;
  add(input: NewSongInput): Song;
  /** Insert many songs under ONE transaction (one fsync), with per-song failure isolation:
   * each song runs inside its own SAVEPOINT, so a bad one rolls back alone and its
   * neighbours still land. Result is positional — `{ song }` or `{ error }` per input. */
  addBatch(inputs: NewSongInput[]): ({ song: Song } | { error: string })[];
  update(id: string, input: UpdateSongInput): Song;
  /** Permanent removal from the library (#90). Deletes the FTS row in the same
   * transaction — song_fts is a plain external-content-free fts5 table with no triggers,
   * so a `songs` delete alone would leave an orphan row that keeps matching searches and
   * then mis-attributes itself to whatever song later reuses that rowid. */
  remove(id: string): Song[];
  search(q: string, field: SearchField): SongSearchResult[];
  count(): number;
  /** Writes only music_key / music_key_source (setting a key also clears key_skipped_at);
   * null clears key and source. No FTS work: the key is not indexed. */
  setMusicKey(id: string, musicKey: MusicKey | null, source: MusicKeySource): Song;
  /** One transaction. A change with a `title` renames the song and its song_fts row too.
   * Every entry is validated before anything is written, so a bad one fails the batch. */
  setMusicKeys(batch: MusicKeyChange[]): Song[];
  skipMusicKey(id: string): void;
  keyList(query: MusicKeyListQuery): MusicKeyRow[];
  /** Undo for a key save: writes the previous key and source back exactly as they were,
   * a legacy value included. A source other than 'legacy' still needs a canonical key, so
   * this cannot be used to sneak free text in as 'typed'. `skippedAt` is restored when
   * given (a save clears it), left alone when omitted. */
  restoreMusicKey(id: string, raw: string, source: MusicKeySource | '', skippedAt?: number | null): Song;
  keyCounts(): MusicKeyCounts;
  /** One go-live of the song at `now` (songUsage.ts). An unknown id is ignored: the song
   * may have been deleted while it was on screen. */
  recordLive(id: string, now: number): void;
}
interface Row {
  id: string; title: string; author: string; sections_json: string; source: string; created_at: number;
  music_key: string; music_key_source: string; ccli_no: string; rowid: number;
}
// Exhaustive by construction: adding a MusicKeySource without listing it here fails typecheck.
const MUSIC_KEY_SOURCES: Record<MusicKeySource, true> = {
  typed: true, title: true, import: true, csv: true, pco: true, chart: true, detected: true, legacy: true,
};
const MUSIC_KEY_TABS: Record<MusicKeyTab, true> = { none: true, lately: true, all: true };
/** Sung lately = went live within the last 8 weeks (spec Phase 1c). */
const LATELY_MS = 8 * 7 * 24 * 60 * 60 * 1000;
// bm25() weights per search field, keyed by song_fts column name and rendered in
// SONG_FTS_COLUMNS order so the positional bm25() args can never drift from the DDL.
// Literal constants in the SQL, not bound parameters — FTS5 auxiliary-function args
// must be constant in some builds, and these never vary at runtime.
type FtsColumn = (typeof SONG_FTS_COLUMNS)[number];
const bm25For = (w: Record<FtsColumn, number>): string =>
  `bm25(song_fts, ${SONG_FTS_COLUMNS.map((c) => w[c].toFixed(1)).join(', ')})`;
const BM25: Record<SearchField, string> = {
  all: bm25For({ title: 8, author: 2, lyrics: 1 }),
  title: bm25For({ title: 1, author: 0, lyrics: 0 }),
  lyric: bm25For({ title: 0, author: 0, lyrics: 1 }),
};
/** A key arriving through songs:add / songs:update (QuickAdd's field). Canonicalised when it
 * parses as one key; a placeholder ("N/A") is no key; anything else is kept exactly as typed.
 * Kept rather than refused because QuickAdd hands a stored legacy value ("capo 2 G") straight
 * back on every Save changes, and the section quick-edit does the same: refusing it would make
 * those songs unsaveable. A modulation stays as typed too, as in the startup cleanup. */
function cleanSongKey(raw: string | undefined): string {
  const typed = raw?.trim() ?? '';
  if (!typed) return '';
  const r = normalizeKey(typed, 'field');
  if (r.kind === 'empty') return '';
  if (r.kind === 'key' && !r.endKey) return r.key;
  return typed;
}
/** The source a key written by a person through add/update gets: canonical is 'typed', a
 * value that did not parse is 'legacy' (it lands on No key for a person to decide). */
const typedSourceOf = (key: string): MusicKeySource | '' => (key ? (isMusicKey(key) ? 'typed' : 'legacy') : '');
const toSong = (r: Row): Song => ({
  id: r.id, title: r.title, author: r.author, sections: JSON.parse(r.sections_json),
  source: r.source, createdAt: r.created_at, ...(r.music_key ? { key: r.music_key } : {}),
  // A source without a key (songs:update cleared it) describes nothing, so it is not read back.
  ...(r.music_key && r.music_key_source ? { keySource: r.music_key_source as MusicKeySource } : {}),
  ...(r.ccli_no ? { ccli: r.ccli_no } : {}),
});

export function createSongsRepo(db: Database.Database): SongsRepo {
  const insertSong = db.prepare('INSERT INTO songs (id, title, author, sections_json, source, created_at, music_key, music_key_source) VALUES (?,?,?,?,?,?,?,?)');
  const insertFts = db.prepare('INSERT INTO song_fts (rowid, title, author, lyrics) VALUES ((SELECT rowid FROM songs WHERE id = ?),?,?,?)');
  const updateSong = db.prepare('UPDATE songs SET title = ?, author = ?, sections_json = ? WHERE id = ?');
  const updateFts = db.prepare('UPDATE song_fts SET title = ?, author = ?, lyrics = ? WHERE rowid = (SELECT rowid FROM songs WHERE id = ?)');
  // FTS row first, while `songs` still holds the rowid the subquery resolves through.
  const deleteFts = db.prepare('DELETE FROM song_fts WHERE rowid = (SELECT rowid FROM songs WHERE id = ?)');
  const deleteSong = db.prepare('DELETE FROM songs WHERE id = ?');
  // The insert itself, transaction-free: `add` wraps it in one, `addBatch` in a SAVEPOINT.
  const insertOne = (input: NewSongInput): Song => {
    const sections = splitToSlides(input.text);
    if (!sections.length) throw new Error('Song has no content');
    const key = cleanSongKey(input.key);
    const keySource = typedSourceOf(key);
    const song: Song = {
      id: randomUUID(), title: input.title.trim() || 'Untitled Song', author: input.author?.trim() ?? '', sections,
      source: input.source ?? 'local', createdAt: Date.now(), ...(key ? { key } : {}), ...(keySource ? { keySource } : {}),
    };
    insertSong.run(song.id, song.title, song.author, JSON.stringify(song.sections), song.source, song.createdAt, key, keySource);
    insertFts.run(song.id, norm(song.title), norm(song.author), norm(lyricsOf(song)));
    invalidateVocab();
    // No songCache.delete here: the id is freshly minted (randomUUID above), so the
    // cache can hold no stale entry for it.
    return song;
  };
  // Memoized Song objects by id: JSON.parse of sections_json was measured at up to
  // ~36 ms per keystroke at 10k songs, and object identity is what keys the scorer's
  // per-song doc cache. Writes DELETE from the cache (never insert) so a rolled-back
  // transaction can never leave a ghost — the next read lazily re-caches from the row.
  // Unbounded by design, never evicted on read: one list() call residents the whole
  // parsed library, and that IS the point — a song's memory cost is trivial next to
  // the JSON.parse it saves on every subsequent keystroke. Only a write ever shrinks it.
  const songCache = new Map<string, Song>();
  const toSongCached = (r: Row): Song => {
    const hit = songCache.get(r.id);
    if (hit) return hit;
    const s = toSong(r);
    songCache.set(r.id, s);
    return s;
  };
  // Both candidate paths must agree with list()'s ORDER BY created_at, title so a
  // full relevance tie ranks identically on either path (W7, guarded by the repo test).
  const libraryOrder = (a: Song, b: Song): number =>
    a.createdAt - b.createdAt || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  // P8: prepare once, not per keystroke (the probe was re-prepared per TOKEN).
  const probeStmt = db.prepare('SELECT 1 FROM song_fts WHERE song_fts MATCH ? LIMIT 1');
  // P7: the FTS query already JOINs songs — select the full row so the second
  // `rowid IN (...)` query (and the bound-variable dance) disappears. The LIMIT still
  // earns its keep even with the IN() gone: it caps the candidate set (and therefore
  // the JS scorer's per-keystroke work) a common token's match count would otherwise
  // blow past.
  const searchStmt = Object.fromEntries(
    (Object.keys(BM25) as SearchField[]).map((f) => [
      f,
      db.prepare(`SELECT s.rowid AS rowid, s.id AS id, s.title AS title, s.author AS author, s.sections_json AS sections_json, s.source AS source, s.created_at AS created_at, s.music_key AS music_key, s.music_key_source AS music_key_source, s.ccli_no AS ccli_no, -${BM25[f]} AS rel FROM song_fts JOIN songs s ON s.rowid = song_fts.rowid WHERE song_fts MATCH ? ORDER BY rel DESC LIMIT ${FTS_CANDIDATE_LIMIT}`),
    ])
  ) as Record<SearchField, ReturnType<typeof db.prepare>>;
  // Vocabulary of every indexed song term, loaded on first use and dropped whenever
  // song_fts changes — the verse pattern (biblesRepo.expandToken / verse_vocab).
  const selectVocab = db.prepare('SELECT term FROM song_vocab');
  // The index stores norm()'d text (see searchIndex.ts), so every vocabulary term IS a
  // norm token: distance comparison and the FTS re-query use the same string. (This
  // retired the { raw, norm } pair dance the un-normalized index needed for "großer".)
  let vocab: string[] | null = null;
  const invalidateVocab = (): void => { vocab = null; };
  const getVocab = (): string[] =>
    (vocab ??= (selectVocab.all() as { term: string }[]).map((r) => r.term));
  // Nearest-tier expansion for a token with NO FTS prefix hit of its own: only the
  // vocabulary terms at the smallest edit distance found join the OR group (ties
  // included) — everything within tolerance would pollute retrieval AND ranking.
  // Returns [] when the token is too short or nothing is in reach; the scorer then
  // simply never matches that token, same as a fruitless full scan today.
  const expandToken = (tok: string): string[] => {
    if (tok.length < 3) return [];
    const tol = matchTol(tok.length);
    let best = Infinity;
    let near: string[] = [];
    for (const t of getVocab()) {
      const d = matchDist(tok, t);
      if (d > tol) continue;
      if (d < best) { best = d; near = [t]; }
      else if (d === best) near.push(t);
    }
    return near;
  };
  const list = (): Song[] => (db.prepare('SELECT rowid, * FROM songs ORDER BY created_at, title').all() as Row[]).map(toSongCached);
  const get = (id: string): Song | null => {
    const r = db.prepare('SELECT rowid, * FROM songs WHERE id = ?').get(id) as Row | undefined;
    return r ? toSongCached(r) : null;
  };
  // --- Song keys ---
  const songExists = db.prepare('SELECT 1 FROM songs WHERE id = ?');
  const setKeyStmt = db.prepare('UPDATE songs SET music_key = ?, music_key_source = ?, key_skipped_at = NULL WHERE id = ?');
  // Clearing leaves key_skipped_at alone: a skipped song that loses its key stays skipped.
  const clearKeyStmt = db.prepare(`UPDATE songs SET music_key = '', music_key_source = '' WHERE id = ?`);
  const setTitleStmt = db.prepare('UPDATE songs SET title = ? WHERE id = ?');
  const setFtsTitleStmt = db.prepare('UPDATE song_fts SET title = ? WHERE rowid = (SELECT rowid FROM songs WHERE id = ?)');
  const skipStmt = db.prepare('UPDATE songs SET key_skipped_at = ? WHERE id = ?');
  // First lyric line straight out of the JSON, so the list never parses 3,000 songs' sections.
  const keyListStmt = db.prepare(`SELECT id, title, author, music_key, music_key_source, live_days, last_live_at, key_skipped_at,
    COALESCE(json_extract(sections_json, '$[0].lines[0]'), '') AS first_line FROM songs`);
  // Arguments come straight off IPC, so every check is a runtime one, not just a type.
  const assertSong = (id: unknown): string => {
    if (typeof id !== 'string' || songExists.get(id) === undefined) throw new Error('Song not found');
    return id;
  };
  const assertKeyArgs = (musicKey: unknown, source: unknown): void => {
    if (musicKey !== null && (typeof musicKey !== 'string' || !isMusicKey(musicKey))) throw new Error(`Not a key: ${String(musicKey)}`);
    if (typeof source !== 'string' || !Object.hasOwn(MUSIC_KEY_SOURCES, source)) throw new Error(`Unknown key source: ${String(source)}`);
    // 'legacy' means "the stored text did not parse"; only the startup cleanup sets it.
    if (musicKey !== null && source === 'legacy') throw new Error('A canonical key cannot have source legacy');
  };
  const restoreKeyStmt = db.prepare('UPDATE songs SET music_key = ?, music_key_source = ? WHERE id = ?');
  const restoreSkipStmt = db.prepare('UPDATE songs SET key_skipped_at = ? WHERE id = ?');
  const usageStmt = db.prepare('SELECT last_live_at, live_days FROM songs WHERE id = ?');
  const setUsageStmt = db.prepare('UPDATE songs SET last_live_at = ?, live_days = ? WHERE id = ?');
  // "Has a key" = a canonical key: a legacy value is still waiting for a person (No key).
  const keyCountsStmt = db.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(music_key = '' OR music_key_source = 'legacy'), 0) AS no_key,
    COALESCE(SUM(last_live_at >= ?), 0) AS lately,
    COALESCE(SUM(last_live_at >= ? AND music_key <> '' AND music_key_source <> 'legacy'), 0) AS lately_with_key,
    COALESCE(MAX(last_live_at IS NOT NULL), 0) AS any_live
    FROM songs`);
  const writeKey = (id: string, musicKey: MusicKey | null, source: MusicKeySource): void => {
    if (musicKey === null) clearKeyStmt.run(id);
    else setKeyStmt.run(musicKey, source, id);
  };
  return {
    list,
    get,
    count: () => (db.prepare('SELECT COUNT(*) AS n FROM songs').get() as { n: number }).n,
    setMusicKey(id, musicKey, source) {
      assertSong(id);
      assertKeyArgs(musicKey, source);
      writeKey(id, musicKey, source);
      songCache.delete(id);
      return get(id)!;
    },
    setMusicKeys(batch) {
      if (!Array.isArray(batch)) throw new Error('Expected a list of key changes');
      const titles = batch.map((c) => {
        if (typeof c !== 'object' || c === null) throw new Error('Expected a key change');
        assertSong(c.id);
        assertKeyArgs(c.key, c.source);
        if (c.title === undefined) return undefined;
        const title = typeof c.title === 'string' ? c.title.trim() : '';
        if (!title) throw new Error('A song needs a title');
        return title;
      });
      db.transaction(() => {
        batch.forEach((c, i) => {
          writeKey(c.id, c.key, c.source);
          const title = titles[i];
          if (title !== undefined) {
            setTitleStmt.run(title, c.id);
            setFtsTitleStmt.run(norm(title), c.id);
          }
        });
      })();
      for (const c of batch) songCache.delete(c.id);
      if (titles.some((t) => t !== undefined)) invalidateVocab();
      return batch.map((c) => get(c.id)!);
    },
    skipMusicKey(id) {
      assertSong(id);
      skipStmt.run(Date.now(), id);
      songCache.delete(id);
    },
    restoreMusicKey(id, raw, source, skippedAt) {
      assertSong(id);
      if (typeof raw !== 'string') throw new Error('Expected the previous key as text');
      if (typeof source !== 'string' || (source !== '' && !Object.hasOwn(MUSIC_KEY_SOURCES, source))) {
        throw new Error(`Unknown key source: ${String(source)}`);
      }
      if (raw === '' && source !== '') throw new Error('No key has no source');
      if (raw !== '' && source !== 'legacy' && !isMusicKey(raw)) throw new Error(`Not a key: ${raw}`);
      if (skippedAt !== undefined && skippedAt !== null && !(typeof skippedAt === 'number' && Number.isFinite(skippedAt))) {
        throw new Error('Expected a skip time');
      }
      db.transaction(() => {
        restoreKeyStmt.run(raw, source, id);
        if (skippedAt !== undefined) restoreSkipStmt.run(skippedAt, id);
      })();
      songCache.delete(id);
      return get(id)!;
    },
    keyCounts() {
      const since = Date.now() - LATELY_MS;
      const r = keyCountsStmt.get(since, since) as {
        total: number; no_key: number; lately: number; lately_with_key: number; any_live: number;
      };
      return { total: r.total, noKey: r.no_key, lately: r.lately, latelyWithKey: r.lately_with_key, anyLive: r.any_live === 1 };
    },
    recordLive(id, now) {
      const prev = usageStmt.get(id) as { last_live_at: number | null; live_days: number } | undefined;
      if (!prev) return;
      const next = nextUsage({ lastLiveAt: prev.last_live_at, liveDays: prev.live_days }, now);
      setUsageStmt.run(next.lastLiveAt, next.liveDays, id);
    },
    keyList(query) {
      const tab = query?.tab;
      if (typeof tab !== 'string' || !Object.hasOwn(MUSIC_KEY_TABS, tab)) throw new Error(`Unknown tab: ${String(tab)}`);
      type KeyRow = {
        id: string; title: string; author: string; music_key: string; music_key_source: string;
        live_days: number; last_live_at: number | null; key_skipped_at: number | null; first_line: string;
      };
      let rows = (keyListStmt.all() as KeyRow[]).map((r): MusicKeyRow => ({
        id: r.id, title: r.title, author: r.author, firstLine: r.first_line,
        key: r.music_key, keySource: r.music_key ? (r.music_key_source as MusicKeySource | '') : '',
        liveDays: r.live_days, lastLiveAt: r.last_live_at, skippedAt: r.key_skipped_at,
      }));
      // Search: every norm()'d query token must appear somewhere in the norm()'d title or
      // author (substring, so "corner" finds "Cornerstone"). In JS over the light rows,
      // not FTS: it has no typo tier to explain and stays well under a millisecond-per-
      // thousand-rows, and FTS would also match lyrics, which this field does not search.
      const tokens = typeof query.q === 'string' ? norm(query.q).split(' ').filter(Boolean) : [];
      if (tokens.length) {
        rows = rows.filter((r) => {
          const hay = norm(`${r.title} ${r.author}`);
          return tokens.every((t) => hay.includes(t));
        });
      }
      const byTitle = (a: MusicKeyRow, b: MusicKeyRow): number =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      if (tab === 'all') return rows.sort(byTitle);
      if (tab === 'lately') {
        const since = Date.now() - LATELY_MS;
        return rows
          .filter((r) => r.lastLiveAt !== null && r.lastLiveAt >= since)
          .sort((a, b) => b.lastLiveAt! - a.lastLiveAt! || byTitle(a, b));
      }
      // No key: no key at all, or a legacy value a person still has to decide on. Ranked by
      // use (live_days, then last_live_at), then title, with skipped songs at the end.
      return rows
        .filter((r) => r.key === '' || r.keySource === 'legacy')
        .sort((a, b) =>
          Number(a.skippedAt !== null) - Number(b.skippedAt !== null)
          || b.liveDays - a.liveDays
          || (b.lastLiveAt ?? -1) - (a.lastLiveAt ?? -1)
          || byTitle(a, b));
    },
    add(input) {
      return db.transaction(() => insertOne(input))();
    },
    addBatch(inputs) {
      const out: ({ song: Song } | { error: string })[] = [];
      db.transaction(() => {
        for (const input of inputs) {
          // Raw SAVEPOINT rather than a nested db.transaction(): better-sqlite3 would
          // savepoint for us, but the node:sqlite test shim is non-nested, and the two
          // must behave identically for the isolation tests to mean anything.
          db.exec('SAVEPOINT song');
          try {
            out.push({ song: insertOne(input) });
            db.exec('RELEASE song');
          } catch (err) {
            db.exec('ROLLBACK TO song');
            db.exec('RELEASE song');
            out.push({ error: err instanceof Error ? err.message : String(err) });
          }
        }
      })();
      return out;
    },
    update(id, input) {
      const existing = get(id);
      if (!existing) throw new Error('Song not found');
      const sections = input.sections
        .map((s) => ({ label: s.label, lines: s.lines.map((l) => l.trim()).filter(Boolean) }))
        .filter((s) => s.lines.length);
      if (!sections.length) throw new Error('Song has no content');
      const title = input.title.trim() || 'Untitled Song';
      const author = input.author?.trim() ?? '';
      const key = cleanSongKey(input.key);
      // Key source stays honest: a changed key was set by a person here, so it is 'typed'
      // (or 'legacy' when it did not parse, or '' when cleared). An unchanged key keeps its
      // source, so a lyric fix does not relabel a key that came from an import or the title.
      const keyChanged = key !== (existing.key ?? '');
      const keySource = keyChanged ? typedSourceOf(key) : (key ? existing.keySource ?? '' : '');
      const song: Song = {
        id, title, author, sections,
        source: existing.source, createdAt: existing.createdAt,
        ...(key ? { key } : {}),
        ...(key && keySource ? { keySource } : {}),
        ...(existing.ccli ? { ccli: existing.ccli } : {}),
      };
      db.transaction(() => {
        updateSong.run(title, author, JSON.stringify(sections), id);
        if (keyChanged) {
          if (key) setKeyStmt.run(key, keySource, id);
          else clearKeyStmt.run(id);
        }
        updateFts.run(norm(title), norm(author), norm(lyricsOfSections(sections)), id);
      })();
      songCache.delete(id);
      invalidateVocab();
      return song;
    },
    remove(id) {
      db.transaction(() => {
        deleteFts.run(id);
        deleteSong.run(id);
      })();
      songCache.delete(id);
      invalidateVocab();
      return list();
    },
    search(q, field) {
      const tokens = norm(q).split(' ').filter(Boolean);
      if (!tokens.length) return rankSongs('', list(), field);
      const tokenHasHit = (t: string): boolean => (probeStmt.get(ftsTerm(t, true)) as unknown) !== undefined;
      const stmt = Object.hasOwn(searchStmt, field) ? searchStmt[field as SearchField] : searchStmt.all;
      let match = orPrefixMatch(tokens);
      let hits = stmt.all(match) as (Row & { rel: number })[];
      const noHit = tokens.filter((t) => !tokenHasHit(t));
      // All-digit tokens keep the full scan even when they hit: matchDist's digit rules
      // admit numeric neighbors the FTS gate can't see — "1000" is one edit from "10000"
      // and must still chart below 10,000 Reasons (W8), and a typo'd number has no
      // nearest-tier expansion worth trusting. The one surviving full-scan class;
      // digit queries are rare enough to pay it.
      if (tokens.some((t) => /^[0-9]+$/.test(t))) {
        return rankSongs(q, list(), field, new Map(hits.map((h) => [h.id, h.rel])), 50);
      }
      // Typo handling is per TOKEN (#13), now by vocabulary expansion instead of a
      // full-library scan: each no-hit token ORs in its nearest indexed terms and the
      // candidate gate re-runs — the fuzzy pass costs O(vocab), not O(library words).
      if (noHit.length) {
        const extra = [...new Set(noHit.flatMap((t) => expandToken(t)))];
        if (extra.length) {
          match = [match, ...extra.map((t) => ftsTerm(t, false))].join(' OR ');
          hits = stmt.all(match) as (Row & { rel: number })[];
        }
      }
      const rel = new Map(hits.map((h) => [h.id, h.rel]));
      const candidates = hits.map(toSongCached).sort(libraryOrder);
      return rankSongs(q, candidates, field, rel, 50);
    },
  };
}
