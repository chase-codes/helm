# Song keys — design (brainstorm stage)

**Date:** 2026-11-17
**Status:** Brainstorm. Recommends an approach and a phase order. Nothing here is built.
Every question that only the product owner can answer is in "Open questions for Chase"; the
phases are written so each one ships on its own.

## Problem

Musicians need each song's key. The column exists (`songs.music_key`, `src/main/schema.ts:18`)
and the leader view already prints it (`LeaderView.tsx:377`, "· Key G"), as does the
audience-variant lyric label (`SlideCanvas.tsx:411-414`, "Verse 1 · Key G"). But almost none
of the church's ~3,000 songs have one, and there is no good way to add them:

- The only editor is the 90px free-text "Key" box in the whole-song QuickAdd modal
  (`QuickAdd.tsx:255-261`). Getting to it takes a right-click, Edit, a scroll, a type and a
  Save changes per song.
- The value is free text, only `.trim()`ed. "capo 2 G" or "Bb maj" goes straight onto the
  leader view and the audience label.
- `songs:update` needs the whole song (`UpdateSongInput` requires `sections`,
  `src/shared/types.ts:15`), rebuilds FTS on every call, and clears the key when `key` is
  left out. There is no key-only or batch write.
- The EasyWorship import throws away the keys a library already has. One real library
  writes them into titles (`'A Child Of The King      (Eb)'`,
  `2026-08-04-easyworship8-import-correction-design.md:109`), and that parsing was put off
  because "Helm has no key field" (same file, :280). The field exists now. The CCLI number
  is read past as well (`easyworship.ts:392-400` selects only rowid, title, author and
  presentation_id).

**Who fills them in.** Dana, a volunteer music director, works in 15-minute weeknight
bursts from memory, old charts and past setlists. She knows "we do Goodness of God in A",
not the recorded key, and she will never do all 3,000. She wants this Sunday right.
Marcus, a guitarist and second leader, thinks in capo shapes ("capo 2, G shapes" means the
song sounds in A) and sings some songs lower than Dana. Full personas are in the research
notes. Two facts shape everything below:

1. **Most of the 3,000 never need a key.** A church sings 100 to 200 songs a year. The job
   is the songs in use, then the long tail if anyone cares.
2. **A wrong key is worse than a blank.** A musician trusts what the leader view says. Every
   automatic source is labelled and reviewed. Nothing overwrites a key a person set.

## Findings that change the brief

Checked against the code on 2026-11-17. The research is right on the data model and the
import, but three things it assumed are not true:

- **Helm has no song schedule and records no song usage.** `service_items` holds only the
  `'scripture'` and `'quote'` kinds (`scheduleRepo.ts:20`, `messagesScheduleRepo.ts:19`),
  all under one `'default'` service whose date is `''` (`serviceItemsStore.ts:31-36`). There
  are no past services and no "upcoming plan" to rank by. A usage-ranked queue needs usage
  capture, built here (Phase 1). Until that has run for a few Sundays, the ranking has
  nothing to go on, so search has to be the main way in.
- **The title-suffix pattern has one documented example, not a measured count.** The
  "869 of 1,997" figure in the EW correction spec counts titles with runs of spaces, not
  titles with keys. How much an import harvest gains is unknown until someone looks at the
  real library (Phase 0).
- **The EasyWorship CCLI column name is our guess.** `ccli_no` comes from our own fixture
  (`__fixtures__/make-fixture.py:46`). The Windows handoff note only expects "a CCLI field"
  (`2026-07-31-song-import-windows-handoff.md:92`). Read it behind the same `columnsOf`
  guard `author` already uses.

Two more facts matter for the design:

- **A re-import cannot backfill.** The dedupe key is normalised title plus lyrics
  (`importKey.ts:8-11`), so a song that is already in the library is skipped, and its key
  and CCLI number are never read. That note ("a re-import recovers them",
  handoff :155-156) only holds if matched songs get their blank fields filled. Phase 1d does
  that.
- **Removing "(Eb)" from titles changes the dedupe key.** A song imported earlier as
  "A Child Of The King (Eb)" would not match the same song re-scanned as "A Child Of The
  King", so it would import twice. Phase 1d says how the key is built so that cannot happen.

## Options considered

### Where keys come from

