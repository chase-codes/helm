// EasyWorship's paragraph→slide rules, measured against two real libraries in the EW8 library
// spec §4.2 (97.65% and 99.55% agreement with the authoritative slide_uids count).
//
// This is EasyWorship-specific and deliberately NOT part of importTidy's source-agnostic rule
// set: it encodes one program's convention about what a blank paragraph means. Its output is
// what makes the generic pipeline safe downstream — after this runs, a blank line means a
// slide break and nothing else does, so importTidy and splitToSlides need no special cases.

export interface EwSplit {
  /** Slide count exactly as EasyWorship counts it, including a leading empty slide. This is
   *  the number to compare against the GUID count in `word.slide_uids` — not the section
   *  count Helm ends up with, which omits empty slides. */
  slideCount: number;
  /** Import-ready lyrics: one blank line per slide break, and no other blank lines. */
  text: string;
}

export function ewSlideBreaks(paragraphs: string[]): EwSplit {
  const groups: string[][] = [];
  let current: string[] = [];
  let i = 0;

  while (i < paragraphs.length) {
    if (paragraphs[i] === '') {
      // Rule 1: a paragraph breaks the slide only when it is EXACTLY empty — a paragraph
      // holding a single space is content (spec §4.2 rule 2, Library A song_id 98).
      groups.push(current);
      current = [];
      while (i < paragraphs.length && paragraphs[i] === '') i++; // Rule 2: a run is one break
    } else {
      current.push(paragraphs[i]);
      i++;
    }
  }
  groups.push(current);

  // Rule 4: trailing empties yield no trailing slide. Rule 3 — a leading break still yields a
  // leading (empty) slide — needs no code: the empty `current` pushed at the first break is it.
  while (groups.length > 0 && groups[groups.length - 1].length === 0) groups.pop();

  // A paragraph can hold "\n" from a \line soft break, so flatten before filtering. Dropping
  // whitespace-only lines is the point: they carry no lyric, splitToSlides would discard them
  // anyway, and leaving one in would hand downstream code a second chance to misread it as a
  // break. Leading indentation inside a line is left alone — splitToSlides owns that choice.
  const slides = groups.map((g) =>
    g.flatMap((p) => p.split('\n')).filter((l) => l.trim() !== '').join('\n')
  );

  return { slideCount: groups.length, text: slides.filter((s) => s !== '').join('\n\n') };
}
