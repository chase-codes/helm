/**
 * The background ladder a track rail washes over `T.panel2`: selected > live > cued >
 * planned, each a weaker tint of that track's own colour.
 *
 * The rails used to spell these out as raw `rgba()` triples (#91), which pinned them to
 * Classic's blue and purple — switch to Grove or Sanctuary and the rows kept the old hue
 * while their rings (already `${T.scripture}66` and friends) moved. Suffixing the theme
 * token with a hex alpha keeps the two in one material.
 *
 * Light mode runs one rung weaker throughout. Its accent tokens are dark inks meant for a
 * pale ground, so an identical alpha reads noticeably heavier there than in dark mode.
 */
const RUNGS = {
  selected: { dark: '2e', light: '24' },
  live: { dark: '24', light: '1c' },
  cued: { dark: '17', light: '12' },
  planned: { dark: '0d', light: '0b' }
} as const;

export type RailRung = keyof typeof RUNGS;

/** `accent` must be a 6-digit hex token (T.scripture, T.message, T.sermon) — the alpha is
 *  appended, so an `rgba()` value would produce nonsense rather than fail loudly. */
export function railTint(accent: string, rung: RailRung, dark: boolean): string {
  return accent + RUNGS[rung][dark ? 'dark' : 'light'];
}
