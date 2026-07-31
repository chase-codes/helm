import { describe, expect, it } from 'vitest';
import { rtfToText } from './rtfToText';

describe('rtfToText', () => {
  it('returns plain text from a minimal document', () => {
    expect(rtfToText('{\\rtf1\\ansi Hello}')).toBe('Hello');
  });

  it('turns \\par and \\line into newlines', () => {
    expect(rtfToText('{\\rtf1 Line one\\par Line two\\line Line three}')).toBe(
      'Line one\nLine two\nLine three'
    );
  });

  it('discards the font table entirely', () => {
    expect(rtfToText('{\\rtf1{\\fonttbl{\\f0\\fnil Arial;}}\\f0\\fs40 Text}')).toBe('Text');
  });

  it('discards ignorable destinations', () => {
    expect(rtfToText('{\\rtf1{\\*\\generator Riched20 10.0;}Text}')).toBe('Text');
  });

  it('decodes a unicode escape and swallows its substitute character', () => {
    expect(rtfToText("{\\rtf1 It\\u8217?s}")).toBe('It’s');
  });

  it('decodes hex escapes using cp1252, not latin-1', () => {
    expect(rtfToText("{\\rtf1 caf\\'e9}")).toBe('café');
    expect(rtfToText("{\\rtf1 It\\'92s}")).toBe('It’s');
  });

  it('emits escaped braces and backslashes literally', () => {
    expect(rtfToText('{\\rtf1 \\{x\\} \\\\ y}')).toBe('{x} \\ y');
  });

  it('ignores the line wrapping of the source file', () => {
    expect(rtfToText('{\\rtf1 A\r\nB}')).toBe('AB');
  });

  it('returns best-effort text rather than throwing on unbalanced braces', () => {
    expect(rtfToText('{\\rtf1 Text')).toBe('Text');
    expect(rtfToText('{\\rtf1 Text}}}')).toBe('Text');
  });

  it('returns an empty string for empty input', () => {
    expect(rtfToText('')).toBe('');
  });
});
