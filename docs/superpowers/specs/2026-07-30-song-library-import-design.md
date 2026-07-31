# Helm — Song library import (EasyWorship first)

**Date:** 2026-07-30
**Closes:** the Songs roadmap item *"Song library import"* — "a way to bring in an existing
song library rather than entering songs one at a time… the immediate need is importing from
EasyWorship 8's format." (Found during Windows rehearsal testing, 2026-07-09.)

---

## Why

A church migrating to Helm arrives with hundreds of songs already typed into another
program. Today Helm's only entry path is `QuickAdd` — one song at a time, by hand. That is
not a migration path; it is a reason not to migrate.

The immediate case is EasyWorship. The design generalises one step beyond it — the first
step of the flow asks *which program you are coming from* — so that CSV, Excel or another
projection program becomes a new adapter rather than a second import feature built
alongside the first. Exactly one adapter ships now.

## What we're building

An **Import songs** wizard in a modal over the operator window:

1. **Source** — which program the library comes from. EasyWorship today.
2. **Locate** — a source-specific picker, validated before anything else happens.
3. **Review** — every song found, with its stanza count, duplicates marked, unreadable ones
   flagged. Nothing has been written yet at this point.
4. **Import** — progress and a running count.
5. **Done** — a summary, naming anything that failed.

Songs land in Helm's library through the existing `songsRepo.add()`, so they are searchable,
sectioned and indexed identically to hand-entered songs.

## The source format — what is established, and what is not

EasyWorship 6.1 and later store their library as **plain SQLite**, not Firebird and not
Paradox. This is corroborated by two independent open-source tools:

