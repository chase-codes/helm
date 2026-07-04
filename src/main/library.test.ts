import { describe, it, expect } from 'vitest';
import { resolveMediaPath } from './library';

describe('resolveMediaPath', () => {
  const root = '/data/library';
  it('resolves a normal relative path under root', () => {
    expect(resolveMediaPath(root, 'images/a.jpg')).toBe('/data/library/images/a.jpg');
  });
  it('strips a leading slash', () => {
    expect(resolveMediaPath(root, '/decks/d1/1.png')).toBe('/data/library/decks/d1/1.png');
  });
  it('rejects path traversal that escapes root', () => {
    expect(resolveMediaPath(root, '../secrets.txt')).toBeNull();
    expect(resolveMediaPath(root, 'images/../../etc/passwd')).toBeNull();
  });
});
