import { describe, expect, it } from 'vitest';
import { parseGeniusHtml } from './geniusUrl';

const GENIUS_HTML = `<!DOCTYPE html><html><head>
<meta property="og:title" content="Bethel Music (Ft. Jenn Johnson) – Goodness of God"/>
<title>Bethel Music – Goodness of God Lyrics | Genius Lyrics</title>
</head><body>
<div data-lyrics-container="true" class="Lyrics__Container-sc-1ynbvzw-1">[Verse 1: Jenn Johnson]<br/>I love You, Lord<br/>Oh, Your mercy never fails me<br/><br/>[Chorus]<br/><a href="/123"><span>And all my life You have been faithful</span></a><br/>And all my life You have been so, so good</div>
<div data-lyrics-container="true">[Bridge]<br/>Your goodness is running after me &#x27;til the end</div>
</body></html>`;

describe('parseGeniusHtml', () => {
  it('extracts labeled lyrics from the lyrics containers', () => {
    const out = parseGeniusHtml(GENIUS_HTML);
    expect(out).not.toBeNull();
    expect(out!.text).toContain('Verse 1\nI love You, Lord');
    expect(out!.text).toContain('Chorus\nAnd all my life You have been faithful');
    expect(out!.text).toContain('Bridge\nYour goodness is running after me \'til the end');
  });

  it('starts a new stanza at each section header', () => {
    const out = parseGeniusHtml(GENIUS_HTML)!;
    expect(out.text).toMatch(/never fails me\n\s*\nChorus/);
  });

  it('reads title and author from og:title', () => {
    const out = parseGeniusHtml(GENIUS_HTML)!;
    expect(out.title).toBe('Goodness of God');
    expect(out.author).toBe('Bethel Music (Ft. Jenn Johnson)');
  });

  it('keeps unknown bracketed headers as plain lines', () => {
    const html = '<div data-lyrics-container="true">[Interlude]<br/>Sing it out</div>';
    const out = parseGeniusHtml(html)!;
    expect(out.text).toContain('[Interlude]');
  });

  it('returns null when no lyrics containers exist', () => {
    expect(parseGeniusHtml('<html><body><p>Nothing here</p></body></html>')).toBeNull();
  });

  it('returns null when containers hold no text', () => {
    expect(parseGeniusHtml('<div data-lyrics-container="true">   </div>')).toBeNull();
  });
});
