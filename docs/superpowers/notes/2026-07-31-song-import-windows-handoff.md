# Handoff — song library import, verification on Windows

**Date:** 2026-07-31 · **State:** shipped on `feat/song-library-import`, 518 tests passing,
verified end-to-end in the real Electron app — but **never run against a real EasyWorship
library**.

Spec: `docs/superpowers/specs/2026-07-30-song-library-import-design.md`
Plan: `docs/superpowers/plans/2026-07-30-song-library-import.md`

**2026-08-04 update:** the schema questions this note poses below are now answered. Three
real, in-use EasyWorship 8 libraries were inspected directly on Windows and the findings are
recorded in `EasyWorship8-Library-Spec.md`, with the resulting adapter correction in
`docs/superpowers/specs/2026-08-04-easyworship8-import-correction-design.md` and
`docs/superpowers/plans/2026-08-04-easyworship8-import-correction.md`. That work also replaced
the locate step: the adapter now searches downward for a `Songs.db`/`SongWords.db` pair,
counts each candidate, drops empty ones, and ranks by song count rather than assuming a single
fixed path. The remaining Windows task is narrower — run the import against a **copy** of the
real library and check three things:

1. **Which library the picker offers** — with more than one library on disk, confirm the one
   ranked first (largest song count) is the one actually in use, and that a stale, empty
   library (a real, observed state — see the spec) is dropped rather than offered.
