import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const FILES = [
  join(__dirname, 'index.html'),
  join(__dirname, '../output/index.html')
];

describe('renderer CSP allows the helm-media scheme', () => {
  for (const file of FILES) {
    it(`${file} allowlists helm-media in img-src, media-src, connect-src`, () => {
      const html = readFileSync(file, 'utf8');
      const csp = /content="([^"]*Content-Security[^"]*)"|content="(default-src[^"]*)"/i.exec(html);
      const content = /content="(default-src[^"]*)"/i.exec(html)?.[1] ?? '';
      expect(content).toMatch(/img-src[^;]*helm-media:/);
      expect(content).toMatch(/media-src[^;]*helm-media:/);
      expect(content).toMatch(/connect-src[^;]*helm-media:/);
      // Guard the untouched directives are still locked down.
      expect(content).toMatch(/default-src 'self'/);
      expect(content).toMatch(/script-src 'self'/);
      void csp;
    });
  }
});
