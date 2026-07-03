import type { CSSProperties, JSX } from 'react';
import type { Theme } from '../../shared/theme';
import type { SongSection } from '../../shared/types';

export interface SectionRailProps {
  theme: Theme;
  dark: boolean;
  width: number;
  sections: SongSection[];
  cuedIndex: number;
  isSectionLive: (i: number) => boolean;
  onSelect: (i: number) => void;
}

export function SectionRail({ theme: T, dark, width, sections, cuedIndex, isSectionLive, onSelect }: SectionRailProps): JSX.Element {
  const secFont = Math.round(Math.max(13, Math.min(18, width / 24)) * 10) / 10;

  const sectionPanelStyle: CSSProperties = {
    width: `${width}px`,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0
  };
  const secRowStyle = (isCued: boolean, isLive: boolean): CSSProperties => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '11px 13px',
    borderRadius: '11px',
    cursor: 'pointer',
    background: isLive ? (dark ? '#221d10' : '#fbf1da') : T.panel2,
    boxShadow: isLive
      ? `inset 0 0 0 2px ${T.accent}`
      : isCued
        ? `inset 0 0 0 1.5px ${T.accent}66`
        : `inset 0 0 0 1px ${T.hairline}`
  });
  const secLabelStyle = (isCued: boolean): CSSProperties => ({
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '10.5px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    fontWeight: 500,
    color: isCued ? T.accent : T.faint
  });
  const secBadgeStyle = (isLive: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '9px',
    letterSpacing: '0.08em',
    fontWeight: 600,
    color: isLive ? T.live : T.dim
  });
  const secLineStyle = (isCued: boolean): CSSProperties => ({
    fontSize: `${secFont}px`,
    lineHeight: 1.45,
    fontWeight: 500,
    color: isCued ? T.text : dark ? '#b4b1aa' : '#5f5848',
    textWrap: 'pretty'
  });

  return (
    <div style={sectionPanelStyle}>
      <div style={{ fontSize: '11px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600, marginBottom: '10px', flexShrink: 0 }}>
        SECTIONS — TAP TO SING
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '2px' }}>
        {sections.map((sc, i) => {
          const isCued = i === cuedIndex;
          const isLive = isSectionLive(i);
          const showBadge = isCued || isLive;
          return (
            <button key={i} style={secRowStyle(isCued, isLive)} onClick={() => onSelect(i)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div style={secLabelStyle(isCued)}>{sc.label}</div>
                {showBadge && (
                  <div style={secBadgeStyle(isLive)}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                    {isLive ? 'LIVE' : 'CUED'}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {sc.lines.map((ln, j) => (
                  <div key={j} style={secLineStyle(isCued)}>
                    {ln}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
