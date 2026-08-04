# Helm — Correcting the EasyWorship import against verified EW8 data

**Date:** 2026-08-04
**Amends:** [2026-07-30-song-library-import-design.md](2026-07-30-song-library-import-design.md)
**Source:** `EasyWorship8-Library-Spec.md` — schema and measurements taken by direct
inspection of three real, in-use EasyWorship 8 libraries on Windows 11.

---

## Why

The original design said, in *Verification on Windows*:

> The Mac has no EasyWorship library, so the format assumptions above are researched
> rather than observed… If anything differs, only `main/importSources/easyworship.ts`
> changes.

We now have observed data. Most assumptions held. Several did not, and one of the
things that differs is **not** confined to the adapter — the slide-splitting bugs live
upstream of it, in how RTF is flattened to text.

This document records what the real data confirms, what it contradicts, and the
correction. It does not re-litigate the parts of the original design that survived.

## What the real data confirms

These were researched guesses that turned out right, and are now settled:

- EasyWorship 6.1+ stores its library as plain SQLite; `Songs.db` → `song`,
  `SongWords.db` → `word`, joined `word.song_id = song.rowid`, lyrics as RTF.
- **The collation hazard is real.** `UTF8_U_CI` is declared on the text columns,
  `better-sqlite3` still cannot register it, and the spec independently recommends our
  exact mitigation as its *preferred* option: issue no `WHERE`/`ORDER BY`/`DISTINCT`
  against a collated column and sort in JS. The existing test that pins this stays.
- **`\uN` and `\line` both matter** — 121 and 91 songs respectively in the larger
  library. `rtfToText` already handles both. Library B alone would have suggested
  neither was needed; it has zero of each.
- cp1252 is the right decoding for `\'xx`.
- Copying the files and opening the copies read-only is right; EasyWorship does hold
  them open.
- Pre-2009 Paradox libraries are correctly out of scope.

## What it contradicts

Seven findings, ordered by consequence.

### 1. `EW_DEFAULT_PATH` points at a folder that cannot exist

