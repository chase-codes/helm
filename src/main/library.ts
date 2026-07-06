import { app, protocol, net } from 'electron';
import { join, normalize, sep, isAbsolute, extname } from 'path';
import { mkdirSync, statSync, createReadStream } from 'fs';
import { Readable } from 'stream';
import { pathToFileURL } from 'url';

export const MEDIA_SCHEME = 'helm-media';

export function libraryRoot(): string {
  const root = join(app.getPath('userData'), 'library');
  mkdirSync(root, { recursive: true });
  return root;
}

// Pure: no Electron dependency, unit-tested. Returns an absolute path inside `root`,
// or null if the request escapes it.
export function resolveMediaPath(root: string, urlPath: string): string | null {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  if (isAbsolute(rel)) return null;
  const abs = normalize(join(root, rel));
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (abs !== root && !abs.startsWith(prefix)) return null;
  return abs;
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo'
};
function mimeFor(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';
}

// Pure: parse an HTTP Range header against a known file size. Returns an
// inclusive byte interval, or null for absent/malformed/unsatisfiable ranges.
export function parseRangeHeader(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, s, e] = m;
  let start: number;
  let end: number;
  if (s === '') {
    const n = parseInt(e, 10);
    if (Number.isNaN(n)) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(s, 10);
    end = e === '' ? size - 1 : parseInt(e, 10);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export function registerMediaProtocol(root: string): void {
  protocol.handle(MEDIA_SCHEME, (req) => {
    const { host, pathname } = new URL(req.url); // helm-media://images/a.jpg -> host=images, pathname=/a.jpg
    const abs = resolveMediaPath(root, host + pathname);
    if (!abs) return new Response('forbidden', { status: 403 });

    // Range request (video seeking, and Chromium's initial media probe): serve a
    // streamed 206 so the element treats the source as seekable. Everything else
    // (images) keeps the original net.fetch path untouched.
    const rangeHeader = req.headers.get('Range');
    if (rangeHeader) {
      let size: number;
      try {
        size = statSync(abs).size;
      } catch {
        return new Response('not found', { status: 404 });
      }
      const range = parseRangeHeader(rangeHeader, size);
      if (range) {
        const stream = createReadStream(abs, { start: range.start, end: range.end });
        stream.on('error', (err) => console.error('[helm-media] stream error', err));
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': mimeFor(abs),
            'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(range.end - range.start + 1)
          }
        });
      }
    }
    return net.fetch(pathToFileURL(abs).toString());
  });
}