- [`jamesinglis/ew61-export`](https://github.com/jamesinglis/ew61-export) (PHP) connects with
  `new PDO('sqlite:' . $song_db_path)` and documents: *"EasyWorship 6.1 now stores its
  databases in SQLite3 format, which meant that all other export utilities no longer
  worked."*
- [`Jacqueb-1337/ew-song-importer`](https://github.com/Jacqueb-1337/ew-song-importer)
  (Python), which targets **EasyWorship 7**, uses `sqlite3.connect()` against the same two
  files and the same two tables.

EasyWorship **2009 and earlier** used Paradox (`.DB` plus a `.MB` memo file) and is *out of
scope*; a Quelea support thread shows their importer failing on EW7 precisely because it
expects a `.MB` that no longer exists.

| Thing | Value |
| --- | --- |
| Default location | `C:\Users\Public\Documents\Softouch\EasyWorship\Default\Databases\Data\` |
| Songs | `Songs.db` → table `song`: `rowid`, `song_item_uid`, `title`, `author`, `copyright`, CCLI number |
| Lyrics | `SongWords.db` → table `word`: `song_id`, `words` |
| Join | `word.song_id = song.rowid` |
| Lyric encoding | **RTF** |

**Unverified:** the exact column set of the version this church runs. The schema above is
consistent across two tools spanning EW 6.1 and EW 7, but we have not opened a real file.
The design confines that risk to a single module (§4) — see *Verification on Windows* below.

The roadmap says "EasyWorship 8". The layout above held from 6.1 through 7, so the working
assumption is **6.1 and later**, with the exact version the church runs confirmed on the
Windows machine rather than assumed here.

### Two hazards, both established before writing code

**1. A custom collation will crash ordinary queries.** EasyWorship declares `UTF8_U_CI` on
text columns; `ew-song-importer` must call `connection.create_collation("UTF8_U_CI", …)`
before running `SELECT rowid FROM song WHERE title = ?`. Helm's `better-sqlite3@12.11.1`
**exposes no collation API** (verified: no match for `collation` in its `lib/` or its
type definitions). Any `WHERE` or `ORDER BY` against those columns therefore throws
*"no such collation sequence: UTF8_U_CI"*.

Avoiding it is free, because a collation is only invoked by a comparison or a sort — never
by a bare scan. We issue `SELECT rowid, title, author FROM song` with no `WHERE` and no
`ORDER BY`, join lyrics on an **integer** key, and sort in JavaScript. A test pins this
(see *Testing*).

**2. EasyWorship holds its files open.** We copy `Songs.db` and `SongWords.db` to a temp
directory and open the copies **read-only**. The church's live library is never opened for
writing, never locked, and cannot be damaged by a failed import.

## Design

### 1. The source seam

```ts
export interface ImportSource {
  id: string                                   // 'easyworship'
  label: string                                // shown in step 1
  locate(): Promise<Located | LocateError>     // folder vs file dialog varies per source
  scan(l: Located): Promise<ScanOutcome>
}

export interface ScannedSong { title: string; author: string; text: string }

export interface ScanOutcome {
  songs: ScannedSong[]                                  // parsed, in title order
  unreadable: { title: string; reason: string }[]        // found but not recoverable
}
```

A song reaches `unreadable` when its RTF yields no text, or it has no lyric row at all. It
still has a title — a library migration must be able to say *which* songs did not come
through.

Everything after `scan` — dedupe, `repo.add`, progress, summary — operates on
`ScannedSong[]` and never learns where the songs came from. Only `locate` and `scan` are
source-specific.

Adding CSV later means one new module implementing this interface plus one registry entry.
**No CSV adapter is built now.** A CSV import needs a column-mapping step we cannot design
without seeing a real file, and guessing at it would be designing twice.

### 2. `shared/songs/rtfToText.ts` — pure

RTF → plain text. The only genuinely hard unit, and deliberately scoped to EasyWorship's
dialect rather than the whole RTF specification:

- control words and control symbols; groups via a brace stack
- `\par` and `\line` → `\n`; `\tab` → tab
- unicode escapes `\uN` with the following skip-character (`\u8217?`)
- hex escapes `\'xx`
- ignorable destinations `{\*\…}` discarded whole
- `{\fonttbl…}`, `{\colortbl…}`, `{\stylesheet…}` discarded whole
- unbalanced braces degrade to best-effort output rather than throwing

Returns text using `\n` only. Never throws: a blob it cannot make sense of yields whatever
text it recovered, and an empty result is handled as a per-song failure downstream, not as
a crash.

### 3. `shared/songs/importTidy.ts` — pure, source-agnostic

Applied to the stripped text before `splitToSlides`. **Exactly these six rules, in order:**

1. `\r\n` and `\r` → `\n`
2. trim trailing whitespace on each line
3. collapse three or more consecutive newlines to exactly two (one blank line = one slide
   break)
4. straighten curly quotes and the modifier-letter apostrophe (`'` `'` `ʼ` → `'`, `"` `"` → `"`)
5. drop lines consisting only of RTF-stripping debris: `()`, `[]`, or a lone `.`
6. trim leading and trailing blank lines from the whole song

**Explicitly not done:** no punctuation stripping, no recapitalisation, no `x2` removal, no
section renaming, no reflowing of long blocks. The `ew61-export` tool offers all of these as
options; each one can silently alter a lyric that nobody re-reads until it is on the
projector. *Testing* pins this list with a guard test in both directions.

### 4. `main/importSources/easyworship.ts` — the one adapter

`locate()` opens `showOpenDialog({ properties: ['openDirectory'] })` and verifies both
`Songs.db` and `SongWords.db` exist in the chosen folder. If either is missing it returns a
typed `LocateError` naming the expected default path, rather than failing later inside
SQLite.

`scan()`:

1. copies both files to a temp directory (`app.getPath('temp')` + a UUID)
2. opens the copies read-only
3. `SELECT rowid, title, author FROM song` — no `WHERE`, no `ORDER BY` (§hazard 1)
4. `SELECT song_id, words FROM word` into a `Map<number, string>` keyed by integer
5. per song: `rtfToText` → `importTidy` → `{ title, author, text }`
6. sorts by title in JavaScript
7. deletes the temp copies in a `finally`

Copyright and CCLI number are **read but discarded**: Helm's `songs` table has no column for
them and nothing in the app displays them. The EasyWorship library still exists, so a future
re-import recovers them if Helm ever grows those fields. This keeps the feature to one job
and avoids inventing a schema-migration mechanism the codebase does not yet have.

### 5. `shared/songs/importKey.ts` — the dedupe key

A song is a duplicate when **both** its title and its lyrics already match something in
Helm. Title alone would silently drop a second arrangement of a common hymn title; that
absence would only surface mid-service.

```ts
importKey(title: string, lyrics: string): string   // lowercased, whitespace-collapsed
```

Called on both sides of the comparison — on a `ScannedSong`, and on an existing `Song` via
`lyricsOf(song)`. **Both sides must normalise identically**, which is the same trap
`lyricsOf` itself exists to prevent between the FTS indexer and the ranker. It gets a
round-trip test rather than trust (see *Testing*).

The key set is built once from `repo.list()` and **added to as the import proceeds**, so
duplicates *within* the source library collapse under the same rule.

Consequence: re-running an import is safe and resumable. A second pass adds nothing; a pass
interrupted halfway is completed by running it again.

### 6. `main/songImport.ts` — the orchestrator

Source-agnostic. Holds the registry, runs a scan, classifies each result, commits.

Injectable seams in the style of `mediaImport.ts` (`sources`, `onProgress`, and the temp
directory) so its control flow tests without Electron and without a real library.

**IPC** — two calls plus a broadcast:

| Channel | Shape |
| --- | --- |
| `songImport.sources` | `→ { id, label }[]` |
| `songImport.scan(sourceId)` | opens the picker, scans → `{ token, rows }` or a typed error |
| `songImport.commit(token)` | `→ { imported, skipped, unreadable }` |
| `songImport.progress` | broadcast `{ done, total }` during commit |

A review row is `{ title, author, stanzas, status: 'new' | 'duplicate' | 'unreadable', reason? }`
— one list covering every song found, so the review step's count matches the library's.
`unreadable` rows are `ScanOutcome.unreadable` carried through with `stanzas: 0`; they are
displayed and then skipped at commit.

Main **retains the parsed songs in memory** against the token; only review rows cross to the
renderer. The full lyric text never round-trips, and the renderer cannot hand back mutated
data. The token is discarded when the modal closes or a new scan starts.

Commit calls `songsRepo.add()` per song, which gives `splitToSlides`, the insert transaction
and the `song_fts` index for free. Any path that wrote songs another way would have to
replicate the FTS insert exactly, and getting it wrong yields songs that exist but can never
be found by search.

`source` is recorded as the source id (`'easyworship'`) rather than the default `'local'`.

### 7. Section labels — no new code

`splitToSlides` already splits on blank lines and promotes a leading
`verse|chorus|bridge|refrain|intro|outro|tag|pre-chorus` line to the section label.
EasyWorship's lyrics carry exactly those markers, and rule 3 above turns its slide breaks
into the blank lines `splitToSlides` expects. Unlabelled blocks fall through to
"Verse 1", "Verse 2" — identical to a hand-entered song today.

This alignment is why the importer's job is to produce clean text and stop.

### 8. `renderer/operator/SongImport.tsx` — the wizard

A large modal over the operator window, following `SettingsModal` / `MessageImport` /
`QuickAdd` (mount-while-open, fresh state per open), full-height so the review list has
room. Entered from a button in Songs mode.

The review step is the safety net: it is where a bad RTF strip is caught **before** four
hundred songs land in the library. It is informational — commit imports every row marked
`new`, and skips `duplicate` and `unreadable`. Per-song opt-out is a plausible later
addition, not part of this scope.

## Error handling

| Situation | Behaviour |
| --- | --- |
| Folder lacks `Songs.db` / `SongWords.db` | Typed error naming the expected path. Nothing written. |
| Temp copy fails | Typed error. Nothing written. Source untouched. |
| Unknown collation | Unreachable by construction (§hazard 1), pinned by a test. |
| One song's RTF unparseable, or empty after stripping | That row is `unreadable` with a reason; every other song still imports. |
| Failure during scan | Nothing has been written — scanning completes before any commit. |
| Crash mid-commit | Each `repo.add` is its own transaction, so the library stays consistent; the dedupe rule makes a re-run resume rather than duplicate. |
| Any outcome | Temp copies removed in a `finally`. |

A library migration must never be aborted by one bad song, and must never fail silently: the
Done step names what did not come through.

## Testing

**Pure units** — `rtfToText`: control words, `\par`/`\line`, `\u8217?`, `\'e9`, nested
groups, ignorable destinations, `fonttbl`/`colortbl` removal, unbalanced braces returning
best effort rather than throwing, plus an EasyWorship-shaped fixture end to end.

**`importTidy`** — one test per rule, plus a **guard test in the other direction**: a lyric
containing `x2`, trailing commas, lower-case line starts and a `Chorus 2` label comes
through unaltered. Without it, "light tidying" drifts into cleanup over time.

**`importKey`** — a round-trip property: a `ScannedSong` and the `Song` it becomes after
`repo.add` produce the same key. This is the FTS-style trap and deserves a test, not care.

**The adapter** — tested against a **synthetic EasyWorship database built with
`node:sqlite`**, the same trick `testDb.ts` uses to avoid the native-ABI dance. The fixture
declares a column `COLLATE UTF8_U_CI`, so the test fails the moment anyone adds an
`ORDER BY title` and reintroduces the crash. Plus: missing-file error, RTF blob with no
recoverable text, a song with no lyric row at all.

**The orchestrator** — duplicate skipped, in-library duplicate collapsed, one bad song does
not abort the run, progress emitted, temp cleanup on both success and failure, commit
idempotent across two runs.

**The wizard** — step transitions, review list rendering (each status), the locate-error
state, and the summary naming failures.

## Verification on Windows

The Mac has no EasyWorship library, so the format assumptions above are researched rather
than observed. The first task on the Windows machine, before anything else:

1. `PRAGMA table_info(song)` and `PRAGMA table_info(word)` — confirm the column names.
2. Dump one real `words` blob — confirm it is RTF and see how slide breaks actually appear.
3. Run the import against a **copy** of the library and compare a handful of songs against
   what EasyWorship shows on screen.

If anything differs, only `main/importSources/easyworship.ts` changes; the RTF stripper, the
tidy rules, the dedupe, the orchestrator and the wizard are all unaffected. That isolation is
the reason for the seam in §1.

## Out of scope

- Importing anything but songs — schedules, media and presentations stay in EasyWorship.
- EasyWorship 2009 and earlier (Paradox `.DB`/`.MB`).
- CSV, Excel and other sources — the seam exists for them; no adapter is written.
- Copyright and CCLI fields, and the schema migration they would require.
- Per-song opt-out in the review step.
- Export *out* of Helm.
