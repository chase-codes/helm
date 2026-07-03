import { useEffect, useRef, useState, type CSSProperties, type JSX, type MutableRefObject } from 'react';
import { themeFor, type Theme } from '../../shared/theme';
import { Header } from './Header';
import { SermonMode } from './SermonMode';
import { SettingsModal } from './SettingsModal';
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

  // Settings is app-level (not owned by any mode) — it can be opened from the header
  // gear regardless of which mode is active, so its state lives here rather than in
  // SongsMode/SermonMode the way QuickAdd's modal state lives in SongsMode.
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      // matching the prototype exactly. Settings sits above the mode layer, so an open
      // settings modal closes first — the mode's own onEscape (e.g. QuickAdd) only
      // gets a chance once settings is out of the way.
      if (e.key === 'Escape') {
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
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
  }, [settingsOpen]);

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
        <Header mode={mode} setMode={setMode} themeMode={themeMode} toggleTheme={toggleTheme} onOpenSettings={() => setSettingsOpen(true)} />
        <div style={mainStyle}>
          {mode === 'pre' && <Placeholder theme={theme} title="Pre-service" />}
          {/* Songs and Sermon stay mounted at all times (keep-alive contract) so operator
              state — cued song/section, sermon reading, schedule — survives tab switches.
              The inactive one is hidden via `display:none`; `display:contents` while active
              keeps it transparent to mainStyle's flex layout. Each receives `active` and
              only registers its keyboard delegate while it's the one on screen. */}
          <div style={{ display: mode === 'songs' ? 'contents' : 'none' }}>
            <SongsMode themeMode={themeMode} keyHandlerRef={keyHandlerRef} active={mode === 'songs'} />
          </div>
          <div style={{ display: mode === 'sermon' ? 'contents' : 'none' }}>
            <SermonMode
              themeMode={themeMode}
              keyHandlerRef={keyHandlerRef}
              active={mode === 'sermon'}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
        </div>
        {settingsOpen && <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
      </div>
    </ThemeCtx.Provider>
  );
}

export default App;
