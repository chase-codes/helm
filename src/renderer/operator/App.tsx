import { useCallback, useEffect, useRef, useState, type CSSProperties, type JSX, type MutableRefObject } from 'react';
import { blurOnPointerClick } from './blurOnPointerClick';
import { suppressSpaceActivation } from './suppressSpaceActivation';
import { Header } from './Header';
import { ModeErrorBoundary } from './ModeErrorBoundary';
import { dispatchModeKey } from './keyDispatch';
import { PreServiceMode } from './PreServiceMode';
import { SermonMode } from './SermonMode';
import { SettingsModal } from './SettingsModal';
import { SongsMode } from './SongsMode';
import { ThemeCtx } from './ThemeCtx';
import { useAppearance } from './useAppearance';
import { sanitizeOverrides, type AppActionId, type HotkeyOverrides } from '../../shared/hotkeys/actions';
import type { ResolvedHotkey } from '../../shared/hotkeys/match';
import { SANS } from '../shared/fonts';

export type Mode = 'pre' | 'songs' | 'sermon';
export type { ThemeMode } from '../../shared/theme';

/**
 * Delegate interface a mode registers on `keyHandlerRef` so the global
 * document keydown handler below can drive it without App knowing anything
 * mode-specific. Future modes (pre/sermon) plug in the same way.
 */
export interface ModeKeyHandler {
  /** Escape: back out one layer (close a mode modal, disarm, blur a field, black the
   * screen — see SongsMode/SermonMode's ladders). Returns true if it consumed the press;
   * the dispatcher ignores the result, but mode tests pin ladder rungs through it. */
  onEscape: () => boolean;
  /** Arrow navigation: +1 (Right/Down) or -1 (Left/Up) steps the current cue. */
  onArrow: (dir: 1 | -1) => void;
  /** Enter: go live on the current cue. (Space no longer does — #52.) */
  onGoLive: () => void;
  /**
   * True while this mode has its own modal open (e.g. SongsMode's QuickAdd). Queried
   * fresh at dispatch time (the handler is re-registered every render — from a LAYOUT
   * effect, so it never lags the commit that is on screen — and this therefore always
   * reflects current state) so App can suppress Enter→onGoLive without needing a
   * separate piece of App-level state per mode's modal.
   */
  isModalOpen: () => boolean;
  /**
   * Delete/Backspace (only while not typing): remove the mode's currently selected list
   * row, if any. Optional — modes with no selectable list omit it, and App then leaves
   * Delete/Backspace untouched. See useListSelection + the interaction-primitives design.
   */
  onDelete?: () => void;
  /**
   * Registry-resolved hotkey actions beyond the core set (section jumps, reading
   * jumps, focus/clear field). Optional — modes ignore actions they don't own.
   * Suppressed by App while Settings or a mode modal is open, same as goLive/delete.
   */
  onAction?: (a: ResolvedHotkey) => void;
}

export type ModeKeyHandlerRef = MutableRefObject<ModeKeyHandler | null>;

