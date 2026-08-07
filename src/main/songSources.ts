// Online single-song sources: LRCLIB search plus URL parsing (Genius, generic).
// Injectable fetch in the style of mediaImport's seams. Never throws across IPC —
// every failure becomes a typed result the renderer can show gently.
import { importTidy } from '../shared/songs/importTidy';
import { detectChorus } from '../shared/songs/detectChorus';
import { searchLrclib, FETCH_TIMEOUT_MS } from './songSources/lrclib';
import { parseGeniusHtml } from './songSources/geniusUrl';
import { extractLyricsFromHtml } from './songSources/genericUrl';
import { decodeEntities } from './songSources/htmlText';
import type { SongFromUrlResult, SongWebSearchResult } from '../shared/types';

export interface SongSources {
  search(query: string): Promise<SongWebSearchResult>;
  fromUrl(url: string): Promise<SongFromUrlResult>;
}

const pipeline = (text: string): string => detectChorus(importTidy(text));

// "Way Maker Lyrics - SomeSite" → "Way Maker Lyrics" (first chunk before a separator).
const pageTitle = (html: string): string => {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).trim().split(/\s+[|–—-]\s+/)[0].trim() : '';
};

export function createSongSources(fetchFn: typeof fetch = fetch): SongSources {
  return {
    async search(query) {
      try {
        return { candidates: await searchLrclib(query, fetchFn) };
      } catch {
        return { error: 'network' };
      }
    },

    async fromUrl(url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { error: 'bad-url' };
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: 'bad-url' };

      let html: string;
      try {
        const res = await fetchFn(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { 'User-Agent': 'Mozilla/5.0 (Helm song import)' },
        });
        if (!res.ok) return { error: 'network' };
        html = await res.text();
      } catch {
        return { error: 'network' };
      }

      // The parsers are pure string transforms with no throwing paths today; the catch is
      // insurance for the never-throw-across-IPC contract if one ever grows a throw.
      try {
        if (/(^|\.)genius\.com$/.test(parsed.hostname)) {
          const g = parseGeniusHtml(html);
          // Markup drift degrades to the generic extractor rather than a dead end.
          if (g) return { candidate: { ...g, text: pipeline(g.text) } };
        }
        const text = extractLyricsFromHtml(html);
        if (!text) return { error: 'no-lyrics' };
        return {
          candidate: { title: pageTitle(html) || 'Untitled Song', author: '', text: pipeline(text) },
        };
      } catch {
        return { error: 'no-lyrics' };
      }
    },
  };
}
