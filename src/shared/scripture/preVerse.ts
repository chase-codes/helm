import type { BibleManifestEntry, ChapterData } from '../types';

// Extract a single verse's text for one version from a fetched chapter. Returns null
// when the verse number (or that version's text for it) is absent. Pure and unit-tested;
// the IPC fetch lives in the caller (PreCardEditor).
export function verseText(chapter: ChapterData, verse: number, versionId: string): string | null {
  return chapter.verses[verse]?.[versionId] ?? null;
}

/**
 * The text of verses `from`..`to` in one version, joined into the single block a
 * pre-service verse card shows. Verses the chapter does not have are skipped rather than
 * failing the whole range, so "John 3:35-40" in a 36-verse chapter is still 35 and 36.
 * Null when none of the range exists in that version: there is nothing to put on the card.
 */
export function passageText(chapter: ChapterData, from: number, to: number, versionId: string): string | null {
  const parts: string[] = [];
  for (let v = from; v <= to; v++) {
    const t = verseText(chapter, v, versionId);
    if (t) parts.push(t.trim());
  }
  return parts.length ? parts.join(' ') : null;
}

/**
 * The translation a pre-service verse card is filled from: the Scripture track's primary
 * version (`scriptureVersions[0]`, the one its entry searches) while it is still
 * installed, else the first installed Bible. Null when none is installed. One rule, so a
 * word searched here finds what it finds on the Sermon page.
 */
export function pickCardBible(manifest: BibleManifestEntry[], scriptureVersions: string[]): BibleManifestEntry | null {
  const installed = manifest.filter((m) => m.installed);
  return installed.find((m) => m.id === scriptureVersions[0]) ?? installed[0] ?? null;
}
