import { describe, expect, it } from 'vitest';
import { extractLyricsFromHtml } from './genericUrl';

const LYRIC_PAGE = `<html><head><title>Way Maker Lyrics - SomeLyricsSite</title>
<style>.x{color:red}</style><script>var t=1;</script></head><body>
<nav><a href="/">Home</a><a href="/songs">Songs</a></nav>
<h1>Way Maker</h1>
<div class="lyrics">
<p>You are here, moving in our midst<br/>I worship You, I worship You</p>
<p>You are here, working in this place<br/>I worship You, I worship You</p>
<p>Way Maker, Miracle Worker<br/>Promise Keeper, Light in the darkness<br/>My God, that is who You are</p>
</div>
<p>Copyright notice: this is a long single paragraph of legal boilerplate text that runs on well past ninety characters in one unbroken line and should never be mistaken for a stanza of song lyrics by the extractor heuristic under any circumstances whatsoever.</p>
</body></html>`;

describe('extractLyricsFromHtml', () => {
  it('extracts the stanza-shaped run and skips chrome and boilerplate', () => {
    const out = extractLyricsFromHtml(LYRIC_PAGE);
    expect(out).not.toBeNull();
    expect(out!).toContain('You are here, moving in our midst');
    expect(out!).toContain('Way Maker, Miracle Worker');
    expect(out!).not.toContain('Copyright notice');
    expect(out!).not.toContain('Home');
  });

  it('keeps stanza breaks between blocks', () => {
    const out = extractLyricsFromHtml(LYRIC_PAGE)!;
    expect(out.split(/\n\s*\n/).length).toBe(3);
  });

  it('returns null for a page with no lyric-shaped content', () => {
    const html = '<html><body><p>One short line</p></body></html>';
    expect(extractLyricsFromHtml(html)).toBeNull();
  });

  it('returns null when the only runs are too short', () => {
    const html = '<div><p>Line one<br/>Line two</p></div>';
    expect(extractLyricsFromHtml(html)).toBeNull();
  });
});