The real layout is `<Profile>\<VersionDir>\Databases\Data\`. Our constant omits the
version directory entirely. Worse, none of the three variable segments may be assumed:

- `Easyworship` is spelled with a **lowercase `w`** on disk.
- The profile is **not always `Default`** — the spec's machine held its real 1,997-song
  library in `Default_1`, with a separate 223-song library in `Default`.
- The version directory is not always `v6.1`; `Default_1` contained both `v6.1` and
  `v6.1.2`.
- **`Default_1\v6.1.2` has a complete schema and zero songs.** It is stale state. Rank
  candidates by row count, never by version string.

The last point is the dangerous one. A user browsing manually has no way to tell the
empty library from the real one, and importing the empty one succeeds.

### 2. The slide split is wrong, and silently so

Spec §4.2 rule 2, proven against Library A song_id 98: a paragraph is a slide break
**only when it is exactly the empty string**. A paragraph containing a single space is
content, and EasyWorship records one slide for it, not two.

We destroy that distinction twice over:

- `importTidy` rule 2 strips trailing whitespace per line, turning `" "` into `""`.
- `splitToSlides` then splits on `/\n\s*\n/`, which would treat a whitespace-only line
  as a break regardless.

Spec §4.3 note 2 flags this precisely: *"This single space is exactly what distinguishes
a break from content. Get this wrong and you mis-split."*

### 3. `\line` is flattened into `\par` — the same bug, second instance

`rtfToText` maps `\par`, `\line` and `\sect` all to `\n`. But `\line` is a **soft** break
*within* a paragraph and can never break a slide; only `\par` can. A `\line\line` used as
a visual gap mid-stanza therefore flattens to a blank line and reads downstream as a
slide break.

This was not in the spec's list of traps — it follows from §4.3 combined with our own
implementation. 91 songs in Library A carry `\line` at all.

**Findings 2 and 3 share one root cause: paragraph structure is flattened into a string
before slide rules are applied.** The information needed to decide is gone by the time
anything tries to decide. The fix addresses the cause, not the two symptoms.

### 4. `word.slide_uids` gives the true slide count, free, and we ignore it

`slide_uids` is a comma-separated GUID list, one per slide — authoritative, already in a
row we read. The spec measures splitting rules like ours at **97.65%** (Library A) and
**99.55%** (Library B). Without the cross-check, the remaining ~2% is invisible; with it,
it is a review queue of roughly 47 songs in 2,000.

### 5. The multi-`word`-row append is disproven

`SongWords.db` declares `CREATE UNIQUE INDEX word_song_id ON word (song_id)`, and the
spec verified exactly one `word` row per song in both libraries with no orphans in either
direction. Our append branch guards a hypothesis that is now known false, and were it ever
to fire it would fuse two songs into one.

### 6. Titles are dirty beyond trimming

**869 of 1,997 titles (43%) in Library A contain runs of two or more spaces** —
`'A Child Of The King      (Eb)'`. We only `.trim()`. Also 13 with trailing whitespace and
31 case-insensitive duplicate titles.

The duplicates confirm our dedupe rule: the spec says *"Duplicate titles are normal. Do
not dedupe on title."* We key on title **plus lyrics**, which is correct and unchanged.

### 7. No schema-drift guards

Spec §2.4 is its most emphasised finding: two libraries reporting the *same* schema version
`6.5.1.0` differed in 15 columns and tables, including `song.provider_id` being absent
entirely. `SELECT *` and hardcoded column lists are unsafe; introspect at runtime.

We are accidentally safe today, reading only `rowid`, `title` and `author` — universal in
every sample. We stop being safe the moment we read one more column, which this change does.

---

## Design

### 1. Keep paragraph structure until the slide rules have run

`shared/songs/rtfToText.ts` gains a sibling export over the same scanner:

```ts
export function rtfToText(rtf: string): string          // unchanged; existing tests hold
export function rtfToParagraphs(rtf: string): string[]  // \par and \sect split; \line → \n
```

New pure unit `shared/songs/ewSlideBreaks.ts` applies spec §4.2 to that array. Rule 1 of
the spec — *parse to a list of paragraphs* — is `rtfToParagraphs`' job; this unit
implements rules 2 through 5, renumbered below:

```ts
export function ewSlideBreaks(paragraphs: string[]): { slideCount: number; text: string }
```

Rules, verbatim from the spec:

1. A paragraph is a slide break **iff** it is exactly `''`.
2. A run of consecutive empty paragraphs is a single break.
3. A break at the very start still yields a leading slide (song_id 34: EasyWorship
   records 6 slides for 5 content sections).
4. Trailing empties yield no trailing slide.

`slideCount` is the EasyWorship-faithful count — including any leading empty slide — so it
is directly comparable to `slide_uids`. `text` is import-ready: one blank line per break,
space-only content lines dropped, empty slides omitted.

Dropping space-only lines rather than preserving them is deliberate. They carry no lyric,
and `splitToSlides` filters empty lines out of a section regardless, so preserving them
would change nothing downstream while leaving a second chance to be misread as a break.

Because `text` now guarantees that a blank line means a slide break and nothing else does,
**`importTidy` and `splitToSlides` need no change.** The adapter pipeline becomes:

```
rtfToParagraphs → ewSlideBreaks → importTidy → (commit) splitToSlides
```

This matters for blast radius: `splitToSlides` is shared by `QuickAdd`, `songsRepo`,
`songImport` and `importKey`, where a whitespace-only line *should* read as a break —
a person typing lyrics does not intend a stray space as content. Its contract is correct
for hand-entered songs and must not change. `rtfToText` and `importTidy` each have exactly
one non-test caller, the adapter, which is what makes the pipeline change safe.

### 2. `slide_uids` as the cross-check

The adapter reads `word.slide_uids`, counts its comma-separated GUIDs, and compares that
to `slideCount`. On disagreement the review row carries `expectedStanzas`.

This is a **separate field, not a status**. Status (`new` / `duplicate` / `unreadable`) is
a set of exclusive states; a song can be `new` *and* disagree about its structure. The
wizard renders a badge; commit still imports the song. A flagged song is one to look at,
not one to drop.

### 3. Locate — forgiving, verifying, ranked

One browse action remains, but it accepts a folder at any level — the `Data` directory, a
version directory, a profile directory, or the EasyWorship root — and searches downward
for `Songs.db` + `SongWords.db` co-presence, matched case-insensitively.

The search is bounded to **four directory levels** below whatever the user picked. That is
exactly the distance from the EasyWorship root to `Data`
(`<root>/<profile>/<version>/Databases/Data`), so picking the topmost sensible folder still
finds every library, while pointing the wizard at a home directory cannot turn into an
unbounded disk walk. `Resources\`, `Datacache\`, `Archive\` and `Locks\` are skipped by
name; they never contain a library and `Archive\` may contain a misleading one.

Each candidate is copied to temp and counted. Zero-song candidates are dropped. If more
than one survives, a picker shows profile, version (from `version.dat`) and song count;
otherwise the single survivor is used with no extra step. `defaultPath` opens the dialog
at the EasyWorship root when it exists.

`EW_DEFAULT_PATH` gains its missing version segment and becomes a **hint for the error
message and the dialog's starting point**, never a location that is assumed to exist.

Full unattended auto-detection (scanning the default root with no browse at all) is
**not** built. The forgiving browse plus ranking already delivers the property that
matters — you cannot silently import the empty `v6.1.2` — and keeps the operator in
control of which library is read.

### 4. Schema-drift guards

A small helper reads `PRAGMA table_info(<table>)` into a set and builds the select list at
runtime. `presentation_id` and `slide_uids` are read when present and treated as null when
not. Absent columns degrade; they never throw.

`presentation_id` is read for one reason: it is the diagnostic that decides whether Path A
(exact slides from `PresentationLayouts.db`) is ever worth building. The review step will
report how many songs have layouts and whether split mismatches cluster in them. The
spec's two real libraries were 22% and 0% layout coverage, so that answer cannot be
guessed from here.

### 5. Small corrections

- Remove the multi-`word`-row append; use a plain map keyed on `song_id`, and replace the
  speculative comment with the verified 1:1 fact and the UNIQUE index that enforces it.
- Collapse internal whitespace runs in titles in addition to trimming. Dedupe is
  unaffected: `importKey` already normalises `\s+` on both sides of its comparison.

### 6. Cross-version re-import (documentation only — not fixed in code)

This correction moves where EasyWorship's slide boundaries fall (Findings 2 and 3 above).
`splitToSlides` promotes a section's first line to a label and strips it from the lyrics before
`importKey.ts` builds its dedupe key from title + lyrics. When a moved boundary now lands on a
line that becomes a label, the text fed to the key changes even though the song itself did not.

Measured: for `{\rtf1\ansi Amazing grace\line\line Chorus\line Praise God\par}`, the importer
shipped before this correction treated `\line\line` as a slide break, promoted "Chorus" to a
label, and produced the key `amazing grace praise god`. This correction does not break the
slide on `\line\line` (only `\par` breaks a slide — Finding 3), so "Chorus" stays in the first
section as a lyric line and the key becomes `amazing grace chorus praise god`.

Consequence for a church that already imported with the OLD importer and then re-imports after
upgrading: songs whose split did not change are seen as duplicates and **skipped** — they never
receive the correction — while songs whose split *did* change are seen as new and **imported a
second time**, leaving two copies with different slide breaks. This is strictly a
**cross-version** effect; within one version the import stays idempotent.

**No migration is required for this correction.** The pre-correction importer shipped but was
never run against a real EasyWorship library — the Windows verification had not happened yet —
so no stored song anywhere carries a dedupe key built under the old rules. The hazard above is
real but was never realised.

We are not fixing this in code, and the reason outlives this correction. A split-insensitive
dedupe key would break the scanned-vs-stored key equality that `importKey.test.ts` deliberately
pins, trading a one-time migration hazard for a permanent weakening of the dedupe guarantee.

The durable lesson is the property itself: **the dedupe key depends on where slide boundaries
fall.** Any future change to slide splitting — importing EasyWorship's exact layouts (Path A)
is the obvious candidate — reintroduces this hazard for every library imported before it, and
will need the migration guidance that this time was unnecessary. That guidance is kept in
`docs/superpowers/notes/2026-07-31-song-import-windows-handoff.md`.

## Deliberately declined

Each of these is a spec recommendation we are choosing not to follow, with the reason.

**`CAST(words AS BLOB)`.** The spec recommends it so `better-sqlite3` yields bytes rather
than a UTF-8-decoded string. But it is only the correct choice if Delphi wrote cp1252
bytes into that column; if it wrote UTF-8, casting and then cp1252-decoding produces
mojibake where the current path is correct. The spec's own measurement settles the
practical question: **zero raw bytes above 127 across all 2,220 songs in both libraries**,
because all non-ASCII is escaped as `\uN` or `\'xx`. The two paths are indistinguishable
on real data, and `wordsToText` already handles both return types. Changing it would trade
one unverifiable guess for another.

