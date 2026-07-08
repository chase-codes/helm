# Slides / Media Import — Repair + Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator can import an image, video, PDF, or PowerPoint deck and immediately see it — visible thumbnail, auto-selected, clear feedback — and can delete a mistake live mid-service without a crash or a block, with PPTX solid and self-contained on Windows.

**Architecture:** Fix the renderer CSP that silently blocks the `helm-media://` scheme (the gating bug). Redesign the deck pipeline in the main process around bundled LibreOffice (`.pptx`→PDF) + `pdfjs-dist` rasterization via `@napi-rs/canvas` (drop poppler; kill the first-slide-only bug; add PDF). Keep every binary/file operation behind injectable `MediaImportOptions` seams so tasks are unit-testable without spawning binaries. Then repair the renderer: real cancel signal, discoverable "+ Import", unified auto-select + feedback, import progress, a parented picker, and right-click Delete + undo built from the shipped interaction primitives.

**Tech Stack:** Electron 39 (main + preload + two renderers), React 19 (inline styles + `ThemeCtx`), TypeScript, Vitest (jsdom for renderer, node for main), better-sqlite3, `pdfjs-dist@5` (already a dep), `@napi-rs/canvas` (prebuilt N-API binaries, currently transitive via pdfjs — promote to a direct dep), electron-builder (`extraResources`), Playwright-Electron REPL driver at `scratch/mediaprobe/driver.mjs`.

## Global Constraints

- **House rules (`CLAUDE.md`):** concise conventional-commit subjects (`fix(media): …`, `feat(media): …`); **NO** `Co-Authored-By` / `Claude-Session` trailers; body only when it adds clarity.
- **Renderer idioms:** inline `CSSProperties` styles + `useContext(ThemeCtx)`. No CSS files, no styled-components, no new UI libs. Match neighboring components (`MessageMode.tsx`, `SongsMode.tsx`).
- **Reuse shipped primitives** for delete+undo: `useContextMenu`/`ContextMenu`, `useTimedUndo`/`UndoToast` (see `SongsMode.tsx` for the `useContextMenu` wiring; `SchedulePanel.tsx` for `UndoToast`). `SlidesTrack` already owns a private `slidesKeyRef` delegate the way `MessageMode` owns `messageKeyRef`.
- **Live-safe, keyboard-first:** Escape backs out; import/convert failures degrade via the existing `deckFallback` modal pattern — never crash or block the operator. Deleting the currently-live item must degrade calmly (output already falls back when the cued item vanishes).
- **Test model:** all main-process binary/file work stays behind `MediaImportOptions` seams; tests inject fakes and never spawn `soffice`/pdfjs against a real binary. Unit-green is explicitly **not** sufficient — every area has a real-app verification step driven through `scratch/mediaprobe/driver.mjs`.
- **`@napi-rs/canvas` is a prebuilt N-API binary** (no per-platform compile toolchain, unlike better-sqlite3). Add it to `dependencies` explicitly.
- **Per-OS LibreOffice binaries live outside git** (large). The build machine must stage `resources/libreoffice` before `build:win`/`build:mac`. The bundled-LibreOffice-on-Windows leg cannot be driven from this Mac — it is a deferred checklist item in `docs/superpowers/plans/2026-07-06-mvp-windows-test-plan.md` and is **not** marked verified until run on a real Windows box.

## Shared type contracts (locked here; every task must match these names exactly)

```ts
// src/shared/types.ts
export interface MediaImportProgress {
  phase: 'converting' | 'rasterizing';
  page?: number;       // 1-based, present during 'rasterizing'
  pageCount?: number;  // total pages, present during 'rasterizing'
}
export interface MediaImportResult {
  items: MediaItem[];
  canceled?: boolean;
  error?: 'no-libreoffice';
}
```

```ts
// src/main/mediaImport.ts
export interface MediaImportOptions {
  findSoffice?: () => string | null;
  convertToPdf?: (soffice: string, src: string, outDir: string) => Promise<string>; // returns pdf path
  rasterize?: (pdfPath: string, outDir: string, onPage?: (page: number, pageCount: number) => void) => Promise<string[]>;
  deleteFiles?: (absPaths: string[]) => void;   // unlink files / rm -rf a deck dir
  onProgress?: (p: MediaImportProgress) => void;
}
export interface MediaImport {
  importImages(): Promise<MediaImportResult>;
  importVideo(): Promise<MediaImportResult>;
  importDeck(): Promise<MediaImportResult>;
  removeMedia(id: string): MediaItem[];
}
```

Renderer IPC surface (`HelmApi.media`) after this plan:

```ts
media: {
  list(): Promise<MediaItem[]>;
  importImages(): Promise<MediaImportResult>;
  importVideo(): Promise<MediaImportResult>;
  importDeck(): Promise<MediaImportResult>;
  remove(id: string): Promise<MediaItem[]>;
  onImportProgress(cb: (p: MediaImportProgress) => void): () => void;
}
```

---

## Task order & rationale

1. **CSP allowlist (A)** — gates every visible result; nothing else is verifiable until media renders.
2. **Import result type + cancel + formats + seams (B core / C)** — reshapes the main-process contract all later tasks depend on.
3. **Production rasterizer (B) — pdfjs + @napi-rs/canvas** — the real deck engine; drops poppler.
4. **Bundled LibreOffice resolution + packaging (B)** — self-contained PPTX.
5. **"+ Import" discoverability (D)** — reposition menu + empty state.
6. **Import feedback + auto-select + cancel consumption (E / C-renderer)** — unify post-import handling.
7. **Progress + parented dialog (F)** — IPC progress broadcast + owned picker.
8. **Delete + undo (G)** — file-deleting `removeMedia` seam, then the renderer context-menu/undo.
9. **Windows checklist (docs)** — fold the bundled-LibreOffice leg into the Windows test plan; unverified.

---

## Task 1: CSP allowlist for `helm-media://` (Area A)

**Files:**
- Modify: `src/renderer/operator/index.html:9`
- Modify: `src/renderer/output/index.html:9`
- Test: `src/renderer/operator/csp.test.ts` (Create)

**Interfaces:**
- Consumes: nothing.
- Produces: both renderer HTML entrypoints allow `helm-media:` in `img-src`, `media-src`, `connect-src`. Every later visual verification depends on this.

- [ ] **Step 1: Write the failing test** — assert both HTML files allowlist the scheme in all three directives.

Create `src/renderer/operator/csp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const FILES = [
  join(__dirname, 'index.html'),
  join(__dirname, '../output/index.html')
];

describe('renderer CSP allows the helm-media scheme', () => {
  for (const file of FILES) {
    it(`${file} allowlists helm-media in img-src, media-src, connect-src`, () => {
      const html = readFileSync(file, 'utf8');
      const csp = /content="([^"]*Content-Security[^"]*)"|content="(default-src[^"]*)"/i.exec(html);
      const content = /content="(default-src[^"]*)"/i.exec(html)?.[1] ?? '';
      expect(content).toMatch(/img-src[^;]*helm-media:/);
      expect(content).toMatch(/media-src[^;]*helm-media:/);
      expect(content).toMatch(/connect-src[^;]*helm-media:/);
      // Guard the untouched directives are still locked down.
      expect(content).toMatch(/default-src 'self'/);
      expect(content).toMatch(/script-src 'self'/);
      void csp;
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/operator/csp.test.ts`
Expected: FAIL — current CSP has `img-src 'self' data:` with no `helm-media:`, and no `media-src`/`connect-src` directives.

- [ ] **Step 3: Edit `src/renderer/operator/index.html`** — replace the `content="…"` value on line 9 with:

```
content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: helm-media:; media-src 'self' helm-media:; connect-src 'self' helm-media:"
```

- [ ] **Step 4: Edit `src/renderer/output/index.html`** — apply the identical replacement on its line 9 (same string).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/operator/csp.test.ts`
Expected: PASS (both files).

- [ ] **Step 6: Real-app verification** — prove media actually renders (this is the bug the CSP fix targets; unit tests never enforce CSP).

```bash
npm run build            # driver launches the Electron binary against out/, not dev server
node scratch/mediaprobe/driver.mjs
# in the driver REPL:
launch
# stub the OS picker to return a real PNG, then import it:
stub image|/absolute/path/to/any.png
click-text Images        # opens the import menu's Images action (or click "+ Import" first)
# after import resolves, check the imported <img> actually decoded:
eval document.querySelector('img')?.naturalWidth
```

Expected: `naturalWidth > 0` (was `0` before the fix; a `0` means the broken-image glyph). Also `ss csp-ok` and eyeball the thumbnail. If `naturalWidth` is 0, the CSP edit didn't take — re-check both files.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/operator/index.html src/renderer/output/index.html src/renderer/operator/csp.test.ts
git commit -m "fix(media): allow helm-media scheme in renderer CSP"
```

---

## Task 2: Import result type, cancel signal, formats & seam signatures (Areas B-core, C)

Reshapes the main-process import contract: an explicit `{ items, canceled?, error? }` result; accepts `pptx/ppt/odp/pdf`; PDF used directly; deck flow split into injectable `convertToPdf` + `rasterize` seams; poppler (`findPdftoppm`, the `--convert-to png` fallback, `runConvertProd`) **deleted**. Production seam bodies land in Tasks 3–4; here they are wired to test fakes.

**Files:**
- Modify: `src/shared/types.ts` (add `MediaImportProgress`, `MediaImportResult`; update `HelmApi.media` return types)
- Modify: `src/main/mediaImport.ts` (result type, seams, formats, delete poppler)
- Modify: `src/main/mediaImport.test.ts`
- Modify: `src/preload/index.ts` (no signature change to `importImages`/`importVideo`/`importDeck` calls, but types now differ — verify typecheck)
- Modify: `src/renderer/operator/SlidesTrack.test.tsx` (stub returns already shaped `{ items }` for deck; update image/video stubs to `{ items }`)

