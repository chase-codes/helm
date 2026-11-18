import type { Song } from '../types';
import { lyricsOf, lyricsOfSections } from './lyrics';
import { splitToSlides } from './splitToSlides';
import { extractKeyFromTitle, isMusicKey } from './musicKey';

// A song is a duplicate when its title, its key and its lyrics all match (song keys spec,
// Phase 1d). Title alone would silently drop a second arrangement of a common hymn title,
// and that absence would only surface mid-service. The key is in it so that "X (G)" and
// "X (Bb)", two leaders' copies with the same lyrics, stay two songs; the title is the
// CLEAN title (the key moved out), so "X (Eb)" stored before keys moved out of titles still
// matches "X (Eb)" scanned again, and so does the "X" + key Eb it becomes after the sweep.
//
// Built the same way on both sides: extractKeyFromTitle gives the clean title and the
// title's key, and the stored side falls back on the song's key when its title has none.
const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

const importKey = (cleanTitle: string, musicKey: string, lyrics: string): string =>
  `${normalize(cleanTitle)}\u0000${musicKey}\u0000${normalize(lyrics)}`;

/** Every identity a stored song answers to. The first is the spec's: the clean title with the
 * title's key, or, when the title has none, a key that came from a title (the sweep or an
 * import moved it). The second is the song's own key when that differs, so a scanned
 * "X (G)" finds the stored "X" a person keyed G. A key a person set on a song whose title
 * has no key does NOT replace the first identity: re-scanning the same untitled "X" must
 * still find it, or every song Dana keyed would come in again. */
export function songImportKeys(song: Song): string[] {
  const t = extractKeyFromTitle(song.title);
  const own = song.key && isMusicKey(song.key) ? song.key : '';
  const titleKey = t.key ?? (song.keySource === 'title' ? own : '');
  const lyrics = lyricsOf(song);
  const keys = [importKey(t.title, titleKey, lyrics)];
  if (own && own !== titleKey) keys.push(importKey(t.title, own, lyrics));
  return keys;
}

// Runs the same splitToSlides the repo will run on commit, so the section labels it strips
// are absent from both sides of the comparison. See importKey.test.ts.
export const scannedImportKey = (title: string, text: string): string => {
  const t = extractKeyFromTitle(title);
  return importKey(t.title, t.key ?? '', lyricsOfSections(splitToSlides(text)));
};
