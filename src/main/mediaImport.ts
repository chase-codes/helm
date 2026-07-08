import { dialog } from 'electron';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
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
