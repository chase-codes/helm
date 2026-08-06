import { describe, expect, it, vi } from 'vitest';
import { searchLrclib } from './lrclib';

const STANZAS = 'I love You, Lord\nFor Your mercy never fails me\n\nAll my life You have been faithful\nAll my life You have been faithful';

const apiRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  trackName: 'Goodness of God', artistName: 'Bethel Music', albumName: 'Victory',
  duration: 296, instrumental: false, plainLyrics: STANZAS, syncedLyrics: '', ...over,
});

const fakeFetch = (body: unknown, ok = true, status = 200): typeof fetch =>
  vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) }) as unknown as typeof fetch;

describe('searchLrclib', () => {
  it('queries the LRCLIB search endpoint with the encoded query', async () => {
    const f = fakeFetch([]);
    await searchLrclib('goodness of god', f);
    expect(f).toHaveBeenCalledWith(
      'https://lrclib.net/api/search?q=goodness%20of%20god',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('maps rows to display-ready candidates (tidied + chorus-labeled)', async () => {
    const withChorus = 'First line one\nFirst line two\n\nRepeat me now\nRepeat me now\n\nSecond stanza here\nMore words here\n\nRepeat me now\nRepeat me now';
    const f = fakeFetch([apiRow({ plainLyrics: withChorus })]);
    const out = await searchLrclib('goodness of god', f);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'Goodness of God', author: 'Bethel Music', album: 'Victory', duration: 296 });
    expect(out[0].text).toContain('Chorus\nRepeat me now');
  });

  it('applies ranking and caps results at 8', async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      apiRow({ trackName: `Song ${i}`, plainLyrics: `${STANZAS}\nUnique line ${i}` })
    );
    const out = await searchLrclib('song', fakeFetch(rows));
    expect(out).toHaveLength(8);
  });

  it('skips malformed rows instead of crashing', async () => {
    const out = await searchLrclib('x', fakeFetch([null, { trackName: 42 }, apiRow()]));
    expect(out).toHaveLength(1);
  });

  it('throws on a non-OK response', async () => {
    await expect(searchLrclib('x', fakeFetch([], false, 500))).rejects.toThrow('lrclib: HTTP 500');
  });

  it('throws on a non-array body', async () => {
    await expect(searchLrclib('x', fakeFetch({ nope: true }))).rejects.toThrow('lrclib: expected an array');
  });
});
