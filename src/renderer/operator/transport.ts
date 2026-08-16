import type { CSSProperties } from 'react';
import type { Theme } from '../../shared/theme';

/** Both transport verbs are this wide in every state (#85). Fixed rather than
 * content-sized: "Go live", "Take down" and "⇄ Switch" all have to occupy the same
 * footprint, or the slot beside them moves as the state changes — and the bar's width
 * would become a function of the song library, which is what the issue is about. */
export const TRANSPORT_VERB_W = '150px';

/** The three looks a transport verb can wear:
 *  - `go`    — green, the only colour that ever means "put this on screen"
 *  - `down`  — the live tint, salmon-on-tinted rather than filled, so the panic control
 *              reads as urgent without out-shouting the primary verb (same `1c`/`55`
 *              formula the on-air bars use, borrowed from PreServiceMode)
 *  - `ghost` — nothing to do in this state; the slot holds its ground, disabled
 */
export type VerbKind = 'go' | 'down' | 'ghost';

export function primaryBtnStyle(T: Theme, kind: VerbKind): CSSProperties {
  const base: CSSProperties = {
    height: '46px',
    width: TRANSPORT_VERB_W,
    padding: '0 12px',
    borderRadius: '11px',
    fontSize: '14.5px',
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    whiteSpace: 'nowrap'
  };
  if (kind === 'go') return { ...base, background: T.go, color: '#fff' };
  if (kind === 'down') {
    return {
      ...base,
      background: `${T.live}1c`,
      boxShadow: `inset 0 0 0 1px ${T.live}55`,
      color: T.live
    };
  }
  return {
    ...base,
    background: 'transparent',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    color: T.faint,
    cursor: 'default'
  };
}

/** Prev / next. Content-sized on purpose — they sit LEFT of the flex spacer, so their
 * widths can't push the verbs around. */
export function transportGhostBtn(T: Theme): CSSProperties {
  return {
    height: '46px',
    padding: '0 16px',
    borderRadius: '11px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.hairline}`,
    fontSize: '14px',
    fontWeight: 600,
    color: T.dim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px'
  };
}

/** Sits between Take down and Go live: adjacent opposite verbs, so the gap has to be
 * wide enough that a hurried click can't land on the wrong one. */
export const verbDividerStyle = (T: Theme): CSSProperties => ({
  width: '1px',
  alignSelf: 'stretch',
  margin: '0 3px',
  background: T.hairline
});
