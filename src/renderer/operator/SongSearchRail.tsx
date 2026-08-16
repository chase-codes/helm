import { useState, type CSSProperties, type JSX, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import type { Theme } from '../../shared/theme';
import type { SearchField } from '../../shared/types';
import { ImportIcon, SearchIcon } from '../shared/icons';
import { ListEmpty } from './ListEmpty';

export interface SongRow {
  id: string;
  title: string;
  author: string;
  snippet: string;
  hasSnippet: boolean;
  isActive: boolean;
  isArmed: boolean;
}

const FIELD_TABS: Array<{ id: SearchField; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'title', label: 'Title' },
  { id: 'lyric', label: 'Lyric' }
];

export interface SongSearchRailProps {
  theme: Theme;
  width: number;
  q: string;
  setQ: (q: string) => void;
  field: SearchField;
  setField: (f: SearchField) => void;
  rows: SongRow[];
  secondaryRows?: SongRow[];
  noResults: boolean;
  emptyText: string;
  /** True when the library holds no songs at all — a different message from "no match for
   * that query", because there is nothing here to search yet (#88). */
  libraryEmpty: boolean;
  /** True while a song holds the screen. A click on a row then means arm / disarm /
   * back-to-base rather than plain select, so the rows forecast which one on hover (#89). */
  locked?: boolean;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onSelect: (id: string) => void;
  /** Double-click: take this song live at section 0 (#58). Distinct from `onSelect`,
   * which arms rather than takes while another song holds the screen. */
  onActivate: (id: string) => void;
  onAddSong: () => void;
  onImportSongs: () => void;
  onRowContextMenu?: (id: string, e: ReactMouseEvent) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}

const cueBadgeStyle = (T: Theme, ghost: boolean): CSSProperties => ({
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: '9px',
  letterSpacing: '0.08em',
  fontWeight: 700,
  color: T.accent,
  opacity: ghost ? 0.45 : 1,
  flexShrink: 0,
  marginTop: '4px'
});

interface RowProps {
  r: SongRow;
  theme: Theme;
  locked: boolean;
  hovered: boolean;
  style: CSSProperties;
  snippetStyle: CSSProperties;
  activeBadgeStyle: CSSProperties;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onActivate: (id: string) => void;
  onRowContextMenu?: (id: string, e: ReactMouseEvent) => void;
}

/** One renderer for both the primary rows and the "also in lyrics" rows: a click means the
 * same thing on each, so the forecast has to appear on each (#89).
 *
 * Declared at module scope, NOT inside SongSearchRail. A component defined in a render body
 * is a new type on every render, so React unmounts and remounts the whole list each time —
 * which drops the node a pointer sequence is midway through (the second half of a
 * double-click lands on a detached button and never fires; see MessageMode's search rail
 * for the same bug found the hard way). */
function Row({
  r,
  theme: T,
  locked,
  hovered,
  style,
  snippetStyle,
  activeBadgeStyle,
  onHover,
  onSelect,
  onActivate,
  onRowContextMenu
}: RowProps): JSX.Element {
  // While a song is live, a click on the live row returns to base, a click on the armed row
  // clears it, and a click anywhere else arms. Only the third has anything to forecast — the
  // other two get a tooltip and no chip, since a badge that appears on hover and then does
  // nothing is worse than none.
  const isLiveRow = locked && r.isActive;
  const canArm = locked && !isLiveRow && !r.isArmed;
  return (
    <button
      style={style}
      onClick={() => onSelect(r.id)}
      onDoubleClick={() => onActivate(r.id)}
      onContextMenu={(e) => onRowContextMenu?.(r.id, e)}
      onMouseEnter={() => onHover(r.id)}
      onMouseLeave={() => onHover(null)}
      title={
        r.isArmed
          ? 'Clear this — nothing queued next'
          : isLiveRow
            ? 'Already on screen'
            : locked
              ? 'Queue this up next'
              : undefined
      }
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: '13px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: r.isActive ? T.accent : T.text
          }}
        >
          {r.title}
        </div>
        <div style={{ fontSize: '11px', color: T.faint, marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.author}
        </div>
        {r.hasSnippet && <div style={snippetStyle}>&ldquo;{r.snippet}&rdquo;</div>}
      </div>
      {/* The armed badge dims under the cursor rather than swapping copy: the row it sits on
          is the one whose click REMOVES it, and a badge that reads the same but looks spent
          says that without a second word to read. */}
      {r.isArmed && <div style={cueBadgeStyle(T, hovered)}>NEXT</div>}
      {canArm && hovered && <div style={cueBadgeStyle(T, true)}>NEXT?</div>}
      {r.isActive && <div style={activeBadgeStyle}>●</div>}
    </button>
  );
}

