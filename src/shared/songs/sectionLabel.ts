// The one section-label line pattern. detectChorus and splitToSlides must agree by
// contract: detectChorus uses it to decide "already labeled, leave alone" and
// splitToSlides uses it to consume label lines — a label kind added to one and not the
// other would prepend "Chorus" above an existing label or mislabel sections.
export const SECTION_LABEL_RE = /^(chorus|verse|bridge|refrain|intro|outro|tag|pre-?chorus)\b/i;
