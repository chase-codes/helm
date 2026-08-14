import { norm, textSignals } from './fuzzy';

export interface TapeRow { id: string; tapeNo: string; title: string; date: string }
export interface QuoteRow { msgId: string; tapeNo: string; title: string; ord: number; label: string; text: string }

export function scoreTape(query: string, tape: { tapeNo: string; title: string }): number {
  const q = norm(query);
  if (!q) return 0;
  const qts = q.split(' ');
  const words = norm(`${tape.title} ${tape.tapeNo}`).split(' ').filter(Boolean);
  const { matched } = textSignals([words], qts);
  if (matched < qts.length) return 0;
  const title = norm(tape.title);
  return title === q ? 1000 : title.includes(q) ? 800 - title.indexOf(q) : 400 + matched * 12;
}

// Order by score, then deterministically (shorter title, then title, then tape number)
// so a score plateau never falls through to insertion order (BUG-002 class).
export function rankTapes(query: string, tapes: TapeRow[]): TapeRow[] {
  if (!norm(query)) return [];
  return tapes
    .map((t) => ({ t, s: scoreTape(query, t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      if (a.t.title.length !== b.t.title.length) return a.t.title.length - b.t.title.length;
      if (a.t.title !== b.t.title) return a.t.title < b.t.title ? -1 : 1;
      return a.t.tapeNo < b.t.tapeNo ? -1 : a.t.tapeNo > b.t.tapeNo ? 1 : 0;
    })
    .map((x) => x.t);
}

// Flat primary score (a quote either matches every query token or is out) plus the
// relevance sub-signals that order the plateau (#53): phrase adjacency, bm25 from
// paragraph_fts when the repo provides it, then exact term frequency. The title/tapeNo
// head is a separate segment so a phrase run never bridges it into the paragraph text.
export function scoreQuote(query: string, row: { title: string; tapeNo: string; text: string }): { score: number; phrase: number; tf: number } {
  const q = norm(query);
  if (!q) return { score: 0, phrase: 0, tf: 0 };
  const qts = q.split(' ');
  const head = norm(`${row.title} ${row.tapeNo}`).split(' ').filter(Boolean);
  const body = norm(row.text).split(' ').filter(Boolean);
  const { matched, tf, phrase } = textSignals([head, body], qts);
  if (matched < qts.length) return { score: 0, phrase: 0, tf: 0 };
  return { score: 300 + matched * 12, phrase, tf };
}

export function rankQuotes(query: string, rows: QuoteRow[], rel?: Map<string, number>): QuoteRow[] {
  if (!norm(query)) return [];
  return rows
    .map((r) => ({ r, s: scoreQuote(query, r), rel: rel?.get(`${r.msgId}:${r.ord}`) ?? 0 }))
    .filter((x) => x.s.score > 0)
    .sort((a, b) => {
      if (b.s.score !== a.s.score) return b.s.score - a.s.score;
      if (b.s.phrase !== a.s.phrase) return b.s.phrase - a.s.phrase;
      if (b.rel !== a.rel) return b.rel - a.rel;
      if (b.s.tf !== a.s.tf) return b.s.tf - a.s.tf;
      if (a.r.tapeNo !== b.r.tapeNo) return a.r.tapeNo < b.r.tapeNo ? -1 : 1;
      return a.r.ord - b.r.ord;
    })
    .slice(0, 12)
    .map((x) => x.r);
}
