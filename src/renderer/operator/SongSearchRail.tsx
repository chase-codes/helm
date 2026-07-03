import type { CSSProperties, JSX, KeyboardEvent } from 'react';
import type { Theme } from '../../shared/theme';
import type { SearchField } from '../../shared/types';

export interface SongRow {
  id: string;
  title: string;
  author: string;
  snippet: string;
  hasSnippet: boolean;
  isActive: boolean;
}

const FIELD_TABS: Array<{ id: SearchField; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'title', label: 'Title' },
  { id: 'lyric', label: 'Lyric' }
];

export interface SongSearchRailProps {
  theme: Theme;
  dark: boolean;
  width: number;
  q: string;
  setQ: (q: string) => void;
  field: SearchField;
  setField: (f: SearchField) => void;
  rows: SongRow[];
  noResults: boolean;
  emptyText: string;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onSelect: (id: string) => void;
}

export function SongSearchRail({
  theme: T,
  dark,
  width,
  q,
  setQ,
  field,
  setField,
  rows,
  noResults,
  emptyText,
  onKeyDown,
  onSelect
}: SongSearchRailProps): JSX.Element {
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
    background: active ? (dark ? '#221d10' : '#f3e6cd') : 'transparent',
    boxShadow: active ? `inset 0 0 0 1px ${T.accent}66` : 'none'
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
  const pasteSongStyle: CSSProperties = {
    width: '100%',
    height: '42px',
    marginTop: '8px',
    borderRadius: '11px',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    border: 'none',
    color: T.dim,
    fontSize: '13.5px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent'
  };

  const placeholder = field === 'title' ? 'Search titles…' : field === 'lyric' ? 'Search a lyric line…' : 'Title or a lyric line…';

  return (
    <div style={opRailStyle}>
      <div style={{ padding: '13px 13px 9px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '9px' }}>
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: T.scripture, display: 'inline-block' }} />
          <span style={{ fontSize: '10px', letterSpacing: '0.12em', color: T.faint, fontWeight: 600 }}>OPERATOR · FIND A SONG</span>
        </div>
        <div style={opSearchBoxStyle}>
          <span style={{ fontSize: '15px', opacity: 0.5 }}>⌕</span>
          <input
            style={{ flex: 1, fontSize: '13.5px' }}
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
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 10px' }}>
        {rows.map((r) => (
          <button key={r.id} style={rowStyle(r.isActive)} onClick={() => onSelect(r.id)}>
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
            {r.isActive && <div style={activeBadgeStyle}>●</div>}
          </button>
        ))}
        {noResults && <div style={{ padding: '14px 8px', color: T.faint, fontSize: '12.5px', lineHeight: 1.5 }}>{emptyText}</div>}
        <button style={pasteSongStyle} onClick={() => {}}>
          + Add a song — search or paste
        </button>
      </div>
    </div>
  );
}
