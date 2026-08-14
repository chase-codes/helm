import { expect, test } from 'vitest';
import { sectionsToText } from './sectionsToText';
import { splitToSlides } from './splitToSlides';

test('emits label lines and blank-line stanza separators', () => {
  expect(
    sectionsToText([
      { label: 'Verse 1', lines: ['line a', 'line b'] },
      { label: 'Chorus', lines: ['line c'] }
    ])
  ).toBe('Verse 1\nline a\nline b\n\nChorus\nline c');
});

test('round-trips through splitToSlides: labels and lines survive', () => {
  const sections = [
    { label: 'Verse 1', lines: ['Amazing grace! how sweet the sound'] },
    { label: 'Chorus', lines: ['Praise God', 'from whom all blessings flow'] },
    { label: 'Verse 2', lines: ['Chorus of angels sing'] }, // lyric line that LOOKS like a label
    { label: 'Bridge', lines: ['up from the grave'] },
    { label: 'Tag', lines: ['amen', 'amen'] }
  ];
  expect(splitToSlides(sectionsToText(sections))).toEqual(sections);
});
