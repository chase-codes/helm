# Bible quick-find: text search from the scripture entry — design

**Date:** 2026-08-23
**Related:** roadmap #3 (reusable scripture-search component), #7 (pre-service scripture
search item), #12 (diacritics in `norm`), #14 (no stemming)

## Goal

Scripture lookup today is reference-only: the entry is a keystroke state machine
(`refBuilder.ts`) that builds `Book ch:v-v` and drops any key that isn't a book prefix
or a digit. There is no way to find "the Zacchaeus story", "where Jesus wept", or "the
prodigal son" without knowing the reference. Mid-service, the pastor names a passage and
the operator needs it on screen in seconds.

Add **text search over verse text**, in the same entry box, with the same feel as song
and quote search: one box, live results on every keystroke, Enter takes the top hit,
deterministic ranking, typo tolerance. This is a *quick-find*, not a study tool: the
goal is to land the cursor on the right verse fast, not to enumerate every occurrence.

## Decisions

- **One box, auto-detect.** Reference typing behaves exactly as it does today. The
  entry becomes a text search only when what was typed cannot be a reference, or when
  the operator forces it with a quote. The typeahead invariant (`bookCompletion` is the
  sole rule for both commit and ghost) is untouched. Competitors mostly use separate
  modes; Blue Letter Bible / YouVersion / Logos auto-detect, and that is the faster flow.
- **Verses, ranked, plus a small curated Passages group.** A verse row is the unit of
  result (`John 3:16` + text). Stories and topics whose names are not in the text
  ("prodigal son", "Lord's prayer", "armor of God") come from a hand-curated table in
  the repo — no external dataset, no licensing. Names and places (`Zacchaeus`,
  `Bethlehem`) need no dataset: they are literally in the verses.
- **FTS5 candidate gate + JS scorer**, same architecture as songs/quotes: a new
  `verse_fts` table gates candidates (bm25 picks which candidates survive the cut), and
  `src/shared/search/verseScore.ts` decides the order with a fixed ladder ending in
  canonical order so results never depend on insertion order.
- **Canonical order, not bm25, settles ties.** bm25's length normalisation would put
  `zaccheus` on Luke 19:5 ("Zaccheus, make haste…") ahead of 19:2 where the story
  starts; for single-word queries it is length noise. Phrase run and coverage lift the
  best verse for multi-word queries; after that, book/chapter/verse order is what every
  presentation tool shows for keyword hits and is what an operator can predict.
- **AND across words.** Every query word must match (prefix or fuzzy). Partial matches
  are noise in a quick-find ("prodigal son" must not list every verse with "son").
  Quoted queries require the words in order. No OR/partial fallback for now.
- **Typos via vocabulary, not a scan.** Each query word that no vocabulary term starts
  with is expanded to the vocabulary terms within the existing Levenshtein tolerance
  (`zaccheus` → `zacchaeus`, `wepts` → `wept`). The vocabulary comes from an
  `fts5vocab` table (~12k terms per translation) cached in main memory. This keeps
  every keystroke at a few milliseconds; a full in-memory fuzzy scan of 31k verses would
  cost 80–150 ms on the main process and could delay a go-live (see the search-perf
  spike, §1).
- **Search the primary version** (`versions[0]`). Results carry the translation abbr.
- **Selecting a hit sets the builder to its reference.** Enter on `Luke 19:2`
  jumps the cursor there *and* puts `Luke 19:2` in the entry — so `+ Add`, Go live,
  Shift+Enter and rail range selection all work on the hit exactly as if it had been
  typed. A passage hit sets a range (`Luke 15:11-32`). The results list goes away
  because the entry no longer shows a search; retyping is cheap and the chapter rail
  now shows the context the operator actually wants. A mouse **click** only previews —
  cursor and highlight move, the entry and the results stay put — because a click that
  closed the list would unmount the row before the second half of a double-click could
  land on it. Enter commits; the click is a rail tap.
- **Arrow keys move a highlight, never the cursor.** Moving the cursor while output is
  live changes the projector; browsing hits must be silent.
- **Matched words are bolded in verse snippets.** The one new rendering behaviour: for
  a verse row the text *is* the content, and a 200–260 px rail can't show much of it.
  Song/quote rails may adopt the same helper later; not in this change.
