import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { dialog } from 'electron';
import { findSoffice, bundledSofficeCandidates, parsePngOutput, createMediaImport, assertConverted } from './mediaImport';
import type { MediaRepo, MediaItem } from './mediaRepo';
import type { MediaImportProgress } from '../shared/types';

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
    expect(cands.every((c) => c.startsWith(join('/app/resources')))).toBe(true);
  });
});

describe('assertConverted', () => {
  it('does not throw when the PDF exists and is non-empty', () => {
    expect(() => assertConverted('/out/deck.pdf', 'soffice --convert-to pdf', () => 1234)).not.toThrow();
  });

  it('throws a descriptive error naming the soffice invocation when the PDF is missing', () => {
    expect(() => assertConverted('/out/deck.pdf', 'soffice --convert-to pdf /d/Deck.pptx', () => null)).toThrow(
      /soffice --convert-to pdf \/d\/Deck\.pptx/
    );
  });

  it('throws when the PDF exists but is zero bytes', () => {
    expect(() => assertConverted('/out/deck.pdf', 'soffice --convert-to pdf /d/Deck.pptx', () => 0)).toThrow(
      /empty PDF/
    );
  });

  it('mentions the missing path in the error message', () => {
    expect(() => assertConverted('/out/deck.pdf', 'invocation', () => null)).toThrow(/\/out\/deck\.pdf/);
  });
});

describe('createMediaImport / importDeck', () => {
  it('returns no-libreoffice when a NON-pdf is picked and findSoffice is null', async () => {
    const repo = makeFakeRepo();
    const convertToPdf = vi.fn();
    const rasterize = vi.fn();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/d/Deck.pptx'] } as never);
    const mediaImport = createMediaImport(repo, '/lib', { findSoffice: () => null, convertToPdf, rasterize });
    const result = await mediaImport.importDeck();
    expect(result).toEqual({ items: [], error: 'no-libreoffice' });
    expect(convertToPdf).not.toHaveBeenCalled();
    expect(rasterize).not.toHaveBeenCalled();
    expect(dialog.showOpenDialog).toHaveBeenCalled(); // picker DID open (so a PDF could have been chosen)
  });

  it('imports a .pdf even when findSoffice is null (PDF needs no LibreOffice)', async () => {
    const repo = makeFakeRepo();
    const libRoot = mkdtempSync(join(tmpdir(), 'helm-media-test-'));
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/d/Report.pdf'] } as never);
    const convertToPdf = vi.fn();
    const rasterize = vi.fn().mockResolvedValue(['slide-0001.png', 'slide-0002.png']);
    const mediaImport = createMediaImport(repo, libRoot, { findSoffice: () => null, convertToPdf, rasterize });
    const result = await mediaImport.importDeck();
    expect(result.error).toBeUndefined();
    expect(convertToPdf).not.toHaveBeenCalled();
    const [pdfArg] = rasterize.mock.calls[0] as [string];
    expect(pdfArg).toBe('/d/Report.pdf');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('deck');
    expect(result.items[0].slides).toHaveLength(2);
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

  it('importImages copies each picked file into images/ and adds items in picked order', async () => {
    const repo = makeFakeRepo();
    const libRoot = mkdtempSync(join(tmpdir(), 'helm-media-test-'));
    const srcDir = mkdtempSync(join(tmpdir(), 'helm-media-src-'));
    const a = join(srcDir, 'a.png');
    const b = join(srcDir, 'b.jpg');
    writeFileSync(a, 'aaa');
    writeFileSync(b, 'bbb');
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [a, b] } as never);
    const mediaImport = createMediaImport(repo, libRoot, {});
    const result = await mediaImport.importImages();
    expect(result.canceled).toBeUndefined();
    expect(result.items).toHaveLength(2);
    // Fake repo unshifts, so picked order is reversed in the list — assert per-title.
    const byTitle = new Map(result.items.map((i) => [i.title, i]));
    for (const [title, ext] of [['a.png', '.png'], ['b.jpg', '.jpg']] as const) {
      const item = byTitle.get(title)!;
      expect(item.type).toBe('image');
      expect(item.filePath!.startsWith('images/')).toBe(true);
      expect(item.filePath!.endsWith(ext)).toBe(true);
      expect(existsSync(join(libRoot, item.filePath!))).toBe(true);
    }
  });

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
});

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
