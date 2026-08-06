import { useContext, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import { ThemeCtx } from './ThemeCtx';

export interface PanelDividerProps {
  active: boolean;
  onMouseDown: (e: ReactMouseEvent) => void;
  hit?: number;
  title?: string;
  background?: string;
}

/** Drag handle between an operator side rail and the center pane. Pure presentation:
 *  width state and drag mechanics live in usePanelWidth. */
export function PanelDivider({ active, onMouseDown, hit = 10, title = 'Drag to resize', background = 'transparent' }: PanelDividerProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const wrapStyle: CSSProperties = {
    width: `${hit}px`,
    flexShrink: 0,
    cursor: 'col-resize',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '6px',
    background,
  };
  const gripStyle: CSSProperties = {
    width: '3px',
    height: '44px',
    borderRadius: '2px',
    background: active ? T.accent : T.border,
  };
  return (
    <div style={wrapStyle} title={title} onMouseDown={onMouseDown}>
      <div style={gripStyle} />
    </div>
  );
}
