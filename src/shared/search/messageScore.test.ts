import { describe, expect, it } from 'vitest';
import { rankQuotes, rankTapes, scoreTape, type QuoteRow } from './messageScore';

const TAPES = [
  { id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: 'December 4, 1965' },
  { id: 'faith', tapeNo: '47-0412', title: 'Faith Is The Substance', date: 'April 12, 1947' },
];
const QUOTES = [
  { msgId: 'rapture', tapeNo: '65-1204', title: 'The Rapture', ord: 2, label: '76', text: 'Now, the Rapture is made up of three things.', snippet: '' },
  { msgId: 'faith', tapeNo: '47-0412', title: 'Faith Is The Substance', ord: 0, label: '1', text: 'Faith is the substance of things hoped for.', snippet: '' },
];

describe('messageScore', () => {
  it('ranks tapes by title/tape number with typo tolerance', () => {
    const r = rankTapes('raptur', TAPES);
    expect(r[0].id).toBe('rapture');
  });
  it('matches a tape by its number', () => {
    expect(scoreTape('65-1204', TAPES[0])).toBeGreaterThan(0);
  });
  it('ranks quotes by paragraph text and caps at 12', () => {
    const r = rankQuotes('substance', QUOTES);
    expect(r[0].msgId).toBe('faith');
  });
  it('returns nothing for an empty query', () => {
    expect(rankTapes('', TAPES)).toEqual([]);
    expect(rankQuotes('', QUOTES)).toEqual([]);
  });

  it('tolerates a genuine typo via the fuzzy path (not a substring match)', () => {
    // 'raptdre' is not a substring of any tape blob, so this must go through lev()
    const r = rankTapes('raptdre', TAPES);
    expect(r[0].id).toBe('rapture');
  });

  it('caps quote results at 12 even when more match', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      msgId: `m${i}`,
      tapeNo: `65-120${i % 10}`,
      title: 'The Rapture',
      ord: i,
      label: String(i),
      text: `grace and truth, portion number ${i}`,
      snippet: '',
    }));
    expect(rankQuotes('grace', many)).toHaveLength(12);
  });
});

// --- #53 cluster, message side: whole-word matching, real relevance, deterministic order ---
const quote = (msgId: string, ord: number, text: string): QuoteRow =>
  ({ msgId, tapeNo: '65-1204', title: 'The Rapture', ord, label: String(ord), text }) as QuoteRow;

describe('messageScore relevance', () => {
  it('a substring inside a longer word does not match a quote', () => {
    expect(rankQuotes('son', [quote('a', 0, 'A person of peace came near')])).toHaveLength(0);
  });

  it('a contiguous phrase outranks the same words scattered, either order', () => {
    const phrase = quote('p', 0, 'The love of God is greater far than tongue can tell');
    const scatter = quote('s', 0, 'God gives the morning and love flows out of every heart');
    for (const rows of [[phrase, scatter], [scatter, phrase]]) {
      expect(rankQuotes('love of god', rows)[0].msgId).toBe('p');
    }
  });

  it('bm25 relevance breaks ties between otherwise-equal quotes, either order', () => {
    const a = quote('a', 0, 'grace abounds tonight');
    const b = quote('b', 0, 'grace alone remains');
    const rel = new Map([['a:0', 3.5], ['b:0', 1.0]]);
    for (const rows of [[a, b], [b, a]]) {
      expect(rankQuotes('grace', rows, rel)[0].msgId).toBe('a');
    }
  });

  it('the 12-quote cap keeps the best matches, not the first twelve', () => {
    const filler = Array.from({ length: 14 }, (_, i) => quote(`f${i}`, i, `grace and mercy portion ${i}`));
    const best = quote('best', 99, 'grace upon grace forever');
    const r = rankQuotes('grace', [...filler, best]);
    expect(r.some((q) => q.msgId === 'best')).toBe(true);
  });

  it('tape ranking is insertion-order independent', () => {
    const a = { id: 'a', tapeNo: '65-1204', title: 'The Rapture', date: '' };
    const b = { id: 'b', tapeNo: '47-0412', title: 'The Seal', date: '' };
    expect(rankTapes('the', [a, b])[0].id).toBe(rankTapes('the', [b, a])[0].id);
  });

  it('a partial tape number keeps matching as the operator types', () => {
    // pins the digit-prefix path across the whole-word matching refactor
    expect(scoreTape('65-12', TAPES[0])).toBeGreaterThan(0);
  });
});