export function SongSearchRail({
  theme: T,
  width,
  q,
  setQ,
  field,
  setField,
  rows,
  secondaryRows,
  noResults,
  emptyText,
  libraryEmpty,
  onKeyDown,
  onSelect,
  onActivate,
  onAddSong,
  onImportSongs,
  locked,
  onRowContextMenu,
  inputRef
}: SongSearchRailProps): JSX.Element {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const opRailStyle: CSSProperties = {
    width: `${width}px`,
    flexShrink: 0,
    background: T.panel,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0
  };
  const opSearchBoxStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '38px',
    padding: '0 11px',
    background: T.inputBg,
    borderRadius: '9px',
    boxShadow: `inset 0 0 0 1px ${T.border}`
  };
  const songFieldWrapStyle: CSSProperties = {
    display: 'flex',
    gap: '3px',
    background: T.panel2,
    padding: '3px',
    borderRadius: '9px',
    marginTop: '7px'
  };
  const fieldTabStyle = (active: boolean): CSSProperties => ({
    flex: 1,
    height: '24px',
    borderRadius: '7px',
    fontSize: '11px',
    fontWeight: active ? 700 : 600,
    color: active ? T.accentInk : T.faint,
    background: active ? T.accent : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  });
  const rowStyle = (active: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    width: '100%',
    padding: '9px 10px',
    borderRadius: '10px',
    cursor: 'pointer',
    marginBottom: '2px',
    background: active ? T.selBg : 'transparent',
    boxShadow: active ? `inset 0 0 0 1px ${T.accent}66` : 'none',
    userSelect: 'none'
  });
  const snippetStyle: CSSProperties = {
    fontSize: '11px',
    color: T.dim,
    marginTop: '4px',
    fontStyle: 'italic',
    lineHeight: 1.35,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical'
  };
  const activeBadgeStyle: CSSProperties = { fontSize: '10px', color: T.accent, flexShrink: 0, marginTop: '3px' };
  const addChipStyle: CSSProperties = {
    width: '100%',
    height: '34px',
    marginTop: '8px',
    padding: '0 10px',
    borderRadius: '9px',
    background: `${T.accent}22`,
    color: T.accent,
    fontSize: '12.5px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };
  const importRowStyle: CSSProperties = {
    width: '100%',
    height: '26px',
    marginTop: '5px',
    borderRadius: '8px',
    fontSize: '11.5px',
    fontWeight: 600,
    color: T.faint,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent'
  };

  const placeholder = field === 'title' ? 'Search titles…' : field === 'lyric' ? 'Search a lyric line…' : 'Title or a lyric line…';

  const row = (r: SongRow): JSX.Element => (
    <Row
      key={r.id}
      r={r}
      theme={T}
      locked={!!locked}
      hovered={hoveredId === r.id}
      style={{ ...rowStyle(r.isActive), ...(r.isArmed ? { boxShadow: `inset 0 0 0 2px ${T.accent}` } : {}) }}
      snippetStyle={snippetStyle}
      activeBadgeStyle={activeBadgeStyle}
      onHover={setHoveredId}
      onSelect={onSelect}
      onActivate={onActivate}
      onRowContextMenu={onRowContextMenu}
    />
  );

  return (
    <div style={opRailStyle}>
      <div style={{ padding: '13px 13px 9px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '9px' }}>
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: T.scripture, display: 'inline-block' }} />
          <span style={{ fontSize: '10px', letterSpacing: '0.12em', color: T.faint, fontWeight: 600 }}>OPERATOR · FIND A SONG</span>
        </div>
        <div style={opSearchBoxStyle}>
          <span style={{ display: 'inline-flex', opacity: 0.5 }}>
            <SearchIcon size={15} />
          </span>
          <input
            ref={inputRef}
            style={{ flex: 1, minWidth: 0, fontSize: '13.5px' }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
          />
          {!!q && (
            <button style={{ fontSize: '12px', color: T.dim, padding: '4px' }} onClick={() => setQ('')}>
              ✕
            </button>
          )}
        </div>
        <div style={songFieldWrapStyle}>
          {FIELD_TABS.map((ft) => (
            <button key={ft.id} style={fieldTabStyle(field === ft.id)} onClick={() => setField(ft.id)}>
              {ft.label}
            </button>
          ))}
        </div>
        <button style={addChipStyle} onClick={onAddSong}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {q.trim() ? `+ Add “${q.trim()}” as a new song` : '+ Add a song'}
          </span>
        </button>
        <button style={{ ...importRowStyle, display: 'inline-flex', alignItems: 'center', gap: '7px' }} onClick={onImportSongs}>
          <ImportIcon size={14} /> Import a song library
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 10px' }}>
        {libraryEmpty && rows.length === 0 && !noResults && (
          // Both affordances it names are already in the header above, so the line only
          // has to point at them.
          <ListEmpty>
            No songs yet — add one with <b>+ Add a song</b>, or bring your existing set in
            with <b>Import a song library</b>.
          </ListEmpty>
        )}
        {rows.map(row)}
        {!!secondaryRows?.length && (
          <>
            <div style={{ fontSize: '10px', letterSpacing: '0.12em', color: T.faint, fontWeight: 600, margin: '10px 2px 6px' }}>
              ALSO IN LYRICS
            </div>
            <div style={{ opacity: 0.72 }}>{secondaryRows.map(row)}</div>
          </>
        )}
        {noResults && <div style={{ padding: '14px 8px', color: T.faint, fontSize: '12.5px', lineHeight: 1.5 }}>{emptyText}</div>}
      </div>
    </div>
  );
}
