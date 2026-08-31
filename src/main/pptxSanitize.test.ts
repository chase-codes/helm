import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename, dirname } from 'path';
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

  it('does not treat a self-closing <a:rPr/> as an opening tag (shape outline after it keeps alpha)', () => {
    // A self-closing run-prop (ubiquitous in real decks) must not open a span that
    // swallows a later shape's outline. The run-level outline alpha after it must
    // still be stripped.
    const xml = `<p:sp><p:txBody><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>x</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:spPr><a:ln><a:solidFill><a:srgbClr val="000000"><a:alpha val="30000"/></a:srgbClr></a:solidFill></a:ln></p:spPr><p:txBody><a:p><a:r><a:rPr b="1"><a:ln><a:solidFill><a:srgbClr val="404040"><a:alpha val="10000"/></a:srgbClr></a:solidFill></a:ln></a:rPr><a:t>y</a:t></a:r></a:p></p:txBody></p:sp>`;
    const out = stripTextOutlineAlpha(xml);
    expect(out).toContain('<a:alpha val="30000"/>');
    expect(out).not.toContain('<a:alpha val="10000"/>');
  });

  it('leaves XML with only self-closing run props fully unchanged', () => {
    const xml = `<a:r><a:rPr lang="en-US"/><a:t>x</a:t></a:r><p:spPr><a:ln><a:solidFill><a:srgbClr val="000000"><a:alpha val="30000"/></a:srgbClr></a:solidFill></a:ln></p:spPr><a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>`;
    expect(stripTextOutlineAlpha(xml)).toBe(xml);
  });

  it('strips the degenerate paired <a:alpha ...></a:alpha> form', () => {
    const xml = `<a:rPr><a:ln><a:solidFill><a:srgbClr val="404040"><a:alpha val="10000"></a:alpha></a:srgbClr></a:solidFill></a:ln></a:rPr>`;
    expect(stripTextOutlineAlpha(xml)).not.toContain('<a:alpha');
  });

  it('never lets one alpha match swallow sibling elements up to a later </a:alpha>', () => {
    // a:alpha is an empty element per OOXML; a stray paired form later in the same
    // outline must not make the self-closing one consume the lumMod between them.
    const xml = `<a:rPr><a:ln><a:solidFill><a:srgbClr val="404040"><a:alpha val="1"/><a:lumMod val="75000"/><a:alpha val="2"></a:alpha></a:srgbClr></a:solidFill></a:ln></a:rPr>`;
    const out = stripTextOutlineAlpha(xml);
    expect(out).toContain('<a:lumMod val="75000"/>');
    expect(out).not.toContain('<a:alpha');
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

function makeDeck(name: string, entries: Record<string, Uint8Array>): string {
  const dir = mkdtempSync(join(tmpdir(), 'helm-pptx-test-'));
  const path = join(dir, name);
  writeFileSync(path, zipSync(entries));
  return path;
}

describe('sanitizePptx', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes a sanitized copy (original basename, own temp dir) with outline alpha stripped, other entries intact', async () => {
    const media = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    const src = makeDeck('deck.pptx', {
      '[Content_Types].xml': strToU8('<Types/>'),
      'ppt/slideMasters/slideMaster1.xml': strToU8(MASTER_BODY_STYLE),
      'ppt/slideLayouts/slideLayout1.xml': strToU8(MASTER_BODY_STYLE),
      'ppt/slides/slide1.xml': strToU8(CLEAN_SLIDE),
      'ppt/media/image1.png': media
    });

    const out = await sanitizePptx(src);

    expect(out).not.toBeNull();
    expect(out).not.toBe(src);
    // Same basename in a fresh temp dir: soffice's output PDF and any error
    // message keep the deck's recognizable name, and the copy never lands in
    // the permanent media library.
    expect(basename(out!)).toBe('deck.pptx');
    expect(dirname(out!)).not.toBe(dirname(src));
    const entries = unzipSync(readFileSync(out!));
    expect(strFromU8(entries['ppt/slideMasters/slideMaster1.xml'])).not.toContain('<a:alpha');
    expect(strFromU8(entries['ppt/slideLayouts/slideLayout1.xml'])).not.toContain('<a:alpha');
    expect(strFromU8(entries['ppt/slides/slide1.xml'])).toBe(CLEAN_SLIDE);
    expect(strFromU8(entries['[Content_Types].xml'])).toBe('<Types/>');
    expect(Array.from(entries['ppt/media/image1.png'])).toEqual(Array.from(media));
    // Original untouched.
    expect(strFromU8(unzipSync(readFileSync(src))['ppt/slideMasters/slideMaster1.xml'])).toContain('<a:alpha');
  });

  it('also sanitizes theme, presentation and chart parts carrying the same construct', async () => {
    // defaultTextStyle (presentation.xml), objectDefaults/txDef (theme) and chart
    // text styles feed rendered output through the identical defRPr/<a:ln> shape.
    const src = makeDeck('deck.pptx', {
      'ppt/presentation.xml': strToU8(`<p:presentation><p:defaultTextStyle>${MASTER_BODY_STYLE}</p:defaultTextStyle></p:presentation>`),
      'ppt/theme/theme1.xml': strToU8(`<a:theme><a:objectDefaults><a:spDef>${MASTER_BODY_STYLE}</a:spDef></a:objectDefaults></a:theme>`),
      'ppt/charts/chart1.xml': strToU8(`<c:chartSpace>${MASTER_BODY_STYLE}</c:chartSpace>`)
    });
    const out = await sanitizePptx(src);
    expect(out).not.toBeNull();
    const entries = unzipSync(readFileSync(out!));
    expect(strFromU8(entries['ppt/presentation.xml'])).not.toContain('<a:alpha');
    expect(strFromU8(entries['ppt/theme/theme1.xml'])).not.toContain('<a:alpha');
    expect(strFromU8(entries['ppt/charts/chart1.xml'])).not.toContain('<a:alpha');
  });

  it('returns null when there is nothing to strip', async () => {
    const src = makeDeck('deck.pptx', {
      '[Content_Types].xml': strToU8('<Types/>'),
      'ppt/slides/slide1.xml': strToU8(CLEAN_SLIDE)
    });
    expect(await sanitizePptx(src)).toBeNull();
  });

  it('returns null for non-OOXML deck extensions without reading the file', async () => {
    // .ppt/.odp go to soffice as-is; the format gate lives here, next to the
    // format knowledge, not at the call site.
    const src = makeDeck('deck.ppt', {
      'ppt/slideMasters/slideMaster1.xml': strToU8(MASTER_BODY_STYLE)
    });
    expect(await sanitizePptx(src)).toBeNull();
  });

  it('sanitizes the other OOXML presentation extensions (.pptm/.ppsx)', async () => {
    for (const name of ['deck.pptm', 'deck.ppsx']) {
      const src = makeDeck(name, { 'ppt/slideMasters/slideMaster1.xml': strToU8(MASTER_BODY_STYLE) });
      expect(await sanitizePptx(src)).not.toBeNull();
    }
  });

  it('returns null and logs when the file is not a zip', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), 'helm-pptx-test-'));
    const src = join(dir, 'not-a-zip.pptx');
    writeFileSync(src, 'plain text, not a zip');
    expect(await sanitizePptx(src)).toBeNull();
    expect(err).toHaveBeenCalledOnce();
    expect(String(err.mock.calls[0][0])).toContain(src);
  });

  it('returns null and logs when the file does not exist', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sanitizePptx('/nope/missing.pptx')).toBeNull();
    expect(err).toHaveBeenCalledOnce();
  });
});
