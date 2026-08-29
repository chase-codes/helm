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
  it('fans out to plain, worship-hinted and title-only queries', async () => {
    const f = fakeFetch([]);
    await searchLrclib('goodness of god', f);
    const urls = (f as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      'https://lrclib.net/api/search?q=goodness%20of%20god',
      'https://lrclib.net/api/search?q=goodness%20of%20god%20worship',
      'https://lrclib.net/api/search?track_name=goodness%20of%20god',
    ]);
    for (const c of (f as ReturnType<typeof vi.fn>).mock.calls) {
      expect(c[1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    }
  });

  it('merges rows from every fan-out query into one ranked list', async () => {
    // "q=Gratitude" returns only a band named Gratitude; the worship song arrives via
    // the hinted query. Both must be in the pool, worship first.
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve([apiRow({ trackName: 'This Is Part', artistName: 'Gratitude', plainLyrics: 'Other words\nhere\n\nOther words\nhere' })]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve([apiRow({ trackName: 'Gratitude', artistName: 'Brandon Lake' })]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve([]) }) as unknown as typeof fetch;
    const out = await searchLrclib('gratitude', f);
    expect(out.map((c) => c.author)).toEqual(['Brandon Lake', 'Gratitude']);
  });

  it('survives one fan-out query failing when another succeeds', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve([apiRow()]) })
      .mockRejectedValueOnce(new Error('timeout')) as unknown as typeof fetch;
    const out = await searchLrclib('goodness of god', f);
    expect(out).toHaveLength(1);
  });

  it('maps rows to display-ready candidates (tidied + chorus-labeled)', async () => {
    // No stanza may open with a section word ("Verse …") — detectChorus treats that as
    // already-labeled text and would skip labeling entirely.
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
