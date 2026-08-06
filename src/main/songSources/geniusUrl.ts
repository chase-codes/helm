// Genius serves lyrics inside <div data-lyrics-container="true"> blocks with <br/> line
// breaks and [Section] header lines — the best-labeled import source we have. Markup
// drift must degrade to null (caller falls back to the generic extractor), never throw.
import { decodeEntities } from './htmlText';

const KNOWN_LABEL = /^(chorus|verse|bridge|refrain|intro|outro|tag|pre-?chorus)\b/i;

function findLyricsContainers(html: string): string[] {
  const containers: string[] = [];
  const regex = /<div[^>]*data-lyrics-container="true"[^>]*>/g;
  let match;

  while ((match = regex.exec(html))) {
    const openingTag = match[0];
    const startPos = match.index + openingTag.length;
    let depth = 1;
    let pos = startPos;

    // Depth-aware scanning: count <div> and </div> to find the true closing tag
    while (pos < html.length && depth > 0) {
      const divOpen = html.indexOf('<div', pos);
      const divClose = html.indexOf('</div>', pos);

      if (divClose === -1) break;
      if (divOpen !== -1 && divOpen < divClose) {
        depth++;
        pos = divOpen + 4;
      } else {
        depth--;
        pos = divClose + 6;
      }
    }

    if (depth === 0) {
      let content = html.substring(startPos, pos - 6);
      // Strip data-exclude-from-selection header blocks (nested divs with excluded class)
      content = content.replace(/<div[^>]*data-exclude-from-selection="true"[^>]*>[\s\S]*?<\/div>/g, '');
      if (content.trim()) {
        containers.push(content);
      }
    }
  }

  return containers;
}

function extractOgTitle(html: string): { author: string; title: string } {
  // Find <meta> tag with property="og:title", then extract content attribute
  // Handle attribute order variants: property-first or content-first
  const metaMatch = html.match(/<meta[^>]*property="og:title"[^>]*>/);
  if (!metaMatch) return { author: '', title: '' };

  const metaTag = metaMatch[0];
  const contentMatch = metaTag.match(/content="([^"]*)"/);
  if (!contentMatch) return { author: '', title: '' };

  const ogTitle = decodeEntities(contentMatch[1]);
  // og:title is "Artist – Song" (en dash); fall back to the whole string as the title.
  const parts = ogTitle.split(/\s+–\s+/);
  const [author, title] = parts.length === 2 ? [parts[0], parts[1]] : ['', ogTitle];
  return { author, title: title || 'Untitled Song' };
}

export function parseGeniusHtml(
  html: string
): { title: string; author: string; text: string } | null {
  const containers = findLyricsContainers(html);
  if (containers.length === 0) return null;

  const lines = decodeEntities(
    containers.join('\n')
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

  const { author, title } = extractOgTitle(html);
  return { title, author, text };
}
