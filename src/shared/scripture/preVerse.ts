import type { ChapterData } from '../types';

// Extract a single verse's text for one version from a fetched chapter. Returns null
// when the verse number (or that version's text for it) is absent — the editor turns
// that into a "verse not found" message. Pure and unit-tested; the IPC fetch lives in
// the caller (PreCardEditor).
export function verseText(chapter: ChapterData, verse: number, versionId: string): string | null {
  return chapter.verses[verse]?.[versionId] ?? null;
}
