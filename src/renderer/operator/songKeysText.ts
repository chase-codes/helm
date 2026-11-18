import type { MusicKeyCounts, TitleKeyRowFlag } from '../../shared/types';
import type { MusicKeySource } from '../../shared/songs/musicKey';
import type { TitleKeyReviewRow } from './TitleKeyReview';
import type { KeyCellProblem, KeyImportGroup } from '../../shared/songs/keySheet';

// The Song keys window's words (docs/ux-vocabulary.md, "Song keys"), apart from the
// component so the window file exports components only.

/** Where a key came from, in plain words. Legacy is not here: it reads "Was: <text>". */
export const SOURCE_WORDS: Record<Exclude<MusicKeySource, 'legacy'>, string> = {
  typed: 'Typed in Helm',
  // The sweep reads Helm's stored title, an import reads EasyWorship's: both are the song's.
  title: "From the song's title",
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

/** Why a title key is held back in the review (unchecked, at the top). Short: the row is one
 * fixed line. `currentKey` is the song's key now, for `has-key`. */
export function titleKeyNote(flag: TitleKeyRowFlag | undefined, currentKey = ''): string {
  switch (flag) {
    case 'modulation': return 'Changes key: the title stays';
    case 'two-keys': return 'Two keys: left in the title';
    case 'single-letter': return 'One letter: a key, or a version?';
    case 'has-key': return `Already has key ${currentKey}`;
    default: return '';
  }
}

/** "412 keys", "1 key". */
export const keysCount = (n: number): string => `${n.toLocaleString()} ${n === 1 ? 'key' : 'keys'}`;

/** The rows a title-key review starts with checked: every one with a key that is not flagged. */
export const defaultChecked = (rows: TitleKeyReviewRow[]): Set<string> =>
  new Set(rows.filter((r) => r.key && !r.flagged).map((r) => r.id));

// ---------------- the spreadsheet round-trip (Phase 2) ----------------

/** The import review's groups (docs/ux-vocabulary.md, "Song keys"). */
export const GROUP_WORDS: Record<KeyImportGroup, string> = {
  ready: 'Ready',
  pick: 'Pick one',
  different: 'Already has a different key',
  'not-a-key': 'Not a key',
  'not-found': 'Not found'
};

/** Why a sheet's cell is not one key, in plain words (normalizeKey's reject reasons). */
export const PROBLEM_WORDS: Record<KeyCellProblem, string> = {
  'two-keys': 'two keys',
  // "G/D": an alternative or a change; either way, two keys for one song.
  'ambiguous-slash': 'two keys',
  'capo-ambiguous': 'capo: which is it?',
  'key-change': 'a key change',
  'not-a-key': 'not a key'
};

const rowsCount = (n: number): string => `${n.toLocaleString()} ${n === 1 ? 'row' : 'rows'}`;

/** The review's one line about the rows it left out without a look, or ''. */
export function leftOutLine(blank: number, same: number): string {
  if (blank && same) return `${rowsCount(blank)} had no key and ${same.toLocaleString()} already had that key; they were left out.`;
  if (blank) return `${rowsCount(blank)} had no key and ${blank === 1 ? 'was' : 'were'} left out.`;
  if (same) return `${rowsCount(same)} already had that key and ${same === 1 ? 'was' : 'were'} left out.`;
  return '';
}

/** After `Export songs without a key…`: "Saved 2,814 songs to Song keys to fill in.csv". */
export const savedLine = (n: number, fileName: string): string =>
  `Saved ${n.toLocaleString()} ${n === 1 ? 'song' : 'songs'} to ${fileName}`;
