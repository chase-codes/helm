import { useContext, type CSSProperties, type JSX } from 'react';
import { ThemeCtx } from './ThemeCtx';
import { tintChip } from './railTint';

/** Function-component fallback so it can read the theme; values mirror ListEmpty (#88). */
export function ModeCrashCard({ label, onReload }: { label: string; onReload: () => void }): JSX.Element {
  const T = useContext(ThemeCtx);
  const cardStyle: CSSProperties = {
    margin: 'auto',
    padding: '18px 22px',
    borderRadius: '11px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    color: T.faint,
    fontSize: '12.5px',
    lineHeight: 1.5,
    textAlign: 'center'
  };
  const btnStyle: CSSProperties = {
    marginTop: '10px',
    padding: '6px 12px',
    borderRadius: '8px',
    ...tintChip(T.accent),
    fontSize: '11.5px',
    fontWeight: 600
  };
  return (
    <div style={cardStyle}>
      <div>The {label} page crashed — the rest of Helm is fine.</div>
      <button style={btnStyle} onClick={onReload}>Reload this page</button>
    </div>
  );
}
