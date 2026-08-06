// Best-effort lyrics extraction from an arbitrary page: strip the markup, then take the
// longest contiguous run of stanza-shaped blocks. Wrong-but-plausible output is fine —
// everything lands in the QuickAdd editor for review, and null degrades to a typed
// 'no-lyrics' error suggesting copy-paste.
import { htmlToText } from './htmlText';

const MIN_LYRIC_LINES = 6;

// Stanza-shaped: 2+ lines, none absurdly long, short on average. Legal boilerplate and
// nav chrome fail one of the three.
const lyricLike = (lines: string[]): boolean => {
  if (lines.length < 2) return false;
  if (lines.some((l) => l.length > 90)) return false;
  const avg = lines.reduce((n, l) => n + l.length, 0) / lines.length;
  return avg <= 50;
};

export function extractLyricsFromHtml(html: string): string | null {
  const stanzas = htmlToText(html)
    .split(/\n\s*\n/)
    .map((s) => s.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((s) => s.length > 0);

  const lineCount = (run: string[][]): number => run.reduce((n, s) => n + s.length, 0);
  let best: string[][] = [];
  let run: string[][] = [];
  for (const s of stanzas) {
    if (lyricLike(s)) {
      run.push(s);
      if (lineCount(run) > lineCount(best)) best = [...run];
    } else {
      run = [];
    }
  }
  if (lineCount(best) < MIN_LYRIC_LINES) return null;
  return best.map((s) => s.join('\n')).join('\n\n');
}
