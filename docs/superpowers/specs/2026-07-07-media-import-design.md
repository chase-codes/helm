# Helm — Slides / Media Import: repair + redesign

**Written:** 2026-07-07 · **Status:** approved design, pre-plan
**Area:** `src/renderer/operator/SlidesTrack.tsx`, `src/main/mediaImport.ts`, `src/main/library.ts`, media IPC, renderer CSP, packaging.

## Goal

An operator can import an **image**, **video**, **PDF**, or **PowerPoint** deck and
**immediately see it** — visible thumbnail, auto-selected, with clear feedback — and can
**remove** a mistake, live mid-service, without a crash or a block. The primary use case is
**PPTX**, which must be **solid and self-contained on Windows** (no operator-installed
tooling). Success is judged in the **real running Electron app**, not by unit tests — unit
tests pass today while the real UI fails, which is exactly how the current defect hid.

## What is actually broken (evidence, from driving the real app)

Investigated by launching the packaged renderer under a Playwright/Electron driver on macOS
and driving Sermon → Slides → **+ Import**, with the OS picker stubbed to return a real file.

1. **🔴 Imported media renders as a broken image — CSP blocks `helm-media://`.** Both
   `src/renderer/operator/index.html` and `src/renderer/output/index.html` ship
   `default-src 'self'; … img-src 'self' data:`. Every media source uses the custom
   `helm-media://` scheme (`mediaSrc()` in `src/shared/media/slides.ts`), which is **not
   allowlisted**, so thumbnails, the center hero, and `<video>` all fail, and renderer
   `fetch('helm-media://…')` returns "Failed to fetch". **The import itself succeeds** (file
   copied, DB row added, item selected) — it just displays broken, which reads as "nothing
   imported." Proven: the same `helm-media://` URL served **200 / image/png** from the main
   process, `<img>.naturalWidth === 0` in the renderer; after adding `helm-media:` to the
   CSP and reloading, the identical image loaded (`naturalWidth === 1`) and the broken-image
   glyph disappeared. Affects the **audience output too** (identical CSP). jsdom unit tests
   don't enforce CSP, so they never caught it.

2. **🟠 The "+ Import" popover opens off-screen when the library is empty/short.** The
   popover is anchored `bottom: 46px` (opens *upward*) — designed for Import at the bottom of
   a long list, but in the **empty state a new operator first sees** the button sits at the
   top and the menu renders above it, clipped by the panel's `overflow-y:auto`. Proven: the
   Images/Video/PowerPoint buttons render at `y = 37–140px`, above the scroll region → not
   visible. "+ Import" looks like it does nothing.

3. **🟠 PPTX import is impossible on a stock machine.** `findSoffice()`/`findPdftoppm()`
   return null when LibreOffice/poppler aren't installed (they weren't, on the dev Mac), so
   `importDeck` always returns `{ error: 'no-libreoffice' }` → the "unavailable" modal.

4. **🟡 Smaller gaps:** no import progress/loading feedback; images/video imported into a
   **non-empty** library are added at the top but **not auto-selected** (only decks were),
   so a second import looks inert; the deck cancel path relies on a fragile id-diff heuristic;
   `media.remove` exists end-to-end but is wired to **no UI**; the file picker is opened
   **parentless** (`dialog.showOpenDialog` with no `BrowserWindow`), so it can surface behind
   the always-on-top output windows on a multi-display rig; and the poppler-missing fallback
   (`soffice --convert-to png`) silently imports only slide 1 of a multi-slide deck.

## Repair-vs-redesign decisions

| Area | Decision | Why |
|---|---|---|
| A. CSP allowlist | **repair** | Mechanism is sound; one missing scheme in two files. |
| B. Deck pipeline | **redesign** | Rebuild around bundled LibreOffice + pdfjs; drop poppler; add PDF; kill first-slide-only bug. |
| C. Cancel handling | **repair** | Return real `{ canceled }` from main; delete the renderer id-diff heuristic. |
| D. "+ Import" discoverability | **redesign** | Reposition menu + real empty state so it's never clipped. |
| E. Import feedback + auto-select | **repair** | Extend deck's select-new behavior to all types; scroll into view. |
| F. Progress + parented dialog | **repair + new** | Add IPC progress; parent the picker to the operator window. |
| G. Delete + undo | **new** | Wire existing `media.remove` via shipped interaction primitives. |