function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>('songs');
  const { mode: themeMode, theme, toggleMode: toggleTheme, family, setFamily, setMode: setThemeMode } = useAppearance();

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

  // Hotkey rebinds, loaded once and kept in App state so Settings edits re-resolve
  // the live keymap immediately (dispatch reads this on every keydown).
  const [hotkeyOverrides, setHotkeyOverrides] = useState<HotkeyOverrides>({});
  useEffect(() => {
    void window.helm.settings
      .get<unknown>('hotkeys', {})
      .then((v) => setHotkeyOverrides(sanitizeOverrides(v)))
      .catch(console.error);
  }, []);

  // ShortcutsSettings' only way to persist a rebind/reset: update local state (so the
  // live dispatcher sees it next render) and mirror it to the settings store.
  const saveHotkeyOverrides = useCallback((next: HotkeyOverrides): void => {
    setHotkeyOverrides(next);
    window.helm.settings.set('hotkeys', next);
  }, []);

  // Bumped by the scripture-lookup hotkey; SermonMode reacts by forcing its scripture
  // track and focusing the ref entry (same App-mediated pattern as biblesRevision).
  const [lookupNonce, setLookupNonce] = useState(0);
  // Its Songs twin (#52): the song-search hotkey switches to Songs and SongsMode focuses
  // its search box on the bump.
  const [searchNonce, setSearchNonce] = useState(0);

  // useCallback([]) so it's a stable dep for the keydown effect below — it only touches
  // stable setters, so it never needs to change.
  const onAppAction = useCallback((id: AppActionId): void => {
    if (id === 'page.pre') setMode('pre');
    else if (id === 'page.songs') setMode('songs');
    else if (id === 'page.sermon') setMode('sermon');
    else if (id === 'displays.release') window.helm.displays.toggleReleased();
    else if (id === 'scripture.lookup') {
      setMode('sermon');
      setLookupNonce((n) => n + 1);
    } else if (id === 'song.search') {
      setMode('songs');
      setSearchNonce((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void =>
      dispatchModeKey(e, {
        settingsOpen,
        closeSettings: () => setSettingsOpen(false),
        handler: keyHandlerRef.current,
        scope: mode === 'songs' ? 'songs' : mode === 'sermon' ? 'scripture' : null,
        overrides: hotkeyOverrides,
        onAppAction
      });
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, mode, hotkeyOverrides, onAppAction]);

  // Release DOM focus from mouse-clicked buttons so the last-clicked control doesn't keep
  // a lingering :focus-visible ring once keyboard navigation begins (BUG-001). See
  // blurOnPointerClick for the full rationale; keyboard activation stays focused.
  useEffect(() => {
    document.addEventListener('click', blurOnPointerClick);
    return () => document.removeEventListener('click', blurOnPointerClick);
  }, []);

  // Space is not a go-live key (#52), and must not become one again through the browser's
  // native button activation on a focused control. See suppressSpaceActivation.
  useEffect(() => {
    document.addEventListener('keydown', suppressSpaceActivation, true);
    return () => document.removeEventListener('keydown', suppressSpaceActivation, true);
  }, []);

  const rootStyle: CSSProperties = {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: theme.appBg,
    color: theme.text,
    fontFamily: SANS,
    fontSize: '14px',
    overflow: 'hidden'
  };
  const mainStyle: CSSProperties = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' };

  return (
    <ThemeCtx.Provider value={theme}>
      <div style={rootStyle}>
        <Header mode={mode} setMode={setMode} themeMode={themeMode} toggleTheme={toggleTheme} onOpenSettings={() => setSettingsOpen(true)} hotkeyOverrides={hotkeyOverrides} />
        <div style={mainStyle}>
          {/* Unlike Songs/Sermon, Pre-service is mounted only while it's the active page
              — the brief gives it no keep-alive, since its whole state lives in main and
              is re-read on mount. It still takes `keyHandlerRef` so Delete and Escape
              reach its card rail like every other list surface (#90). */}
          {mode === 'pre' && (
            <ModeErrorBoundary label="Pre-service">
              <PreServiceMode active={mode === 'pre'} keyHandlerRef={keyHandlerRef} />
            </ModeErrorBoundary>
          )}
          {/* Songs and Sermon stay mounted at all times (keep-alive contract) so operator
              state — cued song/section, sermon reading, schedule — survives tab switches.
              The inactive one is hidden via `display:none`; `display:contents` while active
              keeps it transparent to mainStyle's flex layout. Each receives `active` and
              only registers its keyboard delegate while it's the one on screen. */}
          <div style={{ display: mode === 'songs' ? 'contents' : 'none' }}>
            <ModeErrorBoundary label="Songs">
              <SongsMode keyHandlerRef={keyHandlerRef} active={mode === 'songs'} searchNonce={searchNonce} />
            </ModeErrorBoundary>
          </div>
          <div style={{ display: mode === 'sermon' ? 'contents' : 'none' }}>
            <ModeErrorBoundary label="Sermon">
              <SermonMode
                themeMode={themeMode}
                keyHandlerRef={keyHandlerRef}
                active={mode === 'sermon'}
                onOpenSettings={() => setSettingsOpen(true)}
                biblesRevision={biblesRevision}
                lookupNonce={lookupNonce}
              />
            </ModeErrorBoundary>
          </div>
        </div>
        {settingsOpen && (
          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onBiblesChanged={() => setBiblesRevision((r) => r + 1)}
            hotkeyOverrides={hotkeyOverrides}
            onHotkeyOverridesChange={saveHotkeyOverrides}
            family={family}
            setFamily={setFamily}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
          />
        )}
      </div>
    </ThemeCtx.Provider>
  );
}

export default App;
