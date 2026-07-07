import { useContext, type CSSProperties, type JSX } from 'react';
import { ThemeCtx } from './ThemeCtx';

export interface UndoToastProps {
  label: string;
  onUndo: () => void;
}

/** Transient "Removed <label> — Undo" bar. Track-agnostic: drop it into any list panel. */
export function UndoToast({ label, onUndo }: UndoToastProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const barStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    margin: '0 12px 12px',
    padding: '9px 11px',
    borderRadius: '9px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    flexShrink: 0
  };
  return (
    <div style={barStyle}>
      <span style={{ flex: 1, fontSize: '12px', color: T.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        Removed {label}
      </span>
      <button style={{ fontSize: '12px', fontWeight: 700, color: T.scripture, padding: '2px 4px' }} onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}