| Source | Coverage for this church | Accuracy | Gives | Offline | Effort | Verdict |
|---|---|---|---|---|---|---|
| Typed by Dana/Marcus | the songs in use | exact (it is the church's key) | church key | yes | low | **Phase 1**, the base everything else feeds |
| EW title suffix "(Eb)" | unknown until Phase 0 | high, with a few false positives such as "(F)" for female | church key | yes | low | **Phase 1d** |
| EW CCLI column | probably most songs | exact | a match key, not a key | yes | low | **Phase 1d**, so Phases 2 and 4 can match |
| CSV round-trip (export the gaps, fill in a spreadsheet, import) | whatever the church's people know | exact once matched | either | yes | medium | **Phase 2**. It is the only path that works away from the booth machine |
| Other planners' CSV (PCO, Elvanto, WorshipTools) | depends | exact | church key | yes | medium (same parser) | rides on Phase 2 |
| Chart files: ChordPro `{key:}`, OpenLyrics `<key>`, OpenSong `<key>`, SongSelect `.usr` `Keys=` | only if the church keeps charts | exact | chart key | yes | low to medium | **Phase 3** |
| Key detected from chords in the lyrics | low for an EW library, since projection lyrics rarely carry chords | ~90% in the literature; mixes up relative minors | chart key | yes | low | **Phase 3**, for imported charts only, labelled "Detected from chords" |
| Planning Center Services API | zero: the church does not use PCO (answered 2026-11-17) | exact | church key per arrangement | one-time sync | medium | **Deferred**; Phase 4 only if a future church needs it |
| SongSelect API | — | — | original key | no | — | **Ruled out**: the partner program takes no new partners, and scraping is forbidden |
| Spotify, AcousticBrainz, Tunebat, Chordify, Hooktheory, Musixmatch | patchy | 70–80% | recording key | no | — | **Ruled out**: closed, shut down, no API, or terms risk |
| LLM guess | broad | makes up keys for obscure songs | either, can't tell which | no | low | **Ruled out** for filling. Breaks "a wrong key is worse than a blank" |
| Hymnary.org | hymns only | one hymnal's key | hymnal key | snapshot | medium | Deferred. The data is not open, so ask first |

### How keys get entered

| Pattern | Good for | Fails when | Verdict |
|---|---|---|---|
| Search, pick, Enter, next (one song at a time, its first lines showing) | Dana: she knows which songs she wants | — | **Phase 1** core |
| A queue ranked by recent use | everyone, once usage exists | there is no usage at first | **Phase 1**, gets better every Sunday |
| A key slot on every library row plus right-click Set key | the operator in rehearsal, when someone calls out a key | — | **Phase 1** |
| A key button on the hero for the cued song | catching a key at the moment it matters | a mid-service click | **Phase 1b**, never touches the screen |
| Inline grid: type in a cell, Enter moves down | a confident laptop user | typing into the wrong row, and a 3,000-row grid is daunting | Rejected. The spreadsheet half of Phase 2 is where grid people go |
| Multi-select, then apply one key | rare (few songs share a key on purpose) | mass mistakes; the library is barred from multi-select (grammar rule 4) | Rejected |
| A progress bar over the whole library | — | "212 / 3,000" is discouraging | Rejected. Progress is scoped ("Sung lately: 9 of 14") |
| Accept/reject suggestions | one-click confirms | a recorded key read as the church key | Phase 3, when there is a source to suggest from |

## Recommended approach

- **One church key per song, stored as one of 24 canonical spellings**, with where it came
  from beside it. Messy input becomes canonical at every way in, through one pure
  function (the appendix). This ends "capo 2 G" on the leader view.
- **A fast picker, available in every place a song already is.** The same 12-button +
  Major/Minor picker, with typing shortcuts, opens from the QuickAdd editor, from
  right-click Set key on a library row, from the hero, and from a dedicated **Song keys**
  window built for short sessions. One click or one Enter saves.
- **Get back the keys the library already has.** Pull title suffixes and CCLI numbers
  in on import. Let re-import fill blanks on songs already in the library. Run the same
  extraction once over songs already imported. Everything goes through a review list first.
- **Rank by what the church actually sings**, using usage Helm starts recording from now
  on, and keep search first in the meantime.
- **Then open the doors in order of what the church has:** CSV round-trip, which works
  from home; then chart files. Planning Center is deferred (the church doesn't use it).
  Nothing is auto-guessed.

## Phases

Each phase is useful on its own and assumes only the ones before it.

### Phase 0 — Measure the real library (no product code)

The 3,000-song library is not on this Mac. The local `helm.db` holds 11 songs and no keys.
Before Phase 1d, run a read-only diagnostic on a copy of the church's EasyWorship `Songs.db`
(and on their Helm DB, if one exists). It should report:

- total songs;
- titles whose trailing bracket parses as a key (appendix B, title mode), broken down by key;
- how often `(F)`, `(M)`, `(A)`, `(B)` appear (the false-positive check);
- titles that differ only by a key suffix (`Song (G)` and `Song (Bb)`), which is the
  per-leader signal;
- how many CCLI numbers are filled in, and the column's real name;
- how many copyright fields contain "CCLI";
- how many lyrics have chord-only lines.

This sets how much Phase 1d is worth and answers open questions 3 and 5. It can be a
throwaway script, or an `extractKeyFromTitle` dry run once that function exists.

### Phase 1 — Canonical keys and fast manual entry

Ship in this order. Each slice can merge on its own.

**1a. Data model and writes.**
- `src/shared/songs/musicKey.ts`: `normalizeKey`, `extractKeyFromTitle`, `normalizeCcli`,
  and the `MusicKey` union of the 24 spellings. All pure. The appendix tables become their
  unit tests, row for row.
- Columns (added with the existing one-off pattern in `db.ts:10-12`, made into a list):
  `music_key_source TEXT NOT NULL DEFAULT ''`, `key_skipped_at INTEGER`,
  `ccli_no TEXT NOT NULL DEFAULT ''`, `last_live_at INTEGER`,
  `live_days INTEGER NOT NULL DEFAULT 0`.
- IPC: `songs:setMusicKey(id, key | null, source)` returns the `Song`. It touches only
  the key columns, with no FTS rebuild, because the key is not in FTS
  (`schema.ts:6`). Then `songs:setMusicKeys(batch)`: one transaction, which may also carry a
  new title for the title sweep. A changed title must update `song_fts.title` in the same
  transaction. Then `songs:skipMusicKey(id)`, and `songs:keyList({ tab, q })`: light rows
  (`id, title, author, firstLine, key, keySource, liveDays, lastLiveAt, skippedAt`), so the
  window never pulls 3,000 full songs.
- On startup, existing `music_key` values go through `normalizeKey`. A value that parses is
  rewritten to its canonical spelling. A value that does not parse is kept as typed (never
  destroyed), marked `music_key_source = 'legacy'`, and listed under **No key** with
  "Was: capo 2 G" so a person decides.
- Naming: new code says `musicKey`, never bare `key`. That word already means `liveKey`,
  `cuedKey`, `importKey`, React keys and settings keys in this codebase. `Song.key` stays as
  it is for compatibility.

**1b. The picker, everywhere a song already is.**
- `KeyPicker`: two rows of six buttons in chromatic order, C Db D Eb E F / F# G Ab A Bb B.
  Each button is fixed-size. An ambiguous pitch shows its other spelling small underneath
  (Db/C#, F#/Gb, Ab/G#, Bb/A#). A `Major | Minor` toggle switches all twelve labels (C#m,
  Ebm, G#m and so on, per appendix A). Then `Capo…`, `Clear key`, and in the Song keys
  window `Skip`. Typing works too: a letter picks the root, `b` or `#` changes it, `m` toggles
  minor, Enter saves. The highlighted button always shows what Enter will save.
- `Capo…` opens one line: "Capo [2] playing [G] shapes → Key **A**". It saves the sounding
  key. The capo itself is not stored (open question 9).
- QuickAdd: the 90px free-text box becomes a key button that opens the picker as a
  popover. "Save changes" still saves the whole song, as it does now.
- Song rows (`SongSearchRail.tsx` `SongRow`): a fixed-width key slot at the right of the
  row (rule 5). It shows the key in `T.dim`, or nothing. A missing key is not a warning, so
  there is no colour and no nag.
- Right-click a song row: `Edit`, **`Set key`**, `Delete from library`. Set key opens the
  picker anchored to the row. One row only (rule 6).
- Hero (Songs page, the cued song): the meta line reads `Key Eb`, or a faint **`Set key`**
  button when there is none. Clicking either opens the picker. Nothing in the picker
  calls `applyCue`, `takeLive` or `goLive`, so it can never touch the screen.

**1c. The Song keys window and usage capture.**
- Usage: when the audience output goes live with a song key (`song:<id>:<n>`, parsed by
  `parseSongKey`, `core.ts:22`) and the song differs from the last one that went live, main
  sets `last_live_at`. It adds one to `live_days` when the previous `last_live_at` was on
  another calendar day. Going live counts. Cueing does not.
- Entry point: a secondary row under `+ Import a song library` on the Songs rail, reading
  **`Fill in song keys`**. It opens the **Song keys** window (`ModalShell`, fixed frame).
- Left side: a search field (focused on open) and three tabs. **No key** (with a count)
  is ordered by `live_days` desc, then `last_live_at` desc, then title, with skipped songs
  at the end. **Sung lately** covers the last 8 weeks, with or without keys, so keys can be
  checked as well as filled. **All**. The list is windowed (`useWindowedList`, fixed row
  height).
- Right side, for the selected song: title, author, its first two lyric lines (so Dana
  knows it is the right "Cornerstone"), the picker, `Skip`, and the source when there is
  one ("From the title in EasyWorship").
- Saving a key on **No key** moves to the next song. On the other tabs it stays put. If a
  save replaced a different key, a toast reads `Key changed to A` with Undo for five
  seconds (`useTimedUndo`).
- Progress is scoped and one line, truncated: "Sung lately: 9 of 14 have a key." Before
  any usage exists: "Helm hasn't seen a song go live yet. Search for this Sunday's songs,
  or start at the top." There is no whole-library meter.

**1d. Get back what the library already has.**
- EasyWorship scan: read the CCLI column behind a `columnsOf` guard. If it is empty, use
  `normalizeCcli` on the copyright field. Run `extractKeyFromTitle` on each title.
  `ScannedSong` gets `musicKey?`, `ccli?` and `titleKeyNote?` (for modulation and two-key
  flags). The commit sends them through `addBatch`.
- Review step: one more line, "Keys found in 412 song titles. They'll move from the title
  to the song's key." A **See them** link opens a list of title, then key, then the cleaned
  title, with every row checked and any row can be unchecked. Flagged rows (modulation,
  two keys, the single letters F, M, A and B) sit at the top.
- The dedupe key becomes `normalize(cleanTitle) NUL musicKey NUL normalize(lyrics)`, built
  the same way on both sides. On the stored side, `musicKey` is the song's key, or the one
  parsed from its stored title if it has none. Why: "X (Eb)" stored before this change
  still matches "X (Eb)" re-scanned, and `X (G)` and `X (Bb)` (two leaders' copies with the
  same lyrics) stay two songs. Pin both cases in `importKey.test.ts`.
- Re-import fills blanks. A song the scan finds already in the library, whose key or CCLI
  number is empty, gets the scanned value. A key a person set is never overwritten. The
  Done step counts these separately: "Filled in 37 keys on songs already in your library."
- Library sweep, for a church that imported before this shipped: if any stored title
  parses as ending in a key, the Song keys window shows one line at the top: "412 titles
  end in a key, like *A Child Of The King (Eb)*." The button **`Move keys out of titles`**
  opens the same review list. Applying it is one `setMusicKeys` batch, followed by
  `Moved 412 keys` with Undo for five seconds, which restores every old title and key.

### Phase 2 — CSV round-trip

This is the path for Dana at home, since Helm lives on the booth machine (open question 2).

- **Export**: `Export songs without a key…` in the Song keys window. It writes
  `title, author, ccli, first line, key`, with `key` blank and the rows ordered as the No key
  tab orders them. Dana fills in the key column in Excel or Google Sheets.
- **Import**: `+ Import keys from a spreadsheet` in the Song keys window. It reads CSV with
  any column order. A header is matched by name (`title`/`song`, `author`/`artist`,
  `ccli`/`ccli #`/`song number`, `key`/`default key`/`church key`). Also accepted: PCO's
  song export, plus Elvanto and WorshipTools columns wherever a column maps.
- Each cell goes through `normalizeKey`, and each row is matched by appendix C. The review
  sorts rows into **Ready** (checked), **Pick one** (ambiguous or fuzzy, unchecked until a
  candidate is chosen), **Already has a different key** (kept as Helm's unless switched),
  **Not a key** (the cell, and why: "two keys", "capo: which is it?"), and **Not found**.
  Applying is one batch with a `Set 128 keys` Undo.
- Source recorded as `'csv'`.

### Phase 3 — Chart files and chord detection

Only worth it if the church keeps chord charts (open question 8).

- Import ChordPro (`{key:}`), OpenLyrics (`<key>`), OpenSong (`<key>`) and SongSelect
  `.usr` (`Keys=`) as key sources. They match an existing song by appendix C and set its
  key, or come in as new songs.
- For a chart with chords and no key field, score all 24 keys by chord fit (I, IV, V and vi
  weighted, a bonus for the first and last chord, major wins ties). Offer the result as a
  **suggestion**, labelled "Detected from chords" and never applied without a click. This
  phase brings the first "suggested, not confirmed" state, so it needs a theme token for it
  (rule 8). It is not in Phase 1 on purpose.

### Phase 4 — Planning Center Services sync (deferred)

Deferred: Chase confirmed on 2026-11-17 that the church does not use Planning Center.
Kept here only for a future church that does; the CSV round-trip (Phase 2) already accepts
a PCO song export.

- Personal access token first, for one organisation (Settings → Planning Center, pasted by
  Chase or an admin, not by an agent). OAuth later if it is ever distributed.
- Read-only pull: songs, then arrangements, then keys. Take each arrangement's
  `starting_key` and `chord_chart_key`. Match by CCLI first, then appendix C. One review
  list like Phase 2's, source `'pco'`.
- PCO holds several keys per arrangement, with names such as "Dana" or "Men". With a
  single-key model, the review asks which one becomes the church key. That is the moment
  to revisit per-leader keys (open question 3).

### Not planned

Transposition and chord display (the display spec excludes them,
`2026-08-06-display-views-formatting-design.md:41`); storing copyright for CCLI reporting
(a separate feature, though Phase 1d makes it easy); LLM guesses; any SongSelect, Spotify or
other scraping.

## Data model decision

**Recommended: one church key per song.** The column is `music_key`, holding a canonical
`MusicKey` or `''`. Beside it go `music_key_source` (`typed`, `title`, `import`, `csv`,
`pco`, `chart`, `detected`, `legacy`) and `key_skipped_at`.

Why:

- Every place that reads a key (leader view, audience label, hero) shows one key.
- Dana's mental model is one key per song: "we do it in A".
- EW churches already handle per-leader keys by keeping a copy per key, `Song (G)` and
  `Song (Bb)`. With the Phase 1d dedupe rule, each copy keeps its own key.
- It needs no new table, and nothing about it blocks the next step.

**Alternative, ready when needed:** a `song_keys(song_id, label, key, end_key,
is_default)` table, with labels such as "Dana", "Men" or "Original". `music_key` becomes the
`is_default` row in a one-time migration with no loss. Do this if Chase says leaders often
sing the same song in different keys (open question 3), or when the PCO sync lands.

**Not now:**

- *Original/recorded key.* None of the sources we can reach supply it reliably, and it is
  the field most likely to be mistaken for the church key.
- *End key for modulations.* Kept in the title for now, and listed in review.
- *Capo.* We store the sounding key only.

Spelling is part of the value, not a separate display choice. The stored string is the
canonical spelling (appendix A). Pitch class and mode are derived from it when needed
(Phase 3's detector, Phase 4's comparison).

## UX grammar, rule by rule

Every new surface was checked against `docs/ux-grammar.md`:

1. **Red is on-air only.** No key surface uses `T.live`. A missing key gets no colour.
   "Was: capo 2 G" and the CSV review's reject reasons use `T.dim` text. They are not red,
   so this adds nothing to the Known gaps' "red as danger" debt.
2. **Transport is stable.** No key control sits in a transport bar. The hero's
   `Key Eb` / `Set key` lives in the meta line, not in the transport row. The meta line
   must keep its height whether or not a key is set.
3. **Click cues, double-click takes, Enter commits.** Inside the picker, clicking a key
   button saves it, because a button press is the commit. Typing only highlights, and Enter
   saves. In the Song keys window, a click selects a row. A double-click does nothing extra,
   and nothing in the window calls a screen verb. The modal guard in `keyDispatch.ts:71-76`
   keeps Enter from reaching Go live.
4. **Undo, not confirm.** Setting a key deletes nothing, so it never confirms. Replacing a
   key, the title sweep, and a CSV or PCO apply each give one `useTimedUndo` toast that
   restores the earlier values exactly. The review list before a batch is the look-first
   step. It is not a dialog.
5. **Fixed footprints.** The row key slot is a fixed width that fits `C#m`, and stays the
   same size when empty. The picker's buttons never resize when Minor relabels them. Button
   labels say what they do (`Set key`, `Move keys out of titles`, `Skip`). The Song keys window
   uses a fixed frame, and its progress line truncates.
6. **List kit parity.** The Song keys list is library-shaped. Like the song library (a
   deliberate non-adopter), it has no multi-select, no Delete key and no range. Right-click
   Set key is single-row, next to Edit. The window's rail resizes through `usePanelWidth` +
   `PanelDivider`.
7. **Empty is an invitation.** An empty library: "No songs yet. Bring them in with **+
   Import a song library**." A finished No key tab: "Every song has a key. Check the
   ones you sing on **Sung lately**." No search match: the existing no-match line.
8. **Theme tokens only.** `T.dim`, `T.faint`, `T.accent` for the selected button, and
   `railTint` for the selected row. Phase 1 adds no new meaning, so no new token. Phase 3's
   "suggested" state needs one.
9. **One keyboard.** In the Song keys window: `/` focuses search, Mod+Backspace clears
   it, ↑/↓ move rows, and letters, `b`, `#`, `m` and Enter drive the picker when focus is
   not in the search field. Escape steps back one layer at a time: closing the Capo… line,
   clearing a typed highlight, leaving the search field, then closing the window. It never
   reaches Take down while the window is open. Digits 1–9 do nothing in the window,
   because it has no schedule rows.

## Vocabulary

This uses existing words: **Edit**, **Save changes**, **Undo**, **Clear** (as in
`Clear key`), **+ Import**, **Library**, "click" never "tap". These are the proposed
additions to `docs/ux-vocabulary.md`, for Chase to approve. That file is not edited by this
spec.

| Word | Means | Where it appears |
|---|---|---|
| **Key** | The key the church plays the song in: the sounding key, what the band hears. Never the recorded key or a capo shape. Written `Key Eb`. | Leader view, audience label, hero meta line, row slot |
| **Set key** | Open the key picker for one song. | Right-click a song row, hero meta line |
| **Song keys** | The window for filling in and checking keys. Opened by `Fill in song keys`. | Songs rail secondary row, window title |
| **Skip** | Leave this song's key blank for now. It moves to the end of No key. | Song keys window |
| **No key / Sung lately / All** | The Song keys tabs. | Song keys window |
| **Major / Minor** | The picker's mode toggle. | Picker |
| **Capo…** | Work out the key from a capo position and chord shapes. | Picker |
| **Move keys out of titles** | Take "(Eb)" off song titles and make it the key. | Song keys window banner, import review |

## Risks

- **Wrong keys reach musicians.** Mitigations: canonical input only, a source on every
  automatic key, a review before every batch, never overwriting a typed key, and Undo.
- **Title false positives.** `(F)` and `(M)` may mean female and male leaders, and `(A)`
  and `(B)` may be versions. These single letters are flagged at the top of the review.
  Phase 0 measures them.
- **Duplicates on re-import from the dedupe key change.** Covered by the rule in 1d and two
  pinned tests. Anyone who touches `importKey` again should read the warning in the
  2026-07-31 handoff note first.
- **Shape key or sounding key.** "A capo 2" is rejected as ambiguous rather than guessed,
  and the `Capo…` helper makes it explicit.
- **Usage starts empty**, so the ranked queue is weak for the first few Sundays. Search
  carries Phase 1.
- **Dana may never sit at the booth machine.** Then Phase 1 helps the operator and Marcus,
  and Phase 2 is what reaches Dana. Open question 2 sets the order.
- **Enharmonic rewrites.** A church that writes "Gb" will see "F#". This needs a decision
  (open question 7) before 1a merges, because 1a rewrites stored values.
- **Rail performance.** `SongSearchRail` renders every row unwindowed (`:338`). The key slot
  adds one span per row, and the Song keys window must be windowed.
- **`songs:update` clears an omitted key.** Any new caller must pass the key, or use
  `setMusicKey`. Add a test that a section quick-edit keeps the key.
- **The real EasyWorship schema is unverified** (the CCLI column, and whether
  `songKeys.db` from a forum mention is anything). Phase 0 checks.

## Open questions for Chase

1. ~~**Does the church plan services in Planning Center?**~~ **Answered 2026-11-17: no.**
   Phase 4 is deferred; Phase 2 (CSV) stays the outside-data path.
2. ~~**Who fills in keys, and on which machine?**~~ **Answered 2026-11-17: the booth PC
   only.** The in-app Song keys window (1c) stays ahead of the CSV round-trip; Phase 2 is
   lower priority.
3. ~~**Per-leader keys?**~~ **Answered 2026-11-17: rarely; one church key per song is
   fine.** The single-key model stands. Phase 0 still reports `Song (G)` / `Song (Bb)`
   pairs, which stay as separate songs.
4. ~~**Is the 3,000-song library already imported into Helm?**~~ **Answered 2026-11-17:
   yes.** The library sweep in 1d (`Move keys out of titles`) is the main recovery path,
   ahead of import-time extraction. Phase 0 runs on a copy of the booth PC's `helm.db`
   first, and on the EasyWorship `Songs.db` only if CCLI numbers are needed.
5. **Can someone run the Phase 0 diagnostic** on a copy of their `Songs.db`?
6. ~~**Take "(Eb)" out of titles?**~~ **Answered 2026-11-17: yes.** Move it into the
   key, behind the review list and Undo.
7. **Spellings:** F# or Gb for the major key on that pitch? Ebm or D#m for the minor? The
   appendix recommends F# and Ebm. A library-wide preference is possible, but is it worth it?
8. **Does anyone keep chord charts** (ChordPro, OnSong, SongSelect downloads, PDFs)? If
   not, Phase 3 drops.
9. **Capo:** store only the sounding key (recommended), or also "capo 2" for the
   guitarist?
10. **Should the key keep showing on the audience-variant label** (`SlideCanvas.tsx:411`)?
    With 3,000 keys filled in, it will show everywhere that variant renders.

---

## Appendix A — Canonical key set

Twelve pitch classes, each with a major and a minor form, for 24 values. ASCII `#` and `b`
are stored and displayed, as in chart convention and the existing tooltip ("e.g. G or
Bb").

| PC | Major | Picker also shows | Minor | Picker also shows |
|---|---|---|---|---|
| 0 | `C` | | `Cm` | |
| 1 | `Db` | C# | `C#m` | |
| 2 | `D` | | `Dm` | |
| 3 | `Eb` | | `Ebm` | D#m |
| 4 | `E` | | `Em` | |
| 5 | `F` | | `Fm` | |
| 6 | `F#` | Gb | `F#m` | |
| 7 | `G` | | `Gm` | |
| 8 | `Ab` | G# | `G#m` | Abm |
| 9 | `A` | | `Am` | |
| 10 | `Bb` | A# | `Bbm` | A#m |
| 11 | `B` | | `Bm` | |

Why: majors use the flat spellings worship charts use (Db, Eb, Ab, Bb). Minors use the
spelling with fewer accidentals (C#m, G#m). The ties, F#/Gb and Ebm/D#m, are open question
7. Letter pitch classes: C 0, D 2, E 4, F 5, G 7, A 9, B 11. `#` adds 1 and `b` takes away
1, mod 12, so E# is F, B# is C, Cb is B, and Fb is E.

## Appendix B — Normalisation

### B1. `normalizeKey(raw, mode)`

The result is one of:

- `{ kind: 'key', key, endKey? }`
- `{ kind: 'empty' }`
- `{ kind: 'reject', reason }`, where `reason` is `'not-a-key' | 'two-keys' |
  'capo-ambiguous' | 'ambiguous-slash'`.

`mode` is `'field'` (typed, CSV, legacy column) or `'title'` (the content of a title suffix,
see B3).

Steps, in order:

1. NFKC. Replace `♭` with `b` and `♯`/`＃` with `#`. Replace `–`, `—` and `→` with `-`.
   Trim, then collapse whitespace to single spaces.
2. Strip one pair of enclosing `()` or `[]`.
3. Strip a leading `key of `, `key: `, `key - ` or `key ` (case-insensitive).
4. Empty, or (case-insensitive) `n/a`, `na`, `none`, `unknown`, `tbd`, `?`+ or `-`+, gives
   `empty`.
5. **Core parse** of the whole string (grammar below). If it succeeds, return it.
6. **Capo.**
   - `capo N[,:] X[ shape(s)]` or `X shape(s)[,] capo N`, with 0 ≤ N ≤ 11, where X
     parses: return X raised by N semitones, keeping its mode. N greater than 11 gives
     `not-a-key`.
   - `X (capo N)`, `X capo N` or `X, capo N` with no word "shape": return
     `capo-ambiguous`. That X could be the sounding key or the shape.
7. **Slash** `X/Y`, both of which parse. The same pitch class and mode gives X canonical.
   Anything else gives `ambiguous-slash`.
8. **Modulation**: split on ` - `, `-`, ` to ` or `>`. Two parts that both parse give
   `key = X`, `endKey = Y` (no `endKey` if they are equal).
9. **Two keys**: split on `,`, `;`, ` or ` or `&`. Two or more parts that all parse give
   `two-keys`.
10. Otherwise `not-a-key`.

**Core grammar** (whole string, spaces allowed between parts):

- root `[A-Ga-g]`;
- then an optional accidental: `#`, `b`, `B`, `sharp`, `flat`, `-sharp` or `-flat`, any
  case for the words;
- then an optional quality: `m`, `min`, `minor` or `-minor` (minor), or `M`, `maj` or
  `major` (major).

Case matters for one letter only: a bare `m` means minor and a bare `M` means major.
`MIN`/`Min` and `MAJ`/`Maj` follow the word. A second accidental (`##`, `bb` after an
accidental) or any other trailing token (`7`, `sus`, `add9`, a word) fails the parse.

In **title** mode the root must be upper-case, and steps 6 (capo) and 9 (two keys)
never extract. A capo suffix returns `not-a-key`. A two-key suffix returns `two-keys`, so
the review can flag it, but the title is left alone.

### B2. `normalizeKey` cases (field mode unless noted)

| # | Input | Output | Note |
|---|---|---|---|
| 1 | `G` | `G` | |
| 2 | `g` | `G` | lower-case root is fine in field mode |
| 3 | `Eb` | `Eb` | |
| 4 | `eb` | `Eb` | |
| 5 | `bb` | `Bb` | root b + flat b |
| 6 | `b` | `B` | |
| 7 | `bm` | `Bm` | `m` is quality, not flat |
| 8 | `bbm` | `Bbm` | |
| 9 | `EB` | `Eb` | caps lock: `B` after a root is a flat |
| 10 | `B flat` | `Bb` | |
| 11 | `b-flat` | `Bb` | |
| 12 | `Bflat major` | `Bb` | |
| 13 | `Bbmaj` | `Bb` | |
| 14 | `G major` | `G` | |
| 15 | `GM` | `G` | upper `M` = major |
| 16 | `E maj` | `E` | |
| 17 | `Em` | `Em` | |
| 18 | `E minor` | `Em` | |
| 19 | `e min` | `Em` | |
| 20 | `F# minor` | `F#m` | |
| 21 | `f sharp min` | `F#m` | |
| 22 | `A#` | `Bb` | canonical major spelling |
| 23 | `a#m` | `Bbm` | |
| 24 | `C#` | `Db` | |
| 25 | `Db` | `Db` | |
| 26 | `C#m` | `C#m` | |
| 27 | `Dbm` | `C#m` | |
| 28 | `Gb` | `F#` | pending open question 7 |
| 29 | `Gb major` | `F#` | |
| 30 | `F#/Gb` | `F#` | enharmonic slash |
| 31 | `Gb/F#` | `F#` | |
| 32 | `D#m` | `Ebm` | pending open question 7 |
| 33 | `Abm` | `G#m` | |
| 34 | `G#` | `Ab` | |
| 35 | `E#` | `F` | |
| 36 | `Cb` | `B` | |
| 37 | `Fb` | `E` | |
| 38 | `B#` | `C` | |
| 39 | `Eb ` (trailing space) | `Eb` | |
| 40 | `  e♭ ` | `Eb` | unicode flat, padded |
| 41 | `F♯m` | `F#m` | unicode sharp |
| 42 | `C♯` | `Db` | |
| 43 | `(G)` | `G` | enclosing brackets stripped |
| 44 | `Key of G` | `G` | |
| 45 | `Key: D` | `D` | |
| 46 | `capo 2 G` | `A` | G shapes + 2 = A |
| 47 | `Capo 3, Em shapes` | `Gm` | mode kept |
| 48 | `G shapes capo 2` | `A` | |
| 49 | `capo 0 D` | `D` | |
| 50 | `A (capo 2)` | reject `capo-ambiguous` | sounding A, or A shapes giving B? |
| 51 | `capo 12 G` | reject `not-a-key` | |
| 52 | `D - E` | `D`, endKey `E` | modulation |
| 53 | `D to E` | `D`, endKey `E` | |
| 54 | `Ab→Bb` | `Ab`, endKey `Bb` | arrow becomes `-` in step 1 |
| 55 | `G - G` | `G` | no endKey when equal |
| 56 | `G/D` | reject `ambiguous-slash` | alternate or modulation? |
| 57 | `G, A` | reject `two-keys` | |
| 58 | `G or A` | reject `two-keys` | |
| 59 | `` (empty) | `empty` | |
| 60 | `N/A` | `empty` | also `n/a`, `none`, `?`, `-`, `TBD` |
| 61 | `H` | reject `not-a-key` | German B; not guessed |
| 62 | `G7` | reject `not-a-key` | a chord, not a key |
| 63 | `Am7` | reject `not-a-key` | |
| 64 | `Gsus` | reject `not-a-key` | |
| 65 | `C##` | reject `not-a-key` | double accidental |
| 66 | `Do` | reject `not-a-key` | solfège not supported |
| 67 | `5` | reject `not-a-key` | |
| 68 | `Live` | reject `not-a-key` | |
| 69 | `g` (title mode) | reject `not-a-key` | title mode needs an upper-case root |

### B3. `extractKeyFromTitle(title)` returns `{ title, key?, endKey?, flag? }`

Rules:

1. Collapse whitespace and trim, as the import already does (`easyworship.ts:416`).
2. Look only at the **last** bracket group, matching
   `/\s*[(\[]([^()\[\]]{1,16})[)\]]$/`, or a trailing keyword phrase,
   `/\s*(?:[-–—,]\s*)?key(?: of|:)?\s+(\S+(?:\s+(?:major|minor|flat|sharp))?)$/i`.
3. Run `normalizeKey(content, 'title')`. If that gives `key`, strip the group and trim the
   result, unless that would leave the title empty, or the result has an `endKey`
   (modulation). In both those cases the title is kept as it is, so nothing is lost. Any
   other result leaves the title unchanged.
4. Raise `flag` for `two-keys`, for a modulation, and for a single-letter key with no
   accidental or quality (`A`, `B`, `F`). Flagged rows go to the top of the review list.

| # | Title in | Title out | Key | Flag |
|---|---|---|---|---|
| 1 | `A Child Of The King (Eb)` | `A Child Of The King` | `Eb` | |
| 2 | `A Child Of The King      (Eb)  ` (raw EW) | `A Child Of The King` | `Eb` | |
| 3 | `Goodness Of God [A]` | `Goodness Of God` | `A` | single letter |
| 4 | `Way Maker (Key of Bb)` | `Way Maker` | `Bb` | |
| 5 | `Way Maker (Bb Major)` | `Way Maker` | `Bb` | |
| 6 | `Oceans - Key of D` | `Oceans` | `D` | |
| 7 | `Song(Bb)` | `Song` | `Bb` | no space before bracket |
| 8 | `Song (E♭)` | `Song` | `Eb` | |
| 9 | `Song (Em)` | `Song` | `Em` | |
| 10 | `Song (E minor)` | `Song` | `Em` | |
| 11 | `Song (G#)` | `Song` | `Ab` | |
| 12 | `Song (F#/Gb)` | `Song` | `F#` | |
| 13 | `Song (Live) (Eb)` | `Song (Live)` | `Eb` | only the last group is stripped |
| 14 | `Song (D - E)` | `Song (D - E)` | `D` (endKey `E`) | modulation, title kept |
| 15 | `(G)` | `(G)` | `G` | single letter; title kept, since stripping would leave it empty |
| 16 | `Song (F)` | `Song` | `F` | single letter, might mean "female" |
| 17 | `Psalm 23 (A)` | `Psalm 23` | `A` | single letter, might mean "version A" |
| 18 | `Song (Live)` | `Song (Live)` | — | not a key |
| 19 | `Song (Acoustic)` | `Song (Acoustic)` | — | starts with A, but the whole string must parse |
| 20 | `Song (A Cappella)` | `Song (A Cappella)` | — | |
| 21 | `Song (Am I Wrong)` | `Song (Am I Wrong)` | — | |
| 22 | `Song (Capo 2)` | `Song (Capo 2)` | — | capo never extracts from a title |
| 23 | `Song (2)` | `Song (2)` | — | |
| 24 | `Song (H)` | `Song (H)` | — | |
| 25 | `Song (eb)` | `Song (eb)` | — | title mode needs an upper-case root |
| 26 | `Song (Eb) (Live)` | `Song (Eb) (Live)` | — | the key is not last; not guessed |
| 27 | `Song (G, A)` | `Song (G, A)` | — | two keys |
| 28 | `Song Bb` | `Song Bb` | — | no bracket and no keyword |
| 29 | `Song (Bb) ` (trailing space) | `Song` | `Bb` | |
| 30 | `Song (Dm)` | `Song` | `Dm` | |

### B4. `normalizeCcli(raw)` returns a digit string or `''`

Strip `CCLI`, `song`, `#`, `no.`, `number` and `:` (case-insensitive). Drop commas that are
followed by exactly three digits (thousands separators). Remove spaces. What is left must
be 1–8 digits, not all zeros, and it is returned without leading zeros. Anything else gives
`''`. On the copyright fallback, find
`/CCLI\s*(?:song)?\s*(?:#|no\.?|number)?\s*:?\s*([\d,]{3,10})/i`.

| Input | Output |
|---|---|
| `7115744` | `7115744` |
| `CCLI# 7115744` | `7115744` |
| `CCLI Song No. 7115744` | `7115744` |
| `7,115,744` | `7115744` |
| ` 0022025` | `22025` |
| `N/A` | `''` |
| `` | `''` |
| `0` | `''` |
| `7115744, 25` | `''` (flagged: two numbers) |
| `123456789` | `''` (too long) |
| copyright `© 2017 Bethel Music \| CCLI Song # 7115744` | `7115744` |

## Appendix C — Matching an outside row to a Helm song (CSV, PCO, chart files)

**Normalised title**:

1. `extractKeyFromTitle`, keeping the title.
2. NFKD, then drop combining marks, then lower-case.
3. Remove `’ ' \``.
4. `&` becomes ` and `.
5. Drop every bracket group.
6. Drop commas between digits.
7. Turn every other non-`[a-z0-9]` character into a space, and collapse spaces.
8. Drop a leading `the `, `a ` or `an `.

**Normalised authors**: the same folding, then split on `,`, `;`, `&`, `/`, ` and ` and
` with `, keeping each name's last token, as a set of surnames.

**Stages**, the first that decides wins:

1. **CCLI exact.** Both sides have a CCLI number and they are equal. One Helm song gives
   **Ready**. Several (copies per leader) give **Pick one**, showing each copy's current key
   and first line.
2. **Normalised title exact.** One Helm song gives **Ready**, whatever the authors say. The
   review shows "matched by title". With several, keep those whose surname set overlaps the
   row's. If exactly one is left it is **Ready**. If none or several are left, it is
   **Pick one** among all the title matches.
3. **Fuzzy.** A Helm song is a candidate if either test passes. One: Jaro-Winkler of 0.90
   or more on normalised titles, *and* at least 60% of the shorter title's tokens present
   in the longer. Two: every token of the shorter title (at least 2 tokens) present in the
   longer. Candidates give **Pick one**, with up to three shown, best first. A fuzzy match
   is never checked by default.
4. Nothing matched gives **Not found**, with a search box to match by hand.

Separately, whatever the stage: if the Helm song already has a different key, the row goes
to **Already has a different key**, defaulting to keep Helm's.

| # | Outside row | Helm song(s) | Stage | Result |
|---|---|---|---|---|
| 1 | `Way Maker`, CCLI 7115744 | `Waymaker`, CCLI 7115744 | 1 | Ready (titles differ, CCLI decides) |
| 2 | `Goodness of God` / Ed Cash, Jason Ingram | `Goodness Of God (A)` / Jenn Johnson, Ed Cash | 2 | Ready (key suffix dropped) |
| 3 | `10,000 Reasons (Bless the Lord)` / Matt Redman | `10000 Reasons` / Matt Redman, Jonas Myrin | 2 | Ready (brackets and digit comma dropped) |
| 4 | `The Blessing` / Kari Jobe | `Blessing` / — | 2 | Ready, by title (leading "the") |
| 5 | `Raise A Hallelujah` | `Raise a Hallelujah (Live)` | 2 | Ready |
| 6 | `Oceans (Where Feet May Fail)` | `Oceans` | 2 | Ready |
| 7 | `How Great Thou Art` / Stuart Hine | `How Great Thou Art` / — | 2 | Ready, by title |
| 8 | `Build My Life` / Pat Barrett | `Build My Life` / Housefires | 2 | Ready, by title (one candidate, so authors are not consulted) |
| 9 | `Amazing Grace` / John Newton | `Amazing Grace` (Newton), `Amazing Grace` (Newton), `Amazing Grace (My Chains Are Gone)` (Tomlin, Newton) | 2 | Pick one (three left after the author filter) |
| 10 | `Cornerstone` / Hillsong | `Cornerstone` / Edward Mote, `Cornerstone` / Reuben Morgan | 2 | Pick one; the author filter keeps neither ("hillsong" is not a surname), first lines shown |
| 11 | `Song (G)`, CCLI 123 | `Song (G)` and `Song (Bb)`, both CCLI 123 | 1 | Pick one (copies per leader) |
| 12 | `Graves Into Gardens` | `Graves to Gardens` | 3 | Pick one |
| 13 | `It Is Well With My Soul` | `It Is Well` | 3 | Pick one (Jaro-Winkler is only about 0.89, but the containment test passes; never automatic) |
| 14 | `Holy Forever` | — | 4 | Not found |
| 15 | `Great Are You Lord`, key `G#` | `Great Are You Lord`, key `Ab` | 2 | Ready; the same key, so no conflict (it canonicalises to Ab) |
| 16 | `Great Are You Lord`, key `A` | `Great Are You Lord`, key `G` (typed) | 2 | Already has a different key; keep G by default |