**Zero-slide songs as title-only stubs.** The spec suggests importing them flagged; we keep
classing them `unreadable`. One song in 1,997, and a named failure the operator can act on
is better than a silent blank in the library. The Done step already names it.

**Trailing `(Key)` parsing and `''` → null.** Helm has no key field, and the two fields we
import (`title`, `author`) already treat `''` as absent.

**Path A, `.ewsx` packages, `Media.db`, `Collections.db`, themes.** Out of scope, per the
original design and the scoping decision above. Path A is deferred pending the
`presentation_id` diagnostic this change produces.

## Error handling

Unchanged in character — one bad song never aborts a run, nothing is written before
review, temp copies are removed in a `finally`. Additions:

| Situation | Behaviour |
| --- | --- |
| Browsed folder contains no `Songs.db` + `SongWords.db` pair at any depth | Typed error naming the expected path shape. Nothing written. |
| Every candidate found has zero songs | Typed error saying so explicitly, distinct from "not found" — this is the stale-`v6.1.2` case and must not read as a missing library. |
| More than one non-empty candidate | Picker. No default selection; the user chooses. |
| A candidate fails to open or count | Dropped from the list with a note, rather than failing the whole locate. |
| `slide_uids` column absent | No cross-check for that library; every row imports unflagged. |
| `slide_uids` present but unparseable on one row | That row imports unflagged. Never fatal. |

## Testing

**New pure units.** `ewSlideBreaks` against all four rules plus both proof cases the spec
names — the `" "` paragraph mid-song yielding one slide (song_id 98) and the leading `\par`
yielding six slides for five sections (song_id 34). `rtfToParagraphs` distinguishing
`\line` from `\par`.

**Extended adapter fixtures**, on the existing synthetic `node:sqlite` database: a
`slide_uids` count that disagrees with the split; a `song` table with no `presentation_id`
column; a `word` table with no `slide_uids` column; a directory tree holding two candidate
libraries where one has zero songs; a title with six internal spaces.

**Regression evidence.** The existing `rtfToText`, `importTidy`, `splitToSlides`, dedupe
and orchestrator tests must pass **untouched**. That is the check on the claim that the
pipeline change is confined to the adapter's path — if `splitToSlides`' tests need editing,
the boundary was drawn wrong.

Baseline before this change: 62 files, 526 tests, all passing.
