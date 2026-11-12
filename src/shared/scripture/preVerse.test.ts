import { describe, it, expect } from 'vitest';
import { passageText, pickCardBible, verseText } from './preVerse';
import type { BibleManifestEntry, ChapterData } from '../types';

const chapter: ChapterData = {
  book: 'Psalm',
  chapter: 122,
  verseCount: 2,
  verses: { 1: { kjv: 'I was glad…' }, 2: { kjv: 'Our feet shall stand…' } }
};

describe('verseText', () => {
  it('returns the verse text for a present verse + version', () => {
    expect(verseText(chapter, 1, 'kjv')).toBe('I was glad…');
  });
  it('returns null when the verse number is absent', () => {
    expect(verseText(chapter, 9, 'kjv')).toBeNull();
  });
  it('returns null when the version is absent for that verse', () => {
    expect(verseText(chapter, 1, 'web')).toBeNull();
  });
});

describe('passageText', () => {
  it('returns a single verse unchanged', () => {
    expect(passageText(chapter, 1, 1, 'kjv')).toBe('I was glad…');
  });
  it('joins a range into one block', () => {
    expect(passageText(chapter, 1, 2, 'kjv')).toBe('I was glad… Our feet shall stand…');
  });
  it('skips verses past the end of the chapter', () => {
    expect(passageText(chapter, 2, 9, 'kjv')).toBe('Our feet shall stand…');
  });
  it('is null when nothing in the range exists in that version', () => {
    expect(passageText(chapter, 5, 9, 'kjv')).toBeNull();
    expect(passageText(chapter, 1, 2, 'web')).toBeNull();
  });
});

describe('pickCardBible', () => {
  const kjv: BibleManifestEntry = { id: 'kjv', abbr: 'KJV', name: 'King James', installed: true };
  const web: BibleManifestEntry = { id: 'web', abbr: 'WEB', name: 'World English', installed: true };
  it("uses the Scripture track's primary version", () => {
    expect(pickCardBible([kjv, web], ['web', 'kjv'])?.id).toBe('web');
  });
  it('falls back to the first installed Bible when the primary is gone', () => {
    expect(pickCardBible([kjv, { ...web, installed: false }], ['web'])?.id).toBe('kjv');
  });
  it('is null with no Bible installed', () => {
    expect(pickCardBible([{ ...kjv, installed: false }], ['kjv'])).toBeNull();
  });
});