## Architecture

### A. CSP (repair)

In **both** renderer HTML entrypoints, extend the CSP:

```
img-src 'self' data: helm-media:;
media-src 'self' helm-media:;
connect-src 'self' helm-media:;
```

Leave `default-src 'self'`, `script-src 'self'`, and the font rules untouched. This is the
gating fix — every other visible improvement depends on it.

### B. Deck pipeline (redesign) — `src/main/mediaImport.ts`

Direct import of `.pptx`, `.ppt`, `.odp`, and `.pdf`. **`.pptx` + `.pdf` are the primary,
fully-tested formats**; `.ppt`/`.odp` ride the same LibreOffice path for free and are
accepted but only lightly exercised.

Flow (all in the main process, behind injectable seams so tests never spawn a binary):

1. **Pick** — parented `dialog.showOpenDialog` (see F), filter
   `['pptx','ppt','odp','pdf']`. Cancel → `{ items, canceled: true }` (see C).
2. **To PDF** — `.pdf` is used as-is; `.pptx`/`.ppt`/`.odp` →
   `soffice --headless --convert-to pdf --outdir <tmp> <src>` via the `findSoffice` seam.
3. **Rasterize** — a new `rasterize(pdfPath, outDir)` seam renders **every** PDF page to a
   per-slide PNG using **`pdfjs-dist`** (already a dependency). This **removes poppler**
   entirely and **eliminates the silent first-slide-only bug** — page count drives slide
   count. Production rasterizer pairs pdfjs with **`@napi-rs/canvas`** (N-API *prebuilt*
   binaries — no per-platform compile, unlike `better-sqlite3`). Progress is emitted per page
   (see F).
4. **Store** — PNGs written under `library/decks/<uuid>/`, ordered by page number; a
   `type:'deck'` `MediaItem` added; `{ items }` returned.

