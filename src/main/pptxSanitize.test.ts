import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import { stripTextOutlineAlpha, sanitizePptx } from './pptxSanitize';

/**
 * Regression for the LibreOffice pptx→PDF bug: an <a:alpha> on a text OUTLINE
 * (<a:ln> inside run properties) is applied by LO to the whole glyph, so pure
 * white body text composites to near-black. Stripping the outline alpha before
 * conversion fixes the rendered output without touching text fills.
 */

// Mirrors the real trigger found in ppt/slideMasters/slideMaster1.xml:
// bodyStyle > lvl1pPr > defRPr carrying a 10%-alpha text outline.
const MASTER_BODY_STYLE = `<p:txStyles><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"><a:ln w="9525"><a:solidFill><a:schemeClr val="bg1"><a:lumMod val="75000"/><a:lumOff val="25000"/><a:alpha val="10000"/></a:schemeClr></a:solidFill></a:ln><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle></p:txStyles>`;

describe('stripTextOutlineAlpha', () => {
  it('removes <a:alpha> from an <a:ln> inside a defRPr (master body style)', () => {
    const out = stripTextOutlineAlpha(MASTER_BODY_STYLE);
    expect(out).not.toContain('<a:alpha');
    // Everything else survives: outline colour mods, text fill, sizes.
    expect(out).toContain('<a:lumMod val="75000"/>');
    expect(out).toContain('<a:lumOff val="25000"/>');
    expect(out).toContain('<a:defRPr sz="2800">');
    expect(out).toContain('<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>');
  });

  it('removes <a:alpha> from an <a:ln> inside a run-level rPr', () => {
    const xml = `<a:r><a:rPr lang="en-US"><a:ln><a:solidFill><a:srgbClr val="404040"><a:alpha val="10000"/></a:srgbClr></a:solidFill></a:ln></a:rPr><a:t>hi</a:t></a:r>`;
    const out = stripTextOutlineAlpha(xml);
    expect(out).not.toContain('<a:alpha');
    expect(out).toContain('<a:t>hi</a:t>');
  });

  it('removes <a:alpha> from an <a:ln> inside an endParaRPr', () => {
    const xml = `<a:p><a:endParaRPr><a:ln><a:solidFill><a:srgbClr val="404040"><a:alpha val="10000"/></a:srgbClr></a:solidFill></a:ln></a:endParaRPr></a:p>`;
    expect(stripTextOutlineAlpha(xml)).not.toContain('<a:alpha');
  });

  it('preserves alpha on a TEXT FILL (solidFill directly under run props, no outline)', () => {
    const xml = `<a:rPr><a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="50000"/></a:srgbClr></a:solidFill></a:rPr>`;
    expect(stripTextOutlineAlpha(xml)).toBe(xml);
  });

  it('preserves alpha on a SHAPE outline (<a:ln> under spPr, not run props)', () => {
    const xml = `<p:spPr><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"><a:alpha val="30000"/></a:srgbClr></a:solidFill></a:ln></p:spPr>`;
    expect(stripTextOutlineAlpha(xml)).toBe(xml);
  });

  it('returns XML with no text-outline alpha unchanged', () => {
    const xml = `<a:rPr b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>`;
    expect(stripTextOutlineAlpha(xml)).toBe(xml);
  });
});

// -- zip-level sanitizer ----------------------------------------------------

const CLEAN_SLIDE = `<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>`;

function makePptx(dir: string, entries: Record<string, Uint8Array>): string {
  const path = join(dir, 'deck.pptx');
  writeFileSync(path, zipSync(entries));
  return path;
}

describe('sanitizePptx', () => {
  it('rewrites masters/layouts/slides with outline alpha stripped, leaving other entries intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'helm-pptx-test-'));
    const media = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    const src = makePptx(dir, {
      '[Content_Types].xml': strToU8('<Types/>'),
      'ppt/slideMasters/slideMaster1.xml': strToU8(MASTER_BODY_STYLE),
      'ppt/slideLayouts/slideLayout1.xml': strToU8(MASTER_BODY_STYLE),
      'ppt/slides/slide1.xml': strToU8(CLEAN_SLIDE),
      'ppt/media/image1.png': media
    });

    const out = sanitizePptx(src, dir);

    expect(out).not.toBe(src);
    const entries = unzipSync(readFileSync(out));
    expect(strFromU8(entries['ppt/slideMasters/slideMaster1.xml'])).not.toContain('<a:alpha');
    expect(strFromU8(entries['ppt/slideLayouts/slideLayout1.xml'])).not.toContain('<a:alpha');
    expect(strFromU8(entries['ppt/slides/slide1.xml'])).toBe(CLEAN_SLIDE);
    expect(strFromU8(entries['[Content_Types].xml'])).toBe('<Types/>');
    expect(Array.from(entries['ppt/media/image1.png'])).toEqual(Array.from(media));
    // Original untouched.
    expect(strFromU8(unzipSync(readFileSync(src))['ppt/slideMasters/slideMaster1.xml'])).toContain('<a:alpha');
  });

  it('returns the source path unchanged when there is nothing to strip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'helm-pptx-test-'));
    const src = makePptx(dir, {
      '[Content_Types].xml': strToU8('<Types/>'),
      'ppt/slides/slide1.xml': strToU8(CLEAN_SLIDE)
    });
    expect(sanitizePptx(src, dir)).toBe(src);
  });

  it('falls back to the source path when the file is not a zip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'helm-pptx-test-'));
    const src = join(dir, 'not-a-zip.pptx');
    writeFileSync(src, 'plain text, not a zip');
    expect(sanitizePptx(src, dir)).toBe(src);
  });

  it('falls back to the source path when the file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'helm-pptx-test-'));
    expect(sanitizePptx('/nope/missing.pptx', dir)).toBe('/nope/missing.pptx');
  });
});
