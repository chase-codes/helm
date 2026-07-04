import { dialog } from 'electron';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
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
  for (const candidate of KNOWN_SOFFICE_PATHS) {
    if (exists(candidate)) return candidate;
  }

  const pathDirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
  const binName = process.platform === 'win32' ? 'soffice.exe' : 'soffice';
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = join(dir, binName);
    if (exists(candidate)) return candidate;
  }

  return null;
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

export interface MediaImport {
  importImages(): Promise<MediaItem[]>;
  importVideo(): Promise<MediaItem[]>;
  importDeck(): Promise<{ items: MediaItem[]; error?: 'no-libreoffice' }>;
}

export function createMediaImport(repo: MediaRepo, libRoot: string): MediaImport {
  async function pickFiles(extensions: string[], filterName: string): Promise<string[]> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
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
      // Stub pending Task D1, which will drive the actual soffice conversion.
      if (findSoffice() === null) {
        return { items: repo.list(), error: 'no-libreoffice' };
      }
      return { items: repo.list() };
    }
  };
}
