import type { Song, SongSection } from '../types';

// Flatten sections into a single space-joined lyric blob. Shared by the FTS indexer
// (songsRepo), the in-memory ranker (songScore) and the import dedupe key (importKey) so
// every one of them indexes, searches and compares over identical text.
export const lyricsOfSections = (sections: SongSection[]): string =>
  sections.map((sc) => sc.lines.join(' ')).join(' ');

export const lyricsOf = (s: Song): string => lyricsOfSections(s.sections);
