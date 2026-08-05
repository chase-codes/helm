# Helm — Book-name typeahead in the scripture ref builder

**Date:** 2026-08-05
**Closes:** the roadmap item *"Book-name typeahead in the ref builder"*
(`docs/superpowers/roadmap.md`, Sermon/Scripture section), logged `6d6d19d`.
**Reported:** operator, 2026-08-05 — *"when we're typing in the scripture search bar, it's
supposed to preview the next most likely book to help with searching and confidence in
pressing space to hit the chapter."*

---

## Why

Half of this feature already exists, which is why its absence reads as a regression.

Typing `gen` and pressing space **does** resolve to Genesis: `matchBook` (`refs.ts:11-17`)
takes an exact alias first, then the first prefix match, and the book stage commits it on
space (`refBuilder.ts:86-94`). What is missing is any way to see *where space will land*
before pressing it. `renderBuilder` returns `s.bookQuery` raw at the book stage
(`refBuilder.ts:37`), so the field echoes exactly what was typed. The operator types into
silence and finds out what happened only after committing — mid-service, in front of a
congregation.

**A second problem surfaced while measuring this, and it changes the shape of the work.**
`matchBook`'s prefix branch returns the first match in canonical Genesis→Revelation order,
which is frequently not the likeliest book. Measured against the real function:

| typed | resolves to today | plausibly meant |
| --- | --- | --- |
| `jo` | **Joshua** | John, Job, Joel, Jonah |
| `ma` | **Malachi** | Matthew, Mark |
| `ti` | **Titus** | Timothy (numbered — unreachable bare) |
| `co` | **Colossians** | Corinthians (numbered — unreachable bare) |
| `pe` | **null** | Peter (no bare alias exists) |

(The roadmap's own example — *"`jo` → John before Jonah, Joshua, Joel"* — was wrong; `BOOKS`
is in canonical order, so `jo` gives Joshua.)

Today this misfires invisibly. A truthful preview would put it in the operator's face on
every keystroke: type `ma` for Matthew and watch the field offer Malachi. Shipping the
preview against the current ranking would therefore *advertise* a defect rather than fix one.
So the ranking is in scope.

## What we're building

Two things, bound by one rule.

**1. A ghost completion at the book stage.** As the operator types, the book the field would
commit appears inline in dimmed text, inside the entry field.

```
type "gen":            ┌──────────────────────────────┐
                       │ › gen̲esis                    │
                       └──────────────────────────────┘
                            ^^^ ^^^^^
                            typed  dim — space accepts

press space:           ┌──────────────────────────────┐
                       │ › Genesis                    │
                       └──────────────────────────────┘
```

**2. Ranking by likelihood.** `matchBook`'s prefix branch prefers a curated set of
commonly-read books before falling back to canonical order. `ma` → Matthew, `jo` → John,
`mar` → Mark. The exact-alias branch is unchanged.

### The invariant

> **A ghost is visible if and only if pressing space (or Tab) commits it.**

This is the whole design. It is what makes the preview worth trusting: the operator never has
to wonder whether the thing on screen is what the keystroke will do.

The consequences fall out of it rather than needing separate rules:

- **Numbered books show no ghost until they resolve.** Typing `1` offers nothing, because
  space does not commit there — it inserts a space (`refBuilder.ts:93`). `1 j` still offers
  nothing: ambiguous. `1 jo` offers *1 John*, because `1 jo` is an exact alias
  (`books.ts:70`) and space commits it.
- **No match, no ghost.** `xyz` shows nothing, because space would do nothing.
- **Tab accepts only when a ghost is showing.** With no ghost, Tab keeps its normal focus
  behaviour rather than being swallowed.

### Two ghost forms

A matching alias is not always a prefix of the book name, so an inline tail cannot always be
formed:

| typed | why it matches | ghost |
| --- | --- | --- |
| `gen` | prefix of "Genesis" | `gen`**`esis`** |
| `jhn` | alias of John, not a prefix | `jhn`**` → John`** |

