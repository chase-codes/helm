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

  it('extracts lyrics on AZLyrics-style pages (source-newline-per-line)', () => {
    // Real lyrics pages often put each <br>-terminated line on its own source line.
    // The nav nav index has 27 single-word links on separate source lines.
    // Must extract real lyrics with stanza breaks, not nav chrome.
    const azLyricsStyle = `<html><body>
<nav>
<a href="/?q=A">A</a>
<a href="/?q=B">B</a>
<a href="/?q=C">C</a>
<a href="/?q=D">D</a>
<a href="/?q=E">E</a>
<a href="/?q=F">F</a>
<a href="/?q=G">G</a>
<a href="/?q=H">H</a>
<a href="/?q=I">I</a>
<a href="/?q=J">J</a>
<a href="/?q=K">K</a>
<a href="/?q=L">L</a>
<a href="/?q=M">M</a>
<a href="/?q=N">N</a>
<a href="/?q=O">O</a>
<a href="/?q=P">P</a>
<a href="/?q=Q">Q</a>
<a href="/?q=R">R</a>
<a href="/?q=S">S</a>
<a href="/?q=T">T</a>
<a href="/?q=U">U</a>
<a href="/?q=V">V</a>
<a href="/?q=W">W</a>
<a href="/?q=X">X</a>
<a href="/?q=Y">Y</a>
<a href="/?q=Z">Z</a>
<a href="/?q=0-9">0-9</a>
</nav>
<div class="lyrics">
<p>
First verse line one<br/>
First verse line two<br/>
First verse line three
</p>
<p>
Second verse line one<br/>
Second verse line two<br/>
Second verse line three
</p>
</div>
</body></html>`;
    const out = extractLyricsFromHtml(azLyricsStyle);
    expect(out).not.toBeNull();
    expect(out!).toContain('First verse line one');
    expect(out!).toContain('Second verse line one');
    expect(out!).not.toContain('>A<');
    expect(out!.split(/\n\s*\n/).length).toBe(2);
  });
});
