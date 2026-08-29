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

  it('prefers an exact title match over an artist-name match', () => {
    // LRCLIB's "q=Jireh" is 20 rows of the artist Jireh Lim; the worship song is the
    // one whose *title* is Jireh.
    const lim = row({ trackName: 'Diwata', artistName: 'Jireh Lim', plainLyrics: 'Ikaw ang diwata\nng buhay ko\n\nIkaw ang diwata\nng buhay ko' });
    const song = row({ trackName: 'Jireh', artistName: 'Elevation Worship', plainLyrics: 'I will be content\nin every circumstance\n\nJireh You are enough\nJireh You are enough' });
    const out = rankCandidates([lim, song], 'jireh');
    expect(out[0]).toBe(song);
  });

  it('prefers a worship artist when titles match equally', () => {
    const pop = row({ trackName: 'Gratitude', artistName: 'Beastie Boys', plainLyrics: 'Good times gone\nand you missed them\n\nWhat is it about gratitude\nthat you find so hard' });
    const worship = row({ trackName: 'Gratitude', artistName: 'Brandon Lake', plainLyrics: 'All my words fall short\nI got nothing new\n\nSo I throw up my hands\nand praise You again' });
    const out = rankCandidates([pop, worship], 'gratitude');
    expect(out[0]).toBe(worship);
  });

  it('prefers lyrics that read as worship when artist gives no signal', () => {
    const pop = row({ trackName: 'Promises', artistName: 'Naked Eyes', plainLyrics: 'Promises promises\nyou knew you would never keep\n\nPromises promises\nwhy do I believe' });
    const worship = row({ trackName: 'Promises', artistName: 'Maverick City Music', plainLyrics: 'God of Abraham\nYou are the God of covenant\n\nI put my faith in Jesus\nmy anchor to the ground' });
    const out = rankCandidates([pop, worship], 'promises');
    expect(out[0]).toBe(worship);
  });

  it('prefers the plain song over a medley that contains its title', () => {
    const medley = row({ trackName: 'The Worship Medley: Reckless Love / O Come To The Altar / Great Are You Lord', artistName: 'Tauren Wells', plainLyrics: 'Before I spoke a word\nYou were singing over me\n\nO come to the altar\nthe Father\'s arms are open wide' });
    const plain = row({ trackName: 'Reckless Love', artistName: 'Cory Asbury', plainLyrics: 'Before I spoke a word\nYou were singing over me\n\nOh the overwhelming\nnever-ending reckless love of God' });
    const out = rankCandidates([medley, plain], 'reckless love');
    expect(out[0]).toBe(plain);
  });

  it('demotes rows whose title says instrumental even when the flag is unset', () => {
    const instr = row({ trackName: 'Promises (Instrumental)', artistName: 'The Worship Initiative Instrumentals' });
    const sung = row({ trackName: 'Promises', artistName: 'The Worship Initiative', plainLyrics: STANZAS + '\nextra line' });
    const out = rankCandidates([instr, sung], 'promises');
    expect(out[0]).toBe(sung);
  });

  it('returns an empty array for no usable rows', () => {
    expect(rankCandidates([], 'anything')).toEqual([]);
  });
});
