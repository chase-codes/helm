import type { CSSProperties, JSX } from 'react';
import type { Theme } from '../../shared/theme';
import { railBadgeStyle, railLabelStyle, railRowStyle, railTextStyle } from './railTint';
import type { MessageParagraph } from '../../shared/types';

export interface ParagraphRailProps {
  theme: Theme;
  dark: boolean;
  width: number;
  title: string;
  plannedCount: number;
  paragraphs: MessageParagraph[];
  cuedOrd: number;
  isLive: (ord: number) => boolean;
  plannedSet: Set<number>;
  onSelect: (ord: number) => void;
  /** Double-click: put this paragraph's quote on screen (#58), idempotently. */
  onActivate: (ord: number) => void;
}

const HINT = 'Planned quotes are highlighted. Tap any paragraph — and keep reading right past the plan.';

/** Right rail for the Message track: one card per paragraph in the current tape,
 * tinted by planned/cued/live tier, click jumps `msgIdx` (MessageMode's cue effect
 * handles cueing/hot-updating live output). Mirrors ChapterRail's tap-to-navigate
 * shape (Lectern.pretty.html:416-439, styles 1159/1171-1175). */
export function ParagraphRail({
  theme: T,
  dark,
  width,
  title,
  plannedCount,
  paragraphs,
  cuedOrd,
  isLive,
  plannedSet,
  onSelect,
  onActivate
}: ParagraphRailProps): JSX.Element {
  const panelStyle: CSSProperties = { width: `${width}px`, flexShrink: 0, background: T.panel, display: 'flex', flexDirection: 'column', minHeight: 0 };

  const rowStyle = (live: boolean, cued: boolean, planned: boolean): CSSProperties =>
    railRowStyle(T, T.message, dark, { live, cued, planned });
  const labelStyle = (cued: boolean, planned: boolean): CSSProperties =>
    railLabelStyle(T, T.message, cued || planned);
  const badgeStyle = (live: boolean): CSSProperties => railBadgeStyle(T, live);
  const textStyle = (cued: boolean, planned: boolean): CSSProperties =>
    railTextStyle(T, { cued, planned, fontPx: 12.5 });

  return (
    <div style={panelStyle}>
      <div style={{ padding: '14px 15px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '11px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600 }}>{title}</div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '10px', color: T.message }}>{plannedCount} planned</div>
        </div>
        <div style={{ fontSize: '11.5px', color: T.faint, marginTop: '6px', lineHeight: 1.45 }}>{HINT}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {paragraphs.map((p) => {
          const planned = plannedSet.has(p.ord);
          const cued = p.ord === cuedOrd;
          const live = isLive(p.ord);
          const showBadge = cued || live;
          return (
            <button key={p.ord} style={rowStyle(live, cued, planned)} onClick={() => onSelect(p.ord)} onDoubleClick={() => onActivate(p.ord)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div style={labelStyle(cued, planned)}>&para; {p.label}</div>
                {showBadge && (
                  <div style={badgeStyle(live)}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                    {live ? 'LIVE' : 'CUED'}
                  </div>
                )}
              </div>
              <div style={textStyle(cued, planned)}>{p.text}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
