import type { CSSProperties, JSX } from 'react';
import type { Theme } from '../../shared/theme';
import type { SermonTrack } from './SchedulePanel';

const TRACK_TABS: Array<{ id: SermonTrack; label: string }> = [
  { id: 'scripture', label: 'Scripture' },
  { id: 'message', label: 'Message' },
  { id: 'slides', label: 'Slides' }
];

export interface TrackTabsProps {
  theme: Theme;
  track: SermonTrack;
  setTrack: (t: SermonTrack) => void;
}

/** Track switcher: Scripture/Message/Slides. Extracted from SchedulePanel so the Message
 * track's rail (owned by MessageMode) can render the same tabs without pulling in
 * SchedulePanel's scripture-only body — avoids the double-rail bug where the Message
 * track rendered both SchedulePanel (tabs only) and MessageSearchRail as separate
 * sibling columns. */
export function TrackTabs({ theme: T, track, setTrack }: TrackTabsProps): JSX.Element {
  const trackWrapStyle: CSSProperties = { display: 'flex', gap: '4px', background: T.panel2, padding: '4px', borderRadius: '10px' };
  const trackColor = (id: SermonTrack): string => (id === 'scripture' ? T.scripture : id === 'message' ? T.message : T.sermon);
  const trackTabStyle = (id: SermonTrack): CSSProperties => ({
    // `auto` basis, not equal thirds: at the rail's 200px minimum an equal split gives
    // "Slides" width it doesn't need while "Scripture" overflows its pill — the labels
    // must divide the row by their own widths to all keep breathing room. minWidth 0 +
    // hidden overflow are the below-minimum safety net (clip, never spill).
    flex: '1 1 auto',
    minWidth: 0,
    height: '34px',
    padding: '0 6px',
    borderRadius: '8px',
    fontSize: '12.5px',
    fontWeight: track === id ? 700 : 600,
    color: track === id ? '#fff' : T.dim,
    background: track === id ? trackColor(id) : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden'
  });

  return (
    <div style={trackWrapStyle}>
      {TRACK_TABS.map((t) => (
        <button key={t.id} style={trackTabStyle(t.id)} onClick={() => setTrack(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
