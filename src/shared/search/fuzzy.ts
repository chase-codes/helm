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
export function fuzzyTok(tok: string, words: string[]): boolean {
  const tol = tok.length >= 6 ? 2 : 1;
  return words.some((w) => Math.abs(w.length - tok.length) <= 2 && lev(tok, w) <= tol);
}
