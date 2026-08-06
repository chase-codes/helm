// Genius serves lyrics inside <div data-lyrics-container="true"> blocks with <br/> line
// breaks and [Section] header lines — the best-labeled import source we have. Markup
// drift must degrade to null (caller falls back to the generic extractor), never throw.
import { decodeEntities } from './htmlText';

const KNOWN_LABEL = /^(chorus|verse|bridge|refrain|intro|outro|tag|pre-?chorus)\b/i;

// Depth-aware div closing finder: given opening tag end position, finds the true </div> closing tag
// by counting nested <div> and </div> to handle nesting. Returns the closing tag's index or -1 if not found.
function findDivEnd(html: string, contentStartPos: number): number {
  let depth = 1;
  let pos = contentStartPos;

  while (pos < html.length && depth > 0) {
    const divOpen = html.indexOf('<div', pos);
    const divClose = html.indexOf('</div>', pos);

    if (divClose === -1) return -1;
    if (divOpen !== -1 && divOpen < divClose) {
      depth++;
      pos = divOpen + 4;
    } else {
      depth--;
      pos = divClose + 6;
    }
  }

  return depth === 0 ? pos - 6 : -1; // Return position of closing tag start
}

function stripExcludeBlocks(html: string): string {
  let result = html;
  const excludeRegex = /<div[^>]*data-exclude-from-selection="true"[^>]*>/g;
  let match;
  const toRemove: Array<{ start: number; end: number }> = [];

  while ((match = excludeRegex.exec(result))) {
    const openingTagEnd = match.index + match[0].length;
    const closingPos = findDivEnd(result, openingTagEnd);
    if (closingPos !== -1) {
      const closingEnd = closingPos + 6; // Length of '</div>'
      toRemove.push({ start: match.index, end: closingEnd });
    }
  }

  // Remove in reverse order to preserve indices
  for (let i = toRemove.length - 1; i >= 0; i--) {
    const { start, end } = toRemove[i];
    result = result.substring(0, start) + result.substring(end);
  }

  return result;
}

function findLyricsContainers(html: string): string[] {
  const containers: string[] = [];
  const regex = /<div[^>]*data-lyrics-container="true"[^>]*>/g;
  let match;

  while ((match = regex.exec(html))) {
    const openingTag = match[0];
    const startPos = match.index + openingTag.length;
    const closingPos = findDivEnd(html, startPos);

    if (closingPos !== -1) {
      let content = html.substring(startPos, closingPos);
      // Strip data-exclude-from-selection header blocks (depth-aware to handle nesting)
      content = stripExcludeBlocks(content);
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
