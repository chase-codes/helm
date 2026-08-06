# Song online search & URL import — design

**Date:** 2026-08-06
**Status:** Approved

## Problem

Adding a single song to Helm means hand-pasting lyrics into QuickAdd. The
EasyWorship wizard covers bulk migration, but the weekly case — "we're doing a
new song Sunday" — still requires finding lyrics in a browser, copying them,
pasting, and cleaning them up. QuickAdd already shows a disabled **Search
online** tab anticipating this feature.

## What we're building

The Search online tab comes alive: type a title and pick from ranked results
fetched from LRCLIB, or paste a lyrics-page URL — either way the lyrics arrive
tidied, stanza-split, and chorus-labeled in the QuickAdd editor for review
before saving.

### Source viability (verified 2026-08-06)

[LRCLIB](https://lrclib.net) probe, 10 representative worship songs (modern CCM
+ hymns): **10/10 found with plain lyrics.** Free JSON API
(`GET /api/search?q=`), no auth, no key, explicitly open to third-party use.
Caveats that shaped the design:

- **Raw ranking is untrustworthy.** Top hit for "Goodness of God" was a
  41-minute livestream rip with zero stanza breaks; 14 studio-length
  candidates behind it had clean 6–8-stanza formatting. We re-rank.
- **No section labels.** Stanza breaks yes; "Chorus"/"Verse" headers no. We
  detect the chorus (below).
- Search results **include full `plainLyrics`** — preview-on-highlight costs
  no extra request.

Genius search also works keyless, but its lyrics require HTML scraping — held
back as a search source. Genius **URLs** are supported in the paste path,
where their `[Verse 1]`/`[Chorus]` markers make them the best-labeled imports.

## UX — QuickAdd's Search online tab

- **One input, two behaviors.** Type words → LRCLIB search. Paste an
  `http(s)://` URL → fetch and parse that page. No separate URL field.
- **Prefilled and eager.** Opening the tab with a title in play (rail chip
  flow) runs the search immediately.
- **Results list** (left): title, artist, album · duration, stanza count.
  Ranked, deduped, roughly top 8.
- **Live preview on highlight** (right): the same slide-preview panel the
  Paste tab uses, showing the highlighted result chorus-labeled and split via
  `splitToSlides`. Arrow keys / hover move the highlight.
- **Pick → editor.** Choosing a result fills title, author, and labeled
  lyrics, then flips to the Paste lyrics tab for review. Save is unchanged.
  URL parses land the same way.
- **New author field** in QuickAdd beside the title — `NewSongInput.author`
  already exists; QuickAdd just never exposed it. Search prefills it with the
  artist; hand-adds benefit too.

## Architecture

Fetching happens in the **main process** (renderer CSP blocks arbitrary
hosts). Pure formatting stays in `shared/songs/`.

### Modules

| Module | Job |
| --- | --- |
| `main/songSources/lrclib.ts` | Search client. One GET, 8s timeout. |
| `main/songSources/geniusUrl.ts` | Genius page → lyrics; `[Section]` headers → Helm label lines. |
| `main/songSources/genericUrl.ts` | Any other page: strip markup, take the densest cluster of short lines, best effort. |
| `main/songSources.ts` | Orchestrator + IPC handlers; routes URL vs query. |
| `shared/songs/rankCandidates.ts` | Pure ranking + dedup over LRCLIB rows. |
| `shared/songs/detectChorus.ts` | Pure chorus labeling. |

### IPC

| Channel | Shape |
| --- | --- |
| `songSources.search(query)` | `→ Candidate[]` |
| `songSources.fromUrl(url)` | `→ Candidate` or typed error |

`Candidate = { title, author, text, album?, duration? }` with `text` already
run through the pipeline — display-ready when it crosses the bridge.

### Formatting pipeline (per candidate, in main)

1. `importTidy` — the existing six rules, unchanged.
2. `detectChorus` — unless the text already carries label lines.

Saving goes through the existing `songs.add` with `source: 'web'`, so slides,
FTS indexing, and selection behave identically to hand-entered songs. No
schema changes.

## Ranking & dedup (`rankCandidates`)

- **Drop:** instrumentals, empty `plainLyrics`.
- **Score up:** stanza structure (blank lines present), title similarity to
  the query, sane duration. **Score down:** duration over ~10 minutes
  (penalized, not excluded — long worship songs are real).
- **Dedup:** normalize lyrics (lowercase, collapse whitespace — the
  `importKey` trick), collapse identical bodies, keep the best-ranked
  representative.

## Chorus detection (`detectChorus`)

Split on blank lines → normalize each stanza (lowercase, strip punctuation,
collapse spaces) → stanza bodies occurring ≥2 times are chorus material. The
**most frequent** repeated stanza (tie → first seen) gets a `Chorus` label
line inserted above each occurrence. Everything else stays unlabeled and
falls through to `splitToSlides`' Verse 1, Verse 2… numbering.

Guards: text already containing section label lines is returned untouched
(Genius imports); text with no repeats is returned untouched. Modest by
design — a wrong "Bridge" guess costs more than a missing one; the editor
review step catches the rest.

## Error handling

All add-time; failures never touch the live output path.

| Situation | Behavior |
| --- | --- |
| No results | "No matches — paste lyrics or try a URL" in the results area. |
| Network failure / timeout | Inline error with retry; modal and typed text intact. |
| URL not http(s), or page yields no lyrics | Typed message suggesting copy-paste into the Paste tab. |
| Genius markup drift breaks the parser | Same typed error path — degrades to copy-paste, never a crash. |

## Testing

- **`rankCandidates`** — livestream fixture demoted, instrumental dropped,
  identical bodies collapsed to the best representative, title similarity
  ordering.
- **`detectChorus`** — repeated stanza labeled at every occurrence,
  no-repeat passthrough, already-labeled passthrough, tie goes to first-seen.
- **Parsers** — Genius and generic extractors against saved HTML fixtures;
  Genius `[Section]` → label-line conversion.
- **QuickAdd** — mocked `window.helm.songSources`: results render, highlight
  drives the preview, pick fills the editor + flips tabs, URL input routes to
  `fromUrl`, error and empty states render, author field prefills and saves.
- **IPC** — handler wiring test in the existing style.

## Out of scope

- Genius as a *search* source (URL-paste only).
- SongSelect / CCLI integration.
- Synced-lyrics timing data.
- Bridge / pre-chorus inference.
- Editing existing library songs via search.
