import type { SongSearchResult } from '../types';

// Lyric matches to show as a subordinate hint under a Title search: [] unless the title
// results are "thin" (fewer than `threshold`); otherwise the lyric results whose song is
// not already a title hit, capped at `limit`. Title results are never reordered here.
export function secondaryLyricRows(
  titleResults: SongSearchResult[],
  lyricResults: SongSearchResult[],
  threshold: number,
  limit: number,
): SongSearchResult[] {
  if (titleResults.length >= threshold) return [];
  const titleIds = new Set(titleResults.map((r) => r.song.id));
  return lyricResults.filter((r) => !titleIds.has(r.song.id)).slice(0, limit);
}