Both mean the same thing: *space takes this*. Without the second form, `jhn` / `jn` / `1sa`
would either show nothing or render a garbled overlay.

## Design

### `bookCompletion` — the invariant made structural

The commit decision currently lives inline in `printable`'s book case (`refBuilder.ts:89-90`):

```ts
const b = matchBook(q)
if (b !== null && (!/\d/.test(q) || matchBookExact(q) !== null)) { /* commit */ }
```

Extract it:

```ts
/** The book name that space (or Tab) would commit right now, or null. */
export function bookCompletion(s: RefBuilderState): string | null
```

`printable` calls it to decide whether to commit. The renderer calls it to decide what to
ghost. **They cannot disagree, because they are the same function.** The invariant is not
maintained by discipline or by a comment — it is the only thing the code can express. It is
also directly testable as a property (see Testing).

### `refGhost` — what the ghost says, decided in pure code

```ts
export type RefGhost =
  | { kind: 'tail'; text: string }   // "gen" → { tail, "esis" }
  | { kind: 'alias'; book: string }  // "jhn" → { alias, "John" }

export function refGhost(s: RefBuilderState): RefGhost | null
```

Returns `null` whenever `bookCompletion` does. Chooses `tail` when the normalized query is a
prefix of the normalized book name, `alias` otherwise. The component decides only how each
form *looks*; everything about what it *says* stays unit-testable with no DOM.

### Ranking

`matchBook` keeps its exact-alias branch unchanged. The prefix branch changes from
"first match in canonical order" to "best-ranked match, ties broken by canonical order".

Rank lives in a separate exported list of book names in `books.ts`, not as a field on every
`T(...)` entry — retuning it later touches one list rather than the alias table, and the
alias table stays readable.

The starting list, in order — earlier wins a tie:

```
John, Matthew, Mark, Luke, Acts, Romans, Psalm, Proverbs, Genesis, Exodus,
Isaiah, Hebrews, James, Ephesians, Philippians, Galatians, Colossians, Revelation
```

Everything unlisted keeps canonical order relative to itself, and relative to the list it
sorts last. This resolves the two genuine prefix collisions from the table above:
`ma`→Matthew (Mark, then Malachi) and `jo`→John (Joshua, Job, Joel, Jonah after). Note that
`mar`→Mark and `re`→Revelation are already correct today and are *not* affected — `mar` has
only one prefix match, and `re` is an exact alias of Revelation (`books.ts:74`). The ranking
only ever reaches genuine prefix ties.

The list is a judgement call and is expected to be tuned. What matters is that it is static,
explainable, and identical on every machine and every operator.

### Tab

`applyKey` currently ignores any key whose `length !== 1` except `Backspace`
(`refBuilder.ts:79-80`). It gains a `Tab` branch:

- ghost showing → commit the book, `preventDefault: true`
- no ghost → state unchanged, **`preventDefault: false`** so focus still moves

### Rendering the overlay

The entry field is a controlled `<input>` fed by `value={renderBuilder(builder)}`
(`SermonMode.tsx:633` → `SchedulePanel.tsx:113-120`). **The ghost never enters `value`** —
parsing, the caret, selection and `onEntryChange` are all untouched.

`SermonMode` computes `refGhost(builder)` and passes it to `SchedulePanel` as a prop.
`SchedulePanel` wraps the input in a `position: relative` container and renders, beneath a
transparent-background input:

```
<span aria-hidden="true" style={{ position:'absolute', pointerEvents:'none', …same font… }}>
  <span style={{ color:'transparent' }}>{value}</span>
  <span style={{ color: T.faint }}>{tailOrArrow}</span>
</span>
```

The transparent copy of the typed text advances the dim text to exactly the right offset, so
no text-width measuring is needed. The field is JetBrains Mono at 13.5px; the ghost span must
carry identical `fontFamily`, `fontSize`, `letterSpacing` and padding, or it will drift.

