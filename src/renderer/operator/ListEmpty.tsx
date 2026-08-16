import { useContext, type CSSProperties, type JSX, type ReactNode } from 'react';
import { ThemeCtx } from './ThemeCtx';

export interface ListEmptyProps {
  /** One line: what this list is for, and the affordance that fills it. Name the control
   * in <b> so the eye lands on the thing to press. */
  children: ReactNode;
}

/**
 * The empty state every list rail shares (#88). An empty list is an invitation to act, so
 * the copy always says what would live here AND how to put something in it — never a bare
 * "Nothing yet".
 *
 * Values are the media library's, which is the one the design got right and the one the
 * other four were measured against; lifting them here rather than restyling per rail is
 * what stops the treatment drifting apart again.
 */
export function ListEmpty({ children }: ListEmptyProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const style: CSSProperties = {
    margin: '8px 2px',
    padding: '18px 14px',
    borderRadius: '11px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    color: T.faint,
    fontSize: '12.5px',
    lineHeight: 1.5,
    textAlign: 'center'
  };
  return <div style={style}>{children}</div>;
}
