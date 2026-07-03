import { useContext, type CSSProperties, type JSX } from 'react';
import type { Mode, ThemeMode } from './App';
import { ThemeCtx } from './App';
import { usePresentationState, useDisplayStatus, useClock } from './useHelm';

export interface HeaderProps {
  mode: Mode;
  setMode: (m: Mode) => void;
  themeMode: ThemeMode;
  toggleTheme: () => void;
}

const MODE_TABS: Array<{ id: Mode; label: string }> = [
  { id: 'pre', label: 'Pre-service' },
  { id: 'songs', label: 'Songs' },
  { id: 'sermon', label: 'Sermon' }
];

export function Header({ mode, setMode, themeMode, toggleTheme }: HeaderProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const { output, liveSnap } = usePresentationState();
  const { outputs } = useDisplayStatus();
  const clock = useClock();

  const isLive = output === 'live';
  const snapLbl = liveSnap ? (liveSnap.label ?? liveSnap.ref ?? liveSnap.title ?? '') : '';
  const outLabel =
    output === 'black'
      ? 'SCREEN BLACK'
      : output === 'logo'
        ? 'LOGO'
        : 'LIVE' + (snapLbl ? ' — ' + snapLbl.toUpperCase().slice(0, 30) : '');
  const outColor = output === 'black' ? T.dim : output === 'logo' ? T.accent : T.live;

  const handleLiveClick = (): void => {
    if (isLive) window.helm.presentation.setOutput('black');
  };

  const headerStyle: CSSProperties = {
    height: '56px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '18px',
    padding: '0 16px',
    background: T.panel,
    borderBottom: '1px solid ' + T.hairline
  };
  const logoStyle: CSSProperties = {
    width: '30px',
    height: '30px',
    borderRadius: '9px',
    background: 'linear-gradient(150deg,#e7b95c,#cf8f33)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    color: '#1a1206',
    fontSize: '17px'
  };
  const modeWrapStyle: CSSProperties = { display: 'flex', gap: '4px', background: T.panel2, padding: '4px', borderRadius: '11px' };
  const modeTabStyle = (active: boolean): CSSProperties => ({
    padding: '7px 16px',
    borderRadius: '8px',
    fontSize: '13.5px',
    fontWeight: active ? 700 : 600,
    color: active ? T.accentInk : T.dim,
    background: active ? T.accent : 'transparent'
  });
  const outputsChipStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '11px',
    letterSpacing: '0.06em',
    color: outputs > 0 ? T.dim : T.faint,
    whiteSpace: 'nowrap'
  };
  const liveStatusStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    height: isLive ? '32px' : '28px',
    padding: '0 11px',
    borderRadius: '8px',
    background: outColor + '1c',
    boxShadow: 'inset 0 0 0 1px ' + outColor + '55',
    color: outColor,
    cursor: isLive ? 'pointer' : 'default',
    whiteSpace: 'nowrap'
  };
  const liveDotStyle: CSSProperties = {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: outColor,
    animation: isLive ? 'lecPulse 1.6s ease-in-out infinite' : 'none'
  };
  const takeDownChipStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '9.5px',
    letterSpacing: '0.08em',
    fontWeight: 700,
    color: T.live,
    background: T.live + '22',
    padding: '3px 7px',
    borderRadius: '6px',
    marginLeft: '2px'
  };
  const themeBtnStyle: CSSProperties = {
    width: '34px',
    height: '34px',
    borderRadius: '9px',
    background: T.panel2,
    boxShadow: 'inset 0 0 0 1px ' + T.hairline,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    color: T.dim
  };

  return (
    <div style={headerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
        <div style={logoStyle}>H</div>
        <div style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '-0.01em' }}>Sunday Service</div>
      </div>
      <div style={modeWrapStyle}>
        {MODE_TABS.map((t) => (
          <button key={t.id} style={modeTabStyle(mode === t.id)} onClick={() => setMode(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <span style={outputsChipStyle}>
        {outputs} OUTPUT{outputs === 1 ? '' : 'S'}
      </span>
      <button
        style={liveStatusStyle}
        onClick={handleLiveClick}
        title={isLive ? 'Take down — clears the screen from anywhere' : 'Nothing on screen'}
      >
        <span style={liveDotStyle} />
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '11px', letterSpacing: '0.08em' }}>{outLabel}</span>
        {isLive && <span style={takeDownChipStyle}>✕ TAKE DOWN</span>}
      </button>
      <button style={themeBtnStyle} onClick={toggleTheme}>
        {themeMode === 'dark' ? '☀' : '☾'}
      </button>
      <div
        style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: '15px',
          color: T.dim,
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {clock}
      </div>
    </div>
  );
}