### Data flow

```
keystroke → applyKey ─┬─ printable → bookCompletion ── commits the book
                      └─ Tab       → bookCompletion ── commits the book
                                        ▲
render    → refGhost ───────────────────┘   (same source of truth)
             │
             └→ SermonMode → SchedulePanel prop → dim overlay span
```

## Testing

**Written in this order. Item 1 lands before the ranking changes.**

1. **Pin `bibleSource` first.** `src/main/bibleSource.ts:65,78` calls `matchBook` to map book
   names from downloaded bibles onto canonical names. A silent remap there would mis-file
   installed scripture — a worse failure than anything in the entry field. Verified: all 66
   book names in the bundled KJV (`resources/bibles/kjv.json`), *including* the variants
   `Psalms` and `Song of Songs`, are declared exact aliases (`books.ts:27,30`), so they
   resolve on the exact branch and the ranking provably cannot reach them. The test asserts
   all 66 map to their canonical names **and** that each resolves by exact alias, so the
   safety argument itself is pinned rather than assumed.
2. **Ranking** (`refs.test.ts`): `ma`→Matthew, `jo`→John, `mar`→Mark; exact alias still wins
   (`job`→Job, `1 jo`→1 John, full canonical names); `pe`→null unchanged.
3. **The invariant** (`refBuilder.test.ts`): a table-driven property test over many queries
   asserting `refGhost(s) !== null` ⇔ space commits a book. This is the test that keeps the
   feature honest as the code changes; it fails if anyone reintroduces a separate rule for
   the display.
4. **Numbered books** (`refBuilder.test.ts`): no ghost for `1` or `1 j`; *1 John* for `1 jo`.
5. **Tab** (`refBuilder.test.ts`): commits with a ghost showing; `preventDefault: false` with
   none.
6. **Panel** (`SchedulePanel.test.tsx`): renders both ghost forms, absent with no completion,
   `aria-hidden` so screen readers don't read the field twice.
7. **Real app** — a `scratch/` driver in the house style (Electron + `playwright-core`, as
   `verify-bug008.mjs` / `verify-autofit.mjs`): type `ma`, see the Matthew ghost, press space,
   land on Matthew. Unit tests cannot show that the overlay actually aligns with the input.

## Known caveats

- **Horizontal scroll.** If typed text ever grows long enough to scroll the input, the ghost
  will not scroll with it. A book name plus a reference never gets that long in this field;
  accepted rather than building scroll-syncing.
- **The curated rank is a judgement call.** It will be wrong for some congregation. It is
  static and in one list, so retuning is a one-line change — deliberately not learned from
  usage, which would make the same keystrokes resolve differently week to week and cold-start
  empty on a fresh install. Logged as a possible follow-up, not built.
- **`ti` and `co` stay "wrong".** Timothy and Corinthians are numbered books, so a bare `ti`
  or `co` cannot reach them whatever the ranking; they resolve to Titus and Colossians. The
  ghost at least makes that visible now instead of silent.

## Explicitly not in scope

- **Chapter/verse stage hints** (e.g. "of 21 chapters"). A range display, not a completion,
  and it sits on the extent-fetch path where **BUG-010** already drops digits typed at speed.
  Worth doing after BUG-010.
- **Cycling alternatives** with Tab or arrows. Typing one more letter disambiguates.
- **Usage-based ranking.** See caveats.
- **BUG-010 / BUG-011 / BUG-012**, all pre-existing defects in this same entry field. Adjacent
  but separate; this work neither fixes nor worsens them.
- **Switching `bibleSource` to a stricter exact-only matcher.** Arguably more correct than
  fuzzy-matching downloaded book names, but it could break installs of bibles using variant
  names, and it is not needed for this feature. Left on `matchBook`, pinned by test 1.
