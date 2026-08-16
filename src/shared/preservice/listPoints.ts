/**
 * A typed list marker at the start of a line: `-`, `–`, `—`, `*`, `+`, `•`, or a numeric
 * `1.` / `1)` form, followed by whitespace or the end of the line. The renderer draws its
 * own bullet in front of every point, so a marker left in the text renders doubled ("• -
 * item", #50). Whitespace-or-end is what keeps "-ish", "1.5 loaves", and hyphens inside
 * an item from being eaten — only something typed *as* a marker counts.
 */
const LIST_MARKER = /^(?:[-–—*+•]|\d+[.)])(?:\s+|$)/;

/**
 * Normalizes typed list lines into clean bullet points: trims, strips one leading list
 * marker, and drops lines that are empty or were only a marker. Applied both where lines
 * are typed (PreCardEditor) and where saved cards become slides (preSlideFor), so cards
 * stored with markers baked in before the editor stripped them heal on next render.
 */
export function cleanListPoints(lines: string[]): string[] {
  return lines
    .map((l) => l.trim().replace(LIST_MARKER, '').trim())
    .filter(Boolean);
}
