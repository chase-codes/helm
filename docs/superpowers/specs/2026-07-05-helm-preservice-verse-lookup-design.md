# Helm — Pre-service Bible verse look-up

**Date:** 2026-07-05
**Status:** Draft — awaiting user review
**Master spec:** `docs/superpowers/specs/2026-07-03-helm-design.md`
**Realizes:** the deferred enhancement noted in `docs/superpowers/specs/2026-07-04-helm-slice5-design.md` (L89): *"Enhancement, deferred: let a verse card pull live from an installed bible."* — implemented here in its **edit-time** form (resolve once, store text), not the live/render-time form.

---

## 1. Purpose

The pre-service loop's **Bible verse** card is authored today by hand-typing two fields in `PreCardEditor`: a `REFERENCE` (`Psalm 122:1`) and the full `VERSE TEXT`. Nothing consults the installed Bible — the text is whatever the operator pastes. This slice adds a **Look up** affordance: type a reference, pull the real verse text from the installed Bible, and drop it into the card. The resolved text is stored on the card exactly as today (denormalized), so the tick/render path is unchanged.

## 2. Scope

**In:**
- A **Look up** button (and Enter-in-the-reference-field) in the verse tab of `PreCardEditor` that parses the reference, fetches the primary installed Bible's chapter, and fills the verse text + canonical reference + records the version abbreviation.
- Store the resolved version abbreviation on the card so the projected slide shows the correct translation label instead of a hardcoded `KJV`.
- Inline status/errors; both fields remain editable (manual authoring still works, unchanged).
- A small pure resolver in `shared/scripture` plus tests; new tests for the repo field, the slide label, and the editor look-up/error paths.

**Out:**
- Version **picker** — always resolve from the primary (first) installed Bible.
- Multi-verse **ranges** — a typed range is rejected with a message (single verse only).
- **Live** re-resolution at render/cue time (Approach B / a later 5b item); cross-chapter references; changing the one-verse-per-card projection model.
- Any main-process or preload change — resolution reuses the existing `bibles.manifest` and `bibles.getChapter` IPC.

## 3. Behavioral end state

- In the verse tab, next to the reference field, a **Look up** button appears; pressing Enter in the reference field does the same thing.
- On look-up the reference is parsed, the primary installed Bible's chapter is fetched, and on success the `VERSE TEXT` is replaced with the real verse, the `REFERENCE` is rewritten to its canonical form (`psalm 122.1` → `Psalm 122:1`), and the resolved translation (e.g. `KJV`) is shown inline and saved on the card.
- **Single verse only:** if the reference resolves to a range (`from ≠ to`), look-up does nothing but show *"Enter a single verse, e.g. James 1:1"*. The fields are not modified.
- **Errors leave fields intact** and show an inline message:
  - unparseable reference → *"Enter a reference like Psalm 122:1"*
  - no Bible installed → *"Install a Bible first (Settings → Bibles)"*
  - verse absent from that chapter/translation → *"{Book} {ch} has no verse {n} in {ABBR}"*
- **Manual authoring is unchanged:** the operator can still type both fields and Save without ever pressing Look up. Such cards store no version and render with the `KJV` label fallback, exactly as today.
- Saving stores `ref`, `text`, and (when resolved via look-up) `version`. The projected scripture slide shows `version` as its translation label.

## 4. Changes by layer

### 4.1 Types — `src/shared/types.ts`
- `PreCard`: add optional `version?: string;` on the verse-fields line (`ref?`, `text?`, `version?`). Holds the translation abbreviation, e.g. `KJV`.

### 4.2 Shared resolver — `src/shared/scripture/` (new pure helper, e.g. `preVerse.ts`)
- `verseText(chapter: ChapterData, verse: number, versionId: string): string | null` — returns `chapter.verses[verse]?.[versionId] ?? null`. (If `slides.ts`'s existing `verseCols`/`pickVersion` cover this cleanly, reuse them and skip the new helper — decided at plan time; either way the extraction is a pure, tested unit.)
- No range logic lives here — range rejection is a `parsed.from !== parsed.to` check in the editor (§4.5), kept there so the editor can attach the right message.

### 4.3 Repo — `src/main/preCardsRepo.ts`
- Add `'version'` to `PAYLOAD_KEYS` so the field round-trips through `payload_json`. No schema change, no migration (new optional payload key; older rows simply lack it).

### 4.4 Slide render — `src/shared/preservice/cards.ts`
- `preSlideFor` verse case: change the hardcoded column version to `card.version || 'KJV'`:
  `columns: [{ version: card.version || 'KJV', text: card.text || '' }]`.

### 4.5 Editor — `src/renderer/operator/PreCardEditor.tsx`
- Verse tab keeps `REFERENCE` + `VERSE TEXT`. Add a **Look up** button by the reference field; Enter in that field triggers the same handler.
- Track the resolved `version` in component state (seeded from `card?.version`), and an inline `status`/`error` string.
- **Look-up handler** (async, in the renderer — no new IPC):
  1. `parsed = parseRef(ref)` → if `null`, set the parse error, return.
  2. if `parsed.from !== parsed.to` → set the single-verse message, return.
  3. `manifest = await window.helm.bibles.manifest()`; `primary = manifest.find(m => m.installed)` → if none, set the no-Bible message, return.
  4. `chapter = await window.helm.bibles.getChapter(parsed.book, parsed.ch)`.
  5. `text = verseText(chapter, parsed.from, primary.id)` → if `null`, set the not-found message, return.
  6. success: set `peText = text`, `peRef = formatRef(parsed)` (single verse → no range suffix), `version = primary.abbr`, and show the resolved translation inline.
- **Save:** the verse branch includes `version` (state value; `undefined` when never resolved) alongside `ref`/`text`. Everything else in the editor is unchanged.

## 5. Testing strategy

- **Resolver (`shared/scripture`):** `verseText` returns the text for a present verse and `null` when the verse/version is absent. (Behavioral, matches existing `slides.test.ts` style.)
- **Slide render (`cards.test.ts`):** a verse card with `version: 'WEB'` produces a scripture slide whose column version is `WEB`; a card without `version` falls back to `KJV`.
- **Repo (`preCardsRepo.test.ts`):** saving a verse card with `version` and re-listing round-trips the field.
- **Editor (`PreCardEditor.test.tsx`, mocking `window.helm.bibles`):**
  - Look-up on a valid single-verse ref fills the verse text, canonicalizes the reference, and surfaces the translation label.
  - A typed range shows the single-verse message and leaves the fields unchanged.
  - No-Bible and verse-not-found paths show their messages and leave the fields unchanged.
  - A card saved by hand (no look-up) still saves `ref`/`text` with no `version`.

Full gate before done: `npm run typecheck`, `npm test` (no better-sqlite3 rebuild needed — main-process tests run on `node:sqlite`), `npx eslint .` → 0 new errors.

## 6. Risks / notes

- **Backward compatibility** — `version` is a new optional field; existing verse cards (and all manually-authored ones) render with the `KJV` fallback label, unchanged. No migration.
- **Primary-Bible ambiguity** — "primary" is the first installed Bible (`manifest.find(m => m.installed)`), matching the convention `bibles:bookExtent` already uses in `ipc.ts`. If the church runs a non-KJV primary, look-up pulls and labels from it correctly.
- **Renderer-side resolution** — resolution is orchestrated in the editor using existing IPC; the only pure, cross-tested logic is the verse-text extraction. This keeps the slice free of main/preload churn.
- **Range rejection vs. clamping** — we reject ranges (clear message) rather than silently clamp to the first verse, so the single-verse contract isn't surprising. Revisit if operators want passages (that reopens the range/render decision).
