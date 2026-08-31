import { mkdtempSync, rmSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, extname, join } from 'path';
import { strFromU8, strToU8, unzip, zip, type Unzipped, type AsyncZippable } from 'fflate';

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
// match to the matching close tag is safe. The opening-tag pattern
// `(?:[^>]*[^/>])?>` rejects self-closing forms (`<a:rPr .../>` — ubiquitous in
// real decks), which have no children: matching one as an opener would swallow
// everything up to some LATER close tag, crossing into sibling shapes.
const RUN_PROPS_RE = /<a:(rPr|defRPr|endParaRPr)\b(?:[^>]*[^/>])?>[\s\S]*?<\/a:\1>/g;
const LN_RE = /<a:ln\b(?:[^>]*[^/>])?>[\s\S]*?<\/a:ln>/g;
// a:alpha is an empty element per OOXML (CT_PositiveFixedPercentage): match only
// the self-closing and degenerate `></a:alpha>` forms, never a content span.
const ALPHA_RE = /<a:alpha\b[^>]*\/>|<a:alpha\b[^>]*>\s*<\/a:alpha>/g;

/** Pure: strip <a:alpha> from <a:ln> inside text run properties. */
export function stripTextOutlineAlpha(xml: string): string {
  return xml.replace(RUN_PROPS_RE, (runProps) =>
    runProps.replace(LN_RE, (ln) => ln.replace(ALPHA_RE, ''))
  );
}

// Any XML part under ppt/ can carry the construct: masters/layouts/slides, but
// also presentation.xml (defaultTextStyle), theme (objectDefaults/txDef) and
// chart/diagram parts. stripTextOutlineAlpha is a no-op on parts without it,
// so the wide net costs nothing. `.rels` files don't end in .xml.
const TEXT_PART_RE = /^ppt\/.+\.xml$/;

// The formats whose zip can carry OOXML text parts. .ppt (binary) and .odp
// (different schema) go to soffice untouched.
const OOXML_DECK_RE = /^\.(pptx|pptm|ppsx|ppsm|potx|potm)$/;

// fflate's async API runs inflate/deflate on worker threads, keeping the main
// process — the presentation control plane — responsive during a large import.
const unzipAsync = (data: Uint8Array): Promise<Unzipped> =>
  new Promise((resolve, reject) => unzip(data, (err, out) => (err ? reject(err) : resolve(out))));
// level 0: the output is a throwaway temp file deleted right after conversion,
// and a deck's bytes are dominated by already-compressed media — re-deflating
// them costs seconds of CPU for ~0% gain.
const zipAsync = (data: AsyncZippable): Promise<Uint8Array> =>
  new Promise((resolve, reject) => zip(data, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out))));

/**
 * Write a sanitized copy of the OOXML deck at `srcPath` into a fresh temp dir
 * of its own (same basename, so soffice output and error messages keep the
 * deck's recognizable name) and return the copy's path. Returns `null` when
 * the deck needs no sanitizing — wrong format, nothing to strip, or any
 * failure (logged): sanitizing is best-effort and must never make an import
 * fail that would otherwise have succeeded. The caller owns cleanup of the
 * returned path's directory.
 */
export async function sanitizePptx(srcPath: string): Promise<string | null> {
  if (!OOXML_DECK_RE.test(extname(srcPath).toLowerCase())) return null;
  let destDir: string | null = null;
  try {
    const entries = await unzipAsync(new Uint8Array(await readFile(srcPath)));
    let changed = false;
    const out: AsyncZippable = {};
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
    if (!changed) return null;
    const zipped = await zipAsync(out);
    destDir = mkdtempSync(join(tmpdir(), 'helm-pptx-'));
    const destPath = join(destDir, basename(srcPath));
    await writeFile(destPath, zipped);
    return destPath;
  } catch (err) {
    // A swallowed failure must still be diagnosable: without this line, "the
    // dimmed-text fix stopped working" and "the deck had no alpha to strip"
    // would be indistinguishable.
    console.error(`pptxSanitize: skipped sanitizing ${srcPath}: ${String(err)}`);
    if (destDir !== null) {
      // Never strand a partial copy (e.g. ENOSPC mid-write).
      try {
        rmSync(destDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (rmErr) {
        console.error(`pptxSanitize: failed to clean up ${destDir}: ${String(rmErr)}`);
      }
    }
    return null;
  }
}
