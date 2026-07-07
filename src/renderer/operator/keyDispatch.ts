import type { ModeKeyHandler } from './App';

export interface KeyDispatchCtx {
  settingsOpen: boolean;
  closeSettings: () => void;
  handler: ModeKeyHandler | null;
}

/**
 * Pure translation of a document keydown into the active mode's delegate action.
 * Extracted verbatim from App's inline handler (so the branch table stays unit-testable
 * without mounting the whole app) plus the new Delete/Backspace branch. App wires this to
 * `document` and passes fresh context each event.
 *
 * Escape fires even while typing (closes any open modal); settings sits above the mode
 * layer so an open settings modal closes first. Everything else is gated behind the typing
 * guard so editing an input/textarea is never hijacked.
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
  if (typing) return;

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    handler?.onArrow(1);
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    handler?.onArrow(-1);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    // Guard Enter/Space→goLive behind an open modal (quick-add or settings).
    if (ctx.settingsOpen || handler?.isModalOpen()) return;
    handler?.onGoLive();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    // Only act when the active mode offers a delete; otherwise leave the key alone
    // (Backspace is the primary "delete" key on Mac keyboards, so both map here).
    if (!handler?.onDelete) return;
    e.preventDefault();
    handler.onDelete();
  }
}
