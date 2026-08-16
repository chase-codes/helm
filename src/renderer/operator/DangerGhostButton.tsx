import { useContext, useState, type CSSProperties, type JSX } from 'react';
import { ThemeCtx } from './ThemeCtx';

export interface DangerGhostButtonProps {
  label: string;
  onClick: () => void;
  title?: string;
}

/**
 * A rail-header button for a destructive-but-recoverable action — "Clear all" (#86).
 *
 * It borrows the media rail's "+ Import" footprint deliberately: the most destructive
 * in-service control used to be a 10px text link, smaller and quieter than every harmless
 * button around it. Same size, same weight, same border as its neighbours; the only thing
 * that marks it as destructive is the `live`-tinted hover, which appears exactly when the
 * pointer is on it and about to commit.
 *
 * No confirmation dialog, on purpose. In-service surfaces never confirm — they undo, and
 * the caller routes this through the same remove-with-undo path as a row delete.
 *
 * Hover is React state rather than CSS `:hover` because every colour here comes from the
 * theme context, and the app styles inline throughout (see ContextMenu/QuickAdd for the
 * same pattern).
 */
export function DangerGhostButton({ label, onClick, title }: DangerGhostButtonProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const [hot, setHot] = useState(false);
  const style: CSSProperties = {
    height: '26px',
    padding: '0 10px',
    borderRadius: '8px',
    border: 'none',
    boxShadow: `inset 0 0 0 1px ${hot ? T.live : T.border}`,
    background: hot ? `${T.live}1c` : 'transparent',
    color: hot ? T.live : T.dim,
    fontSize: '12px',
    fontWeight: 600,
    whiteSpace: 'nowrap'
  };
  return (
    <button
      style={style}
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      // Keyboard focus gets the same warning colour a pointer hover does — otherwise the
      // one control that needs a "this is destructive" cue is the one control that loses
      // it when reached by Tab.
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
    >
      {label}
    </button>
  );
}
