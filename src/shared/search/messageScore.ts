import { lev, norm } from './fuzzy';

export interface TapeRow { id: string; tapeNo: string; title: string; date: string }
export interface QuoteRow { msgId: string; tapeNo: string; title: string; ord: number; label: string; text: string; snippet: string }

export function matchTol(tokLen: number): number {
  return tokLen <= 4 ? 1 : 2;
}

function tokensMatch(blob: string, qts: string[]): number {
  const words = blob.split(' ');
  let matched = 0;
  for (const t of qts) {
    if (blob.includes(t)) { matched++; continue; }
    const tol = matchTol(t.length);
    if (words.some((w) => Math.abs(w.length - t.length) <= 2 && lev(t, w) <= tol)) matched++;
  }
  return matched;
}

export function scoreTape(query: string, tape: { tapeNo: string; title: string }): number {
  const q = norm(query);
  if (!q) return 0;
  const qts = q.split(' ');
  const blob = norm(`${tape.title} ${tape.tapeNo}`);
  const matched = tokensMatch(blob, qts);
  if (matched < qts.length) return 0;
  const title = norm(tape.title);
  return title === q ? 1000 : title.includes(q) ? 800 - title.indexOf(q) : 400 + matched * 12;
}

export function rankTapes(query: string, tapes: TapeRow[]): TapeRow[] {
  if (!norm(query)) return [];
  return tapes
    .map((t) => ({ t, s: scoreTape(query, t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}

export function scoreQuote(query: string, row: { title: string; tapeNo: string; text: string }): { score: number; snippet: string } {
  const q = norm(query);
  if (!q) return { score: 0, snippet: '' };
  const qts = q.split(' ');
  const blob = norm(`${row.title} ${row.tapeNo} ${row.text}`);
  const matched = tokensMatch(blob, qts);
  if (matched < qts.length) return { score: 0, snippet: '' };
  const snippet = qts.some((t) => t.length > 2 && norm(row.text).includes(t)) ? row.text : '';
  return { score: 300 + matched * 12, snippet };
}

export function rankQuotes(query: string, rows: QuoteRow[]): QuoteRow[] {
  if (!norm(query)) return [];
  return rows
    .map((r) => ({ r, ...scoreQuote(query, r) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((x) => ({ ...x.r, snippet: x.snippet }));
}
