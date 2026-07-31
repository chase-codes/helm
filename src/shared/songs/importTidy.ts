// The six normalisations applied to imported lyrics, and no others. Source-agnostic: a CSV
// adapter will want exactly these too.
//
// Deliberately NOT done — each one can silently alter a lyric nobody re-reads until it is on
// the projector: punctuation stripping, recapitalisation, "x2" removal, section renaming,
// reflowing long blocks. importTidy.test.ts pins this with a guard test.

const ARTIFACT_LINE = /^(?:\(\s*\)|\[\s*\]|\.)$/;

export function importTidy(text: string): string {
  return (text || '')
    .replace(/\r\n?/g, '\n')                       // 1. CRLF / CR → LF
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))    // 2. trailing whitespace
    .filter((line) => !ARTIFACT_LINE.test(line.trim())) // 5. debris (before the collapse)
    .join('\n')
    .replace(/[‘’ʼ]/g, "'")         // 4. curly quotes
    .replace(/[“”]/g, '"')
    .replace(/\n{3,}/g, '\n\n')                    // 3. one blank line = one slide break
    .replace(/^\n+|\n+$/g, '');                    // 6. leading / trailing blank lines
}
