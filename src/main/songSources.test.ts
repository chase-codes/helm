import { describe, expect, it, vi } from 'vitest';
import { createSongSources } from './songSources';

const textResponse = (body: string, ok = true): Response =>
  ({ ok, status: ok ? 200 : 500, text: () => Promise.resolve(body) }) as unknown as Response;
const jsonResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

const GENIUS_HTML = `<html><head><meta property="og:title" content="Sinach – Way Maker"/></head><body>
<div data-lyrics-container="true">[Chorus]<br/>Way Maker, Miracle Worker<br/>Promise Keeper, Light in the darkness</div></body></html>`;

const GENERIC_HTML = `<html><head><title>Way Maker Lyrics - SomeSite</title></head><body>
<p>You are here, moving in our midst<br/>I worship You, I worship You</p>
<p>You are here, working in this place<br/>I worship You, I worship You</p>
<p>Way Maker, Miracle Worker<br/>Promise Keeper, Light in the darkness</p></body></html>`;

describe('songSources.search', () => {
  it('wraps LRCLIB candidates', async () => {
    const row = { trackName: 'Way Maker', artistName: 'Sinach', duration: 300, instrumental: false,
      plainLyrics: 'Line one here\nLine two here\n\nLine three here\nLine four here' };
    const s = createSongSources(vi.fn().mockResolvedValue(jsonResponse([row])) as unknown as typeof fetch);
    const out = await s.search('way maker');
    expect('candidates' in out && out.candidates[0].title).toBe('Way Maker');
  });

  it('converts any failure to the network error', async () => {
    const s = createSongSources(vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch);
    expect(await s.search('way maker')).toEqual({ error: 'network' });
  });
});

describe('songSources.fromUrl', () => {
  it('rejects non-http(s) and garbage URLs without fetching', async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const s = createSongSources(f);
    expect(await s.fromUrl('ftp://x.com/a')).toEqual({ error: 'bad-url' });
    expect(await s.fromUrl('not a url')).toEqual({ error: 'bad-url' });
    expect(f).not.toHaveBeenCalled();
  });

  it('routes genius.com pages through the Genius parser (labels intact)', async () => {
    const s = createSongSources(vi.fn().mockResolvedValue(textResponse(GENIUS_HTML)) as unknown as typeof fetch);
    const out = await s.fromUrl('https://genius.com/Sinach-way-maker-lyrics');
    expect('candidate' in out).toBe(true);
    if ('candidate' in out) {
      expect(out.candidate.title).toBe('Way Maker');
      expect(out.candidate.author).toBe('Sinach');
      expect(out.candidate.text).toContain('Chorus\nWay Maker, Miracle Worker');
    }
  });

  it('falls back to the generic extractor when Genius markup fails to parse', async () => {
    const s = createSongSources(vi.fn().mockResolvedValue(textResponse(GENERIC_HTML)) as unknown as typeof fetch);
    const out = await s.fromUrl('https://genius.com/whatever');
    expect('candidate' in out && out.candidate.text).toContain('You are here, moving in our midst');
  });

  it('uses the generic extractor with the page title for other hosts', async () => {
    const s = createSongSources(vi.fn().mockResolvedValue(textResponse(GENERIC_HTML)) as unknown as typeof fetch);
    const out = await s.fromUrl('https://somesite.com/way-maker');
    expect('candidate' in out).toBe(true);
    if ('candidate' in out) {
      expect(out.candidate.title).toBe('Way Maker Lyrics');
      expect(out.candidate.author).toBe('');
    }
  });

  it('returns no-lyrics when a page yields nothing lyric-shaped', async () => {
    const s = createSongSources(vi.fn().mockResolvedValue(textResponse('<html><body><p>hi</p></body></html>')) as unknown as typeof fetch);
    expect(await s.fromUrl('https://somesite.com/x')).toEqual({ error: 'no-lyrics' });
  });

  it('returns network on HTTP failure and on fetch rejection', async () => {
    const s1 = createSongSources(vi.fn().mockResolvedValue(textResponse('', false)) as unknown as typeof fetch);
    expect(await s1.fromUrl('https://x.com/a')).toEqual({ error: 'network' });
    const s2 = createSongSources(vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch);
    expect(await s2.fromUrl('https://x.com/a')).toEqual({ error: 'network' });
  });
});
