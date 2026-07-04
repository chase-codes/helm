import { app, protocol, net } from 'electron';
import { join, normalize, sep, isAbsolute } from 'path';
import { mkdirSync } from 'fs';
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

export function registerMediaProtocol(root: string): void {
  protocol.handle(MEDIA_SCHEME, (req) => {
    const { host, pathname } = new URL(req.url); // helm-media://images/a.jpg -> host=images, pathname=/a.jpg
    const abs = resolveMediaPath(root, host + pathname);
    if (!abs) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(abs).toString());
  });
}
