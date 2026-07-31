import { describe, expect, it } from 'vitest';
import { importTidy } from './importTidy';

describe('importTidy', () => {
  it('normalises CRLF and CR to LF', () => {
    expect(importTidy('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('trims trailing whitespace on each line', () => {
    expect(importTidy('a   \nb\t\t')).toBe('a\nb');
  });

  it('collapses three or more newlines to exactly two', () => {
    expect(importTidy('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('keeps a single blank line, because that is one slide break', () => {
    expect(importTidy('a\n\nb')).toBe('a\n\nb');
  });

  it('straightens curly quotes', () => {
    expect(importTidy('‘a’ “b”')).toBe("'a' \"b\"");
  });

  it('drops lines that are only RTF-stripping debris', () => {
    expect(importTidy('a\n()\nb\n[]\nc\n.\nd')).toBe('a\nb\nc\nd');
  });

  it('trims leading and trailing blank lines', () => {
    expect(importTidy('\n\n\na\n\n\n')).toBe('a');
  });

  it('returns an empty string when nothing survives', () => {
    expect(importTidy('\n\n()\n\n')).toBe('');
  });

  // Guard test: everything "light tidying" must NOT do. Without this, the six rules drift
  // into the opinionated cleanup the spec rejected, and a lyric changes without anyone noticing.
  it('leaves lyric content untouched', () => {
    const lyric = [
      'Verse 1',
      'amazing grace, how sweet the sound. x2',
      'That saved a wretch like me,',
      '',
      'Chorus 2',
      'praise God! (2x)'
    ].join('\n');
    expect(importTidy(lyric)).toBe(lyric);
  });
});
