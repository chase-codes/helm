import { dialog } from 'electron';
import { existsSync, copyFileSync, mkdirSync, readdirSync } from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { basename, extname, join } from 'path';
import type { MediaRepo, MediaItem } from './mediaRepo';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'];

// Known install locations to probe, in priority order, before falling back to PATH.
const KNOWN_SOFFICE_PATHS = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice', // macOS
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe', // Windows
  '/usr/bin/soffice', // common Linux install
  '/usr/local/bin/soffice'
];

// Known install locations for poppler's pdftoppm, probed before falling back to PATH.
const KNOWN_PDFTOPPM_PATHS = [
  '/opt/homebrew/bin/pdftoppm', // macOS Homebrew (Apple Silicon)
  '/usr/local/bin/pdftoppm', // macOS Homebrew (Intel) / common Linux
  '/usr/bin/pdftoppm', // common Linux install (poppler-utils)
  'C:\\Program Files\\poppler\\Library\\bin\\pdftoppm.exe' // Windows (poppler for Windows)
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

/**
 * Probe known poppler-utils install locations plus PATH for a `pdftoppm`
 * binary, mirroring `findSoffice`. Used to rasterize the intermediate PDF
 * into per-slide PNGs; when absent, deck conversion degrades to a single
 * PNG (see `runConvertProd`).
 */
export function findPdftoppm(exists: (p: string) => boolean = existsSync): string | null {
  return probeForBinary(KNOWN_PDFTOPPM_PATHS, 'pdftoppm', 'pdftoppm.exe', exists);
}

function copyPickedFiles(
  repo: MediaRepo,
  libRoot: string,
  subfolder: string,
  type: MediaItem['type'],
  filePaths: string[]
): void {
  const destDir = join(libRoot, subfolder);
  mkdirSync(destDir, { recursive: true });

  for (const filePath of filePaths) {
    const ext = extname(filePath); // includes leading dot, or '' if none
    const relPath = `${subfolder}/${randomUUID()}${ext}`;
    copyFileSync(filePath, join(libRoot, relPath));
    repo.add({ type, title: basename(filePath), filePath: relPath, slides: [] });
  }
}

/** Runs an external binary to completion, rejecting on non-zero exit or spawn error. */
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
 * Production `runConvert`: converts `src` (a .pptx) to PDF via soffice, then
 * rasterizes each PDF page to a PNG via poppler's `pdftoppm` — this yields
 * true per-slide PNGs, unlike soffice's own `--convert-to png`, which emits
 * only the first slide on many builds.
 *
 * If `pdftoppm` is unavailable, degrades calmly: falls back to soffice's
 * single-PNG (first-slide-only) export and logs the limitation, rather than
 * failing the import outright.
 *
 * Returns filenames relative to `outDir` (not full paths) — callers combine
 * them with the deck's own relative directory before storing in the DB.
 */
async function runConvertProd(soffice: string, src: string, outDir: string): Promise<string[]> {
  await runExternal(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, src]);

  const pdftoppm = findPdftoppm();
  if (pdftoppm !== null) {
    const pdfPath = join(outDir, `${basename(src, extname(src))}.pdf`);
    await runExternal(pdftoppm, ['-png', pdfPath, join(outDir, 'slide')]);
  } else {
    console.warn(
      '[mediaImport] pdftoppm not found; importing deck as a single-slide image (per-slide PNGs unavailable). Install poppler-utils for full per-slide conversion.'
    );
    await runExternal(soffice, ['--headless', '--convert-to', 'png', '--outdir', outDir, src]);
  }

  return readdirSync(outDir).filter((f) => f.toLowerCase().endsWith('.png'));
}

export interface MediaImport {
  importImages(): Promise<MediaItem[]>;
  importVideo(): Promise<MediaItem[]>;
  importDeck(): Promise<{ items: MediaItem[]; error?: 'no-libreoffice' }>;
}

/**
 * Injectable seams for `createMediaImport`, defaulted to the real
 * `findSoffice`/`runConvertProd` in production. Tests inject fakes here so
 * `importDeck` can be exercised without spawning soffice/pdftoppm or
 * touching a real file-open dialog's underlying tools.
 */
export interface MediaImportOptions {
  findSoffice?: () => string | null;
  runConvert?: (soffice: string, src: string, outDir: string) => Promise<string[]>;
}

export function createMediaImport(
  repo: MediaRepo,
  libRoot: string,
  options: MediaImportOptions = {}
): MediaImport {
  const findSofficeFn = options.findSoffice ?? (() => findSoffice());
  const runConvert = options.runConvert ?? runConvertProd;

  async function pickFiles(extensions: string[], filterName: string, multi = true): Promise<string[]> {
    const result = await dialog.showOpenDialog({
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: filterName, extensions }]
    });
    if (result.canceled) return [];
    return result.filePaths;
  }

  return {
    async importImages() {
      const filePaths = await pickFiles(IMAGE_EXTENSIONS, 'Images');
      copyPickedFiles(repo, libRoot, 'images', 'image', filePaths);
      return repo.list();
    },

    async importVideo() {
      const filePaths = await pickFiles(VIDEO_EXTENSIONS, 'Video');
      copyPickedFiles(repo, libRoot, 'video', 'video', filePaths);
      return repo.list();
    },

    async importDeck() {
      const soffice = findSofficeFn();
      if (soffice === null) {
        return { items: repo.list(), error: 'no-libreoffice' };
      }

      const filePaths = await pickFiles(['pptx'], 'PowerPoint', false);
      if (filePaths.length === 0) return { items: repo.list() };

      const srcPath = filePaths[0];
      const relDeckDir = `decks/${randomUUID()}`;
      const deckDir = join(libRoot, relDeckDir);
      mkdirSync(deckDir, { recursive: true });

      const pngFiles = await runConvert(soffice, srcPath, deckDir);
      const slides = parsePngOutput(pngFiles).map((name) => `${relDeckDir}/${name}`);

      repo.add({ type: 'deck', title: basename(srcPath), filePath: null, slides });
      return { items: repo.list() };
    }
  };
}
