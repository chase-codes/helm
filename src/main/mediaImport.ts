import { dialog } from 'electron';
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { basename, extname, join } from 'path';
import type { MediaRepo, MediaItem } from './mediaRepo';
import type { MediaImportProgress, MediaImportResult } from '../shared/types';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'];
const DECK_EXTENSIONS = ['pptx', 'ppt', 'odp', 'pdf'];

// Known install locations to probe, in priority order, before falling back to PATH.
const KNOWN_SOFFICE_PATHS = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice', // macOS
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe', // Windows
  '/usr/bin/soffice', // common Linux install
  '/usr/local/bin/soffice'
];

function probeForBinary(
  knownPaths: string[],
  binName: string,
  winBinName: string,
  exists: (p: string) => boolean
): string | null {
  for (const candidate of knownPaths) {
    if (exists(candidate)) return candidate;
  }

  const pathDirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
  const name = process.platform === 'win32' ? winBinName : binName;
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (exists(candidate)) return candidate;
  }

  return null;
}

/**
 * Sort LibreOffice's page PNG filenames numerically by their trailing number
 * (e.g. "slide2.png" before "slide10.png"), falling back to lexical order for
 * names with no trailing number. Pure — does not mutate its input.
 */
export function parsePngOutput(files: string[]): string[] {
  const trailingNumber = (name: string): number | null => {
    const match = name.match(/(\d+)(?=\.[^.]*$|$)/);
    return match ? parseInt(match[1], 10) : null;
  };

  return [...files].sort((a, b) => {
    const na = trailingNumber(a);
    const nb = trailingNumber(b);
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1; // numbered names sort before non-numbered
    if (nb !== null) return 1;
    return a.localeCompare(b);
  });
}

/**
 * Probe known LibreOffice install locations plus PATH for a `soffice`
 * binary. Accepts an injected existence predicate for testability; defaults
 * to `fs.existsSync`.
 */
export function findSoffice(exists: (p: string) => boolean = existsSync): string | null {
  return probeForBinary(KNOWN_SOFFICE_PATHS, 'soffice', 'soffice.exe', exists);
}

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

function runExternal(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${String(code)}: ${stderr}`));
    });
  });
}

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
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
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
function deleteFilesProd(_absPaths: string[]): void {
  throw new Error('deleteFilesProd not yet implemented');
}
function absPathsForItem(_libRoot: string, _item: MediaItem): string[] {
  throw new Error('absPathsForItem not yet implemented');
}
