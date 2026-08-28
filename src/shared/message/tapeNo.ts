const TAPE_RE = /\b(\d{2}-\d{4}[A-Za-z]?)\b/;

export function parseTapeNo(s: string): string | null {
  const m = TAPE_RE.exec(s || '');
  return m ? m[1].toUpperCase() : null;
}
