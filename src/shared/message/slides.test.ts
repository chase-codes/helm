import { describe, expect, it } from 'vitest';
import { buildQuoteSlide, buildReadingSlide, keyForMessageQuote, keyForReading } from './slides';

const MSG = {
  id: 'rapture', tapeNo: '65-1204', title: 'The Rapture', date: 'December 4, 1965',
  durationS: 9430, audioPath: null, source: 'vgr',
  paragraphs: [
    { ord: 0, label: 'E-1', text: 'Let us pray.' },
    { ord: 1, label: '76', text: 'Now, the Rapture is made up of three things.' },
  ],
};

describe('message slides', () => {
  it('builds a quote slide with byte-exact reference', () => {
    const s = buildQuoteSlide(MSG, 1);
    expect(s.kind).toBe('quote');
    expect(s.text).toBe('Now, the Rapture is made up of three things.');
    expect(s.source).toBe('The Rapture · Tape 65-1204 · ¶76');
    expect(s.accent).toBe('#a88bc4');
  });
  it('builds a reading slide carrying all paragraphs + activeOrd', () => {
    const s = buildReadingSlide(MSG, 1);
    expect(s.kind).toBe('reading');
    expect(s.activeOrd).toBe(1);
    expect(s.paras).toHaveLength(2);
    expect(s.paras?.[0]).toEqual({ label: 'E-1', text: 'Let us pray.' });
  });
  it('keys: same tape = same flow key prefix; reading key is per-tape', () => {
    expect(keyForMessageQuote('rapture', 1)).toBe('msg:rapture:1');
    expect(keyForReading('rapture')).toBe('read:rapture');
  });
});
