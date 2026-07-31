// RTF → plain text, scoped to the dialect EasyWorship's editor emits rather than the whole
// RTF specification. Never throws: a blob it cannot make sense of yields whatever text was
// recoverable, and the caller treats an empty result as an unreadable song.

// Control words whose entire group is metadata, not lyrics.
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'generator', 'filetbl',
  'listtable', 'listoverridetable', 'rsidtbl', 'themedata', 'datastore', 'xmlnstbl'
]);

// Windows-1252 puts printable characters where Latin-1 has control codes (0x80–0x9F), and
// EasyWorship's \'xx escapes are cp1252 — curly quotes and dashes land in exactly this range,
// so treating them as Latin-1 would yield control characters instead of punctuation.
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178
};

interface GroupState {
  skip: boolean; // inside a destination whose text is discarded
  uc: number;    // substitute characters to swallow after a \u escape
}

export function rtfToText(rtf: string): string {
  if (!rtf) return '';
  const out: string[] = [];
  const stack: GroupState[] = [{ skip: false, uc: 1 }];
  let g = stack[0];
  let i = 0;
  let skipChars = 0; // literal characters still to be swallowed after \uN

  const emit = (s: string): void => {
    if (!g.skip) out.push(s);
  };

  while (i < rtf.length) {
    const ch = rtf[i];

    if (ch === '{') {
      stack.push({ ...g });
      g = stack[stack.length - 1];
      i++;
      continue;
    }

    if (ch === '}') {
      if (stack.length > 1) {
        stack.pop();
        g = stack[stack.length - 1];
      }
      skipChars = 0; // a \uN substitute never spans a group boundary
      i++;
      continue;
    }

    if (ch === '\\') {
      i++;
      const next = rtf[i];
      if (next === undefined) break;

      if (next === '\\' || next === '{' || next === '}') {
        if (skipChars > 0) skipChars--;
        else emit(next);
        i++;
        continue;
      }

      if (next === '*') {
        g.skip = true;
        i++;
        continue;
      }

      if (next === "'") {
        const code = parseInt(rtf.slice(i + 1, i + 3), 16);
        i += 3;
        if (skipChars > 0) skipChars--;
        else if (!Number.isNaN(code)) emit(String.fromCharCode(CP1252_HIGH[code] ?? code));
        continue;
      }

      if (next === '~') {
        emit(' '); // non-breaking space: plain ASCII, downstream tidying collapses whitespace
        i++;
        continue;
      }

      if (next === '_') {
        emit('-'); // non-breaking hyphen: plain ASCII is fine here too
        i++;
        continue;
      }

      if (!/[a-z]/i.test(next)) {
        i++; // other control symbols such as \- carry no lyric text
        continue;
      }

      // Control word: letters, an optional signed number, then an optional single space
      // which is a delimiter rather than text.
      let j = i;
      while (j < rtf.length && /[a-z]/i.test(rtf[j])) j++;
      const word = rtf.slice(i, j);
      let numStr = '';
      if (rtf[j] === '-') {
        numStr = '-';
        j++;
      }
      while (j < rtf.length && /[0-9]/.test(rtf[j])) numStr += rtf[j++];
      if (rtf[j] === ' ') j++;
      i = j;
      const num = numStr === '' ? null : parseInt(numStr, 10);

      if (SKIP_DESTINATIONS.has(word)) g.skip = true;
      else if (word === 'uc') g.uc = num ?? 1;
      else if (word === 'u' && num !== null) {
        // A corrupted blob can carry a \u parameter outside the valid Unicode range. That must
        // degrade to "no character emitted", not throw — the substitute character is still
        // swallowed either way, so a malformed escape doesn't leave a stray '?' in the lyric.
        const cp = num < 0 ? num + 0x10000 : num;
        if (cp >= 0 && cp <= 0x10ffff) emit(String.fromCodePoint(cp));
        skipChars = g.uc;
      } else if (word === 'par' || word === 'line' || word === 'sect') emit('\n');
      else if (word === 'tab') emit('\t');
      // every other control word is formatting and produces no text
      continue;
    }

    i++;
    if (ch === '\r' || ch === '\n') continue; // source-file wrapping, not lyric structure
    if (skipChars > 0) {
      skipChars--;
      continue;
    }
    emit(ch);
  }

  return out.join('');
}
