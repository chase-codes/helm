import { useState, type CSSProperties, type JSX, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import type { Theme } from '../../shared/theme';
import type { RefGhost } from '../../shared/scripture/refBuilder';
import { TrackTabs } from './TrackTabs';
import { UndoToast } from './UndoToast';
import { DangerGhostButton } from './DangerGhostButton';
import { ListEmpty } from './ListEmpty';

/** Shared by the input and its ghost overlay — they must render at the exact same size or
 * the transparent spacer copy drifts out from under the typed text (see Finding 3). */
const entryFont: CSSProperties = { fontSize: '13.5px', fontFamily: "'JetBrains Mono',monospace" };

export type SermonTrack = 'scripture' | 'message' | 'slides';

export interface ScheduleRow {
  id: string;
  title: string;
  meta: string;
  isCurrent: boolean;
  isSelected: boolean;
  onClick: (e: ReactMouseEvent) => void;
  /** Double-click: take this reading's first verse live (#58). Receives the event so
   * the caller can ignore shift-double-clicks — two quick shift-clicks are range
   * selection (#61), not a request to take the screen. */
  onDoubleClick: (e: ReactMouseEvent) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}

export interface SchedulePanelProps {
  theme: Theme;
  width: number;
  track: SermonTrack;
  setTrack: (t: SermonTrack) => void;
  value: string;
  onEntryChange: (v: string) => void;
  onEntryKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Book-name completion preview for the entry field. Non-null exactly when space (or Tab)
   * would commit a book while the entry has focus — see `bookCompletion` in refBuilder.
   * Rendered as a dim overlay, never as part of `value`, and only while the input is
   * focused: away from focus, space goes to onGoLive instead, so a stale ghost must not
   * imply it would still be accepted (see Finding 1). */
  ghost?: RefGhost | null;
  canAdd: boolean;
  addLabel: string;
  onAdd: () => void;
  rows: ScheduleRow[];
  undo?: { label: string; onUndo: () => void };
  /** Clear-schedule control; the button renders only when the schedule is non-empty.
   * Destructive but recoverable — the caller routes it through the same removeMany +
   * undo-toast path as row deletes, so there is no confirmation dialog. It gets a real
   * button footprint (DangerGhostButton) rather than the 10px text link it used to be:
   * the most destructive in-service action must not also be the smallest target (#86). */
  onClearAll?: () => void;
  /** Lets SermonMode focus the reading entry (scripture-lookup hotkey, '/'). */
  entryRef?: RefObject<HTMLInputElement | null>;
}

/** Left rail: track switcher + (Scripture only, for now) the add-reading input and
 * the reading schedule. Message/Slides tabs are selectable but render no content here
 * — SermonMode swaps the whole center+right area for a placeholder while they're active. */
export function SchedulePanel({
  theme: T,
  width,
  track,
  setTrack,
  value,
  onEntryChange,
  onEntryKeyDown,
  ghost,
  canAdd,
  addLabel,
  onAdd,
  rows,
  undo,
  onClearAll,
  entryRef
}: SchedulePanelProps): JSX.Element {
  // The ghost is derived from builder state alone and knows nothing about focus, but "space
  // commits the book" is only true while this input has focus — when it doesn't, space goes
  // to onGoLive instead (see Finding 1). Track focus locally and gate the overlay on it.
  const [focused, setFocused] = useState(false);
  const panelStyle: CSSProperties = { width: `${width}px`, flexShrink: 0, background: T.panel, display: 'flex', flexDirection: 'column', minHeight: 0 };
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
  const schedAddStyle: CSSProperties = {
    width: '100%',
    height: '34px',
    marginTop: '8px',
    borderRadius: '9px',
    background: `${T.scripture}22`,
    color: T.scripture,
    fontSize: '12.5px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // The label names the reference it will file, so it grows with the typed entry. Full
    // width already keeps the chip from widening; clipping keeps a long one from wrapping
    // to a second line and shoving the schedule down (#85).
    padding: '0 10px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  };
  const rowStyle = (isCurrent: boolean, isSelected: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '10px 11px',
    borderRadius: '11px',
    cursor: 'pointer',
    userSelect: 'none',
    background: isCurrent ? T.panel3 : isSelected ? T.panel2 : 'transparent',
    boxShadow: isSelected
      ? `inset 0 0 0 1.5px ${T.accent}`
      : isCurrent
        ? `inset 0 0 0 1px ${T.scripture}55`
        : 'none'
  });
  const iconStyle: CSSProperties = {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: '13px',
    color: T.scripture,
    background: `${T.scripture}22`
  };

  return (
    <div style={panelStyle}>
      <div style={{ padding: '12px 12px 10px', flexShrink: 0 }}>
        <TrackTabs theme={T} track={track} setTrack={setTrack} />
      </div>

      {track === 'scripture' && (
        <>
          <div style={{ padding: '0 12px 10px', flexShrink: 0 }}>
            <div style={schedInputStyle}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '14px', color: T.scripture }}>&rsaquo;</span>
              <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
                <input
                  ref={entryRef}
                  style={{ ...entryFont, flex: 1, minWidth: 0 }}
                  value={value}
                  onChange={(e) => onEntryChange(e.target.value)}
                  onKeyDown={onEntryKeyDown}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="Add reading — John 3:16"
                />
                {ghost && focused && (
                  // A transparent copy of the typed text advances the dim completion to
                  // exactly the caret's offset — no text measuring, no scroll syncing (a
                  // book name plus a reference never gets long enough to scroll this field).
                  // Font must match the input exactly or the ghost drifts.
                  <span
                    data-ghost
                    aria-hidden="true"
                    style={{
                      ...entryFont,
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      display: 'flex',
                      alignItems: 'center',
                      pointerEvents: 'none',
                      whiteSpace: 'pre'
                    }}
                  >
                    <span style={{ color: 'transparent' }}>{value}</span>
                    <span data-ghost-text style={{ color: T.faint }}>
                      {ghost.kind === 'tail' ? ghost.text : ` → ${ghost.book}`}
                    </span>
                  </span>
                )}
              </div>
            </div>
            {canAdd && (
              <button style={schedAddStyle} onClick={onAdd}>
                {addLabel}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 8px', flexShrink: 0 }}>
            <span style={{ fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600 }}>
              SCRIPTURE SCHEDULE
            </span>
            {onClearAll && rows.length > 0 && (
              <DangerGhostButton
                label="Clear all"
                onClick={onClearAll}
                title="Remove every reading — undoable for five seconds"
              />
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {rows.length === 0 && (
              <ListEmpty>
                Readings you add will wait here — type a reference above, then <b>+ Add</b>.
              </ListEmpty>
            )}
            {rows.map((r) => (
              <button
                key={r.id}
                style={rowStyle(r.isCurrent, r.isSelected)}
                data-schedule-row={r.id}
                data-selected={r.isSelected || undefined}
                onClick={r.onClick}
                onDoubleClick={r.onDoubleClick}
                onContextMenu={r.onContextMenu}
              >
                <div style={iconStyle}>&#10013;</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '13.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                  <div style={{ fontSize: '11px', color: T.faint, marginTop: '1px' }}>{r.meta}</div>
                </div>
                {r.isCurrent && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: T.live, flexShrink: 0 }} />}
              </button>
            ))}
          </div>

          {undo && <UndoToast label={undo.label} onUndo={undo.onUndo} accent={T.scripture} />}
        </>
      )}
    </div>
  );
}
