import { createContext, useState, type CSSProperties, type JSX } from 'react';
import { themeFor, type Theme } from '../../shared/theme';
import { Header } from './Header';

export type Mode = 'pre' | 'songs' | 'sermon';
export type ThemeMode = 'dark' | 'light';

export const ThemeCtx = createContext<Theme>(themeFor('dark'));

function Placeholder({ theme, title }: { theme: Theme; title: string }): JSX.Element {
  const wrapStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    textAlign: 'center'
  };
  const titleStyle: CSSProperties = { fontSize: '20px', fontWeight: 700, color: theme.text };
  const bodyStyle: CSSProperties = { fontSize: '13px', color: theme.faint, maxWidth: '420px' };
  return (
    <div style={wrapStyle}>
      <div style={titleStyle}>{title}</div>
      <div style={bodyStyle}>
        Coming in a later slice — see docs/superpowers/specs/2026-07-03-helm-design.md §11.
      </div>
    </div>
  );
}

function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>('songs');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const theme = themeFor(themeMode);
  const toggleTheme = (): void => setThemeMode((m) => (m === 'dark' ? 'light' : 'dark'));

  const rootStyle: CSSProperties = {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: theme.appBg,
    color: theme.text,
    fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
    fontSize: '14px',
    overflow: 'hidden'
  };
  const mainStyle: CSSProperties = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' };

  return (
    <ThemeCtx.Provider value={theme}>
      <div style={rootStyle}>
        <Header mode={mode} setMode={setMode} themeMode={themeMode} toggleTheme={toggleTheme} />
        <div style={mainStyle}>
          {mode === 'pre' && <Placeholder theme={theme} title="Pre-service" />}
          {mode === 'sermon' && <Placeholder theme={theme} title="Sermon" />}
          {mode === 'songs' && <div style={{ flex: 1, minHeight: 0 }} />}
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}

export default App;
