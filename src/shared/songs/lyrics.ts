import type { Song, SongSection } from '../types';

// Flatten sections into a single space-joined lyric blob. Shared by the FTS indexer
// (songsRepo) and the import dedupe key (importKey). The in-memory ranker (songScore)
// tokenizes song.sections itself because it needs section boundaries; if what this
// indexes ever changes, songScore's segment construction must change in lockstep or
// FTS will return candidates the scorer silently scores 0.
export const lyricsOfSections = (sections: SongSection[]): string =>
  sections.map((sc) => sc.lines.join(' ')).join(' ');

export const lyricsOf = (s: Song): string => lyricsOfSections(s.sections);
