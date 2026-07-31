// Windows-1252 decoding, shared by every place that reads bytes EasyWorship wrote as an
// \ansi RTF stream: rtfToText's `\'xx` hex-escape path, and easyworship.ts's direct decode of
// a `words` BLOB column (the RTF byte stream itself, before rtfToText ever sees it as a JS
// string). Both need the same table — duplicating it risks the two decoders drifting apart.

// Windows-1252 puts printable characters where Latin-1 has control codes (0x80–0x9F), and
// EasyWorship's lyric text is cp1252 — curly quotes and dashes land in exactly this range, so
// treating them as Latin-1 would yield control characters instead of punctuation.
export const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178
};

// Decodes a raw byte stream as Windows-1252: 0x00–0x7F and 0xA0–0xFF map straight through
// (cp1252 agrees with Latin-1/Unicode there), and 0x80–0x9F go through CP1252_HIGH (falling
// back to the byte's own value for the handful of codepoints cp1252 leaves unassigned, same
// as the `\'xx` escape path does).
export function decodeCp1252(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? (CP1252_HIGH[b] ?? b) : b);
  }
  return out;
}