- **No debounce**, as elsewhere. The query is a few ms.

## Entry: a `search` stage in `refBuilder.ts`

`BuilderStage` gains `'search'`. While in it:

- `bookQuery` holds the query text (so `renderBuilder` shows it with no change), and a
  new `prior: RefBuilderState | null` holds the state the entry was in before the key
  that started the search.
- `book`, `chapter`, `startVerse`, `endVerse` are null; `toParsedRef` returns null;
  `bookCompletion`/`refGhost` return null (stage guard).

Transitions **into** search (all from `printable`):

| From | Key | Result |
|---|---|---|
| book stage | letter/digit, and the new `bookQuery` contains a letter but `matchBook(bookQuery) === null` | search, query = new `bookQuery` (`"prod"`) |
| book stage | `"` (or any non-alnum printable other than `.`) | search, query = `bookQuery + key` — the explicit escape for `john`, `mark`, `acts`; `.` stays ignored so `jn.` doesn't flip modes |
| chapter stage, `chapter === null` | a letter | search, query = `typedBook + ' ' + key` |

`typedBook` is what the operator actually typed before the commit (`"the"`, `"jhn"`),
not the committed name. `commitBook` therefore keeps `bookQuery` instead of clearing it
(nothing reads it after commit: `bookCompletion` guards on `book === null`,
`renderBuilder` prefers `book`). This is what makes `"the l"` a search for `the l`
rather than for `1 Thessalonians l`, and `"he said"` a search for `he said`. The entry
shows `1 Thessalonians` for exactly one keystroke in that case — accepted.

Letters in later stages (chapter typed, verse, endVerse) stay ignored as today.

Transitions **out**: Backspace pops one character; when the query is back to the length
it had when search began, the state becomes `prior` (so `pro` ghosts Proverbs again and
`john ` is back in chapter stage with John committed). Escape clears (existing ladder).
Tab is not swallowed in search. Every other printable appends.

`isSearch(s)` is just `s.stage === 'search'`; `searchQuery(s)` returns the text.

## Index and repo