**Interfaces:**
- Consumes: `MediaItem`, `MediaRepo` (unchanged).
- Produces: `MediaImportResult`, `MediaImportOptions` (with `convertToPdf`/`rasterize`/`deleteFiles`/`onProgress`), `MediaImport` (with `removeMedia`) — exactly as in the "Shared type contracts" block above. `importImages`/`importVideo`/`importDeck` all resolve `MediaImportResult`. `convertToPdf` returns the produced PDF path; `rasterize` returns per-page PNG **basenames** (relative to `outDir`).

- [ ] **Step 1: Add the shared types.** In `src/shared/types.ts`, after the `MediaItem` interface (around line 42) add:

```ts
export interface MediaImportProgress {
  phase: 'converting' | 'rasterizing';
  page?: number;
  pageCount?: number;
}
export interface MediaImportResult {
  items: MediaItem[];
  canceled?: boolean;
  error?: 'no-libreoffice';
}
```

Then update the `media` block of `HelmApi` (around line 216) to:

```ts
  media: {
    list(): Promise<MediaItem[]>;
    importImages(): Promise<MediaImportResult>;
    importVideo(): Promise<MediaImportResult>;
    importDeck(): Promise<MediaImportResult>;
    remove(id: string): Promise<MediaItem[]>;
    onImportProgress(cb: (p: MediaImportProgress) => void): () => void;
  };
```

(The `onImportProgress` sub and the `CH.mediaImportProgress` channel are implemented in Task 7; declare the type now so the contract is stable, and add a stub sub in preload in Step 6 so typecheck passes.)

- [ ] **Step 2: Write the failing tests** for the reshaped `mediaImport`. Replace the `describe('findPdftoppm', …)` block in `src/main/mediaImport.test.ts` (it tests a deleted function) and extend the `importDeck` describe. New/changed tests:

```ts
// remove the entire `describe('findPdftoppm', …)` block.

// In the createMediaImport describe, replace the two existing importDeck tests' seam
// wiring (runConvert -> convertToPdf + rasterize) and add cancel + pdf-direct + format tests:

it('returns { items, error: no-libreoffice } without opening a picker when findSoffice is null', async () => {
  const repo = makeFakeRepo();
  const convertToPdf = vi.fn();
  const rasterize = vi.fn();
  const mediaImport = createMediaImport(repo, '/lib', { findSoffice: () => null, convertToPdf, rasterize });
  const result = await mediaImport.importDeck();
  expect(result).toEqual({ items: [], error: 'no-libreoffice' });
  expect(convertToPdf).not.toHaveBeenCalled();
  expect(dialog.showOpenDialog).not.toHaveBeenCalled();
});

it('a cancelled picker resolves { items, canceled: true } and adds nothing', async () => {
  const repo = makeFakeRepo();
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] } as never);
  const mediaImport = createMediaImport(repo, '/lib', {
    findSoffice: () => '/usr/bin/soffice',
    convertToPdf: vi.fn(),
    rasterize: vi.fn()
  });
  const result = await mediaImport.importDeck();
  expect(result).toEqual({ items: [], canceled: true });
});

it('converts a .pptx via convertToPdf then rasterize, storing slides in page order', async () => {
  const repo = makeFakeRepo();
  const libRoot = mkdtempSync(join(tmpdir(), 'helm-media-test-'));
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/decks/MyDeck.pptx'] } as never);
  const convertToPdf = vi.fn().mockResolvedValue('/tmp/MyDeck.pdf');
  const rasterize = vi.fn().mockResolvedValue(['slide-0001.png', 'slide-0002.png', 'slide-0003.png']);
  const mediaImport = createMediaImport(repo, libRoot, { findSoffice: () => '/usr/bin/soffice', convertToPdf, rasterize });

  const result = await mediaImport.importDeck();

  expect(result.error).toBeUndefined();
  expect(convertToPdf).toHaveBeenCalledWith('/usr/bin/soffice', '/decks/MyDeck.pptx', expect.any(String));
  const [pdfArg, outDirArg] = rasterize.mock.calls[0] as [string, string];
  expect(pdfArg).toBe('/tmp/MyDeck.pdf');
  expect(outDirArg.startsWith(join(libRoot, 'decks'))).toBe(true);
  expect(result.items).toHaveLength(1);
  const item = result.items[0];
  expect(item.type).toBe('deck');
  expect(item.filePath).toBeNull();
  expect(item.slides.map((s) => s.split('/').pop())).toEqual(['slide-0001.png', 'slide-0002.png', 'slide-0003.png']);
  expect(item.slides.every((s) => s.startsWith('decks/'))).toBe(true);
});

it('imports a .pdf directly (no convertToPdf) and rasterizes it', async () => {
  const repo = makeFakeRepo();
  const libRoot = mkdtempSync(join(tmpdir(), 'helm-media-test-'));
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/decks/Report.pdf'] } as never);
  const convertToPdf = vi.fn();
  const rasterize = vi.fn().mockResolvedValue(['slide-0001.png']);
  const mediaImport = createMediaImport(repo, libRoot, { findSoffice: () => '/usr/bin/soffice', convertToPdf, rasterize });

  const result = await mediaImport.importDeck();

  expect(convertToPdf).not.toHaveBeenCalled();
  const [pdfArg] = rasterize.mock.calls[0] as [string];
  expect(pdfArg).toBe('/decks/Report.pdf');
  expect(result.items[0].type).toBe('deck');
  expect(result.items[0].slides).toHaveLength(1);
});

it('offers pptx, ppt, odp and pdf to the picker', async () => {
  const repo = makeFakeRepo();
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] } as never);
  const mediaImport = createMediaImport(repo, '/lib', {
    findSoffice: () => '/usr/bin/soffice', convertToPdf: vi.fn(), rasterize: vi.fn()
  });
  await mediaImport.importDeck();
  const opts = vi.mocked(dialog.showOpenDialog).mock.calls[0][0] as Electron.OpenDialogOptions;
  expect(opts.filters?.[0].extensions).toEqual(['pptx', 'ppt', 'odp', 'pdf']);
});

it('importImages resolves { items } and { canceled: true } on cancel', async () => {
  const repo = makeFakeRepo();
  const libRoot = mkdtempSync(join(tmpdir(), 'helm-media-test-'));
  const mediaImport = createMediaImport(repo, libRoot, {});
  vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] } as never);
  expect(await mediaImport.importImages()).toEqual({ items: [], canceled: true });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/main/mediaImport.test.ts`
Expected: FAIL — `convertToPdf`/`rasterize` options don't exist; `importDeck` returns `{ items }` without `canceled`; `importImages` returns an array.

- [ ] **Step 4: Rewrite `src/main/mediaImport.ts`.** Delete `KNOWN_PDFTOPPM_PATHS`, `findPdftoppm`, and `runConvertProd`. Keep `parsePngOutput`, `findSoffice`, `probeForBinary`, `runExternal`, `copyPickedFiles`. Apply these changes:

Add the deck extension list near the top:

```ts
const DECK_EXTENSIONS = ['pptx', 'ppt', 'odp', 'pdf'];
```

Change `copyPickedFiles` to return the added items (needed so image/video imports can report `items`):

```ts
function copyPickedFiles(
  repo: MediaRepo,
  libRoot: string,
  subfolder: string,
  type: MediaItem['type'],
  filePaths: string[]
): MediaItem[] {
  const destDir = join(libRoot, subfolder);
  mkdirSync(destDir, { recursive: true });
  const added: MediaItem[] = [];
  for (const filePath of filePaths) {
    const ext = extname(filePath);
    const relPath = `${subfolder}/${randomUUID()}${ext}`;
    copyFileSync(filePath, join(libRoot, relPath));
    added.push(repo.add({ type, title: basename(filePath), filePath: relPath, slides: [] }));
  }
  return added;
}
```

Replace the `MediaImport`/`MediaImportOptions` interfaces and `createMediaImport` with:

```ts
export interface MediaImport {
  importImages(): Promise<MediaImportResult>;
  importVideo(): Promise<MediaImportResult>;
  importDeck(): Promise<MediaImportResult>;
  removeMedia(id: string): MediaItem[];
}

/**
 * Injectable seams for `createMediaImport`. Tests inject fakes so importDeck runs
 * without spawning soffice or invoking pdfjs, and removeMedia runs without touching disk.
 * Production wires the real soffice (`convertToPdf`), pdfjs+canvas (`rasterize`),
 * fs unlink (`deleteFiles`) and progress broadcast (`onProgress`) in Tasks 3, 4 and 8.
 */
export interface MediaImportOptions {
  findSoffice?: () => string | null;
  convertToPdf?: (soffice: string, src: string, outDir: string) => Promise<string>;
  rasterize?: (pdfPath: string, outDir: string, onPage?: (page: number, pageCount: number) => void) => Promise<string[]>;
  deleteFiles?: (absPaths: string[]) => void;
  onProgress?: (p: MediaImportProgress) => void;
}

export function createMediaImport(
  repo: MediaRepo,
  libRoot: string,
  options: MediaImportOptions = {}
): MediaImport {
  const findSofficeFn = options.findSoffice ?? (() => findSoffice());
  const convertToPdf = options.convertToPdf ?? convertToPdfProd;   // Task 3
  const rasterize = options.rasterize ?? rasterizeProd;            // Task 3
  const deleteFiles = options.deleteFiles ?? deleteFilesProd;      // Task 8
  const emit = options.onProgress ?? (() => {});

  async function pickFiles(extensions: string[], filterName: string, multi = true): Promise<{ paths: string[]; canceled: boolean }> {
    const result = await dialog.showOpenDialog({
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: filterName, extensions }]
    });
    if (result.canceled) return { paths: [], canceled: true };
    return { paths: result.filePaths, canceled: false };
  }

  return {
    async importImages() {
      const { paths, canceled } = await pickFiles(IMAGE_EXTENSIONS, 'Images');
      if (canceled) return { items: repo.list(), canceled: true };
      copyPickedFiles(repo, libRoot, 'images', 'image', paths);
      return { items: repo.list() };
    },

    async importVideo() {
      const { paths, canceled } = await pickFiles(VIDEO_EXTENSIONS, 'Video');
      if (canceled) return { items: repo.list(), canceled: true };
      copyPickedFiles(repo, libRoot, 'video', 'video', paths);
      return { items: repo.list() };
    },

    async importDeck() {
      const soffice = findSofficeFn();
      if (soffice === null) return { items: repo.list(), error: 'no-libreoffice' };

      const { paths, canceled } = await pickFiles(DECK_EXTENSIONS, 'Presentations', false);
      if (canceled) return { items: repo.list(), canceled: true };

      const srcPath = paths[0];
      const relDeckDir = `decks/${randomUUID()}`;
      const deckDir = join(libRoot, relDeckDir);
      mkdirSync(deckDir, { recursive: true });

      let pdfPath: string;
      if (extname(srcPath).toLowerCase() === '.pdf') {
        pdfPath = srcPath;
      } else {
        emit({ phase: 'converting' });
        pdfPath = await convertToPdf(soffice, srcPath, deckDir);
      }

      const pngFiles = await rasterize(pdfPath, deckDir, (page, pageCount) =>
        emit({ phase: 'rasterizing', page, pageCount })
      );
      const slides = parsePngOutput(pngFiles).map((name) => `${relDeckDir}/${name}`);

      repo.add({ type: 'deck', title: basename(srcPath), filePath: null, slides });
      return { items: repo.list() };
    },

    removeMedia(id) {
      const item = repo.get(id);
      if (item) deleteFiles(absPathsForItem(libRoot, item));  // Task 8 defines absPathsForItem
      return repo.remove(id);
    }
  };
}
```

