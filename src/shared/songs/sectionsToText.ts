import type { SongSection } from '../types';

// Inverse of splitToSlides for stored songs: every persisted label either matched
// splitToSlides' label regex or is a generated `Verse N`, so emitting the label as
// the stanza's first line re-parses to the identical sections. (splitToSlides only
// consumes ONE label line per stanza, so a lyric line that happens to start with
// "Chorus…" after a real label survives the trip.)
export const sectionsToText = (sections: SongSection[]): string =>
  sections.map((s) => [s.label, ...s.lines].join('\n')).join('\n\n');
