// Usage: node scratch/mediaprobe/raster-smoke.mjs /abs/path/to/multipage.pdf /abs/out/dir
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [, , pdfPath, outDir] = process.argv;
mkdirSync(outDir, { recursive: true });
const { createCanvas } = await import('@napi-rs/canvas');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: true }).promise;
console.log('pages:', doc.numPages);
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 2 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport: vp }).promise;
  const name = `slide-${String(n).padStart(4, '0')}.png`;
  writeFileSync(join(outDir, name), canvas.toBuffer('image/png'));
  console.log('wrote', name, canvas.width + 'x' + canvas.height);
}
await doc.destroy();
