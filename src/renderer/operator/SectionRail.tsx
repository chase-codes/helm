import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react';
import type { Theme } from '../../shared/theme';
import type { SongSection } from '../../shared/types';
import { railBadgeStyle, railFont, railLabelStyle } from './railTint';

export interface SectionRailProps {
  theme: Theme;
  width: number;
  sections: SongSection[];
  cuedIndex: number;
  isSectionLive: (i: number) => boolean;
  onSelect: (i: number) => void;
  /** Double-click: put this section on screen (#58), idempotently — see takeLive. */
  onActivate: (i: number) => void;
  editingIndex: number | null;
  editError: boolean;
  onSectionContextMenu: (i: number, e: ReactMouseEvent) => void;
  onEditSave: (i: number, lines: string[]) => void;
  onEditCancel: () => void;
  /** Collapse the rail to a slim stub, handing its width to the hero (whose auto-fitted
   *  lyric is width-bound, so the freed width becomes font size). */
  onCollapse?: () => void;
}

interface SectionEditorProps {
  theme: Theme;
  initial: string;
  font: number;
  error: boolean;
  onSave: (lines: string[]) => void;
  onCancel: () => void;
}

// In-place quick edit for one section's lines. Enter saves, Shift+Enter inserts a
// newline, Escape cancels; both keys stop propagation so the global key dispatcher
// (go-live / take-down chain) never sees them. Blur = click-outside = cancel.
function SectionEditor({ theme: T, initial, font, error, onSave, onCancel }: SectionEditorProps): JSX.Element {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      onSave(value.split('\n'));
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };
  const style: CSSProperties = {
    width: '100%',
    padding: 0,
    border: 'none',
    outline: 'none',
    resize: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: `${font}px`,
    lineHeight: 1.45,
    fontWeight: 500,
    color: T.text
  };
  return (
    <div>
      <textarea
        ref={ref}
        rows={Math.max(3, value.split('\n').length + 1)}
        style={style}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onCancel}
      />
      {error && <div style={{ fontSize: '11px', color: T.live, marginTop: '4px' }}>Couldn’t save — try again</div>}
    </div>
  );
}

export function SectionRail({
  theme: T,
  width,
  sections,
  cuedIndex,
  isSectionLive,
  onSelect,
  onActivate,
  editingIndex,
  editError,
  onSectionContextMenu,
  onEditSave,
  onEditCancel,
  onCollapse
}: SectionRailProps): JSX.Element {
  const secFont = railFont(width);

  const sectionPanelStyle: CSSProperties = {
    width: `${width}px`,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0
  };
  const secRowStyle = (isCued: boolean, isLive: boolean): CSSProperties => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '11px 13px',
    borderRadius: '11px',
    cursor: 'pointer',
    background: isLive ? T.selBg : T.panel2,
    boxShadow: isLive
      ? `inset 0 0 0 2px ${T.accent}`
      : isCued
        ? `inset 0 0 0 1.5px ${T.accent}66`
        : `inset 0 0 0 1px ${T.hairline}`,
    userSelect: 'none'
  });
  const secLabelStyle = (isCued: boolean): CSSProperties => railLabelStyle(T, T.accent, isCued);
  const secBadgeStyle = (isLive: boolean): CSSProperties => railBadgeStyle(T, isLive);
  const secLineStyle = (isCued: boolean): CSSProperties => ({
    fontSize: `${secFont}px`,
    lineHeight: 1.45,
    fontWeight: 500,
    color: isCued ? T.text : T.lineDim,
    textWrap: 'pretty'
  });

  // Keep the cued card visible on hotkey jumps (mirrors ChapterRail's selection-scroll):
  // an effect keyed on the index, not a callback ref, so a manual scroll isn't fought
  // on every re-render.
  const cuedRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cuedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [cuedIndex]);

  return (
    <div style={sectionPanelStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          letterSpacing: '0.1em',
          color: T.faint,
          fontWeight: 600,
          marginBottom: '10px',
          flexShrink: 0
        }}
      >
        <span>SECTIONS — TAP TO SING</span>
        {onCollapse && (
          <button
            title="Hide sections — bigger lyrics"
            onClick={onCollapse}
            style={{
              border: 'none',
              background: 'transparent',
              color: T.faint,
              cursor: 'pointer',
              fontSize: '13px',
              lineHeight: 1,
              padding: '2px 4px'
            }}
          >
            »
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '2px' }}>
        {sections.map((sc, i) => {
          const isCued = i === cuedIndex;
          const isLive = isSectionLive(i);
          const showBadge = isCued || isLive;
          const isEditing = i === editingIndex;
          const header = (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div style={secLabelStyle(isCued)}>{sc.label}</div>
              {showBadge && (
                <div style={secBadgeStyle(isLive)}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                  {isLive ? 'LIVE' : 'CUED'}
                </div>
              )}
            </div>
          );
          if (isEditing) {
            return (
              <div key={i} style={secRowStyle(isCued, isLive)}>
                {header}
                <SectionEditor
                  theme={T}
                  initial={sc.lines.join('\n')}
                  font={secFont}
                  error={editError}
                  onSave={(lines) => onEditSave(i, lines)}
                  onCancel={onEditCancel}
                />
              </div>
            );
          }
          return (
            <button
              key={i}
              ref={i === cuedIndex ? cuedRef : undefined}
              style={secRowStyle(isCued, isLive)}
              onClick={() => onSelect(i)}
              onDoubleClick={() => onActivate(i)}
              onContextMenu={(e) => onSectionContextMenu(i, e)}
            >
              {header}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {sc.lines.map((ln, j) => (
                  <div key={j} style={secLineStyle(isCued)}>
                    {ln}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
