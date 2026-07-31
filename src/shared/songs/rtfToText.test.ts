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

  it('does not throw on a unicode parameter above the valid range, and swallows its substitute character', () => {
    expect(rtfToText('{\\rtf1 It\\u99999999?s}')).toBe('Its');
  });

  it('does not throw on a large negative unicode parameter, and swallows its substitute character', () => {
    expect(rtfToText('{\\rtf1 It\\u-99999999?s}')).toBe('Its');
  });

  it('still decodes a valid unicode escape whose parameter needs the negative-to-unsigned correction', () => {
    // 0x2019 (’) stored as a negative 16-bit RTF parameter: 8217 - 65536 = -57319.
    expect(rtfToText('{\\rtf1 It\\u-57319?s}')).toBe('It’s');
  });

  it('still decodes a direct astral-plane unicode escape', () => {
    expect(rtfToText('{\\rtf1 \\u128512?}')).toBe('😀');
  });

  it('turns \\~ into a space and \\_ into a hyphen', () => {
    expect(rtfToText('{\\rtf1 Holy\\~Spirit}')).toBe('Holy Spirit');
    expect(rtfToText('{\\rtf1 well\\_being}')).toBe('well-being');
  });
});
