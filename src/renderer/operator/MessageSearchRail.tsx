import type { CSSProperties, JSX, KeyboardEvent } from 'react';
import type { Theme } from '../../shared/theme';
import { norm } from '../../shared/search/fuzzy';

export interface MsgScheduleRow {
  id: string;
  title: string;
  meta: string;
  isCurrent: boolean;
  onClick: () => void;
}
export interface MsgTapeRow {
  id: string;
  title: string;
  meta: string;
  onClick: () => void;
}
export interface MsgQuoteRow {
  id: string;
  title: string;
  preview: string;
  onClick: () => void;
}

export interface MessageSearchRailProps {
  theme: Theme;
  q: string;
  onQChange: (q: string) => void;
  /** Chip label when scoped to a tape (its title), else null — drives the `›` vs chip
   * chrome in the search box (Lectern.pretty.html:210-218). */
  scopeLabel: string | null;
  onClearScope: () => void;
  tapeRows: MsgTapeRow[];
  quoteRows: MsgQuoteRow[];
  scheduleRows: MsgScheduleRow[];
  /** Slot for Task 12's tape player card — rendered as-is at the bottom of the rail,
   * omitted entirely when null (this task has no player yet). */
  tapePlayer: JSX.Element | null;
}

/** Body of the Message track's left rail: scope chip + search box, TAPES/QUOTES search
 * results (or the QUOTE SCHEDULE list when the box is empty), and the tape-player slot.
 * Rendered beneath TrackTabs inside MessageMode's single rail panel (no panel chrome
 * of its own — MessageMode owns that, matching SchedulePanel's shape for the other
 * tracks). Ported character-exact from Lectern.pretty.html:207-281 / 1294-1313. */
export function MessageSearchRail({
  theme: T,
  q,
  onQChange,
  scopeLabel,
  onClearScope,
  tapeRows,
  quoteRows,
  scheduleRows,
  tapePlayer
}: MessageSearchRailProps): JSX.Element {
  const schedInputStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    height: '42px',
    padding: '0 12px',
    background: T.inputBg,
    borderRadius: '10px',
    boxShadow: `inset 0 0 0 1px ${T.border}`
  };
  const msgChipStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    height: '24px',
    padding: '0 8px',
    borderRadius: '7px',
    background: `${T.message}22`,
    color: T.message,
    fontSize: '11px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    maxWidth: '120px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flexShrink: 0,
    cursor: 'pointer'
  };
  const sectionHeaderStyle = (padding: string): CSSProperties => ({ fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600, padding, flexShrink: 0 });
  const scrollWrapStyle: CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' };
  const tapeIconStyle: CSSProperties = {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: '13px',
    color: T.message,
    background: `${T.message}22`
  };
  const scheduleIconStyle: CSSProperties = { ...tapeIconStyle, fontSize: '14px' };
  const tapeRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 11px', borderRadius: '11px', cursor: 'pointer', background: T.panel2, boxShadow: `inset 0 0 0 1px ${T.hairline}` };
  const scheduleRowStyle = (isCurrent: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '10px 11px',
    borderRadius: '11px',
    cursor: 'pointer',
    background: isCurrent ? T.panel3 : 'transparent',
    boxShadow: isCurrent ? `inset 0 0 0 1px ${T.message}55` : 'none'
  });
  const quoteRowStyle: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: '11px', cursor: 'pointer', background: T.panel2, boxShadow: `inset 0 0 0 1px ${T.hairline}` };
  const quoteTitleStyle: CSSProperties = { fontWeight: 600, fontSize: '12.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const quotePreviewStyle: CSSProperties = {
    fontSize: '12px',
    lineHeight: 1.42,
    color: T.dim,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    marginTop: '3px'
  };
  const rowTitleStyle: CSSProperties = { fontWeight: 600, fontSize: '13.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const tapeRowTitleStyle: CSSProperties = { ...rowTitleStyle, fontSize: '13px' };
  const rowMetaStyle: CSSProperties = { fontSize: '11px', color: T.faint, marginTop: '1px' };
  const emptyStyle: CSSProperties = { padding: '12px 8px', color: T.faint, fontSize: '12.5px', lineHeight: 1.5 };

  const hasSearch = !!norm(q);
  const hasTapeMatches = hasSearch && tapeRows.length > 0;
  const hasQuoteMatches = hasSearch && quoteRows.length > 0;
  const searchEmpty = hasSearch && !hasTapeMatches && !hasQuoteMatches;
  const quotesHeader = scopeLabel ? 'QUOTES IN THIS TAPE' : 'QUOTES';
  const placeholder = scopeLabel ? 'Search within this tape…' : 'Search tapes & quotes…';

  const onQKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Backspace' && !q && scopeLabel) onClearScope();
  };

  return (
    <>
      <div style={{ padding: '0 12px 10px', flexShrink: 0 }}>
        <div style={schedInputStyle}>
          {scopeLabel ? (
            <button style={msgChipStyle} onClick={onClearScope} title="Searching within this tape — click to search everything">
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scopeLabel}</span>
              <span>&#10005;</span>
            </button>
          ) : (
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '14px', color: T.message }}>&rsaquo;</span>
          )}
          <input
            style={{ flex: 1, fontSize: '13.5px', minWidth: 0 }}
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            onKeyDown={onQKeyDown}
            placeholder={placeholder}
          />
        </div>
      </div>

      {hasSearch ? (
        <div style={scrollWrapStyle}>
          {hasTapeMatches && (
            <>
              <div style={sectionHeaderStyle('2px 4px 2px')}>TAPES — SELECT TO SEARCH WITHIN</div>
              {tapeRows.map((t) => (
                <button key={t.id} style={tapeRowStyle} onClick={t.onClick}>
                  <div style={tapeIconStyle}>&#9656;</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={tapeRowTitleStyle}>{t.title}</div>
                    <div style={rowMetaStyle}>{t.meta}</div>
                  </div>
                </button>
              ))}
            </>
          )}
          {hasQuoteMatches && (
            <>
              <div style={sectionHeaderStyle('6px 4px 2px')}>{quotesHeader}</div>
              {quoteRows.map((r) => (
                <button key={r.id} style={quoteRowStyle} onClick={r.onClick}>
                  <div style={quoteTitleStyle}>{r.title}</div>
                  <div style={quotePreviewStyle}>{r.preview}</div>
                </button>
              ))}
            </>
          )}
          {searchEmpty && <div style={emptyStyle}>No matches — try fewer words, or clear the tape scope.</div>}
        </div>
      ) : (
        <>
          <div style={sectionHeaderStyle('0 14px 8px')}>QUOTE SCHEDULE</div>
          <div style={scrollWrapStyle}>
            {scheduleRows.map((r) => (
              <button key={r.id} style={scheduleRowStyle(r.isCurrent)} onClick={r.onClick}>
                <div style={scheduleIconStyle}>&#10077;</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={rowTitleStyle}>{r.title}</div>
                  <div style={rowMetaStyle}>{r.meta}</div>
                </div>
                {r.isCurrent && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: T.live, flexShrink: 0 }} />}
              </button>
            ))}
          </div>
        </>
      )}

      {tapePlayer}
    </>
  );
}