Add temporary placeholders so this file typechecks/tests before Tasks 3 and 8 fill them in (replaced there):

```ts
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function convertToPdfProd(_soffice: string, _src: string, _outDir: string): Promise<string> {
  throw new Error('convertToPdfProd not yet implemented');
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function rasterizeProd(_pdfPath: string, _outDir: string, _onPage?: (p: number, n: number) => void): Promise<string[]> {
  throw new Error('rasterizeProd not yet implemented');
}
function deleteFilesProd(_absPaths: string[]): void {
  throw new Error('deleteFilesProd not yet implemented');
}
function absPathsForItem(_libRoot: string, _item: MediaItem): string[] {
  throw new Error('absPathsForItem not yet implemented');
}
```

Update imports at the top of the file: add `MediaImportProgress`, `MediaImportResult` from `../shared/types`; keep `MediaRepo`, `MediaItem` from `./mediaRepo`. (`readdirSync` stays — Task 3's rasterizer uses it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/mediaImport.test.ts`
Expected: PASS (all reshaped tests; the production-seam placeholders are never hit because every test injects fakes).

- [ ] **Step 6: Add a stub `onImportProgress` in preload so the app typechecks.** In `src/preload/index.ts`, inside the `media:` block (after `remove`), add:

```ts
    onImportProgress: sub(CH.mediaImportProgress),
```

and add `mediaImportProgress: 'media:importProgress',` to `CH` in `src/shared/types.ts` (in the media group, after `mediaRemove`). This channel is broadcast in Task 7.

- [ ] **Step 7: Fix the renderer test stubs.** In `src/renderer/operator/SlidesTrack.test.tsx`, change the `importImages`/`importVideo` stubs to resolve `{ items }` and update any assertion that read them as arrays:

```ts
      importImages: vi.fn(() => Promise.resolve({ items })),
      importVideo: vi.fn(() => Promise.resolve({ items })),
      importDeck: vi.fn(() => Promise.resolve({ items })),
```

(The renderer still reads `res.items` only after Task 6; for now `SlidesTrack.tsx`'s existing `refreshFrom(l)` expects an array — Step 8 keeps the app compiling by adapting those two call sites minimally; the full unification is Task 6.)

- [ ] **Step 8: Keep `SlidesTrack.tsx` compiling.** The existing `importImages`/`importVideo` handlers call `.then(refreshFrom)` where `refreshFrom(l: MediaItem[])`. Change those two handlers to unwrap `.items` (full unification lands in Task 6):

```ts
  const importImages = (): void => {
    setImportOpen(false);
    void window.helm.media.importImages().then((r) => refreshFrom(r.items)).catch(console.error);
  };
  const importVideo = (): void => {
    setImportOpen(false);
    void window.helm.media.importVideo().then((r) => refreshFrom(r.items)).catch(console.error);
  };
```

The `importDeck` handler already reads `res.items` — leave it as-is for now (Task 6 replaces it).

- [ ] **Step 9: Run the full suite + typecheck**

Run: `npx vitest run src/main/mediaImport.test.ts src/renderer/operator/SlidesTrack.test.tsx && npm run typecheck`
Expected: PASS, clean typecheck.

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/main/mediaImport.ts src/main/mediaImport.test.ts src/preload/index.ts src/renderer/operator/SlidesTrack.tsx src/renderer/operator/SlidesTrack.test.tsx
git commit -m "refactor(media): explicit import result, cancel signal, PDF + deck seams"
```

---

## Task 3: Production rasterizer — pdfjs + @napi-rs/canvas (Area B)

Fills in `convertToPdfProd` and `rasterizeProd`. `rasterizeProd` renders **every** PDF page to a zero-padded PNG via `pdfjs-dist` + `@napi-rs/canvas` — this removes poppler and eliminates the first-slide-only bug (page count drives slide count). Because these spawn a binary / load a native module, they are **not** unit-tested against real files; they are covered by a Node smoke script and the real-app step.

**Files:**
- Modify: `package.json` (add `@napi-rs/canvas` to `dependencies`)
- Modify: `electron.vite.config.ts` (externalize deps in main/preload so pdfjs + canvas resolve at runtime)
- Modify: `src/main/mediaImport.ts` (replace the two `*Prod` placeholders)
- Create: `scratch/mediaprobe/raster-smoke.mjs` (node smoke: rasterize a real PDF)

**Interfaces:**
- Consumes: `MediaImportOptions.convertToPdf`/`rasterize` signatures from Task 2.
- Produces: real `convertToPdfProd(soffice, src, outDir): Promise<string>` (returns `<outDir>/<base>.pdf`) and `rasterizeProd(pdfPath, outDir, onPage?): Promise<string[]>` (returns `slide-0001.png…` basenames, one per page, calling `onPage(n, total)` per page).

- [ ] **Step 1: Promote `@napi-rs/canvas` to a direct dependency.**

Run: `npm install --save-exact @napi-rs/canvas@0.1.100`
Expected: `package.json` `dependencies` now lists `@napi-rs/canvas`. (It was already present transitively via pdfjs; this pins it as first-class so packaging keeps it.)

- [ ] **Step 2: Externalize main/preload deps** so electron-vite doesn't try to bundle pdfjs's ESM/worker or the native canvas. Edit `electron.vite.config.ts`:

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    // …unchanged…
  }
})
```

- [ ] **Step 3: Implement the production seams** in `src/main/mediaImport.ts`. Replace the `convertToPdfProd` and `rasterizeProd` placeholders with:

```ts
import { writeFileSync, readFileSync } from 'fs';  // add to the existing fs import line

/**
 * Convert a .pptx/.ppt/.odp to a PDF in `outDir` via headless LibreOffice, returning
 * the produced PDF's absolute path. soffice names the output `<basename>.pdf`.
 */
async function convertToPdfProd(soffice: string, src: string, outDir: string): Promise<string> {
  await runExternal(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, src]);
  return join(outDir, `${basename(src, extname(src))}.pdf`);
}

/**
 * Rasterize every page of `pdfPath` to a zero-padded PNG in `outDir` (`slide-0001.png`…)
 * using pdfjs-dist + @napi-rs/canvas. Page count drives slide count — no first-slide-only
 * truncation. Returns the PNG basenames in page order; calls `onPage(n, total)` per page.
 */
async function rasterizeProd(
  pdfPath: string,
  outDir: string,
  onPage?: (page: number, pageCount: number) => void
): Promise<string[]> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const names: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 2 }); // 2x for crisp projection
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        canvas: canvas as unknown as HTMLCanvasElement,
        viewport
      }).promise;
      const name = `slide-${String(n).padStart(4, '0')}.png`;
      writeFileSync(join(outDir, name), canvas.toBuffer('image/png'));
      names.push(name);
      onPage?.(n, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }
  return names;
}
```

(The `canvas`/`canvasContext` casts bridge `@napi-rs/canvas`'s types to pdfjs's DOM-typed `RenderParameters`; pdfjs v5's Node path accepts the napi canvas at runtime.)

- [ ] **Step 4: Write the Node smoke script** `scratch/mediaprobe/raster-smoke.mjs` — proves pdfjs+canvas rasterize a real multi-page PDF outside Electron (fast feedback before the full app run):

```js
// Usage: node scratch/mediaprobe/raster-smoke.mjs /abs/path/to/multipage.pdf /abs/out/dir
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [, , pdfPath, outDir] = process.argv;
mkdirSync(outDir, { recursive: true });
const { createCanvas } = await import('@napi-rs/canvas');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), isEvalSupported: false, useSystemFonts: true }).promise;
console.log('pages:', doc.numPages);
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 2 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport: vp }).promise;
  const name = `slide-${String(n).padStart(4, '0')}.png`;
  writeFileSync(join(outDir, name), canvas.toBuffer('image/png'));
  console.log('wrote', name, canvas.width + 'x' + canvas.height);
}
await doc.destroy();
```

- [ ] **Step 5: Run the smoke script against a real multi-page PDF**

```bash
node scratch/mediaprobe/raster-smoke.mjs /absolute/path/to/some-multipage.pdf /tmp/helm-raster-out
ls /tmp/helm-raster-out
```

Expected: `pages: N` with `N > 1`, and N PNG files `slide-0001.png … slide-000N.png`, each with non-zero dimensions. If this fails with a module-resolution error, the `pdfjs-dist/legacy/build/pdf.mjs` path or the napi canvas install is wrong — fix before proceeding.

- [ ] **Step 6: Run the existing unit suite + typecheck** (the placeholders' tests still pass because tests inject fakes; this confirms the real bodies typecheck):

Run: `npx vitest run src/main/mediaImport.test.ts && npm run typecheck`
Expected: PASS, clean typecheck.

- [ ] **Step 7: Real-app verification — import a real PDF end-to-end.** Requires the deck production wiring in `src/main/index.ts` to pass no seam overrides (it already calls `createMediaImport(mediaRepo, libRoot)` — the defaults are now the real `*Prod`). Task 4 wires bundled soffice; PDF import needs no soffice, so it works now.

```bash
npm run build
node scratch/mediaprobe/driver.mjs
# REPL:
launch
stub deck|/absolute/path/to/some-multipage.pdf
click-text + Import
click-text PowerPoint      # or the relabeled action from Task 5 if run after it
# wait for import to resolve, then:
eval window.helm.media.list().then(l => l[0].slides.length)
eval Array.from(document.querySelectorAll('img')).filter(i => i.naturalWidth>0).length
ss pdf-import
```

Expected: `slides.length === (PDF page count)` (multi-page, proving no first-slide-only truncation) and multiple thumbnails with `naturalWidth > 0`. Eyeball `ss pdf-import` — per-slide thumbnails visible in the deck rail.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts src/main/mediaImport.ts scratch/mediaprobe/raster-smoke.mjs
git commit -m "feat(media): rasterize decks via pdfjs + napi canvas, drop poppler"
```

---

## Task 4: Bundled LibreOffice resolution + packaging (Area B)

Resolve `soffice` in priority order **bundled (`process.resourcesPath`) → known install locations → PATH**, and ship LibreOffice-headless via `electron-builder.yml` `extraResources`. A dev machine without a bundled copy still works if LibreOffice is installed; a packaged install never depends on the operator installing anything.

**Files:**
- Modify: `src/main/mediaImport.ts` (`findSoffice` gains a resources-path arg + bundled candidates)
- Modify: `src/main/mediaImport.test.ts`
- Modify: `src/main/index.ts` (pass `process.resourcesPath` into the production `findSoffice`)
- Modify: `electron-builder.yml` (`extraResources` for `resources/libreoffice`)
- Modify: `docs/superpowers/plans/2026-07-06-mvp-windows-test-plan.md` (staging note — see Task 9 for the verification checklist item)

**Interfaces:**
- Consumes: `findSoffice(exists?, resourcesPath?)`.
- Produces: `findSoffice(exists = existsSync, resourcesPath?: string): string | null` — checks bundled candidates derived from `resourcesPath` first, then `KNOWN_SOFFICE_PATHS`, then PATH. `bundledSofficeCandidates(resourcesPath): string[]` (exported for the test).

- [ ] **Step 1: Write the failing tests.** Add to the `describe('findSoffice', …)` block in `src/main/mediaImport.test.ts`:

```ts
it('prefers the bundled soffice under resourcesPath over a known install', () => {
  const bundled = bundledSofficeCandidates('/app/resources')[0];
  const exists = (p: string): boolean =>
    p === bundled || p === '/Applications/LibreOffice.app/Contents/MacOS/soffice';
  expect(findSoffice(exists, '/app/resources')).toBe(bundled);
});

it('falls back to a known install when no bundled copy exists', () => {
  const exists = (p: string): boolean => p === '/Applications/LibreOffice.app/Contents/MacOS/soffice';
  expect(findSoffice(exists, '/app/resources')).toBe('/Applications/LibreOffice.app/Contents/MacOS/soffice');
});

it('bundledSofficeCandidates returns platform-appropriate paths under resourcesPath', () => {
  const cands = bundledSofficeCandidates('/app/resources');
  expect(cands.length).toBeGreaterThan(0);
  expect(cands.every((c) => c.startsWith('/app/resources'))).toBe(true);
});
```

Add `bundledSofficeCandidates` to the import from `./mediaImport` at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/mediaImport.test.ts -t findSoffice`
Expected: FAIL — `bundledSofficeCandidates` is undefined; `findSoffice` ignores a resources path.

- [ ] **Step 3: Implement in `src/main/mediaImport.ts`.** Add above `findSoffice`:

```ts
/**
 * Candidate paths for a LibreOffice `soffice` binary bundled next to the app via
 * electron-builder `extraResources` (staged at `<resourcesPath>/libreoffice`). Layout
 * differs per OS because the vendored tree mirrors LibreOffice's own install shape.
 */
export function bundledSofficeCandidates(resourcesPath: string): string[] {
  const root = join(resourcesPath, 'libreoffice');
  if (process.platform === 'win32') return [join(root, 'program', 'soffice.exe')];
  if (process.platform === 'darwin') return [join(root, 'MacOS', 'soffice'), join(root, 'program', 'soffice')];
  return [join(root, 'program', 'soffice'), join(root, 'opt', 'libreoffice', 'program', 'soffice')];
}
```

Change `findSoffice`:

```ts
export function findSoffice(
  exists: (p: string) => boolean = existsSync,
  resourcesPath?: string
): string | null {
  if (resourcesPath) {
    for (const candidate of bundledSofficeCandidates(resourcesPath)) {
      if (exists(candidate)) return candidate;
    }
  }
  return probeForBinary(KNOWN_SOFFICE_PATHS, 'soffice', 'soffice.exe', exists);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/mediaImport.test.ts -t findSoffice`
Expected: PASS.

- [ ] **Step 5: Wire the resources path into production.** In `src/main/index.ts`, change the media-import construction (line ~166) to inject the real `findSoffice` bound to `process.resourcesPath`:

```ts
  const mediaRepo = createMediaRepo(db)
  const mediaImport = createMediaImport(mediaRepo, libRoot, {
    findSoffice: () => findSoffice(undefined, process.resourcesPath)
  })
```

and add `findSoffice` to the import from `./mediaImport`:

```ts
import { createMediaImport, findSoffice } from './mediaImport'
```

- [ ] **Step 6: Add `extraResources` for LibreOffice** in `electron-builder.yml`, under the existing `extraResources:` list:

```yaml
extraResources:
  - from: resources/bibles
    to: bibles
  - from: resources/libreoffice
    to: libreoffice
```

Add a comment above it in the file:

```yaml
# resources/libreoffice is a vendored, per-OS LibreOffice-headless tree kept OUTSIDE git
# (large). It MUST be staged on the build machine before build:win / build:mac. If the
# folder is absent the build still succeeds but PPTX import degrades to the
# no-libreoffice fallback modal at runtime.
```

- [ ] **Step 7: Typecheck + full main suite**

Run: `npm run typecheck && npx vitest run src/main/mediaImport.test.ts`
Expected: PASS.

- [ ] **Step 8: Real-app verification (macOS, LibreOffice installed locally).** Install LibreOffice on the dev Mac if absent (`brew install --cask libreoffice`) — this exercises the *known-install* leg of `findSoffice` (the *bundled* leg is Windows-only and deferred to Task 9). Then import a real `.pptx`:

```bash
npm run build
node scratch/mediaprobe/driver.mjs
# REPL:
launch
stub deck|/absolute/path/to/real.pptx
click-text + Import
click-text PowerPoint
eval window.helm.media.list().then(l => l[0].slides.length)
ss pptx-import
```

Expected: `slides.length` equals the deck's slide count (multi-slide), per-slide thumbnails render. If it returns the `no-libreoffice` modal, `findSoffice` didn't find the binary — check `which soffice` / the known paths.

- [ ] **Step 9: Commit**

```bash
git add src/main/mediaImport.ts src/main/mediaImport.test.ts src/main/index.ts electron-builder.yml
git commit -m "feat(media): resolve bundled LibreOffice, ship it via extraResources"
```

---

## Task 5: "+ Import" discoverability — header action + empty state (Area D)

Pin **+ Import** as a header action at the top of the media panel, **outside** the scrolling list, opening its menu **downward** so options are always on-screen regardless of list length (fixes the empty/short-list clipping where the upward popover renders above the panel and is clipped by `overflow-y:auto`). Add a real empty state.

**Files:**
- Modify: `src/renderer/operator/SlidesTrack.tsx`
- Modify: `src/renderer/operator/SlidesTrack.test.tsx`

**Interfaces:**
- Consumes: existing `importOpen` state, `importImages`/`importVideo`/`importDeck` handlers.
- Produces: `+ Import` button lives in a header row above the scroll container; `importPopStyle` opens downward (`top`, not `bottom`); an empty-state block renders in the list area when `items.length === 0`.

- [ ] **Step 1: Write the failing tests.** Add to `src/renderer/operator/SlidesTrack.test.tsx`:

```ts
it('shows an empty-state hint when the library has no items', async () => {
  const empty = { ...makeHelm(), media: { list: () => Promise.resolve([]),
    importImages: vi.fn(() => Promise.resolve({ items: [] })),
    importVideo: vi.fn(() => Promise.resolve({ items: [] })),
    importDeck: vi.fn(() => Promise.resolve({ items: [] })),
    remove: vi.fn(() => Promise.resolve([])) } };
  (window as unknown as { helm: unknown }).helm = empty;
  renderTrack();
  expect(await screen.findByText(/No media yet/i)).toBeTruthy();
});

it('the import menu opens downward (top-anchored, not bottom-anchored)', async () => {
  installHelmStub();
  renderTrack();
  const importBtn = (await screen.findByText('+ Import')).closest('button') as HTMLButtonElement;
  fireEvent.click(importBtn);
  const menu = (await screen.findByText('Images')).closest('div') as HTMLElement;
  // The popover container carries an explicit top offset and no bottom offset.
  expect(menu.style.bottom).toBe('');
  expect(menu.style.top).not.toBe('');
});
```

Add a small `makeHelm()` helper near `installHelmStub` that returns the same object shape (presentation/video blocks) so the empty test can override only `media`. If simpler, inline the full helm object in the empty test mirroring `installHelmStub`. Keep it DRY by extracting the presentation/video sub-objects into a `baseHelm()` used by both.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/operator/SlidesTrack.test.tsx -t "empty-state|downward"`
Expected: FAIL — no empty-state text; the popover is `bottom: 46px` (upward).

- [ ] **Step 3: Restructure the panel in `src/renderer/operator/SlidesTrack.tsx`.** Move the `+ Import` button + menu out of the scroll container into a header row directly under the "PRESENTATIONS & MEDIA" label, and render an empty state inside the scroll container. Replace the rail's JSX (the `<div style={railStyle}>` … first `</div>` after the list) with:

```tsx
      <div style={railStyle}>
        <div style={{ padding: '12px 12px 10px', flexShrink: 0 }}>
          <TrackTabs theme={T} track={track} setTrack={setTrack} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 9px', flexShrink: 0 }}>
          <div style={{ fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600 }}>PRESENTATIONS &amp; MEDIA</div>
          <div style={{ position: 'relative' }}>
            <button style={importHeaderBtnStyle} onClick={() => setImportOpen((o) => !o)}>
              + Import
            </button>
            {importOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onClick={() => setImportOpen(false)} />
                <div style={importPopStyle}>
                  <button style={importRowStyle} onClick={importImages}>Images</button>
                  <button style={importRowStyle} onClick={importVideo}>Video</button>
                  <button style={importRowStyle} onClick={importDeck}>Slides / PDF</button>
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {items.length === 0 && (
            <div style={emptyStateStyle}>
              No media yet — import slides, images, or video with <b>+ Import</b> to get started.
            </div>
          )}
          {items.map((item) => (
            <button key={item.id} style={rowStyle(item.id === selId)} onClick={() => selectItem(item)}>
              <div style={thumbBoxStyle}>
                <SlideCanvas slide={slidesOf(item)[0]} fill />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {iconFor(item)} {item.title}
                </div>
                <div style={{ fontSize: '11px', color: T.faint, marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{metaFor(item)}</div>
              </div>
              {item.id === selId && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: T.live, flexShrink: 0 }} />}
            </button>
          ))}
        </div>
      </div>
```

- [ ] **Step 4: Replace the import styles.** Remove `importBtnStyle` (the old full-width bottom button). Change `importPopStyle` to open downward and add the header-button + empty-state styles:

```ts
  const importHeaderBtnStyle: CSSProperties = {
    height: '26px',
    padding: '0 10px',
    borderRadius: '8px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    border: 'none',
    color: T.dim,
    fontSize: '12px',
    fontWeight: 600,
    background: 'transparent'
  };
  const importPopStyle: CSSProperties = {
    position: 'absolute',
    top: '30px',   // opens DOWNWARD from the header button (was bottom: 46px)
    right: 0,
    zIndex: 40,
    width: '180px',
    background: T.panel3,
    borderRadius: '12px',
    padding: '6px',
    boxShadow: T.floatShadow
  };
  const emptyStateStyle: CSSProperties = {
    margin: '8px 2px',
    padding: '18px 14px',
    borderRadius: '11px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    color: T.faint,
    fontSize: '12.5px',
    lineHeight: 1.5,
    textAlign: 'center'
  };
```

Keep `importRowStyle` unchanged. Update the existing "shows the LibreOffice-missing fallback modal" and cancel tests: the menu label changed from `PowerPoint` to `Slides / PDF` — update those `findByText('PowerPoint')` calls to `findByText('Slides / PDF')`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SlidesTrack.test.tsx`
Expected: PASS (empty-state + downward-menu + updated label tests).

- [ ] **Step 6: Real-app verification — empty state + reachable menu.** Import discoverability was broken specifically in the empty state, so verify there:

```bash
npm run build
node scratch/mediaprobe/driver.mjs
# REPL (with an empty library — fresh userData, or delete existing media rows first):
launch
eval document.body.innerText.includes('No media yet')
click-text + Import
eval (() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Images'); const r=b.getBoundingClientRect(); return {top:r.top, visible:r.top>0 && r.top<window.innerHeight}; })()
ss import-menu-open
```

Expected: empty-state text present; after clicking **+ Import**, the `Images` action's `top` is a positive on-screen value (`visible: true`) — not the old clipped `y = 37–140px` above the scroll region. Eyeball `ss import-menu-open`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/operator/SlidesTrack.tsx src/renderer/operator/SlidesTrack.test.tsx
git commit -m "feat(media): make + Import discoverable with a top header menu + empty state"
```

---

## Task 6: Unified auto-select, feedback & cancel consumption (Areas E, C-renderer)

Unify post-import handling for **all** types: given the returned `items`, select the newly added item(s) (diff against pre-import ids), scroll the row into view, show a brief "Imported ✓". Replace the id-diff cancel heuristic with the real `canceled` flag; a `canceled` result leaves selection untouched. Delete the long "diff item ids to guess cancel" comment.

**Files:**
- Modify: `src/renderer/operator/SlidesTrack.tsx`
- Modify: `src/renderer/operator/SlidesTrack.test.tsx`

**Interfaces:**
- Consumes: `MediaImportResult` (`{ items, canceled?, error? }`) from all three import calls.
- Produces: a single `applyImport(res, prevIds)` path used by images, video, and deck; a `justImported` boolean state that renders the "Imported ✓" chip; row auto-scroll via a `ref` map or `scrollIntoView` by data attribute.

- [ ] **Step 1: Write the failing tests.** Add to `src/renderer/operator/SlidesTrack.test.tsx`:

```ts
it('auto-selects a newly imported image (non-empty library) instead of keeping the old selection', async () => {
  installHelmStub();
  const newItem: MediaItem = { id: 'imgNEW', type: 'image', title: 'New.jpg', filePath: 'imgNEW.jpg', slides: [], createdAt: 9 };
  window.helm.media.importImages = vi.fn(async () => ({ items: [newItem, ...items] }));
  renderTrack();
  await screen.findByText('▤ Sermon.pptx');       // library loaded, deck selected by default
  fireEvent.click((await screen.findByText('+ Import')).closest('button') as HTMLButtonElement);
  fireEvent.click((await screen.findByText('Images')).closest('button') as HTMLButtonElement);
  // The new image becomes selected (its row shows the live dot), old deck no longer selected.
  await screen.findByText('▣ New.jpg');
  await waitFor(() => {
    const row = (screen.getByText('▣ New.jpg').closest('button')) as HTMLButtonElement;
    expect(row.querySelector('span[style*="border-radius: 50%"]')).toBeTruthy();
  });
});

it('shows a brief "Imported ✓" confirmation after a successful import', async () => {
  installHelmStub();
  const newItem: MediaItem = { id: 'imgNEW', type: 'image', title: 'New.jpg', filePath: 'imgNEW.jpg', slides: [], createdAt: 9 };
  window.helm.media.importImages = vi.fn(async () => ({ items: [newItem, ...items] }));
  renderTrack();
  await screen.findByText('▤ Sermon.pptx');
  fireEvent.click((await screen.findByText('+ Import')).closest('button') as HTMLButtonElement);
  fireEvent.click((await screen.findByText('Images')).closest('button') as HTMLButtonElement);
  expect(await screen.findByText(/Imported/)).toBeTruthy();
});

it('a canceled import (canceled:true) leaves the current selection untouched', async () => {
  const { cue } = installHelmStub();
  renderTrack();
  const imgRow = (await screen.findByText('▣ Welcome.jpg')).closest('button') as HTMLButtonElement;
  fireEvent.click(imgRow);
  await screen.findByText('▣ Welcome.jpg');
  cue.mockClear();
  window.helm.media.importDeck = vi.fn(async () => ({ items, canceled: true }));
  fireEvent.click((await screen.findByText('+ Import')).closest('button') as HTMLButtonElement);
  fireEvent.click((await screen.findByText('Slides / PDF')).closest('button') as HTMLButtonElement);
  await screen.findByText('▣ Welcome.jpg');
  expect(screen.queryByText('1')).toBeNull(); // no deck rail — selection still the image
  expect(cue).not.toHaveBeenCalledWith(expect.stringContaining('deck1'), expect.anything());
});
```

Keep the existing "cancelling the PowerPoint picker (same items, no new id)" test but update it to pass `{ items, canceled: true }` (the heuristic it documented is being deleted) — or delete it in favor of the new canceled test above. Prefer updating: rename it and set `canceled: true`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/operator/SlidesTrack.test.tsx -t "auto-selects|Imported|canceled"`
Expected: FAIL — images use `refreshFrom` (keeps old selection); no confirmation chip; deck path still uses the id-diff heuristic.

- [ ] **Step 3: Add the unified import handler.** In `src/renderer/operator/SlidesTrack.tsx`, add a `justImported` state near the other `useState`s:

```ts
  const [justImported, setJustImported] = useState(false);
```

Add a self-clearing effect (mirrors `useTimedUndo`'s pattern) after the existing effects:

```ts
  // Brief post-import confirmation; clears itself after 2.2s.
  useEffect(() => {
    if (!justImported) return;
    const t = setTimeout(() => setJustImported(false), 2200);
    return () => clearTimeout(t);
  }, [justImported]);
```

Replace `refreshFrom`, `importImages`, `importVideo`, `importDeck` (and delete the long id-diff comment block) with:

```ts
  // Unified post-import handling for every media type: a canceled picker leaves selection
  // untouched; otherwise select the newly-added item (diff against the ids captured before
  // the import), scroll it into view, and flash "Imported ✓". Replaces the old per-type
  // refreshFrom (which left a non-empty library stuck on its prior selection) and the
  // fragile id-diff cancel heuristic (main now returns an explicit `canceled` flag).
  const applyImport = (res: MediaImportResult, prevIds: Set<string>): void => {
    if (res.canceled) return;
    const added = res.items.find((i) => !prevIds.has(i.id));
    setItems(res.items);
    if (added) {
      setSelId(added.id);
      setSlideIdx(0);
      setJustImported(true);
      requestAnimationFrame(() => {
        document.querySelector(`[data-media-id="${added.id}"]`)?.scrollIntoView({ block: 'nearest' });
      });
    }
  };

  const runImport = (
    call: () => Promise<MediaImportResult>,
    onError?: (err: unknown) => void
  ): void => {
    setImportOpen(false);
    const prevIds = new Set(items.map((i) => i.id));
    void call()
      .then((res) => {
        if (res.error === 'no-libreoffice') { setDeckFallback('no-libreoffice'); return; }
        applyImport(res, prevIds);
      })
      .catch((err: unknown) => { console.error(err); onError?.(err); });
  };

  const importImages = (): void => runImport(() => window.helm.media.importImages());
  const importVideo = (): void => runImport(() => window.helm.media.importVideo());
  const importDeck = (): void => runImport(
    () => window.helm.media.importDeck(),
    () => setDeckFallback('failed')
  );
```

Add the import for the type at the top of the file:

```ts
import type { MediaItem, MediaImportResult, Slide } from '../../shared/types';
```

Add `data-media-id={item.id}` to the library row `<button>` so `scrollIntoView` can find it:

```tsx
            <button key={item.id} data-media-id={item.id} style={rowStyle(item.id === selId)} onClick={() => selectItem(item)}>
```

- [ ] **Step 4: Render the "Imported ✓" chip.** In the header row (from Task 5), show it beside the label when `justImported`:

```tsx
          <div style={{ fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600 }}>
            PRESENTATIONS &amp; MEDIA {justImported && <span style={{ color: T.live, letterSpacing: 0 }}>· Imported ✓</span>}
          </div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SlidesTrack.test.tsx`
Expected: PASS.

- [ ] **Step 6: Real-app verification — second import auto-selects + confirms.** The bug was a second import into a non-empty library looking inert:

```bash
npm run build
node scratch/mediaprobe/driver.mjs
# REPL (library already has ≥1 item):
launch
stub image|/absolute/path/to/second.png
click-text + Import
click-text Images
eval (async () => { const l = await window.helm.media.list(); return l[0].title; })()   # newest
eval document.body.innerText.includes('Imported')
ss auto-select
```

Expected: the newly imported item is selected (its title matches list[0]) and "Imported ✓" appears briefly. Eyeball `ss auto-select` — the new row highlighted with the live dot.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/operator/SlidesTrack.tsx src/renderer/operator/SlidesTrack.test.tsx
git commit -m "fix(media): auto-select imports, confirm success, honor real cancel flag"
```

---

## Task 7: Import progress broadcast + parented picker (Area F)

Broadcast a `media:importProgress` event (same shape/pattern as the bibles/message installer progress in `src/main/index.ts`) so a multi-second deck import never looks hung, and parent the file picker to the operator window so it can't open behind the always-on-top outputs.

**Files:**
- Modify: `src/main/index.ts` (broadcast fn; wire `onProgress` into `createMediaImport`; pass operator window to the picker)
- Modify: `src/main/mediaImport.ts` (parent the `showOpenDialog`)
- Modify: `src/main/mediaImport.test.ts` (progress emission via the seam)
- Modify: `src/renderer/operator/SlidesTrack.tsx` (subscribe; show a pending/among-the-rows spinner)
- Modify: `src/renderer/operator/SlidesTrack.test.tsx`

**Interfaces:**
- Consumes: `MediaImportOptions.onProgress` (Task 2), `CH.mediaImportProgress` (Task 2 Step 6), `HelmApi.media.onImportProgress` (Task 2 Step 1).
- Produces: `createMediaImport` emits `{ phase: 'converting' }` before conversion and `{ phase: 'rasterizing', page, pageCount }` per page (already wired in Task 2's `importDeck`); the picker is parented; the renderer shows a spinner row while a deck import is in flight.

- [ ] **Step 1: Write the failing main test** — progress is emitted through the seam. Add to `src/main/mediaImport.test.ts`:

```ts
it('emits converting then per-page rasterizing progress for a pptx import', async () => {
  const repo = makeFakeRepo();
  const libRoot = mkdtempSync(join(tmpdir(), 'helm-media-test-'));
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/d/Deck.pptx'] } as never);
  const progress: MediaImportProgress[] = [];
  const rasterize = vi.fn(async (_pdf: string, _out: string, onPage?: (p: number, n: number) => void) => {
    onPage?.(1, 2); onPage?.(2, 2);
    return ['slide-0001.png', 'slide-0002.png'];
  });
  const mediaImport = createMediaImport(repo, libRoot, {
    findSoffice: () => '/usr/bin/soffice',
    convertToPdf: vi.fn().mockResolvedValue('/tmp/Deck.pdf'),
    rasterize,
    onProgress: (p) => progress.push(p)
  });
  await mediaImport.importDeck();
  expect(progress[0]).toEqual({ phase: 'converting' });
  expect(progress).toContainEqual({ phase: 'rasterizing', page: 1, pageCount: 2 });
  expect(progress).toContainEqual({ phase: 'rasterizing', page: 2, pageCount: 2 });
});

it('does not emit a converting phase for a direct pdf import', async () => {
  const repo = makeFakeRepo();
  const libRoot = mkdtempSync(join(tmpdir(), 'helm-media-test-'));
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/d/Report.pdf'] } as never);
  const progress: MediaImportProgress[] = [];
  const mediaImport = createMediaImport(repo, libRoot, {
    findSoffice: () => '/usr/bin/soffice',
    convertToPdf: vi.fn(),
    rasterize: vi.fn(async (_p, _o, onPage) => { onPage?.(1, 1); return ['slide-0001.png']; }),
    onProgress: (p) => progress.push(p)
  });
  await mediaImport.importDeck();
  expect(progress.some((p) => p.phase === 'converting')).toBe(false);
});
```

Add `MediaImportProgress` to the type import in the test file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/mediaImport.test.ts -t progress`
Expected: FAIL only if Task 2's `emit(...)` calls were omitted; if Task 2 wired them correctly these pass immediately — in that case, treat this step as the regression lock and continue. (If they fail, add the `emit({ phase: 'converting' })` and the `onPage` bridge in `importDeck` per Task 2 Step 4.)

- [ ] **Step 3: Parent the picker** in `src/main/mediaImport.ts`. Accept an optional window resolver in `MediaImportOptions`:

```ts
  getParentWindow?: () => Electron.BrowserWindow | null;
```

and use it in `pickFiles`:

```ts
    async function pickFiles(extensions, filterName, multi = true) {
      const parent = options.getParentWindow?.() ?? null;
      const dialogOpts = {
        properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: [{ name: filterName, extensions }]
      } as Electron.OpenDialogOptions;
      const result = parent
        ? await dialog.showOpenDialog(parent, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts);
      if (result.canceled) return { paths: [], canceled: true };
      return { paths: result.filePaths, canceled: false };
    }
```

(Tests call the no-parent branch since they don't inject `getParentWindow`; existing `dialog.showOpenDialog` mock still matches.)

- [ ] **Step 4: Wire broadcast + parent + progress in `src/main/index.ts`.** Add a broadcast fn near the other `broadcast*` helpers:

```ts
  const broadcastMediaProgress = (p: MediaImportProgress): void => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.mediaImportProgress, p)
  }
```

and change the media-import construction to inject it plus the parent-window resolver:

```ts
  const mediaImport = createMediaImport(mediaRepo, libRoot, {
    findSoffice: () => findSoffice(undefined, process.resourcesPath),
    onProgress: broadcastMediaProgress,
    getParentWindow: () => operatorWindow
  })
```

Add `MediaImportProgress` to the type import from `../shared/types` at the top.

- [ ] **Step 5: Write the failing renderer test** — a spinner shows while a deck import is pending. Add to `src/renderer/operator/SlidesTrack.test.tsx`:

```ts
it('shows an importing spinner while a deck import is in flight, then clears it', async () => {
  installHelmStub();
  let resolveImport!: (r: { items: MediaItem[] }) => void;
  window.helm.media.importDeck = vi.fn(() => new Promise((res) => { resolveImport = res; }));
  renderTrack();
  await screen.findByText('▤ Sermon.pptx');
  fireEvent.click((await screen.findByText('+ Import')).closest('button') as HTMLButtonElement);
  fireEvent.click((await screen.findByText('Slides / PDF')).closest('button') as HTMLButtonElement);
  expect(await screen.findByText(/Importing/i)).toBeTruthy();
  resolveImport({ items });
  await waitFor(() => expect(screen.queryByText(/Importing/i)).toBeNull());
});
```

The `installHelmStub` `media` block needs `onImportProgress: () => () => {}` added.

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/renderer/operator/SlidesTrack.test.tsx -t "importing spinner"`
Expected: FAIL — no importing state.

- [ ] **Step 7: Implement the renderer progress UI** in `src/renderer/operator/SlidesTrack.tsx`. Add state:

```ts
  const [importing, setImporting] = useState<null | { label: string }>(null);
```

Subscribe to progress (updates the spinner label with page counts):

```ts
  useEffect(() => {
    const off = window.helm.media.onImportProgress((p) => {
      setImporting({
        label: p.phase === 'converting'
          ? 'Converting…'
          : `Rasterizing ${p.page ?? 0}/${p.pageCount ?? 0}…`
      });
    });
    return off;
  }, []);
```

Set/clear `importing` around a deck import — extend `runImport` to take a `pending` flag, or set it inline in `importDeck`:

```ts
  const importDeck = (): void => {
    setImporting({ label: 'Importing…' });
    runImport(
      () => window.helm.media.importDeck(),
      () => setDeckFallback('failed')
    );
  };
```

and clear it at the end of `runImport`'s `.then`/`.catch` (both branches):

```ts
      .then((res) => {
        setImporting(null);
        if (res.error === 'no-libreoffice') { setDeckFallback('no-libreoffice'); return; }
        applyImport(res, prevIds);
      })
      .catch((err: unknown) => { setImporting(null); console.error(err); onError?.(err); });
```

Render a spinner row at the top of the scroll container (above the item list):

```tsx
          {importing && (
            <div style={importingRowStyle}>
              <span style={{ opacity: 0.8 }}>⏳</span> {importing.label}
            </div>
          )}
```

with:

```ts
  const importingRowStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '8px',
    margin: '4px 2px', padding: '10px 12px', borderRadius: '10px',
    background: T.panel3, color: T.dim, fontSize: '12.5px', fontWeight: 600
  };
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run src/main/mediaImport.test.ts src/renderer/operator/SlidesTrack.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Real-app verification — progress + parented picker.**

```bash
npm run build
node scratch/mediaprobe/driver.mjs
# REPL — progress: import a multi-page PDF and watch the spinner update:
launch
stub deck|/absolute/path/to/multipage.pdf
click-text + Import
click-text Slides / PDF
eval document.body.innerText.match(/Rasterizing \d+\/\d+/)?.[0] || document.body.innerText.match(/Importing|Converting/)?.[0]
ss import-progress
```

Expected: a `Rasterizing n/N` (or `Importing…`) label appears during import, then clears. For the **parented picker**, verify manually (the stub bypasses the native dialog): temporarily un-stub, open a real output window (`View → Open Test Output`), then trigger a real import and confirm the OS picker appears as a sheet over the operator window, not behind the always-on-top output. Note this in the verification log.

- [ ] **Step 10: Commit**

```bash
git add src/main/index.ts src/main/mediaImport.ts src/main/mediaImport.test.ts src/renderer/operator/SlidesTrack.tsx src/renderer/operator/SlidesTrack.test.tsx
git commit -m "feat(media): import progress spinner + parent the file picker to the operator window"
```

---

## Task 8a: File-deleting `removeMedia` seam (Area G — main)

`media.remove` currently deletes only the DB row, orphaning files. Implement `removeMedia(id)` to delete the on-disk media (the file for image/video, the whole `decks/<uuid>/` dir for a deck) **and** the row, behind an injectable `deleteFiles` seam so it's unit-testable without touching real disk (real path via a tmp dir).

**Files:**
- Modify: `src/main/mediaImport.ts` (implement `absPathsForItem`, `deleteFilesProd`)
- Modify: `src/main/ipc.ts` (route `media:remove` to `mediaImport.removeMedia`)
- Modify: `src/main/mediaImport.test.ts`

**Interfaces:**
- Consumes: `MediaImport.removeMedia` (declared in Task 2), `MediaRepo.get`/`remove`.
- Produces: `absPathsForItem(libRoot, item): string[]` — for image/video, `[libRoot/filePath]`; for a deck, `[dirname(libRoot/slides[0])]` (the deck dir). `deleteFilesProd(absPaths)` removes each path recursively (`rmSync(p, { recursive: true, force: true })`).

- [ ] **Step 1: Write the failing tests.** Add to `src/main/mediaImport.test.ts` a describe for removal, using a real tmp dir so file deletion is observable:

```ts
import { mkdirSync, writeFileSync, existsSync } from 'fs';

describe('createMediaImport / removeMedia', () => {
  it('deletes an image file and its row', async () => {
    const libRoot = mkdtempSync(join(tmpdir(), 'helm-media-rm-'));
    mkdirSync(join(libRoot, 'images'), { recursive: true });
    const rel = 'images/pic.png';
    writeFileSync(join(libRoot, rel), 'x');
    const repo = makeFakeRepo();
    const item = repo.add({ type: 'image', title: 'pic.png', filePath: rel, slides: [] });
    const mediaImport = createMediaImport(repo, libRoot, {});
    const remaining = mediaImport.removeMedia(item.id);
    expect(existsSync(join(libRoot, rel))).toBe(false);
    expect(remaining.find((i) => i.id === item.id)).toBeUndefined();
  });

  it('deletes an entire deck directory and its row', () => {
    const libRoot = mkdtempSync(join(tmpdir(), 'helm-media-rm-'));
    const deckDir = join(libRoot, 'decks', 'abc');
    mkdirSync(deckDir, { recursive: true });
    writeFileSync(join(deckDir, 'slide-0001.png'), 'x');
    writeFileSync(join(deckDir, 'slide-0002.png'), 'x');
    const repo = makeFakeRepo();
    const item = repo.add({ type: 'deck', title: 'D', filePath: null, slides: ['decks/abc/slide-0001.png', 'decks/abc/slide-0002.png'] });
    const mediaImport = createMediaImport(repo, libRoot, {});
    mediaImport.removeMedia(item.id);
    expect(existsSync(deckDir)).toBe(false);
  });

  it('deleteFiles seam is invoked with the resolved paths (no disk touch when injected)', () => {
    const repo = makeFakeRepo();
    const item = repo.add({ type: 'image', title: 'p', filePath: 'images/p.png', slides: [] });
    const deleted: string[][] = [];
    const mediaImport = createMediaImport(repo, '/lib', { deleteFiles: (paths) => deleted.push(paths) });
    mediaImport.removeMedia(item.id);
    expect(deleted[0]).toEqual([join('/lib', 'images/p.png')]);
  });

  it('removing an unknown id is a no-op that still returns the list', () => {
    const repo = makeFakeRepo();
    const mediaImport = createMediaImport(repo, '/lib', { deleteFiles: () => { throw new Error('should not delete'); } });
    expect(() => mediaImport.removeMedia('nope')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/main/mediaImport.test.ts -t removeMedia`
Expected: FAIL — `absPathsForItem`/`deleteFilesProd` throw the "not yet implemented" placeholders.

- [ ] **Step 3: Implement the placeholders** in `src/main/mediaImport.ts`. Add `rmSync` and `dirname` to the imports (`fs` and `path`), then replace the two placeholder functions:

```ts
/** Absolute on-disk paths owned by a media item: the deck's directory, or the single file. */
function absPathsForItem(libRoot: string, item: MediaItem): string[] {
  if (item.type === 'deck') {
    if (item.slides.length === 0) return [];
    return [dirname(join(libRoot, item.slides[0]))];
  }
  return item.filePath ? [join(libRoot, item.filePath)] : [];
}

function deleteFilesProd(absPaths: string[]): void {
  for (const p of absPaths) rmSync(p, { recursive: true, force: true });
}
```

- [ ] **Step 4: Route the IPC handler** in `src/main/ipc.ts` (line ~108):

```ts
  ipcMain.handle(CH.mediaRemove, (_e, id: string) => mediaImport.removeMedia(id));
```

(`mediaRepo` is still a param — leave it; other media handlers use it. If lint flags it unused after this change, keep it: `mediaList` uses `mediaRepo.list()`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/mediaImport.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/mediaImport.ts src/main/mediaImport.test.ts src/main/ipc.ts
git commit -m "fix(media): remove deletes on-disk files and deck dirs, not just the row"
```

---

## Task 8b: Right-click Delete + deferred-commit undo (Area G — renderer)

Right-click a media row → **Delete**, reusing `useContextMenu`/`ContextMenu` (as `SongsMode` does) and `useTimedUndo`/`UndoToast` (as `SchedulePanel` renders it). **Deferred-commit:** Delete optimistically drops the row locally, selects a neighbor, and arms the undo toast — nothing is deleted on disk yet. **Undo** re-inserts locally and cancels. On toast **expiry**, call `window.helm.media.remove(id)` (Task 8a deletes files + row). Deleting the currently-live item degrades calmly.

**Files:**
- Modify: `src/renderer/operator/SlidesTrack.tsx`
- Modify: `src/renderer/operator/SlidesTrack.test.tsx`

**Interfaces:**
- Consumes: `useContextMenu`, `useTimedUndo`, `UndoToast`, `window.helm.media.remove`.
- Produces: `pickNeighborId(items, removedId): string` (pure — the id to select after removal: the next row, else previous, else `''`); a context menu with a `Delete` (danger) item on each library row; a `pendingDelete` undo toast whose expiry commits the removal via IPC.

- [ ] **Step 1: Write a failing unit test for the pure neighbor picker.** Create `src/renderer/operator/pickNeighbor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickNeighborId } from './pickNeighbor';

const ids = (xs: string[]) => xs.map((id) => ({ id }));

describe('pickNeighborId', () => {
  it('selects the next row when one follows', () => {
    expect(pickNeighborId(ids(['a', 'b', 'c']), 'b')).toBe('c');
  });
  it('selects the previous row when removing the last', () => {
    expect(pickNeighborId(ids(['a', 'b', 'c']), 'c')).toBe('b');
  });
  it('returns empty string when removing the only row', () => {
    expect(pickNeighborId(ids(['a']), 'a')).toBe('');
  });
  it('returns empty string when the id is absent', () => {
    expect(pickNeighborId(ids(['a', 'b']), 'z')).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/operator/pickNeighbor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure helper.** Create `src/renderer/operator/pickNeighbor.ts`:

```ts
/**
 * The id to select after removing `removedId` from `items`: the following row if any,
 * else the preceding row, else '' (list became empty, or the id wasn't present).
 * Pure — mirrors the neighbor-selection contract described for useListSelection.
 */
export function pickNeighborId(items: { id: string }[], removedId: string): string {
  const idx = items.findIndex((i) => i.id === removedId);
  if (idx === -1) return '';
  const next = items[idx + 1] ?? items[idx - 1];
  return next?.id ?? '';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/operator/pickNeighbor.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing component tests.** Add to `src/renderer/operator/SlidesTrack.test.tsx`:

```ts
it('right-click Delete drops the row locally and arms an Undo toast without an immediate IPC remove', async () => {
  installHelmStub();
  renderTrack();
  const row = (await screen.findByText('▣ Welcome.jpg')).closest('button') as HTMLButtonElement;
  fireEvent.contextMenu(row);
  fireEvent.click(await screen.findByText('Delete'));
  // Optimistically gone from the list, undo offered, but nothing deleted on disk yet.
  await waitFor(() => expect(screen.queryByText('▣ Welcome.jpg')).toBeNull());
  expect(await screen.findByText(/Removed/)).toBeTruthy();
  expect(window.helm.media.remove).not.toHaveBeenCalled();
});

it('Undo restores the row and never calls media.remove', async () => {
  installHelmStub();
  renderTrack();
  const row = (await screen.findByText('▣ Welcome.jpg')).closest('button') as HTMLButtonElement;
  fireEvent.contextMenu(row);
  fireEvent.click(await screen.findByText('Delete'));
  fireEvent.click(await screen.findByText('Undo'));
  expect(await screen.findByText('▣ Welcome.jpg')).toBeTruthy();
  expect(window.helm.media.remove).not.toHaveBeenCalled();
});

it('after the undo window expires, the removal commits via media.remove', async () => {
  vi.useFakeTimers();
  try {
    installHelmStub();
    renderTrack();
    // findByText uses real timers internally; query synchronously after flushing microtasks.
    await vi.waitFor(() => expect(screen.getByText('▣ Welcome.jpg')).toBeTruthy());
    fireEvent.contextMenu(screen.getByText('▣ Welcome.jpg').closest('button') as HTMLButtonElement);
    fireEvent.click(screen.getByText('Delete'));
    vi.advanceTimersByTime(5200); // useTimedUndo default 5000ms
    expect(window.helm.media.remove).toHaveBeenCalledWith('img1');
  } finally {
    vi.useRealTimers();
  }
});
```

(If fake-timers prove fiddly with Testing Library in this repo, assert the commit by exposing a shorter `useTimedUndo(1200)` in `SlidesTrack` and `await`ing a real `waitFor` for `remove` to have been called. Keep whichever is green; note the choice.)

- [ ] **Step 6: Run to verify they fail**

Run: `npx vitest run src/renderer/operator/SlidesTrack.test.tsx -t "Delete|Undo|expires"`
Expected: FAIL — no context menu / undo wiring.

- [ ] **Step 7: Wire the context menu + deferred-commit undo** in `src/renderer/operator/SlidesTrack.tsx`. Add imports:

```ts
import { useContextMenu } from './useContextMenu';
import { useTimedUndo } from './useTimedUndo';
import { UndoToast } from './UndoToast';
import { pickNeighborId } from './pickNeighbor';
```

Inside the component, near the other hooks:

```ts
  const contextMenu = useContextMenu();
  const undo = useTimedUndo<MediaItem>();
```

Add the delete/undo handlers (deferred-commit: expiry fires the IPC):

```ts
  // Deferred-commit delete: drop the row locally + arm undo; nothing leaves disk until the
  // toast expires. Undo re-inserts and cancels. Deleting the live item degrades calmly —
  // main's output already falls back when a cued key disappears (no re-cue here).
  const removeItem = (item: MediaItem): void => {
    contextMenu.close();
    const neighborId = pickNeighborId(items, item.id);
    setItems((l) => l.filter((i) => i.id !== item.id));
    if (selId === item.id) { setSelId(neighborId); setSlideIdx(0); }
    undo.arm(item);
  };

  const undoRemove = (): void => {
    const item = undo.pending;
    if (!item) return;
    undo.cancel();
    // Re-fetch to restore the exact prior order rather than guessing an insertion index.
    void window.helm.media.list().then((l) => {
      setItems(l);
      setSelId(item.id);
    }).catch(console.error);
  };

  // Commit on expiry: when the pending item clears WITHOUT an undo, delete it for real.
  const committedRef = useRef<string | null>(null);
  useEffect(() => {
    if (undo.pending) { committedRef.current = undo.pending.id; return; }
    const id = committedRef.current;
    committedRef.current = null;
    if (id) void window.helm.media.remove(id).catch(console.error);
  }, [undo.pending]);
```

Add `useRef` to the React import. Wire the row's `onContextMenu`:

```tsx
            <button
              key={item.id}
              data-media-id={item.id}
              style={rowStyle(item.id === selId)}
              onClick={() => selectItem(item)}
              onContextMenu={(e) => contextMenu.open(e, [{ label: 'Delete', danger: true, onSelect: () => removeItem(item) }])}
            >
```

Render the undo toast (just above the deck/video right panels or inside the rail scroll footer) and the context menu (once, near the fallback modal at the end):

```tsx
        {undo.pending && (
          <UndoToast label={undo.pending.title} onUndo={undoRemove} />
        )}
```

Place the `UndoToast` inside the rail `<div style={railStyle}>`, after the scroll container `</div>` (so it sits at the rail's bottom, matching `SchedulePanel`'s placement). Add `{contextMenu.menu}` right before the final closing `</div>` of the root (next to `{deckFallback && …}`).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/renderer/operator/SlidesTrack.test.tsx src/renderer/operator/pickNeighbor.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Real-app verification — Delete + Undo, including the live item.**

```bash
npm run build
node scratch/mediaprobe/driver.mjs
# REPL:
launch
# Delete + Undo restores:
eval (() => { const r=[...document.querySelectorAll('[data-media-id]')][0]; r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true})); return 'ctx'; })()
click-text Delete
eval document.body.innerText.includes('Removed')
click-text Undo
ss delete-undo
# Delete the LIVE item degrades calmly: select an item, Go live, then delete it — no crash.
```

Expected: right-click shows a Delete item; choosing it removes the row and shows "Removed <title> — Undo"; Undo restores it; letting the toast expire commits (verify with `eval window.helm.media.list()` after ~6s — the item is gone and its files deleted). Deleting a live item must not crash the operator or output window (watch the driver console for errors); the output falls back as designed. Eyeball `ss delete-undo`.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/operator/SlidesTrack.tsx src/renderer/operator/SlidesTrack.test.tsx src/renderer/operator/pickNeighbor.ts src/renderer/operator/pickNeighbor.test.ts
git commit -m "feat(media): right-click Delete with deferred-commit undo"
```

---

## Task 9: Windows bundled-LibreOffice verification checklist (docs)

Fold an explicit, **unverified** checklist item into the Windows test plan for the one leg that can't be driven from macOS: the *bundled* LibreOffice path on a packaged Windows build. Do NOT mark it verified.

**Files:**
- Modify: `docs/superpowers/plans/2026-07-06-mvp-windows-test-plan.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a documented Windows verification item + a build-staging note for the vendored LibreOffice tree.

- [ ] **Step 1: Add a staging note to Part A.** After the A3 "transfer bundle" section, add:

```markdown
### A3b · [Build machine] Stage the vendored LibreOffice tree (required for PPTX import)
The per-OS LibreOffice-headless tree lives **outside git** (large). Before `build:win`
(or `build:mac`) it MUST be staged at `resources/libreoffice` so electron-builder's
`extraResources` copies it next to the app (`<resourcesPath>/libreoffice`). If it's
absent the build still succeeds, but PPTX import degrades to the "PowerPoint import
unavailable" modal at runtime. Windows layout expected by `bundledSofficeCandidates`:
`resources/libreoffice/program/soffice.exe`.
```

- [ ] **Step 2: Add the verification item to Part B → P0 (or P1 if deck import isn't gating Wednesday — match the existing P2 note that media is non-gating).** Given the current plan marks media as **P2 (deferred)**, add the item under P2 so it's tracked but not treated as a Wednesday blocker:

```markdown
- [ ] **Bundled LibreOffice PPTX/PDF import (self-contained) — NOT YET VERIFIED.** On a
  packaged Windows build with **no** LibreOffice installed on the box: import a `.pptx`
  and a `.pdf` via **+ Import → Slides / PDF**. Confirm (a) every slide/page renders as a
  separate thumbnail on the projector (no first-slide-only truncation), (b) the file
  picker opens **parented** to the operator window (a sheet/owned modal), never behind the
  always-on-top audience output, and (c) right-click **Delete + Undo** works on a media
  row. This exercises the *bundled* `findSoffice` leg (`<resourcesPath>/libreoffice`) that
  cannot be driven from macOS. Leave unchecked until run on a real Windows box.
```

- [ ] **Step 3: Verify the doc renders and commit** (docs-only; no tests).

Run: `git diff --stat docs/superpowers/plans/2026-07-06-mvp-windows-test-plan.md`
Expected: the two additions present.

```bash
git add docs/superpowers/plans/2026-07-06-mvp-windows-test-plan.md
git commit -m "docs(plan): add Windows bundled-LibreOffice import verification item"
```

---

## Final verification (whole feature)

- [ ] **Run the full suite + typecheck + lint**

```bash
npm run test && npm run typecheck && npm run lint
```

Expected: all green, no type errors, no lint errors.

- [ ] **Full real-app smoke (macOS, LibreOffice installed) via the driver** — one pass exercising every area:

```bash
npm run build
node scratch/mediaprobe/driver.mjs
# launch → import a real PDF (Task 3) → import a real PPTX (Task 4) →
# confirm per-slide thumbnails + hero render (Task 1) → Go Live shows on the output window →
# second import auto-selects + "Imported ✓" (Task 6) → progress spinner seen (Task 7) →
# + Import reachable from the empty state (Task 5) → right-click Delete + Undo (Task 8b) →
# let a delete commit and confirm files are gone (Task 8a).
```

Expected: every area behaves as specced in the **real running app**, not just under unit tests.

- [ ] **Clean up scratch artifacts** if desired (`scratch/mediaprobe/raster-smoke.mjs` may stay as a dev aid; `/tmp/helm-raster-out` can be removed).

## Self-review checklist (run by the plan author before execution)

- **Spec coverage:** A→Task 1; B→Tasks 2,3,4; C→Tasks 2 (main) + 6 (renderer); D→Task 5; E→Task 6; F→Task 7; G→Tasks 8a,8b; Windows leg→Task 9. ✅
- **Poppler removed:** `findPdftoppm`, `runConvertProd`, `--convert-to png` fallback deleted in Task 2. ✅
- **First-slide-only bug killed:** Task 3 rasterizes every `doc.numPages`. ✅
- **Seams keep tests binary-free:** all soffice/pdfjs/fs work behind `MediaImportOptions`; every unit test injects fakes. ✅
- **Type consistency:** `MediaImportResult`, `MediaImportProgress`, `convertToPdf`/`rasterize`/`deleteFiles`/`onProgress`/`getParentWindow`, `removeMedia`, `pickNeighborId` names are identical across every task that references them. ✅
- **Real-app verification per area** via `scratch/mediaprobe/driver.mjs`. ✅
- **House rules:** every commit subject is a concise `fix(media):`/`feat(media):`/`refactor(media):`/`docs(plan):`; no trailers. ✅
