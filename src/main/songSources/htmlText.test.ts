import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText } from './htmlText';

describe('decodeEntities', () => {
  it('decodes named entities', () => {
    expect(decodeEntities('Mercy &amp; grace &#x27;til the end&nbsp;now')).toBe(
      "Mercy & grace 'til the end now"
    );
  });

  it('decodes decimal and hex numeric entities', () => {
    expect(decodeEntities('It&#8217;s d&#233;j&#224; vu &#x2019;til dawn')).toBe(
      'It’s déjà vu ’til dawn'
    );
  });

  it('leaves malformed numeric entities untouched', () => {
    expect(decodeEntities('&#0; &#x110000; &#xzz;')).toBe('&#0; &#x110000; &#xzz;');
  });
});

describe('htmlToText', () => {
  it('treats source newlines as whitespace and br/block closes as line breaks', () => {
    // Consumers trim per line (genericUrl splits and trims), so only line structure is
    // asserted here — incidental spaces around newlines are fine.
    const html = '<p>Line one<br/>\nLine two</p>\n<p>Line three</p>';
    const lines = htmlToText(html)
      .split('\n')
      .map((l) => l.trim());
    expect(lines.join('\n').trim()).toBe('Line one\nLine two\n\nLine three');
  });
});
