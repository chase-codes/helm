import { describe, it, expect } from 'vitest';
import { cleanListPoints } from './listPoints';

describe('cleanListPoints', () => {
  it('strips the common typed list markers (#50)', () => {
    expect(cleanListPoints(['- item', '* item', '+ item', '• item', '– item', '— item'])).toEqual([
      'item', 'item', 'item', 'item', 'item', 'item'
    ]);
  });

  it('strips numeric markers in both 1. and 1) form', () => {
    expect(cleanListPoints(['1. first', '2) second', '10. tenth'])).toEqual(['first', 'second', 'tenth']);
  });

  it('leaves a bare item alone', () => {
    expect(cleanListPoints(['Fellowship dinner'])).toEqual(['Fellowship dinner']);
  });

  it('leaves a hyphen inside an item alone', () => {
    expect(cleanListPoints(['Mid-week prayer - 7pm'])).toEqual(['Mid-week prayer - 7pm']);
  });

  it('does not treat a marker glued to a word as a marker', () => {
    // "-ish", "1.5 loaves": a marker only counts when whitespace (or line end) follows.
    expect(cleanListPoints(['-ish', '1.5 loaves'])).toEqual(['-ish', '1.5 loaves']);
  });

  it('drops a line that is only a marker instead of emitting an empty bullet', () => {
    expect(cleanListPoints(['-', '•', '1.', '  *  '])).toEqual([]);
  });

  it('drops blank lines and trims whitespace, like the editor always has', () => {
    expect(cleanListPoints(['  a  ', '', '   ', 'b'])).toEqual(['a', 'b']);
  });

  it('strips only one marker — nested bullets are out of scope', () => {
    expect(cleanListPoints(['- - inner'])).toEqual(['- inner']);
  });

  it('does not strip a bare year or number', () => {
    expect(cleanListPoints(['2026 vision night'])).toEqual(['2026 vision night']);
  });
});
