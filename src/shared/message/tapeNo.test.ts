import { describe, expect, it } from 'vitest';
import { parseTapeNo } from './tapeNo';

describe('parseTapeNo', () => {
  it('accepts canonical tape numbers', () => {
    expect(parseTapeNo('65-1204')).toBe('65-1204');
    expect(parseTapeNo('64-0206B')).toBe('64-0206B');
  });
  it('trims surrounding text and normalizes whitespace/dashes', () => {
    expect(parseTapeNo('  65-1204  ')).toBe('65-1204');
    expect(parseTapeNo('Tape 47-0412 The Rapture')).toBe('47-0412');
  });
  it('returns null when no tape number is present', () => {
    expect(parseTapeNo('The Rapture')).toBeNull();
    expect(parseTapeNo('')).toBeNull();
  });
});
