import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { dialog } from 'electron';
import { findSoffice, findPdftoppm, parsePngOutput, createMediaImport } from './mediaImport';
import type { MediaRepo, MediaItem } from './mediaRepo';

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() }
}));

function makeFakeRepo(): MediaRepo {
  const items: MediaItem[] = [];
  return {
    list: () => [...items],
    add: (item) => {
      const added: MediaItem = { id: `id-${items.length}`, createdAt: items.length, ...item };
      items.unshift(added);
      return added;
    },
    remove: (id) => {
      const idx = items.findIndex((i) => i.id === id);
      if (idx >= 0) items.splice(idx, 1);
      return [...items];
    },
    get: (id) => items.find((i) => i.id === id) ?? null
  };
}

describe('parsePngOutput', () => {
  it('sorts page PNG filenames numerically by trailing number', () => {
    expect(parsePngOutput(['slide10.png', 'slide2.png', 'slide1.png'])).toEqual([
      'slide1.png',
      'slide2.png',
      'slide10.png'
    ]);
  });

  it('falls back to lexical order when there is no trailing number', () => {
    expect(parsePngOutput(['b.png', 'a.png', 'c.png'])).toEqual(['a.png', 'b.png', 'c.png']);
  });

  it('handles a mix of numbered and non-numbered names by putting numbered first, in numeric order', () => {
    expect(parsePngOutput(['deck.png', 'deck2.png', 'deck1.png'])).toEqual([
      'deck1.png',
      'deck2.png',
      'deck.png'
    ]);
  });

  it('does not mutate the input array', () => {
    const input = ['slide2.png', 'slide1.png'];
    const copy = [...input];
    parsePngOutput(input);
    expect(input).toEqual(copy);
  });

  it('returns an empty array unchanged', () => {
    expect(parsePngOutput([])).toEqual([]);
  });
});

describe('findSoffice', () => {
  it('returns the first known path that exists', () => {
    const exists = (p: string): boolean => p === '/Applications/LibreOffice.app/Contents/MacOS/soffice';
    expect(findSoffice(exists)).toBe('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  });

  it('returns the Windows path when only that one exists', () => {
    const exists = (p: string): boolean => p === 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';
    expect(findSoffice(exists)).toBe('C:\\Program Files\\LibreOffice\\program\\soffice.exe');
  });

  it('returns null when no candidate exists', () => {
    expect(findSoffice(() => false)).toBeNull();
  });
});

describe('findPdftoppm', () => {
  it('returns the first known path that exists', () => {
    const exists = (p: string): boolean => p === '/opt/homebrew/bin/pdftoppm';
    expect(findPdftoppm(exists)).toBe('/opt/homebrew/bin/pdftoppm');
  });

  it('returns null when no candidate exists', () => {
    expect(findPdftoppm(() => false)).toBeNull();
  });
});

describe('createMediaImport / importDeck', () => {
  it('returns the no-libreoffice error without opening a file picker when findSoffice yields null', async () => {
    const repo = makeFakeRepo();
    const runConvert = vi.fn();
    const mediaImport = createMediaImport(repo, '/lib', {
      findSoffice: () => null,
      runConvert
    });

    const result = await mediaImport.importDeck();

    expect(result).toEqual({ items: [], error: 'no-libreoffice' });
    expect(runConvert).not.toHaveBeenCalled();
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  });

  it('converts a picked deck via the injected runConvert and stores slides in parsePngOutput order', async () => {
    const repo = makeFakeRepo();
    const libRoot = mkdtempSync(join(tmpdir(), 'helm-media-test-'));
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ['/decks/src/MyDeck.pptx']
    } as Awaited<ReturnType<typeof dialog.showOpenDialog>>);

    const listing = ['slide-1.png', 'slide-10.png', 'slide-2.png'];
    const runConvert = vi.fn().mockResolvedValue(listing);

    const mediaImport = createMediaImport(repo, libRoot, {
      findSoffice: () => '/usr/bin/soffice',
      runConvert
    });

    const result = await mediaImport.importDeck();

    expect(result.error).toBeUndefined();
    expect(runConvert).toHaveBeenCalledTimes(1);
    const [sofficeArg, srcArg, outDirArg] = runConvert.mock.calls[0] as [string, string, string];
    expect(sofficeArg).toBe('/usr/bin/soffice');
    expect(srcArg).toBe('/decks/src/MyDeck.pptx');
    expect(outDirArg.startsWith(join(libRoot, 'decks'))).toBe(true);

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.type).toBe('deck');
    expect(item.filePath).toBeNull();
    expect(item.title).toBe('MyDeck.pptx');

    const expectedOrder = parsePngOutput(listing);
    expect(item.slides.map((s) => s.split('/').pop())).toEqual(expectedOrder);
    expect(item.slides.every((s) => s.startsWith('decks/'))).toBe(true);
  });
});