**Self-contained LibreOffice (the primary requirement).** Ship LibreOffice-headless with the
app via `electron-builder.yml` `extraResources` (the mechanism already used for
`resources/bibles`), unpacked and resolved from `process.resourcesPath`. The `findSoffice`
seam resolves in priority order: **bundled (`process.resourcesPath`) → known install
locations → PATH**, so a dev machine without a bundled copy still works if LibreOffice is
installed, and a packaged install never depends on the operator installing anything. The
vendored per-OS LibreOffice lives outside git (it's large); the build machine must have it
staged before `build:win`/`build:mac` — documented in the plan and the Windows test plan.

**Seams (`MediaImportOptions`)** — extend the existing pattern:
`findSoffice`, `convertToPdf(soffice, src, outDir)`, `rasterize(pdfPath, outDir)`. Tests
inject fakes; production wires the real soffice + pdfjs/canvas implementations. `findPdftoppm`
and the `runConvert`/`--convert-to png` fallback are **deleted**.

*Rasterization location — decided.* Main-side (above) over rendering in the renderer, because
the codebase's test model puts file/binary work behind main-process seams; renderer
rasterization would move core logic out of that testable boundary. Cost: one prebuilt native
dep (`@napi-rs/canvas`), which needs no compile toolchain.

### C. Cancel handling (repair)

`importDeck`/`importImages`/`importVideo` resolve with an explicit
`{ items: MediaItem[]; canceled?: boolean; error?: 'no-libreoffice' }`. A cancelled picker →
`{ items, canceled: true }`. The renderer deletes the "diff item ids to guess cancel"
heuristic and its long explanatory comment; a `canceled` result simply leaves selection
untouched.

### D. "+ Import" discoverability (redesign) — `SlidesTrack.tsx`

Pin **+ Import** as a header action at the **top** of the media panel, *outside* the
scrolling list container, and open its menu **downward** so all options are always on-screen
regardless of list length (fixes the empty/short-list clipping). Add a real **empty state**
in the list area ("No media yet — import slides, images, or video to get started") so a new
operator sees guidance, not a lone button. Keep inline-styles + `ThemeCtx` idioms.

### E. Import feedback + auto-select (repair)

Unify post-import handling for **all** types: given the returned `items`, select the newly
added item(s) (diff against the pre-import ids), scroll the row into view, and show a brief
"Imported ✓" confirmation. Replaces the current `refreshFrom` (`cur || l[0].id`) which left a
non-empty library's selection stuck on the old item.

### F. Progress + parented dialog (repair + new)

- **Progress:** a `media:importProgress` broadcast (same shape as the bibles / message
  installer progress in `src/main/index.ts`) reports `{ phase: 'converting' | 'rasterizing',
  page?, pageCount? }`. `SlidesTrack` shows a pending/among-the-rows spinner so a multi-second
  deck import never looks hung. Images/video are fast → a brief pending flash is enough.
- **Parented picker:** pass the operator `BrowserWindow` to `dialog.showOpenDialog` so it's a
  sheet (mac) / owned modal (Windows) and never opens behind the always-on-top outputs or on
  the projector. Main resolves the operator window (it already tracks `operatorWindow`).

### G. Delete + undo (new) — `SlidesTrack.tsx` + `src/main/mediaRepo.ts`

Right-click a media row → **Delete**, reusing the shipped primitives in
`src/renderer/operator/`: `useContextMenu`/`ContextMenu`, `useTimedUndo` + `UndoToast`
(and `useListSelection` for neighbor-selection after removal). `SlidesTrack` gains its own
context/key delegate the way `MessageMode` does (it already owns a private `slidesKeyRef`).

**Deferred-commit undo** (no re-add IPC, no orphan files): on Delete, optimistically drop the
row from local `items`, select a neighbor, and `arm(item)` the undo toast. **Undo** re-inserts
the item locally and `cancel()`s — nothing was deleted yet. On toast **expiry**, call
`window.helm.media.remove(id)`, which in main deletes the DB row **and** the on-disk media
(the file for image/video, the whole `decks/<uuid>/` dir for a deck) — closing the current
orphan-file gap. Deleting the currently-live item degrades calmly (output falls back as it
already does when the cued item goes away); no crash, no block.

## Data flow (deck import, happy path)

```
Renderer: click Import → PowerPoint/PDF
  → window.helm.media.importDeck()
Main: parented showOpenDialog → src file (or {canceled})
  → [pptx] convertToPdf(soffice, src) → tmp.pdf     (emit 'converting')
  → rasterize(tmp.pdf, decks/<uuid>/) via pdfjs      (emit 'rasterizing' page n/N)
  → write PNGs, mediaRepo.add({type:'deck', slides})
  → return { items }
Renderer: select new item, scroll into view, "Imported ✓"
  → thumbnails/hero load via helm-media:// (CSP now allows it)
```

## Testing & verification

**Unit (via seams, `*.test.ts`/`*.test.tsx`):** pdf-direct path; pptx→pdf→raster path;
per-page slide count (regression for first-slide-only); cancel → `{ canceled }`; progress
emission; missing-LibreOffice graceful fallback; `mediaRepo.remove` deletes files + row;
delete-with-undo (optimistic remove, undo restores, expiry commits); auto-select-new;
CSP string present in both HTML entrypoints.

**Real-app (macOS, the Playwright/Electron driver):** import a real multi-page **PDF** and a
real **PPTX** (LibreOffice installed locally to exercise the actual `soffice`); confirm
per-slide thumbnails render, the hero renders, **Go Live** shows on the output window, and
right-click **Delete + Undo** works. "Unit tests green" is explicitly **not** sufficient.

**Windows (the one leg I cannot drive from macOS):** the *bundled* LibreOffice path on a
packaged Windows build must be verified on a real Windows box. Fold an explicit item into
`docs/superpowers/plans/2026-07-06-mvp-windows-test-plan.md`: after `build:win`, import a
`.pptx` and a `.pdf` with **no** LibreOffice installed on the box, confirm per-slide render on
the projector, and confirm the picker is parented (not behind the audience output). This
design does **not** claim the Windows-bundled leg works until that runs.

## Out of scope (this pass)

Keynote `.key` (LibreOffice opens it poorly); rename/reorder/tag media; deck slide
re-ordering; per-slide notes; cloud import. Format set is `.pptx`/`.pdf` (primary) +
`.ppt`/`.odp` (free via LibreOffice).

## House rules

Concise conventional-commit subjects (`fix(media): …`, `feat(media): …`); **no**
`Co-Authored-By`/`Claude-Session` trailers. Keyboard-first, live-safe: Escape backs out,
failures degrade via the existing `deckFallback` modal pattern, never crash or block the
operator. Main-process binary work stays behind `MediaImportOptions` seams.
