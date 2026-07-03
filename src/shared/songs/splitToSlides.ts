import type { SongSection } from '../types';
export function splitToSlides(text: string): SongSection[] {
  const blocks = (text || '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b, i) => {
    let lines = b.split(/\n/).map((l) => l.trim()).filter(Boolean);
    let label = `Verse ${i + 1}`;
    if (/^(chorus|verse|bridge|refrain|intro|outro|tag|pre-?chorus)\b/i.test(lines[0] || '')) {
      label = lines[0].replace(/[:.]$/, ''); lines = lines.slice(1);
    }
    return { label, lines };
  });
}
