import { readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

/**
 * Works around a LibreOffice pptx→PDF rendering bug: OOXML lets a text style
 * carry an outline (<a:ln>) with partial <a:alpha>, which per spec applies to
 * the outline only. LibreOffice instead wraps the WHOLE glyph in that alpha
 * (PDF ca/CA graphics state), so pure-white body text over a dark background
 * composites to near-black (#FFFFFF at 10% over black ≈ #1A1A1A). The trigger
 * lives in slide masters' bodyStyle but can appear in layouts and slides too.
 *
 * The faithful fix is to drop the alpha from text OUTLINES only — text fills
 * and shape outlines keep theirs — before handing the deck to soffice.
 */

// Run-property elements that carry text styling. <a:ln> inside one of these is
// a text outline; <a:ln> anywhere else (e.g. under p:spPr) is a shape outline
// and must keep its alpha. These elements never nest themselves, so a lazy
// match to the matching close tag is safe. Self-closing forms have no <a:ln>.
const RUN_PROPS_RE = /<a:(rPr|defRPr|endParaRPr)\b[^>]*>[\s\S]*?<\/a:\1>/g;
const LN_RE = /<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/g;
const ALPHA_RE = /<a:alpha\b[^>]*(?:\/>|>[\s\S]*?<\/a:alpha>)/g;

/** Pure: strip <a:alpha> from <a:ln> inside text run properties. */
export function stripTextOutlineAlpha(xml: string): string {
  return xml.replace(RUN_PROPS_RE, (runProps) =>
    runProps.replace(LN_RE, (ln) => ln.replace(ALPHA_RE, ''))
  );
}

// Only these parts define text styling that reaches the renderer.
const TEXT_PART_RE = /^ppt\/(slideMasters|slideLayouts|slides)\/[^/]+\.xml$/;

/**
 * Write a sanitized copy of the .pptx at `srcPath` into `outDir` and return its
 * path. Returns `srcPath` unchanged when there is nothing to strip, or when the
 * file can't be read as a zip — sanitizing is best-effort and must never make
 * an import fail that would otherwise have succeeded.
 */
export function sanitizePptx(srcPath: string, outDir: string): string {
  try {
    const entries = unzipSync(readFileSync(srcPath));
    let changed = false;
    const out: Zippable = {};
    for (const [name, data] of Object.entries(entries)) {
      if (TEXT_PART_RE.test(name)) {
        const xml = strFromU8(data);
        const fixed = stripTextOutlineAlpha(xml);
        if (fixed !== xml) {
          changed = true;
          out[name] = strToU8(fixed);
          continue;
        }
      }
      out[name] = data;
    }
    if (!changed) return srcPath;
    const destPath = join(outDir, `sanitized-${basename(srcPath)}`);
    writeFileSync(destPath, zipSync(out));
    return destPath;
  } catch {
    return srcPath;
  }
}
