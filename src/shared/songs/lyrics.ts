import type { Song } from '../types';

// Flatten a song's sections into a single space-joined lyric blob. Shared by the
// FTS indexer (songsRepo) and the in-memory ranker (songScore) so both index and
// search over identical text.
export const lyricsOf = (s: Song): string => s.sections.map((sc) => sc.lines.join(' ')).join(' ');
