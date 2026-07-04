import { describe, it, expect } from 'vitest';
import { findSoffice, parsePngOutput } from './mediaImport';

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
