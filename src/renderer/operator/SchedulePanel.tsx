import type { CSSProperties, JSX, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { Theme } from '../../shared/theme';
import { TrackTabs } from './TrackTabs';

export type SermonTrack = 'scripture' | 'message' | 'slides';

export interface ScheduleRow {
  id: string;
  title: string;
  meta: string;
  isCurrent: boolean;
  isSelected: boolean;
  onClick: () => void;
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
  canAdd: boolean;
  addLabel: string;
  onAdd: () => void;
  rows: ScheduleRow[];
  undo?: { label: string; onUndo: () => void };
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
  canAdd,
  addLabel,
  onAdd,
  rows,
  undo
}: SchedulePanelProps): JSX.Element {
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
    justifyContent: 'center'
  };
  const rowStyle = (isCurrent: boolean, isSelected: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '10px 11px',
    borderRadius: '11px',
    cursor: 'pointer',
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
              <input
                style={{ flex: 1, fontSize: '13.5px', fontFamily: "'JetBrains Mono',monospace" }}
                value={value}
                onChange={(e) => onEntryChange(e.target.value)}
                onKeyDown={onEntryKeyDown}
                placeholder="Add reading — John 3:16"
              />
            </div>
            {canAdd && (
              <button style={schedAddStyle} onClick={onAdd}>
                {addLabel}
              </button>
            )}
          </div>
          <div style={{ fontSize: '10px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600, padding: '0 14px 8px', flexShrink: 0 }}>
            SCRIPTURE SCHEDULE
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {rows.map((r) => (
              <button
                key={r.id}
                style={rowStyle(r.isCurrent, r.isSelected)}
                data-selected={r.isSelected || undefined}
                onClick={r.onClick}
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

          {undo && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                margin: '0 12px 12px',
                padding: '9px 11px',
                borderRadius: '9px',
                background: T.panel2,
                boxShadow: `inset 0 0 0 1px ${T.border}`,
                flexShrink: 0
              }}
            >
              <span style={{ flex: 1, fontSize: '12px', color: T.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Removed {undo.label}
              </span>
              <button
                style={{ fontSize: '12px', fontWeight: 700, color: T.scripture, padding: '2px 4px' }}
                onClick={undo.onUndo}
              >
                Undo
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
