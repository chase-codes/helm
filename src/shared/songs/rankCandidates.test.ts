// src/shared/songs/rankCandidates.test.ts
import { describe, expect, it } from 'vitest';
import { rankCandidates, type LrclibRow } from './rankCandidates';

const STANZAS = 'I love You, Lord\nFor Your mercy never fails me\n\nAll my life You have been faithful\nAll my life You have been so, so good';
// Different words AND no stanza breaks — must not share a dedup key with STANZAS
// (the key collapses all whitespace, so merely removing blank lines is not enough).
const FLAT = 'Sing it one more time\n' + STANZAS.replace(/\n\n/g, '\n');

const row = (over: Partial<LrclibRow>): LrclibRow => ({
  trackName: 'Goodness of God', artistName: 'Bethel Music', albumName: 'Victory',
  duration: 296, instrumental: false, plainLyrics: STANZAS, ...over,
});

describe('rankCandidates', () => {
  it('drops instrumentals and rows without plain lyrics', () => {
    const rows = [row({ instrumental: true }), row({ plainLyrics: null }), row({ plainLyrics: '  ' }), row({})];
    expect(rankCandidates(rows, 'goodness of god')).toHaveLength(1);
  });

  it('demotes the livestream rip below the studio version', () => {
    const livestream = row({ trackName: 'Goodness of God (Live Stream)', duration: 2466, plainLyrics: FLAT });
    const studio = row({});
    const out = rankCandidates([livestream, studio], 'goodness of god');
    expect(out[0]).toBe(studio);
    expect(out[1]).toBe(livestream);
  });

  it('collapses identical lyric bodies (whitespace/case-insensitive) keeping the best-scored', () => {
    const a = row({});
    // Same lyric body (uppercased, extra whitespace) but a livestream duration — scores
    // lower than a, so the dedup must keep a even though b comes first in the input.
    const b = row({ albumName: 'Peace', duration: 2466, plainLyrics: STANZAS.toUpperCase().replace(/\n/g, ' \n') });
    const out = rankCandidates([b, a], 'goodness of god');
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(a);
  });

  it('ranks better title matches first', () => {
    const match = row({});
    const other = row({ trackName: 'Different Song Entirely', artistName: 'Someone Else', plainLyrics: 'Other words here\nMore other words\n\nOther chorus line\nAnother other line' });
    const out = rankCandidates([other, match], 'goodness of god bethel');
    expect(out[0]).toBe(match);
  });

  it('returns an empty array for no usable rows', () => {
    expect(rankCandidates([], 'anything')).toEqual([]);
  });
});
