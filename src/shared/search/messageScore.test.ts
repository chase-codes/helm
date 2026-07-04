import { describe, expect, it } from 'vitest';
import { matchTol, rankQuotes, rankTapes, scoreTape } from './messageScore';

const TAPES = [
  { id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: 'December 4, 1965' },
  { id: 'faith', tapeNo: '47-0412', title: 'Faith Is The Substance', date: 'April 12, 1947' },
];
const QUOTES = [
  { msgId: 'rapture', tapeNo: '65-1204', title: 'The Rapture', ord: 2, label: '76', text: 'Now, the Rapture is made up of three things.', snippet: '' },
  { msgId: 'faith', tapeNo: '47-0412', title: 'Faith Is The Substance', ord: 0, label: '1', text: 'Faith is the substance of things hoped for.', snippet: '' },
];

describe('messageScore', () => {
  it('shares the songScore tolerance rule (resolves len-5 divergence)', () => {
    expect(matchTol(4)).toBe(1);
    expect(matchTol(5)).toBe(2);
    expect(matchTol(6)).toBe(2);
  });
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
});
