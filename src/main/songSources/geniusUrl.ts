// Genius serves lyrics inside <div data-lyrics-container="true"> blocks with <br/> line
// breaks and [Section] header lines — the best-labeled import source we have. Markup
// drift must degrade to null (caller falls back to the generic extractor), never throw.
import { decodeEntities } from './htmlText';

const KNOWN_LABEL = /^(chorus|verse|bridge|refrain|intro|outro|tag|pre-?chorus)\b/i;

export function parseGeniusHtml(
  html: string
): { title: string; author: string; text: string } | null {
  const containers = [
    ...html.matchAll(/<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g),
  ];
  if (containers.length === 0) return null;

  const lines = decodeEntities(
    containers.map((m) => m[1]).join('\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map((l) => l.trim());

  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\[([^\]]+)\]$/);
    if (m) {
      // "[Verse 1: Jenn Johnson]" → "Verse 1"; unknown headers stay bracketed for the
      // editor to catch. Every header starts a new stanza.
      const inner = m[1].split(':')[0].trim();
      if (out.length > 0) out.push('');
      out.push(KNOWN_LABEL.test(inner) ? inner : line);
    } else {
      out.push(line);
    }
  }
  const text = out.join('\n');
  if (!text.replace(/\s/g, '')) return null;

  const og = html.match(/<meta property="og:title" content="([^"]*)"/);
  const ogTitle = og ? decodeEntities(og[1]) : '';
  // og:title is "Artist – Song" (en dash); fall back to the whole string as the title.
  const parts = ogTitle.split(/\s+–\s+/);
  const [author, title] = parts.length === 2 ? [parts[0], parts[1]] : ['', ogTitle];
  return { title: title || 'Untitled Song', author, text };
}
