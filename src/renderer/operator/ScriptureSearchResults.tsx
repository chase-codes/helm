import type { CSSProperties, JSX } from 'react';
import type { Theme } from '../../shared/theme';
import { highlightTokens } from '../../shared/search/highlight';
import { INSTALL_HINT } from '../../shared/scripture/labels';
import { ListEmpty } from './ListEmpty';

export interface PassageResultRow { key: string; title: string; meta: string }
export interface VerseResultRow { key: string; ref: string; text: string }

export interface ScriptureSearchState {
  query: string;
  tokens: string[];
  abbr: string;
  total: number;
  passages: PassageResultRow[];
  verses: VerseResultRow[];
  /** Index into the combined list: passages first, then verses. */
  highlighted: number;
  onHover: (index: number | null) => void;
  /** Single click: a PREVIEW — the caller moves the highlight and the cursor and leaves the
   * search open, so the row survives long enough for a double-click to land on it. Enter
   * (not click) is what commits the hit into the entry. */
  onPick: (index: number) => void;
  /** Double click: take this hit to the screen, via the idempotent take verb. */
  onActivate: (index: number) => void;
  noVersion: boolean;
  /** True once a reply for THIS query has landed. False while a search is still in flight —
   * the rows below may still be the previous query's, and an empty list means "not yet",
   * not "nothing matches", so the empty state waits for this. */
  settled: boolean;
}

const headerStyle = (T: Theme): CSSProperties => ({
  fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600, padding: '0 14px 6px', flexShrink: 0
});

const rowStyle = (T: Theme, highlighted: boolean): CSSProperties => ({
  display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%', textAlign: 'left',
  padding: '8px 11px', borderRadius: '11px', cursor: 'pointer', userSelect: 'none', gap: '2px',
  background: highlighted ? T.panel2 : 'transparent',
  boxShadow: highlighted ? `inset 0 0 0 1.5px ${T.scripture}` : 'none'
});

interface RowProps {
  index: number;
  title: string;
  body?: string;
  bodySegs?: { text: string; hit: boolean }[];
  theme: Theme;
  highlighted: boolean;
  onHover: (i: number | null) => void;
  onPick: (i: number) => void;
  onActivate: (i: number) => void;
}

/** Declared at module scope, NOT inside ScriptureSearchResults — an inline component is a
 * new type every render, so React would remount the list on each keystroke/hover and the
 * second half of a double-click would land on a detached node (see SongSearchRail's Row). */
function Row({ index, title, body, bodySegs, theme: T, highlighted, onHover, onPick, onActivate }: RowProps): JSX.Element {
  return (
    <button
      style={rowStyle(T, highlighted)}
      // Marks this as a RESULT row (the schedule's rows carry `data-schedule-row`): the ref
      // a hit shows also appears in the hero once the cursor lands on it, so a test looking
      // for "Luke 19:5" needs a way to mean this list and not the whole mode.
      data-search-row={index}
      data-highlighted={highlighted || undefined}
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPick(index)}
      onDoubleClick={() => onActivate(index)}
    >
      <div style={{ fontWeight: 600, fontSize: '13px', color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
      {body !== undefined && (
        <div style={{ fontSize: '11px', color: T.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{body}</div>
      )}
      {bodySegs && (
        <div style={{ fontSize: '11.5px', color: T.dim, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {bodySegs.map((s, i) => (s.hit ? <b key={i} data-hit style={{ color: T.text, fontWeight: 700 }}>{s.text}</b> : <span key={i}>{s.text}</span>))}
        </div>
      )}
    </button>
  );
}

export const SEARCH_VERSE_ROWS = 10;

export function ScriptureSearchResults({ theme: T, search: s }: { theme: Theme; search: ScriptureSearchState }): JSX.Element {
  const count = `${s.total} ${s.total === 1 ? 'VERSE' : 'VERSES'}${s.abbr ? ` · ${s.abbr}` : ''}`;
  const verses = s.verses.slice(0, SEARCH_VERSE_ROWS);
  // Only an ANSWERED query can be empty. While one is in flight the list area stays blank
  // rather than claiming "No verses match" for a query nothing has looked at yet.
  const nothing = s.settled && s.passages.length === 0 && verses.length === 0;
  return (
    <>
      <div style={headerStyle(T)}>{count}</div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {s.noVersion && nothing && <ListEmpty>{INSTALL_HINT}</ListEmpty>}
        {!s.noVersion && nothing && <ListEmpty>No verses match “{s.query.trim()}”.</ListEmpty>}
        {s.passages.length > 0 && <div style={{ ...headerStyle(T), padding: '4px 4px 2px' }}>PASSAGES</div>}
        {s.passages.map((p, i) => (
          <Row key={p.key} index={i} title={p.title} body={p.meta} theme={T} highlighted={s.highlighted === i}
            onHover={s.onHover} onPick={s.onPick} onActivate={s.onActivate} />
        ))}
        {s.passages.length > 0 && verses.length > 0 && <div style={{ ...headerStyle(T), padding: '8px 4px 2px' }}>VERSES</div>}
        {verses.map((v, j) => {
          const i = s.passages.length + j;
          return (
            <Row key={v.key} index={i} title={v.ref} bodySegs={highlightTokens(v.text, s.tokens)} theme={T}
              highlighted={s.highlighted === i} onHover={s.onHover} onPick={s.onPick} onActivate={s.onActivate} />
          );
        })}
      </div>
    </>
  );
}
