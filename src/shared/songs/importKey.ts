import type { Song } from '../types';
import { lyricsOf, lyricsOfSections } from './lyrics';
import { splitToSlides } from './splitToSlides';

// A song is a duplicate when BOTH its title and its lyrics already match. Title alone would
// silently drop a second arrangement of a common hymn title, and that absence would only
// surface mid-service.
const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

const importKey = (title: string, lyrics: string): string =>
  `${normalize(title)}\u0000${normalize(lyrics)}`;

export const songImportKey = (song: Song): string => importKey(song.title, lyricsOf(song));

// Runs the same splitToSlides the repo will run on commit, so the section labels it strips
// are absent from both sides of the comparison. See importKey.test.ts.
export const scannedImportKey = (title: string, text: string): string =>
  importKey(title, lyricsOfSections(splitToSlides(text)));
