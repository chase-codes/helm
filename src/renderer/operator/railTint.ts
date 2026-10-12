import type { CSSProperties } from 'react';
import type { Theme } from '../../shared/theme';
import { MONO } from '../shared/fonts';

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

/** The house tinted-chip formula (#140): weak wash of the accent, a stronger ring of it,
 *  ink in the accent itself. Spread it where the full triple applies; sites that use only
 *  the `1c` wash stay hand-written. */
export function tintChip(accent: string): CSSProperties {
  return {
    background: `${accent}1c`,
    boxShadow: `inset 0 0 0 1px ${accent}55`,
    color: accent
  };
}

/** Width-derived rail font (#136): the pastor reads these columns over the pulpit
 *  mirror, so widening a rail must enlarge the text. Shared by ChapterRail and
 *  SectionRail. */
export function railFont(width: number): number {
  return Math.round(Math.max(13, Math.min(18, width / 24)) * 10) / 10;
}

export interface RailTier {
  live: boolean;
  cued: boolean;
  planned: boolean;
  /** ChapterRail's extra tier; rails without a selection simply omit it. */
  selected?: boolean;
}

/** The rail card: background from the tint ladder, ring strength descending with the
 *  same tiers. selected and live share the full-strength 2px ring. */
export function railRowStyle(T: Theme, accent: string, dark: boolean, tier: RailTier): CSSProperties {
  const { live, cued, planned, selected = false } = tier;
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '11px 13px',
    borderRadius: '11px',
    cursor: 'pointer',
    userSelect: 'none',
    background: selected
      ? railTint(accent, 'selected', dark)
      : live
        ? railTint(accent, 'live', dark)
        : cued
          ? railTint(accent, 'cued', dark)
          : planned
            ? railTint(accent, 'planned', dark)
            : T.panel2,
    boxShadow:
      selected || live
        ? `inset 0 0 0 2px ${accent}`
        : cued
          ? `inset 0 0 0 1.5px ${accent}66`
          : planned
            ? `inset 0 0 0 1px ${accent}44`
            : `inset 0 0 0 1px ${T.hairline}`
  };
}

/** Card eyebrow ("VERSE 12", "¶ 3"): accent ink while the row is emphasized. */
export function railLabelStyle(T: Theme, accent: string, emphasized: boolean): CSSProperties {
  return {
    fontFamily: MONO,
    fontSize: '10.5px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    fontWeight: 500,
    color: emphasized ? accent : T.faint
  };
}

/** The ● LIVE / planned badge slot on a rail card. */
export function railBadgeStyle(T: Theme, live: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontFamily: MONO,
    fontSize: '9px',
    letterSpacing: '0.08em',
    fontWeight: 600,
    color: live ? T.live : T.dim
  };
}

/** Two-line clamped card body; `fontPx` carries ChapterRail's width-derived size vs
 *  ParagraphRail's fixed 12.5. */
export function railTextStyle(T: Theme, opts: { cued: boolean; planned: boolean; fontPx: number }): CSSProperties {
  return {
    fontSize: `${opts.fontPx}px`,
    lineHeight: 1.42,
    fontWeight: 500,
    color: opts.cued ? T.text : opts.planned ? T.lineDim : T.dim,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden'
  };
}

/** Rule 1: the one ring that means "the congregation sees this", on every rail row and
 *  hero. The cued or selected item wears its track colour instead, never this. */
export function liveRing(T: Theme): string {
  return `inset 0 0 0 2px ${T.live}`;
}

/** The QUEUED badge (decision 7), lifted from SongSearchRail's old NEXT badge: track-colour
 *  mono caps with a fixed footprint (rule 5). `ghost` is both the hover forecast and the
 *  spent look on the row whose click would clear it. */
export function queuedBadgeStyle(accent: string, ghost: boolean): CSSProperties {
  return {
    fontFamily: MONO,
    fontSize: '9px',
    letterSpacing: '0.08em',
    fontWeight: 700,
    color: accent,
    opacity: ghost ? 0.45 : 1,
    flexShrink: 0,
    whiteSpace: 'nowrap'
  };
}

export interface ScheduleRowTier {
  live: boolean;
  /** In the delete-selection (useListSelection). */
  selected: boolean;
  /** The cued item (the hero shows it). */
  current: boolean;
}

/** One row look for the three schedule-shaped lists (Scripture schedule, quote schedule,
 *  media library). Live outranks the selection so the item on screen always reads red, even
 *  inside a picked range; the selection and the cue wear the track colour, at two strengths. */
export function scheduleRowStyle(T: Theme, accent: string, tier: ScheduleRowTier): CSSProperties {
  const { live, selected, current } = tier;
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '10px 11px',
    borderRadius: '11px',
    cursor: 'pointer',
    userSelect: 'none',
    background: live || current ? T.panel3 : selected ? T.panel2 : 'transparent',
    boxShadow: live
      ? liveRing(T)
      : selected
        ? `inset 0 0 0 1.5px ${accent}`
        : current
          ? `inset 0 0 0 1px ${accent}55`
          : 'none'
  };
}
