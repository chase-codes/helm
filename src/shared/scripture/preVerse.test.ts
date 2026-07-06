import { describe, it, expect } from 'vitest';
import { verseText } from './preVerse';
import type { ChapterData } from '../types';

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
