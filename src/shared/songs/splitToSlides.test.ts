import { expect, test } from 'vitest';
import { splitToSlides } from './splitToSlides';

test('splits on blank lines and auto-labels', () => {
  const r = splitToSlides('Line one\nLine two\n\nChorus\nThe chorus line');
  expect(r).toEqual([
    { label: 'Verse 1', lines: ['Line one', 'Line two'] },
    { label: 'Chorus', lines: ['The chorus line'] },
  ]);
});
test('recognizes labeled headers case-insensitively, strips punctuation', () => {
  const r = splitToSlides('VERSE 2:\nA line\n\nPre-Chorus.\nB line');
  expect(r[0].label).toBe('VERSE 2'); expect(r[1].label).toBe('Pre-Chorus');
});
test('empty and whitespace-only input → []', () => {
  expect(splitToSlides('')).toEqual([]); expect(splitToSlides(' \n \n ')).toEqual([]);
});
