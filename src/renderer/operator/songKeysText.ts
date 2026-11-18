import type { MusicKeyCounts } from '../../shared/types';
import type { MusicKeySource } from '../../shared/songs/musicKey';

// The Song keys window's words (docs/ux-vocabulary.md, "Song keys"), apart from the
// component so the window file exports components only.

/** Where a key came from, in plain words. Legacy is not here: it reads "Was: <text>". */
export const SOURCE_WORDS: Record<Exclude<MusicKeySource, 'legacy'>, string> = {
  typed: 'Typed in Helm',
  title: 'From the title in EasyWorship',
  import: 'From the EasyWorship import',
  csv: 'From a spreadsheet',
  pco: 'From Planning Center',
  chart: 'From a chord chart',
  detected: 'Detected from chords'
};

/** The one progress line: scoped to Sung lately, never the whole library. */
export function progressLine(c: MusicKeyCounts | null): string {
  if (!c || c.total === 0) return '';
  if (!c.anyLive) return "Helm hasn't seen a song go live yet. Search for this Sunday's songs, or start at the top.";
  if (c.lately === 0) return 'No song has gone live in the last eight weeks.';
  return `Sung lately: ${c.latelyWithKey} of ${c.lately} ${c.lately === 1 ? 'has' : 'have'} a key.`;
}
