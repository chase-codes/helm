import type { CSSProperties, JSX, KeyboardEvent, MouseEvent as ReactMouseEvent, Ref } from 'react';
import type { Theme } from '../../shared/theme';
import { norm } from '../../shared/search/fuzzy';
import { ListEmpty } from './ListEmpty';
import { DangerGhostButton } from './DangerGhostButton';
import { UndoToast } from './UndoToast';
import { MONO } from '../shared/fonts';
import { scheduleRowStyle } from './railTint';
import { QueuedBadge, RowStateMark } from './StateBadge';
import { RowNumber } from './RowNumber';

export interface MsgScheduleRow {
  id: string;
  title: string;
  meta: string;
  isCurrent: boolean;
  /** In the delete-selection (#90) — distinct from `isCurrent`, which is the cued quote. */
  isSelected: boolean;
  /** The quote holds the audience screen (rule 1: red ring + LIVE). */
  isLive: boolean;
  /** Lined up behind the live quote (decision 7). */
  isQueued: boolean;
  /** Receives the event so the caller can branch on shiftKey for range selection. */
  onClick: (e: ReactMouseEvent) => void;
  /** Double-click: take this row's quote live (#58). */
  onDoubleClick: (e: ReactMouseEvent) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}
export interface MsgTapeRow {
  id: string;
  title: string;
  meta: string;
  onClick: () => void;
  /** Double-click: take this row's quote live (#58). */
  onDoubleClick: () => void;
}
export interface MsgQuoteRow {
  id: string;
  title: string;
  preview: string;
  /** Lined up behind the live quote of the same tape; Go live takes it. */
  isQueued?: boolean;
  onClick: () => void;
  /** Double-click: take this row's quote live (#58). */
  onDoubleClick: () => void;
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
  /** "Deleted …" bar with Undo for a quote-schedule delete (#86); same 5s grammar as the
   * scripture and media rails. */
  undo?: { label: string; onUndo: () => void };
  /** False when no tapes are installed at all — the empty schedule then points at the
   * import rather than at a search box that can't match anything (#88). */
  hasTapes: boolean;
  /** Opens Settings, where message import lives — the affordance the empty state names. */
  onImportMessages: () => void;
  /** The quote schedule's add chip: files the cued paragraph, as Scripture's `+ Add <ref>`
   * files the cued verse. Null while no tape is loaded. `planned` ghosts it in place (same
   * footprint, rule 5) when that paragraph is already in the schedule. */
  add?: { label: string; onAdd: () => void; planned: boolean } | null;
  /** Clear-schedule control (#86), same as Scripture's: renders only with rows, and the
   * caller routes it through the same removeMany + undo as a row delete. */
  onClearAll?: () => void;
  /** The search input, so the page's `/` key can focus it (grammar rule 9). */
  inputRef?: Ref<HTMLInputElement>;
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
  tapePlayer,
  undo,
  hasTapes,
  onImportMessages,
  add,
  onClearAll,
  inputRef
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
  const tapeRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 11px', borderRadius: '11px', cursor: 'pointer', background: T.panel2, boxShadow: `inset 0 0 0 1px ${T.hairline}`, userSelect: 'none' };
  // Songs' import row: the secondary action under the add chip. The list header's right
  // slot is Clear all's, as on Scripture.
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
  // Scripture's add chip (SchedulePanel's schedAddStyle) in the message colour.
  const addChipStyle = (planned: boolean): CSSProperties => ({
    width: '100%',
    height: '34px',
    marginTop: '8px',
    borderRadius: '9px',
    background: `${T.message}22`,
    color: T.message,
    fontSize: '12.5px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 10px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    opacity: planned ? 0.45 : 1,
    cursor: planned ? 'default' : 'pointer'
  });
  const quoteRowStyle: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: '11px', cursor: 'pointer', background: T.panel2, boxShadow: `inset 0 0 0 1px ${T.hairline}`, userSelect: 'none' };
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
    else if (e.key === 'Escape' && q) {
      // One key, one action, as in the Songs and Scripture boxes: a non-empty query consumes
      // the press (clear only); the next press reaches the page ladder, which blurs.
      e.stopPropagation();
      onQChange('');
    }
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
            <span style={{ fontFamily: MONO, fontSize: '14px', color: T.message }}>&rsaquo;</span>
          )}
          <input
            ref={inputRef}
            style={{ flex: 1, fontSize: '13.5px', minWidth: 0 }}
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            onKeyDown={onQKeyDown}
            placeholder={placeholder}
          />
        </div>
        {add && (
          <button
            style={addChipStyle(add.planned)}
            onClick={add.onAdd}
            disabled={add.planned}
            title={add.planned ? 'Already in the quote schedule' : undefined}
          >
            {add.label}
          </button>
        )}
        <button style={importRowStyle} onClick={onImportMessages}>
          + Import
        </button>
      </div>

      {hasSearch ? (
        <div style={scrollWrapStyle}>
          {hasTapeMatches && (
            <>
              <div style={sectionHeaderStyle('2px 4px 2px')}>TAPES — SELECT TO SEARCH WITHIN</div>
              {tapeRows.map((t) => (
                <button key={t.id} style={tapeRowStyle} onClick={t.onClick} onDoubleClick={t.onDoubleClick}>
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
                <button key={r.id} style={quoteRowStyle} onClick={r.onClick} onDoubleClick={r.onDoubleClick}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ ...quoteTitleStyle, flex: 1, minWidth: 0 }}>{r.title}</div>
                    {r.isQueued && <QueuedBadge accent={T.message} />}
                  </div>
                  <div style={quotePreviewStyle}>{r.preview}</div>
                </button>
              ))}
            </>
          )}
          {searchEmpty && <div style={emptyStyle}>No matches — try fewer words, or clear the tape scope.</div>}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 8px', flexShrink: 0 }}>
            <div style={{ ...sectionHeaderStyle(''), minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title="Quote schedule">
              QUOTE SCHEDULE
            </div>
            {onClearAll && scheduleRows.length > 0 && (
              <DangerGhostButton
                label="Clear all"
                onClick={onClearAll}
                title="Delete every quote, undoable for five seconds"
              />
            )}
          </div>
          <div style={scrollWrapStyle}>
            {scheduleRows.length === 0 &&
              (hasTapes ? (
                // Names the chip at the top of the rail (#88), which files the cued paragraph.
                <ListEmpty>No quotes yet. Find one above or tap a paragraph, then add it with <b>+ Add</b>.</ListEmpty>
              ) : (
                // Nothing installed at all: a search box the operator cannot make match
                // anything is not an invitation, so name the import instead (#88) — the
                // + Import at the top of the rail, the same verb the Slides rail teaches.
                <ListEmpty>
                  No messages yet — import one with <b>+ Import</b> to search its quotes.
                </ListEmpty>
              ))}
            {scheduleRows.map((r, i) => (
              <button
                key={r.id}
                data-quote-row={r.id}
                data-selected={r.isSelected || undefined}
                style={scheduleRowStyle(T, T.message, { live: r.isLive, selected: r.isSelected, current: r.isCurrent })}
                onClick={r.onClick}
                onDoubleClick={r.onDoubleClick}
                onContextMenu={r.onContextMenu}
              >
                <RowNumber n={i + 1} color={T.faint} />
                <div style={scheduleIconStyle}>&#10077;</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={rowTitleStyle}>{r.title}</div>
                  <div style={rowMetaStyle}>{r.meta}</div>
                </div>
                <RowStateMark theme={T} accent={T.message} live={r.isLive} queued={r.isQueued} current={r.isCurrent} />
              </button>
            ))}
          </div>
        </>
      )}

      {undo && <UndoToast label={undo.label} onUndo={undo.onUndo} accent={T.message} />}
      {tapePlayer}
    </>
  );
}
