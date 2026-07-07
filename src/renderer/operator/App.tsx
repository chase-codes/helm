import { useEffect, useRef, useState, type CSSProperties, type JSX, type MutableRefObject } from 'react';
import { themeFor } from '../../shared/theme';
import { blurOnPointerClick } from './blurOnPointerClick';
import { Header } from './Header';
import { dispatchModeKey } from './keyDispatch';
import { PreServiceMode } from './PreServiceMode';
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
  /**
   * True while this mode has its own modal open (e.g. SongsMode's QuickAdd). Queried
   * fresh at dispatch time (the handler is re-registered every render, so this always
   * reflects current state) so App can suppress Enter/Space→onGoLive without needing a
   * separate piece of App-level state per mode's modal.
   */
  isModalOpen: () => boolean;
  /**
   * Delete/Backspace (only while not typing): remove the mode's currently selected list
   * row, if any. Optional — modes with no selectable list omit it, and App then leaves
   * Delete/Backspace untouched. See useListSelection + the interaction-primitives design.
   */
  onDelete?: () => void;
}

export type ModeKeyHandlerRef = MutableRefObject<ModeKeyHandler | null>;

function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>('songs');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const theme = themeFor(themeMode);
  const toggleTheme = (): void => setThemeMode((m) => (m === 'dark' ? 'light' : 'dark'));

  // Settings is app-level (not owned by any mode) — it can be opened from the header
  // gear regardless of which mode is active, so its state lives here rather than in
  // SongsMode/SermonMode the way QuickAdd's modal state lives in SongsMode.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Bumped by SettingsModal after a successful bible uninstall (which, unlike install,
  // has no IPC progress broadcast for SermonMode to piggyback on) so App can mediate the
  // refresh between the two sibling components instead of them reaching into each other.
  const [biblesRevision, setBiblesRevision] = useState(0);

  // Delegated to whichever mode is active (see ModeKeyHandler above). Registered
  // once on `document` here so future modes plug in without App changing.
  const keyHandlerRef = useRef<ModeKeyHandler | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void =>
      dispatchModeKey(e, {
        settingsOpen,
        closeSettings: () => setSettingsOpen(false),
        handler: keyHandlerRef.current
      });
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen]);

  // Release DOM focus from mouse-clicked buttons so the last-clicked control doesn't keep
  // a lingering :focus-visible ring once keyboard navigation begins (BUG-001). See
  // blurOnPointerClick for the full rationale; keyboard activation stays focused.
  useEffect(() => {
    document.addEventListener('click', blurOnPointerClick);
    return () => document.removeEventListener('click', blurOnPointerClick);
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
        <Header mode={mode} setMode={setMode} themeMode={themeMode} toggleTheme={toggleTheme} onOpenSettings={() => setSettingsOpen(true)} />
        <div style={mainStyle}>
          {mode === 'pre' && <PreServiceMode themeMode={themeMode} active={mode === 'pre'} />}
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
              biblesRevision={biblesRevision}
            />
          </div>
        </div>
        {settingsOpen && (
          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onBiblesChanged={() => setBiblesRevision((r) => r + 1)}
          />
        )}
      </div>
    </ThemeCtx.Provider>
  );
}

export default App;
