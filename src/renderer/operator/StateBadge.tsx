import type { CSSProperties, JSX } from 'react';
import type { Theme } from '../../shared/theme';
import { queuedBadgeStyle, railBadgeStyle } from './railTint';

const DOT: CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: 'currentColor',
  display: 'inline-block'
};

/** The red LIVE badge (rule 1). `chip` gives it a panel ground so it stays legible over a
 *  slide image or a hero card. */
export function LiveBadge({
  theme: T,
  chip = false,
  style
}: {
  theme: Theme;
  chip?: boolean;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <span
      data-badge="live"
      style={{
        ...railBadgeStyle(T, true),
        flexShrink: 0,
        whiteSpace: 'nowrap',
        ...(chip ? { background: T.panel, padding: '3px 7px', borderRadius: '6px' } : {}),
        ...style
      }}
    >
      <span style={DOT} />
      LIVE
    </span>
  );
}

/** QUEUED (decision 7): lined up behind what is live; Go live or a double click takes it. */
export function QueuedBadge({
  accent,
  ghost = false,
  label = 'QUEUED',
  style
}: {
  accent: string;
  ghost?: boolean;
  label?: string;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <span data-badge="queued" style={{ ...queuedBadgeStyle(accent, ghost), ...style }}>
      {label}
    </span>
  );
}

/** Trailing marker for a schedule row: LIVE, else QUEUED, else the track-colour cue dot. */
export function RowStateMark({
  theme,
  accent,
  live,
  queued,
  current
}: {
  theme: Theme;
  accent: string;
  live: boolean;
  queued: boolean;
  current: boolean;
}): JSX.Element | null {
  if (live) return <LiveBadge theme={theme} />;
  if (queued) return <QueuedBadge accent={accent} />;
  if (current)
    return (
      <span
        data-cued-dot
        style={{ width: '8px', height: '8px', borderRadius: '50%', background: accent, flexShrink: 0 }}
      />
    );
  return null;
}
