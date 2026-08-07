import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { resolveMediaPath, parseRangeHeader } from './library';

describe('resolveMediaPath', () => {
  const root = join('/', 'data', 'library');
  it('resolves a normal relative path under root', () => {
    expect(resolveMediaPath(root, 'images/a.jpg')).toBe(join(root, 'images', 'a.jpg'));
  });
  it('strips a leading slash', () => {
    expect(resolveMediaPath(root, '/decks/d1/1.png')).toBe(join(root, 'decks', 'd1', '1.png'));
  });
  it('rejects path traversal that escapes root', () => {
    expect(resolveMediaPath(root, '../secrets.txt')).toBeNull();
    expect(resolveMediaPath(root, 'images/../../etc/passwd')).toBeNull();
  });
});

describe('parseRangeHeader', () => {
  it('returns null when there is no Range header', () => {
    expect(parseRangeHeader(null, 1000)).toBeNull();
  });
  it('parses a closed range', () => {
    expect(parseRangeHeader('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
  });
  it('parses an open-ended range to the last byte', () => {
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  });
  it('parses a suffix range (last N bytes)', () => {
    expect(parseRangeHeader('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
  });
  it('clamps an end past EOF', () => {
    expect(parseRangeHeader('bytes=0-99999', 1000)).toEqual({ start: 0, end: 999 });
  });
  it('rejects a start past EOF', () => {
    expect(parseRangeHeader('bytes=2000-', 1000)).toBeNull();
  });
  it('rejects a malformed header', () => {
    expect(parseRangeHeader('kilobytes=0-1', 1000)).toBeNull();
  });
});
