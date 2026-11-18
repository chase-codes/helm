import { useContext, type CSSProperties, type JSX } from 'react';
import type { MusicKey } from '../../shared/songs/musicKey';
import { useWindowedList } from '../shared/useWindowedList';
import { MONO } from '../shared/fonts';
import { ThemeCtx } from './ThemeCtx';

// The one review list for keys found in titles (song keys spec, Phase 1d): the Song keys
// window's `Move keys out of titles` and the import's `See them` both show it. Each row reads
// title, then key, then the title it gets, and has a checkbox. It is the look-first step
// before a batch (grammar rule 4), not a dialog: nothing is written from here.
//
// One fixed line per row, windowed (a library can hold thousands): the window is arithmetic
// on ROW_H, so nothing in a row may wrap (rule 5).

export interface TitleKeyReviewRow {
  id: string;
  title: string;
  /** The title once the key moves out; equal to `title` when the title stays. */
  cleanTitle: string;
  /** The key offered. Absent (two keys): nothing to move, so the row cannot be checked. */
  key?: MusicKey;
  /** A modulation's end key, shown after the start key. */
  endKey?: MusicKey;
  /** Held back for a person to look at: starts unchecked (the caller puts these first). */
  flagged: boolean;
  /** Why it is held back, or what is different about it, in plain words; '' for none. */
  note: string;
}

const ROW_GAP = 3;
const ROW_H = 34 + ROW_GAP;

export interface TitleKeyReviewProps {
  /** In display order: the caller puts flagged rows first. */
  rows: TitleKeyReviewRow[];
  checked: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

export function TitleKeyReview({ rows, checked, onToggle }: TitleKeyReviewProps): JSX.Element {
  const T = useContext(ThemeCtx);
  // Destructured: the React compiler reads `win.setEl` on an object as a ref access.
  const { setEl: setScrollEl, onScroll, start, end, topPad, bottomPad } = useWindowedList(rows.length, ROW_H);
  const clip: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };
  const rowStyle = (on: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    height: `${ROW_H - ROW_GAP}px`,
    marginBottom: `${ROW_GAP}px`,
    padding: '0 10px',
    boxSizing: 'border-box',
    borderRadius: '8px',
    background: T.panel2,
    fontSize: '13px',
    color: on ? T.text : T.dim,
    cursor: 'pointer',
    userSelect: 'none'
  });
  const keyStyle: CSSProperties = { ...clip, width: '62px', flexShrink: 0, fontFamily: MONO, fontSize: '12px', color: T.text };
  const head: CSSProperties = { ...clip, fontSize: '11px', color: T.faint, letterSpacing: '0.04em' };
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: '10px', padding: '0 10px 6px', flexShrink: 0 }} aria-hidden>
        <span style={{ width: '16px', flexShrink: 0 }} />
        <span style={{ ...head, flex: 1 }}>TITLE NOW</span>
        <span style={{ ...head, width: '62px', flexShrink: 0 }}>KEY</span>
        <span style={{ ...head, flex: 1 }}>TITLE AFTER</span>
        <span style={{ ...head, width: '190px', flexShrink: 0 }} />
      </div>
      <div ref={setScrollEl} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} data-title-key-list>
        <div style={{ height: `${topPad}px` }} />
        {rows.slice(start, end).map((r) => {
          const on = checked.has(r.id);
          const after = on && r.key ? r.cleanTitle : r.title;
          return (
            <label key={r.id} style={rowStyle(on)} data-title-key-row={r.id}>
              <input
                type="checkbox"
                checked={on}
                disabled={!r.key}
                onChange={() => onToggle(r.id)}
                aria-label={`Move the key out of ${r.title}`}
                style={{ width: '16px', height: '16px', flexShrink: 0, margin: 0, accentColor: T.accent }}
              />
              <span style={{ ...clip, flex: 1 }} title={r.title}>
                {r.title}
              </span>
              <span style={keyStyle}>{r.key ? (r.endKey ? `${r.key} → ${r.endKey}` : r.key) : '—'}</span>
              <span style={{ ...clip, flex: 1, color: on ? T.text : T.faint }} title={after}>
                {after}
              </span>
              <span style={{ ...clip, width: '190px', flexShrink: 0, fontSize: '12px', color: T.dim }} data-title-key-note>
                {r.note}
              </span>
            </label>
          );
        })}
        <div style={{ height: `${bottomPad}px` }} />
      </div>
    </div>
  );
}
