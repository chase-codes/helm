import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import { ThemeCtx } from './ThemeCtx';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** Element to restore focus to when the menu closes (the right-click trigger). */
  restoreFocusTo?: HTMLElement | null;
}

/**
 * Cursor-positioned right-click menu. Renders null while closed. While open it focuses
 * itself and `stopPropagation`s the keys it handles, so App.tsx's global document keydown
 * delegate does NOT also step cues / go live / close settings — the menu owns the keyboard
 * only while visible, then hands control straight back on close (see the interaction-
 * primitives design, "fit, don't fight"). Theme comes from ThemeCtx (no theme prop) since
 * it is invoked from many call sites.
 */
export function ContextMenu({ open, x, y, items, onClose, restoreFocusTo }: ContextMenuProps): JSX.Element | null {
  const T = useContext(ThemeCtx);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const firstEnabled = items.findIndex((it) => !it.disabled);
  const [active, setActive] = useState(() => (firstEnabled === -1 ? 0 : firstEnabled));
  const [pos, setPos] = useState({ x, y });

  // Reset highlight to the first enabled item whenever the menu re-opens (or its item set
  // changes while open) — the initial mount is already covered by the lazy useState above.
  // Adjusted during render, not in an effect — React's documented "adjusting state when a
  // prop changes" pattern — so it takes effect in the same commit instead of triggering an
  // extra cascading render.
  const [seen, setSeen] = useState({ open, firstEnabled });
  if (seen.open !== open || seen.firstEnabled !== firstEnabled) {
    setSeen({ open, firstEnabled });
    if (open) setActive(firstEnabled === -1 ? 0 : firstEnabled);
  }

  // Clamp to the viewport once measured, flipping left/up when it would overflow.
  useLayoutEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 6;
    let nx = x;
    let ny = y;
    if (x + width + pad > window.innerWidth) nx = Math.max(pad, window.innerWidth - width - pad);
    if (y + height + pad > window.innerHeight) ny = Math.max(pad, window.innerHeight - height - pad);
    setPos({ x: nx, y: ny });
  }, [open, x, y, items]);

  // Move DOM focus into the menu on open; restore to the trigger on close.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.focus();
    return () => {
      restoreFocusTo?.focus?.();
    };
  }, [open, restoreFocusTo]);

  // Any scroll / resize / window blur dismisses the menu (its anchor point is now stale).
  useEffect(() => {
    if (!open) return;
    const dismiss = (): void => onClose();
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [open, onClose]);

  if (!open) return null;

  const activate = (it: ContextMenuItem): void => {
    if (it.disabled) return;
    onClose();
    it.onSelect();
  };

  const step = (dir: 1 | -1): void => {
    setActive((cur) => {
      const n = items.length;
      let i = cur;
      for (let k = 0; k < n; k++) {
        i = (i + dir + n) % n;
        if (!items[i].disabled) return i;
      }
      return cur;
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      step(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      setActive(firstEnabled === -1 ? 0 : firstEnabled);
    } else if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i].disabled) {
          setActive(i);
          break;
        }
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      const it = items[active];
      if (it) activate(it);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else {
      // While the menu owns focus, no key should reach App's document-level delegate
      // (e.g. Delete/Backspace must not fall through to ModeKeyHandler.onDelete while
      // a menu is open) — only stop propagation, don't preventDefault an unhandled key.
      e.stopPropagation();
    }
  };

  const scrimStyle: CSSProperties = { position: 'fixed', inset: 0, zIndex: 60 };
  const menuStyle: CSSProperties = {
    position: 'fixed',
    top: `${pos.y}px`,
    left: `${pos.x}px`,
    zIndex: 61,
    minWidth: '168px',
    background: T.panel3,
    borderRadius: '10px',
    padding: '5px',
    boxShadow: `0 18px 50px rgba(0,0,0,.45), inset 0 0 0 1px ${T.border}`,
    outline: 'none'
  };
  const itemStyle = (it: ContextMenuItem, i: number): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: '7px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: it.disabled ? 'default' : 'pointer',
    opacity: it.disabled ? 0.4 : 1,
    color: it.danger ? T.live : T.text,
    background: i === active && !it.disabled ? (it.danger ? `${T.live}1c` : T.panel2) : 'transparent'
  });

  return (
    <>
      <div
        style={scrimStyle}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div ref={menuRef} role="menu" tabIndex={-1} style={menuStyle} onKeyDown={onKeyDown}>
        {items.map((it, i) => (
          <button
            key={i}
            role="menuitem"
            aria-disabled={it.disabled || undefined}
            data-danger={it.danger || undefined}
            tabIndex={-1}
            style={itemStyle(it, i)}
            onMouseEnter={() => !it.disabled && setActive(i)}
            onClick={() => activate(it)}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}
