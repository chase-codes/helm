import type { CSSProperties, JSX } from 'react';
import type { Theme } from '../../shared/theme';
import type { OutputMode, SlideColumn } from '../../shared/types';

export interface SermonCenterProps {
  theme: Theme;
  output: OutputMode;
  cuedIsLive: boolean;
  heroLabel: string;
  cols: SlideColumn[];
  ondeckTag: string;
  ondeckTagColor: string;
  ondeckTitle: string;
  ondeckPreview: string;
  /** The version-picker button + popover (Task 6's VersionPicker), rendered in the
   * transport row where the design's static version button used to sit. */
  versionPicker: JSX.Element;
  onPrev: () => void;
  onNext: () => void;
  onGoLive: () => void;
  onToggleLogo: () => void;
}

const INSTALL_HINT = '[ Install a Bible in Settings ]';

/** Now-bar, hero verse card, on-deck preview, and transport for the Scripture track. */
export function SermonCenter({
  theme: T,
  output,
  cuedIsLive,
  heroLabel,
  cols,
  ondeckTag,
  ondeckTagColor,
  ondeckTitle,
  ondeckPreview,
  versionPicker,
  onPrev,
  onNext,
  onGoLive,
  onToggleLogo
}: SermonCenterProps): JSX.Element {
  const outColor = output === 'black' ? T.dim : output === 'logo' ? T.accent : T.live;
  const projText = output === 'black' ? 'NOTHING ON SCREEN' : output === 'logo' ? 'LOGO ON SCREEN' : 'LIVE ON SCREEN';

  const centerStyle: CSSProperties = { flex: 1, minWidth: 0, background: T.appBg, display: 'flex', flexDirection: 'column', padding: '16px 22px', minHeight: 0 };
  const nowBarStyle: CSSProperties = {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    height: '28px',
    padding: '0 12px',
    borderRadius: '9px',
    background: `${outColor}1c`,
    boxShadow: `inset 0 0 0 1px ${outColor}55`,
    color: outColor,
    marginBottom: '4px'
  };
  const projDotStyle: CSSProperties = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: outColor,
    animation: output === 'live' ? 'lecPulse 1.6s ease-in-out infinite' : 'none'
  };
  const heroCardStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    borderRadius: '14px',
    background: T.panel,
    boxShadow: cuedIsLive ? `inset 0 0 0 2px ${T.scripture}66` : `inset 0 0 0 1px ${T.hairline}`
  };
  const heroLabelStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '12px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: cuedIsLive ? T.scripture : T.faint,
    fontWeight: 500
  };
  const verseColMax = cols.length > 1 ? '50%' : '100%';
  const verseVerStyle: CSSProperties = { fontFamily: "'JetBrains Mono',monospace", fontSize: '11px', letterSpacing: '0.14em', color: T.faint, marginBottom: '8px' };
  const verseTextStyle: CSSProperties = {
    fontFamily: "'Newsreader', Georgia, serif",
    fontSize: cols.length > 1 ? '21.0px' : 'clamp(26.0px, 2.70vw, 38.0px)',
    lineHeight: 1.4,
    color: T.text,
    fontWeight: 400
  };
  const ondeckStyle: CSSProperties = { flexShrink: 0, padding: '12px 15px', borderRadius: '12px', background: T.panel2, boxShadow: `inset 0 0 0 1px ${T.hairline}` };
  const ondeckTagStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2px 7px',
    borderRadius: '5px',
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '9px',
    letterSpacing: '0.06em',
    fontWeight: 500,
    color: ondeckTagColor,
    background: `${ondeckTagColor}22`,
    flexShrink: 0,
    whiteSpace: 'nowrap'
  };
  const ghostBtn: CSSProperties = {
    height: '46px',
    padding: '0 16px',
    borderRadius: '11px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.hairline}`,
    fontSize: '14px',
    fontWeight: 600,
    color: T.dim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px'
  };
  const goLiveStyle: CSSProperties = {
    height: '46px',
    padding: '0 20px',
    borderRadius: '11px',
    background: cuedIsLive ? T.live : '#2f9e5b',
    color: '#fff',
    fontSize: '14.5px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px',
    whiteSpace: 'nowrap'
  };
  const logoBtnStyle: CSSProperties = {
    height: '46px',
    padding: '0 14px',
    borderRadius: '11px',
    background: 'transparent',
    boxShadow: `inset 0 0 0 1px ${output === 'logo' ? T.accent + '66' : T.border}`,
    fontSize: '13px',
    fontWeight: 600,
    color: output === 'logo' ? T.accent : T.dim,
    display: 'flex',
    alignItems: 'center'
  };

  return (
    <div style={centerStyle}>
      <div style={nowBarStyle}>
        <span style={projDotStyle} />
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '11.5px', letterSpacing: '0.06em' }}>{projText}</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={heroCardStyle}>
          <div style={{ margin: 'auto', width: '100%', maxWidth: '680px', textAlign: 'center', padding: '22px 30px' }}>
            <div style={heroLabelStyle}>{heroLabel}</div>
            {cols.length ? (
              <div style={{ display: 'flex', gap: '30px', justifyContent: 'center', textAlign: 'left', marginTop: '18px' }}>
                {cols.map((c, i) => (
                  <div key={i} style={{ flex: 1, maxWidth: verseColMax }}>
                    <div style={verseVerStyle}>{c.version}</div>
                    <div style={verseTextStyle}>{c.text}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: '18px', fontSize: '13px', color: T.faint }}>{INSTALL_HINT}</div>
            )}
          </div>
        </div>
      </div>

      <div style={ondeckStyle}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '10px', letterSpacing: '0.12em', color: T.faint }}>
          UP NEXT — TAP OR PRESS →
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '7px' }}>
          <div style={ondeckTagStyle}>{ondeckTag}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ondeckTitle}</div>
            <div style={{ fontSize: '12px', color: T.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ondeckPreview}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '13px', flexShrink: 0 }}>
        <button style={ghostBtn} onClick={onPrev}>
          &lsaquo; Back
        </button>
        <button style={ghostBtn} onClick={onNext}>
          Next verse &rsaquo;
        </button>
        <div style={{ flex: 1 }} />
        <button style={goLiveStyle} onClick={onGoLive}>
          {cuedIsLive ? '■ Take down' : '● Go live'}
        </button>
        {versionPicker}
        <button style={logoBtnStyle} onClick={onToggleLogo}>
          {output === 'logo' ? 'Logo on screen' : 'Logo'}
        </button>
      </div>
    </div>
  );
}
