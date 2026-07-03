import { useEffect, useRef, useState, type CSSProperties, type JSX, type MutableRefObject } from 'react';
import { themeFor, type Theme } from '../../shared/theme';
import { Header } from './Header';
import { SongsMode } from './SongsMode';
import { ThemeCtx } from './ThemeCtx';

export type Mode = 'pre' | 'songs' | 'sermon';
export type ThemeMode = 'dark' | 'light';

/**
 * Delegate interface a mode registers on `keyHandlerRef` so the global
 * document keydown handler below can drive it without App knowing anything
 * mode-specific. Future modes (pre/sermon) plug in the same way.
 */
export interface ModeKeyHandler {
  /** Escape: close an open modal if one is open. Returns true if it handled it. */
  onEscape: () => boolean;
  /** Arrow navigation: +1 (Right/Down) or -1 (Left/Up) steps the current cue. */
  onArrow: (dir: 1 | -1) => void;
  /** Enter/Space: go live on the current cue. */
  onGoLive: () => void;
}

export type ModeKeyHandlerRef = MutableRefObject<ModeKeyHandler | null>;

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

  // Delegated to whichever mode is active (see ModeKeyHandler above). Registered
  // once on `document` here so future modes plug in without App changing.
  const keyHandlerRef = useRef<ModeKeyHandler | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing = tag === 'input' || tag === 'textarea';
      const handler = keyHandlerRef.current;

      // Escape fires even while typing (closes any open modal); no preventDefault,
      // matching the prototype exactly.
      if (e.key === 'Escape') {
        handler?.onEscape();
        return;
      }
      if (typing) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        handler?.onArrow(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        handler?.onArrow(-1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler?.onGoLive();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

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
          {mode === 'songs' && <SongsMode themeMode={themeMode} keyHandlerRef={keyHandlerRef} />}
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}

export default App;
