// Minimal HTML-to-text helpers shared by the URL parsers. Deliberately not a real HTML
// parser: lyrics pages are text-dense, and everything lands in the QuickAdd editor for
// human review before saving.

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ',
};

export const decodeEntities = (s: string): string =>
  s.replace(/&(?:amp|lt|gt|quot|#x27|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/i, '')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|ul|ol|nav|header|footer|section|article|table|tr)>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  );
}
