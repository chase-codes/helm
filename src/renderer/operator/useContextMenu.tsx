import { useCallback, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  trigger: HTMLElement | null;
}

const CLOSED: MenuState = { open: false, x: 0, y: 0, items: [], trigger: null };

export interface UseContextMenu {
  /** Wire to `onContextMenu`; preventDefaults, anchors at the cursor, remembers the trigger. */
  open: (e: ReactMouseEvent, items: ContextMenuItem[]) => void;
  /** Swap the open menu's items without moving or closing it — how a `keepOpen` item
   * re-labels itself for a two-step confirm. A no-op while closed, so a late timer that
   * meant to disarm a confirm can fire harmlessly. */
  update: (items: ContextMenuItem[]) => void;
  close: () => void;
  /** Drop into JSX once; renders null while closed. */
  menu: JSX.Element;
}

/**
 * Owns context-menu state and rendering so a consumer wires it in ~3 lines:
 *   const { open, menu } = useContextMenu();
 *   <Row onContextMenu={(e) => open(e, [{ label: 'Edit', onSelect }])} /> ... {menu}
 */
export function useContextMenu(): UseContextMenu {
  const [state, setState] = useState<MenuState>(CLOSED);
  const open = useCallback((e: ReactMouseEvent, items: ContextMenuItem[]): void => {
    e.preventDefault();
    setState({ open: true, x: e.clientX, y: e.clientY, items, trigger: e.currentTarget as HTMLElement });
  }, []);
  const update = useCallback((items: ContextMenuItem[]): void => {
    setState((s) => (s.open ? { ...s, items } : s));
  }, []);
  const close = useCallback((): void => setState((s) => ({ ...CLOSED, trigger: s.trigger })), []);
  const menu = (
    <ContextMenu open={state.open} x={state.x} y={state.y} items={state.items} onClose={close} restoreFocusTo={state.trigger} />
  );
  return { open, update, close, menu };
}
