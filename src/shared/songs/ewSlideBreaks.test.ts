import { describe, expect, it } from 'vitest';
import { ewSlideBreaks } from './ewSlideBreaks';

describe('ewSlideBreaks', () => {
  it('breaks only on an exactly-empty paragraph', () => {
    expect(ewSlideBreaks(['Verse 1', 'line one', '', 'Chorus', 'line two'])).toEqual({
      slideCount: 2,
      text: 'Verse 1\nline one\n\nChorus\nline two'
    });
  });

  // EW8 spec §4.2 rule 2, proven against Library A song_id 98: EasyWorship records ONE slide
  // for this song, not two. A paragraph holding a single space is content, not a break.
  it('treats a one-space paragraph as content, not a break', () => {
    expect(ewSlideBreaks(['CHORUS', 'line one', ' ', 'line two'])).toEqual({
      slideCount: 1,
      text: 'CHORUS\nline one\nline two'
    });
  });

  it('collapses a run of empty paragraphs into one break', () => {
    expect(ewSlideBreaks(['A', '', '', '', 'B']).slideCount).toBe(2);
  });

  // EW8 spec §4.2 rule 4, proven against Library A song_id 34: the RTF opens with a bare
  // \par and EasyWorship records 6 slides for 5 content sections. The leading empty slide
  // counts, so the comparison against slide_uids lines up — but it is not imported.
  it('counts a leading empty slide but leaves it out of the text', () => {
    expect(ewSlideBreaks(['', 'A', '', 'B'])).toEqual({ slideCount: 3, text: 'A\n\nB' });
  });

  it('drops trailing empty paragraphs without counting a trailing slide', () => {
    expect(ewSlideBreaks(['A', '', ''])).toEqual({ slideCount: 1, text: 'A' });
  });

  it('keeps a \\line-produced newline inside its slide', () => {
    expect(ewSlideBreaks(['A\nB'])).toEqual({ slideCount: 1, text: 'A\nB' });
  });

  it('emits no whitespace-only line, so nothing downstream can reread one as a break', () => {
    const { text } = ewSlideBreaks(['A', '   ', 'B', '', 'C']);
    expect(text).toBe('A\nB\n\nC');
    expect(text.split('\n').some((l) => l !== '' && l.trim() === '')).toBe(false);
  });

  it('preserves leading indentation inside a line', () => {
    expect(ewSlideBreaks(['      houses and lands,']).text).toBe('      houses and lands,');
  });

  it('returns nothing for no paragraphs', () => {
    expect(ewSlideBreaks([])).toEqual({ slideCount: 0, text: '' });
  });
});
