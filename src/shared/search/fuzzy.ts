export function norm(s: string): string {
  return (s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
  }
  return d[m][n];
}
// Single source of truth for fuzzy-match tolerance by token length: short tokens
// (≤4) allow 1 edit, longer tokens allow 2. Used by fuzzyTok, songScore, and
// messageScore so every scorer agrees on len-5 (→ 2) and every other length.
export function matchTol(tokLen: number): number {
  return tokLen <= 4 ? 1 : 2;
}
export function fuzzyTok(tok: string, words: string[]): boolean {
  const tol = matchTol(tok.length);
  return words.some((w) => Math.abs(w.length - tok.length) <= 2 && lev(tok, w) <= tol);
}