`schema.ts`:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS verse_fts USING fts5(
  version_id UNINDEXED, book UNINDEXED, chapter UNINDEXED, verse UNINDEXED, text,
  tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE IF NOT EXISTS verse_vocab USING fts5vocab(verse_fts, 'row');
```

Column order exported as `VERSE_FTS_COLUMNS` like `SONG_FTS_COLUMNS`. `verse_vocab` is
global across versions (FTS5 vocab can't be filtered by an UNINDEXED column); that only
means a KJV word can expand a typo while searching WEB — harmless, and the MATCH itself is
still filtered to one version.

`biblesRepo`:

- `install` inserts into `verse_fts` in the same transaction as `verses`; `uninstall`
  deletes both.
- `ensureSearchIndex()` — called from `openDb` after the schema — backfills any version
  that has `verses` rows but no `verse_fts` rows. One-time ~0.5 s for an installed KJV.
  Startup, not first-search: a half-second stall on the first keystroke mid-service is
  the wrong place for it.
- `search(q, versionId, limit = 50): { hits: VerseHit[]; total: number }` where
  `VerseHit = { book, chapter, verse, text }`:
  1. `tokens = norm(q).split(' ')`; empty → `{hits: [], total: 0}`. Quoted (`"…"`) sets
     `phrase = true`.
  2. For each token: `terms = [tok]` (prefix). If no vocab term starts with `tok` and
     `tok.length >= 3`, expand to the NEAREST tier only — the vocab terms at the smallest
     `matchDist(tok, t)` found within `matchTol` (ties included), not everything within
     tolerance (reusing `fuzzy.ts`). This keeps a typo like "wepts" expanding to "wept"
     (1 edit) without also pulling in "went" (2 edits); still empty → the query returns
     no hits.
  3. MATCH = tokens joined with `AND`, each token `("a"* OR "b" OR …)`.
     `SELECT … WHERE verse_fts MATCH ? AND version_id = ? ORDER BY bm25(verse_fts)
     LIMIT 1000` (bm25 only decides which candidates survive the cut), plus
     `SELECT count(*)` for `total`.
  4. `rankVerses(q, candidates, limit)` from `verseScore.ts`.

The `"tok"*` MATCH-string builder and the `LIMIT 1000` constant move into a shared
helper (`src/main/ftsQuery.ts`) used by songs, messages and verses — the third copy is
the one that gets factored, nothing else about the song/message paths changes.

Vocabulary is loaded on first search per process (`SELECT term FROM verse_vocab`) and
invalidated when a version is installed.

## Ranking: `src/shared/search/verseScore.ts`

```ts
interface VerseSignals { score, phrase, covWeight, dist }
scoreVerse(qts, phrase, text): signals via textSignals([verseWords], qts)
```

- Gate: `matched === qts.length`; for phrase queries additionally `phrase === qts.length`.
  Fails → score 0, dropped.
- `score = 300 + 12 * matched` (quote-scorer shape; constant across survivors, kept for
  parity and so a future partial band has somewhere to go).
- Ladder: `score ↓ → phrase ↓ → covWeight ↓ → dist ↑ → canonical ↑` (`bookIndex`,
  `chapter`, `verse`). Canonical last makes the order independent of FTS return order;
  bm25 is deliberately not in the ladder (see Decisions).
- `dist` is `textSignals`' additive match-quality signal: the sum, over every matched
  query token, of that token's best match distance (exact 0 < anchored prefix 1 < fuzzy
  edit distance) — a verse matched exactly outranks one matched only by prefix or fuzzy,
  even when phrase run and coverage tie. Raw term frequency (`tf`) is deliberately NOT in
  the ladder: it rewards a long verse's incidental repeats of short words ("in", "the"...)
  as much as a real second mention of the query's actual subject.
- `foldCompoundNames(text)` runs before `norm(text)` in `scoreVerse`, and on the copy
  written to `verse_fts` at install/backfill time (not on `verses`, which keeps the
  display text as-is): the bundled KJV writes some compound proper nouns with an en dash
  ("Beth–lehem", "Beer–sheba"), and the shared tokenizer treats any dash as a word
  boundary, splitting them into two unmatchable halves — folding the dash away before
  indexing/scoring fixes search without touching what's displayed.
- `textSignals`' fuzzy matching is what makes a vocab-expanded typo actually score
  (`zaccheus` vs `zacchaeus` is Levenshtein 1 within tolerance 2).

Expected behaviour on the gold set: phrase runs dominate ("for god so loved" → John 3:16,
"in the beginning" → Gen 1:1 then John 1:1 by canonical tie, "the lord is my shepherd" →
Ps 23:1); an exact match beats a prefix match and lifts "new heaven and a new earth" →
Rev 21:1 (exact "heaven") over Isaiah's "new heavens" (prefix, dist 1); single names list
in canonical order ("zaccheus" → Luke 19:2, 19:5, 19:8).

## Passages: `src/shared/scripture/passages.ts`

```ts
interface Passage { title: string; aliases: string[]; book: string; ch: number; from: number; to: number }
export const PASSAGES: Passage[]   // ~150–250 entries
export function matchPassages(q: string, limit = 3): Passage[]
```

Curated: parables, miracles, key events (creation, flood, exodus, ten commandments,
nativity, sermon on the mount, crucifixion, resurrection, pentecost…), famous chapters
(love chapter, faith chapter, armor of God, fruit of the Spirit, Lord's prayer,
beatitudes, great commission, Psalm 23/51/91/139…). Matching runs in the renderer (it's
static data): `textSignals` over `title + aliases` words, all tokens required, ordered by
phrase ↓, covWeight ↓, title length ↑, canonical ↑. Every entry's range is validated
against book extents in a test.

## IPC

- `CH.biblesSearch = 'bibles:search'` — `(q: string, versionId: string) =>
  { hits: VerseHit[]; total: number; versionId }`.
- `preload.bibles.search(q, versionId)`.

## UI

`SchedulePanel` gets a `search` prop: `null`, or `{ query, rows, passages, total, abbr,
highlighted, onHover, onPick, onActivate, empty }`. When non-null and the track is
scripture, the schedule header + list are replaced by `ScriptureSearchResults` (new file,
`Row` declared at module scope — see the `SongSearchRail` comment on why):

- Header: `N VERSES · KJV` (total, not shown count). Empty: `No verses match “…”`; no
  version installed: `INSTALL_HINT`.
- `PASSAGES` group (≤3): title, meta `Luke 15:11–32`.
- `VERSES` group (10 rows): ref in bold, text clamped to 2 lines with matched words
  bolded (`highlightTokens(text, qts)` — a small shared helper in `src/shared/search/`).
- Row states: highlighted (keyboard), hover. Click = preview (highlight + cursor, search
  stays open); double-click = activate. Enter = commit the ref into the entry;
  Shift+Enter = activate. Activation goes through the **idempotent take verb**
  (`presentation.take`, the #58 path), never `goLive` — `goLive` toggles, so on the verse
  already live it would black the projector.

`SermonMode`:

- `search = isSearch(builder) ? searchQuery(builder) : null`. Effect: on `search` or
  `versions[0]` change → `window.helm.bibles.search(search, versions[0])`, `live`-flag
  guarded; `passages = matchPassages(search)` synchronously.
- Highlight index state, reset to 0 when results change; clamped to
  `passages.length + rows.length - 1`. Combined list order: passages, then verses.
- `onEntryKeyDown` in search stage: `ArrowDown/ArrowUp` move highlight; `Enter` = pick
  highlighted (`setBuilder(fromParsedRef(ref))` + `jumpTo(first verse)` +
  `requestRailScroll`); `Shift+Enter` = same, then go live with it (reuse
  `goLiveFromBuilder`'s chapter-fetch path); Escape/Backspace fall through to `applyKey`.
- `addRef` while searching = highlighted hit's reference (so `+ Add` is labelled and
  files it); `canAdd` false when there are no hits.
- `+ Add`/Go live button behaviour otherwise unchanged.
- Placeholder: `John 3:16 — or a word to search`.

## Error handling

- Search IPC failure → `console.error`, results cleared, empty state shown; the entry
  keeps its text.
- No primary version → search effect skipped; `INSTALL_HINT` empty state.
- Vocab expansion finds nothing → zero hits (not a crash); passages still match.
- `ensureSearchIndex` runs in a transaction per version; a failure logs and leaves
  that version unsearchable rather than failing startup.

## Tests

| File | Covers |
|---|---|
| `refBuilder.test.ts` | every transition in the table above; Backspace restore; quote escape; `.` ignored; `the l`; `1 jo` digit clause unchanged; existing tests still pass (only `bookQuery: ''` after commit assertions change) |
| `verseScore.test.ts` | gate, phrase gate, ladder (phrase → cov → dist → canonical), order-independence (shuffle candidates → same order) |
| `passages.test.ts` | fuzzy title/alias match, all-tokens gate, every range within `bookExtent` of the bundled KJV |
| `biblesRepo.test.ts` | FTS rows on install/remove, `ensureSearchIndex` backfill, `search`: prefix, AND, quoted phrase, typo expansion, version filter, `total` |
| `bibleSearchRanking.test.ts` | **gold set** over the bundled KJV (`resources/bibles/kjv.json`, installed once per file): ~25 queries with expected top-1 / top-3 — famous phrases, names, places, typos (`zaccheus`, `bethlehem`, `jesus wept`, `for god so loved`, `in the beginning`, `lord is my shepherd`, `faith hope love`, `be still`, `prodigal` (→ 0 verses, passage hit), `lazarus`, `nicodemus`, `road to damascus` (→ passage)) |
| `ftsQuery.test.ts` | MATCH builder (escaping, AND/OR shape) |
| `ScriptureSearchResults.test.tsx` | groups, header count, highlighted row, bolding, empty states |
| `SermonMode.test.tsx` | typing a non-book shows results; ↑/↓/Enter/Shift+Enter; picking sets the builder and jumps; `+ Add` label follows the highlight |

## Out of scope (follow-ups)

- OR / partial-match fallback when AND yields nothing.
- People/places dataset (TIPNR) as a distinct result type.
- Cross-version search; search from the pre-service verse card (#7).
- Bolding in song/quote rails; arrow nav there.
- Stemming (#14) and `norm` diacritics (#12) — both would benefit verse search via the
  shared tokenizer/normaliser and are fixed in one place.