2. **How many songs carry a CHECK badge** in the review step (the source's own slide count
   disagreeing with the adapter's parse) — a plausible, small number, not most of the library.
3. **A spot-check of a flagged song's slides** — pick one CHECK-badged song and confirm the
   imported slide breaks match what EasyWorship shows on screen for that song.

## If a real church already imported with the OLD importer, before this correction

**Do not just re-run the import over an existing library after upgrading to this correction.**
It will silently produce a mix of skipped-and-uncorrected songs and duplicated songs, not a
clean re-import.

Why: the dedupe key (`importKey.ts`) is built from a song's title plus its post-split lyrics.
`splitToSlides` promotes a section's first line to a label and strips it out of the lyrics
before the key is built. This correction moves where EasyWorship's slide boundaries fall (see
the design spec's "Finding 2" and "Finding 3"), so for any song where a boundary now lands on
what becomes a label line, the text handed to the dedupe key changes even though the song
itself did not. Measured example: for the RTF
`{\rtf1\ansi Amazing grace\line\line Chorus\line Praise God\par}`, the OLD importer produced
the dedupe key `amazing grace praise god` (the old code flattened `\line\line` into a slide
break, promoting "Chorus" to a label and stripping it from the key's lyrics); this correction
produces `amazing grace chorus praise god` (the `\line\line` no longer breaks the slide, so
"Chorus" stays inside the first section as a lyric line and enters the key).

Consequence, re-running the import after upgrading:
- A song whose split did **not** change re-imports with the same key as before → seen as a
  duplicate → **skipped**. It never receives the correction; the church keeps the OLD,
  possibly-wrong slide breaks for that song, forever, unless someone notices and removes it
  by hand.
- A song whose split **did** change re-imports with a different key → seen as new →
  **imported a second time**, leaving two copies of the same song with two different slide
  breaks in the library, and no indication to the operator that this happened.

This is strictly a **cross-version** effect. Within a single version of the importer, running
the import twice against the same library remains idempotent (`songImport.test.ts` pins this).
It is only re-running *after upgrading the importer itself* that is unsafe, because the
definition of "the same song" (the dedupe key) shifted underneath already-imported data.

We deliberately did not fix this in code — see the design spec's "Cross-version re-import"
subsection for why a split-insensitive dedupe key is not the answer.

**Operator guidance:** anyone who already ran the OLD (pre-2026-08-04) importer against a real
EasyWorship library should **delete those imported songs from Helm and import fresh** with the
corrected importer, rather than re-running the import over them.

The rest of this note is the original, pre-correction handoff and is kept for history.

---

## What to do first, on the Windows machine

The whole feature rests on a schema nobody has seen. It is corroborated by two independent
open-source tools ([`ew61-export`](https://github.com/jamesinglis/ew61-export), PHP, EW 6.1;
[`ew-song-importer`](https://github.com/Jacqueb-1337/ew-song-importer), Python, EW 7) but not
by a real file. Before importing anything:

1. Find the library — usually
   `C:\Users\Public\Documents\Softouch\EasyWorship\Default\Databases\Data\`.
2. **Copy it somewhere else and work on the copy.** The app already copies before reading, but
   there is no reason to point it at the only original.
3. Dump the schema:
   ```
   PRAGMA table_info(song);   -- expect: song_item_uid, title, author, copyright, a CCLI field
   PRAGMA table_info(word);   -- expect: song_id, words
   ```
4. Dump one real `words` value. Confirm it is RTF, note whether the column is **TEXT or BLOB**,
   and look at how slide breaks actually appear.
5. Check whether a song ever has **more than one `word` row**.
6. Confirm neither table is `WITHOUT ROWID` — both queries select `rowid`, and the lyric query
   orders by it, so a `WITHOUT ROWID` table would fail the whole import with
   *"no such column: rowid"*. The `PRAGMA table_info` output above answers this.

Items 4 and 5 are the two the code guesses at. Both are already handled defensively — a BLOB
is decoded as UTF-8, and multiple rows are concatenated as separate stanzas rather than
overwriting — but neither has met real data.

If the schema differs, **only `src/main/importSources/easyworship.ts` changes.** The RTF
stripper, tidy rules, dedupe key, orchestrator and wizard know nothing about EasyWorship. That
isolation was the point of the design and a reviewer confirmed it holds.

## Then

Run the import against the copied library, and compare a handful of songs — especially long
ones and any with unusual characters — against what EasyWorship shows on screen. Check the
review step's stanza counts look plausible before committing the import.

## The two hazards already handled — do not "simplify" these away

**Custom collation.** EasyWorship declares `UTF8_U_CI` on its text columns, and no Node SQLite
driver can register it. Verified directly: a bare `SELECT rowid, title, author FROM song`
works, while `ORDER BY title` and `WHERE title = ?` both throw *"no such collation sequence"*.
The adapter therefore sorts in JavaScript. The committed fixture at
`src/main/importSources/__fixtures__/ew/` declares that collation precisely so a test fails if
anyone adds a `WHERE` or `ORDER BY`. It cannot be regenerated from Node — stock SQLite refuses
to create such a table — so `make-fixture.py` beside it is the only way to rebuild it.

**Locked files.** EasyWorship holds its databases open. The adapter copies both to a temp
directory, opens the copies read-only, and deletes them in a `finally`.

## What was verified, and how

- **518 unit tests.** The pure units (RTF stripping, tidy rules, dedupe key) are tested
  directly; the adapter runs against the committed fixture; the orchestrator runs against a
  real in-memory SQLite via `openTestDb()`.
- **The real Electron app, 19/19 checks** (throwaway user-data dir, native folder dialog
  stubbed at the main-process boundary). The one that mattered: a word appearing **only** in
  the imported RTF lyrics is findable through the app's real search path — proving the import
  actually wrote the `song_fts` index, which no unit test can show.
- A pleasant accident: Helm seeds its own "Amazing Grace" and "Blessed Assurance" at first
  launch, so the real-app run unintentionally exercised the dedupe rule against same-titled
  different songs. Both imported correctly, distinguished by lyrics rather than title — which
  is exactly the behaviour the title-and-lyrics key was chosen for.

## Known, deliberately deferred

- A **truncated** first `word` row ending inside an unclosed RTF skip destination leaves the
  stripper's skip flag set and swallows the next row's lyrics. Needs a corrupt blob; the song
  still imports non-empty. Revisit if real libraries turn out to use multi-row `word` tables.
- `importKey` joins title and lyrics with a NUL, and the stripper can emit a raw NUL from a
  malformed control word. A false duplicate would need a NUL in a *title*, which comes from a
  SQLite text column and never through RTF.
- The scan token is discarded when a new scan starts but not when the wizard is closed, so a
  cancelled review holds its parsed lyrics in main until the next scan.
- The review step is informational — no per-song opt-out. If someone wants to skip 40 years of
  Christmas carols, that is the next increment.
- Copyright and CCLI number are read past, not stored: Helm has no field for them. The
  EasyWorship library still exists, so a re-import recovers them if Helm ever grows one.
