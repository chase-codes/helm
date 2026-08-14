import type { ModeKeyHandler } from './App';
import type { AppActionId, HotkeyOverrides } from '../../shared/hotkeys/actions';
import { resolveHotkey } from '../../shared/hotkeys/match';

export interface KeyDispatchCtx {
  settingsOpen: boolean;
  closeSettings: () => void;
  handler: ModeKeyHandler | null;
  /** Which mode-scope bindings are in play: Songs page → 'songs', Sermon page →
   * 'scripture' (SermonMode ignores scripture actions on its message/slides tracks),
   * Pre-service → null (global only). */
  scope: 'songs' | 'scripture' | null;
  overrides: HotkeyOverrides;
  onAppAction: (id: AppActionId) => void;
  /** Test seam; defaults to real platform detection inside resolveHotkey. */
  isMac?: boolean;
}

/**
 * Document-keydown → action dispatch. Escape stays hardcoded and first (closes any open
 * modal, even while typing; settings sits above the mode layer). Everything else resolves
 * through the hotkey registry: core actions keep their dedicated ModeKeyHandler methods
 * (arrows/goLive/delete, with their pre-existing guard semantics preserved exactly),
 * page-level actions go to App via onAppAction, and the rest reach the active mode's
 * optional onAction. The typing guard lives in resolveHotkey now: unmodified bindings
 * never fire from an input/textarea, Mod/Alt bindings do.
 */
export function dispatchModeKey(e: KeyboardEvent, ctx: KeyDispatchCtx): void {
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName?.toLowerCase();
  const typing = tag === 'input' || tag === 'textarea';
  const { handler } = ctx;

  if (e.key === 'Escape') {
    if (ctx.settingsOpen) {
      ctx.closeSettings();
      return;
    }
    handler?.onEscape();
    return;
  }

  const resolved = resolveHotkey(e, { scope: ctx.scope, typing, overrides: ctx.overrides, isMac: ctx.isMac });
  if (!resolved) return;

  switch (resolved.id) {
    case 'displays.release':
      // Panic control — releasing/taking the screens must work even behind Settings
      // or a modal; it touches no operator-window UI state.
      e.preventDefault();
      ctx.onAppAction('displays.release');
      return;
    case 'page.pre':
    case 'page.songs':
    case 'page.sermon':
    case 'scripture.lookup':
      // Behind Settings or a mode modal a silent page switch would strand the modal.
      if (ctx.settingsOpen || handler?.isModalOpen()) return;
      e.preventDefault();
      ctx.onAppAction(resolved.id);
      return;
    case 'nav.next':
      e.preventDefault();
      handler?.onArrow(1);
      return;
    case 'nav.prev':
      e.preventDefault();
      handler?.onArrow(-1);
      return;
    case 'go.live':
      e.preventDefault();
      // Guard Enter/Space→goLive behind an open modal (quick-add or settings).
      if (ctx.settingsOpen || handler?.isModalOpen()) return;
      handler?.onGoLive();
      return;
    case 'item.delete':
      // Only act when the active mode offers a delete AND no modal is up — a destructive
      // delete can't fire behind Settings/QuickAdd. (Backspace is the primary "delete"
      // key on Mac keyboards, so both map here by default.)
      if (!handler?.onDelete || ctx.settingsOpen || handler.isModalOpen()) return;
      e.preventDefault();
      handler.onDelete();
      return;
    default:
      // Mode-scoped extras (section jumps, reading jumps, focus/clear field). Same
      // modal guard as goLive/delete.
      if (ctx.settingsOpen || handler?.isModalOpen()) return;
      if (!handler?.onAction) return;
      e.preventDefault();
      handler.onAction(resolved);
  }
}
