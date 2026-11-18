import {
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX
} from 'react';
import { createPortal } from 'react-dom';
import { ThemeCtx } from './ThemeCtx';
import { Z_STACKED_MODAL } from './zLayers';
import { MONO, SANS } from '../shared/fonts';
import { interactionVars } from './interactionVars';
import { isMusicKey, keyOfPitch, pitchOfKey, type MusicKey } from '../../shared/songs/musicKey';

// The song keys picker (spec 2026-11-17, Phase 1b): twelve fixed buttons in chromatic
// order, a Major | Minor toggle, Capo…, Clear key. One click or one Enter saves.
//
// Keyboard (grammar rule 9): a letter picks the root, `b` / `#` change it, `m` toggles
// minor, arrows walk the grid, Enter saves what is highlighted, Escape steps back one
// layer (Capo… line → typed highlight → close). While the picker is mounted it owns
// every plain key in the window, in the capture phase, so nothing it handles can reach
// the page's dispatcher: not Enter (Go live), not B / C / T (section jumps), not the
// arrows (section steps). Mod and Alt chords pass through, so Mod+B still releases the
// screens. The picker calls no screen verb; saving is the caller's `onPick`.

/** Appendix A, "Picker also shows": the other spelling, small under the canonical one. */
const ALSO: Partial<Record<MusicKey, string>> = {
  Db: 'C#', 'F#': 'Gb', Ab: 'G#', Bb: 'A#',
  Ebm: 'D#m', 'G#m': 'Abm', Bbm: 'A#m'
};

const LETTER_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const PCS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const CAPOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** A root typed letter by letter: "E" then "b" is Eb. `open` is true right after a letter,
 * while one accidental may still follow it. */
interface Typed { pc: number; open: boolean }

export interface KeyPickerProps {
  /** The song's key now: a canonical key, '' for none, or a legacy value as typed. */
  value: string;
  /** Save. null is Clear key. */
  onPick: (key: MusicKey | null) => void;
  /** The last Escape rung, after the Capo… line and a typed highlight. */
  onClose: () => void;
  /** The Song keys window's `Skip` (Phase 1c). Not rendered unless passed. */
  onSkip?: () => void;
  /** The song's title, for the eyebrow, so a picker opened from a row says which song. */
  songTitle?: string;
  /** Plain keys the host handles itself (the Song keys window's ↑/↓ rows and `/` search).
   * The picker leaves them alone, so the host's own listener must stop them. */
  hostKeys?: (e: KeyboardEvent) => boolean;
  /** Move focus into the picker on mount (default). The Song keys window turns it off: its
   * picker remounts per song, and must not pull focus out of the search field mid-word. */
  autoFocus?: boolean;
}

const isTextField = (el: EventTarget | null): boolean => {
  const tag = (el as HTMLElement | null)?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea';
};

export function KeyPicker({ value, onPick, onClose, onSkip, songTitle, hostKeys, autoFocus = true }: KeyPickerProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = isMusicKey(value) ? pitchOfKey(value) : null;
  const initialMinor = current?.minor ?? false;
  const [minor, setMinor] = useState(initialMinor);
  const [typed, setTyped] = useState<Typed | null>(null);
  const [capoOpen, setCapoOpen] = useState(false);
  const [capo, setCapo] = useState(2);
  const [shape, setShape] = useState<Typed>({ pc: 7, open: false });

  const capoKey = keyOfPitch(shape.pc + capo, minor);
  // What Enter saves. The highlight on the grid is always this key.
  const target: MusicKey | null = capoOpen
    ? capoKey
    : typed
      ? keyOfPitch(typed.pc, minor)
      : current
        ? keyOfPitch(current.pc, minor)
        : null;

  const openCapo = (): void => {
    // G shapes and Em shapes are where a guitarist with a capo usually starts.
    setShape({ pc: minor ? 4 : 7, open: false });
    setCapoOpen(true);
  };

  // A letter starts a root; `b` or `#` straight after one changes it (so "b" alone is B,
  // and "bb" is Bb, the same reading normalizeKey gives).
  const typeInto = (t: Typed | null, k: string): Typed | null => {
    const lower = k.toLowerCase();
    if ((lower === 'b' || k === '#') && t?.open) return { pc: mod12(t.pc + (k === '#' ? 1 : -1)), open: false };
    if (lower in LETTER_PC) return { pc: LETTER_PC[lower], open: true };
    return t;
  };

  // The window listener is attached once per mount and always runs the latest closure.
  const onKey = useEffectEvent((e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Tab') return;
    // A text field outside the picker keeps its own keys (the Song keys window's search).
    if (isTextField(e.target) && !rootRef.current?.contains(e.target as Node)) return;
    if (hostKeys?.(e)) return;
    const inSelect = (e.target as HTMLElement | null)?.tagName?.toLowerCase() === 'select';
    e.stopPropagation();
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      if (capoOpen) setCapoOpen(false);
      else if (typed || minor !== initialMinor) { setTyped(null); setMinor(initialMinor); }
      else onClose();
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      if (target) onPick(target);
      return;
    }
    if (inSelect && k.startsWith('Arrow')) return; // the select's own arrows
    e.preventDefault();
    if (k === 'm' || k === 'M') { setMinor((m) => !m); return; }
    if (capoOpen) {
      if (/^[1-9]$/.test(k)) { setCapo(Number(k)); return; }
      const next = typeInto(shape, k);
      if (next) setShape(next);
      return;
    }
    if (k.startsWith('Arrow')) {
      const step = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : k === 'ArrowUp' ? -6 : k === 'ArrowDown' ? 6 : 0;
      const from = target ? pitchOfKey(target).pc : -step; // nothing lit: start at C
      setTyped({ pc: mod12(from + step), open: false });
      return;
    }
    setTyped((t) => typeInto(t, k));
  });
  // Layout timing, like SongsMode's key delegate: the picker must own the keys from the
  // commit that shows it, or an Enter in that gap would reach Go live.
  useLayoutEffect(() => {
    const listener = (e: KeyboardEvent): void => onKey(e);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);
  useEffect(() => {
    if (autoFocus) rootRef.current?.focus();
    // Mount only: a picker that has started taking keys keeps the focus it was given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- styles ----------------
  const rootStyle: CSSProperties = {
    width: '354px',
    padding: '10px 12px 12px',
    background: T.panel3,
    borderRadius: '12px',
    boxShadow: T.floatShadow,
    outline: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    userSelect: 'none'
  };
  const eyebrowStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontSize: '10px',
    letterSpacing: '0.1em',
    fontWeight: 600,
    color: T.faint,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textTransform: 'uppercase'
  };
  const segWrapStyle: CSSProperties = { display: 'flex', gap: '3px', background: T.panel2, padding: '3px', borderRadius: '8px', flexShrink: 0 };
  const segStyle = (on: boolean): CSSProperties => ({
    width: '54px',
    height: '22px',
    borderRadius: '6px',
    fontSize: '11.5px',
    fontWeight: on ? 700 : 600,
    textAlign: 'center',
    color: on ? T.accentInk : T.dim,
    background: on ? T.accent : 'transparent'
  });
  const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(6, 50px)', gap: '6px' };
  const keyBtnStyle = (k: MusicKey): CSSProperties => {
    const lit = k === target;
    const saved = k === value;
    return {
      width: '50px',
      height: '46px',
      borderRadius: '9px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1px',
      background: lit ? T.accent : T.panel2,
      color: lit ? T.accentInk : T.text,
      boxShadow: lit ? 'none' : `inset 0 0 0 1px ${saved ? T.accent : T.hairline}`
    };
  };
  const altStyle = (lit: boolean): CSSProperties => ({
    height: '11px',
    fontSize: '9.5px',
    lineHeight: '11px',
    fontWeight: 500,
    color: lit ? T.accentInk : T.faint,
    opacity: lit ? 0.75 : 1
  });
  const footStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '6px', height: '28px', whiteSpace: 'nowrap' };
  const ghostStyle = (enabled: boolean): CSSProperties => ({
    height: '28px',
    padding: '0 10px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    color: T.dim,
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.hairline}`,
    opacity: enabled ? 1 : 0.45,
    cursor: enabled ? 'pointer' : 'default',
    flexShrink: 0
  });
  const selectStyle: CSSProperties = {
    height: '26px',
    padding: '0 4px',
    borderRadius: '7px',
    border: 'none',
    background: T.inputBg,
    color: T.text,
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontFamily: 'inherit',
    fontSize: '12px',
    fontWeight: 600,
    flexShrink: 0
  };
  const capoTextStyle: CSSProperties = { fontSize: '12px', color: T.dim, flexShrink: 0 };
  const capoSaveStyle: CSSProperties = {
    height: '26px',
    padding: '0 8px',
    borderRadius: '7px',
    fontSize: '12px',
    color: T.text,
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.accent}`,
    flexShrink: 0
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      style={rootStyle}
      data-key-picker
      title="Type a key: a letter, then b or #, m for minor. Enter saves."
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={eyebrowStyle}>{songTitle ? `Key · ${songTitle}` : 'Key'}</div>
        <div style={segWrapStyle}>
          <button tabIndex={-1} style={segStyle(!minor)} aria-pressed={!minor} onClick={() => setMinor(false)}>
            Major
          </button>
          <button tabIndex={-1} style={segStyle(minor)} aria-pressed={minor} onClick={() => setMinor(true)}>
            Minor
          </button>
        </div>
      </div>
      <div style={gridStyle}>
        {PCS.map((pc) => {
          const k = keyOfPitch(pc, minor);
          const lit = k === target;
          return (
            // Buttons stay out of the tab order (like ContextMenu items): focus rests on the
            // picker, so Enter always saves the highlight rather than whichever button.
            <button
              key={pc}
              tabIndex={-1}
              style={keyBtnStyle(k)}
              aria-label={`Key ${k}`}
              aria-current={lit || undefined}
              data-key={k}
              onClick={() => onPick(k)}
            >
              <span style={{ fontSize: '15px', fontWeight: 700, lineHeight: '18px' }}>{k}</span>
              <span style={altStyle(lit)}>{ALSO[k] ?? ''}</span>
            </button>
          );
        })}
      </div>
      {/* One fixed-height row: the actions, or the Capo… line in their place (rule 5). */}
      {capoOpen ? (
        <div style={footStyle} data-capo-line>
          <span style={capoTextStyle}>Capo</span>
          <select aria-label="Capo" style={selectStyle} value={capo} onChange={(e) => setCapo(Number(e.target.value))}>
            {CAPOS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span style={capoTextStyle}>playing</span>
          <select
            aria-label="Shapes"
            style={selectStyle}
            value={shape.pc}
            onChange={(e) => setShape({ pc: Number(e.target.value), open: false })}
          >
            {PCS.map((pc) => (
              <option key={pc} value={pc}>
                {keyOfPitch(pc, minor)}
              </option>
            ))}
          </select>
          <span style={capoTextStyle}>shapes →</span>
          <button tabIndex={-1} style={capoSaveStyle} data-capo-save onClick={() => onPick(capoKey)} title="Save the key the band hears">
            Key <b>{capoKey}</b>
          </button>
          <div style={{ flex: 1 }} />
          <button
            tabIndex={-1}
            style={{ fontSize: '12px', color: T.faint, padding: '4px', flexShrink: 0 }}
            onClick={() => setCapoOpen(false)}
            title="Close the capo line"
            aria-label="Close the capo line"
          >
            ✕
          </button>
        </div>
      ) : (
        <div style={footStyle}>
          <button tabIndex={-1} style={ghostStyle(true)} onClick={openCapo} title="Work out the key from a capo and chord shapes">
            Capo…
          </button>
          <button
            tabIndex={-1}
            style={ghostStyle(!!value)}
            disabled={!value}
            onClick={() => onPick(null)}
            title={value ? 'Leave this song without a key' : 'This song has no key'}
          >
            Clear key
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ fontFamily: MONO, fontSize: '10px', color: T.faint, flexShrink: 0 }}>Enter saves</span>
          {onSkip && (
            <button tabIndex={-1} style={ghostStyle(true)} onClick={onSkip} title="Leave this song's key blank for now">
              Skip
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export interface KeyPickerPopoverProps extends KeyPickerProps {
  /** The control the picker hangs from: a row, the hero's meta line, QuickAdd's key button. */
  anchor: HTMLElement;
  /** The anchor is a button that opens and closes the picker itself, so a press on it is
   * not an outside click. A row is not: clicking it closes the picker like anywhere else. */
  anchorToggles?: boolean;
}

/**
 * The picker as a popover, fixed under (or, without room, over) its anchor and clamped to
 * the window. A click outside or a scroll closes it, like ContextMenu. Saving closes it too.
 * Focus goes back to the anchor on close.
 */
export function KeyPickerPopover({ anchor, anchorToggles = false, onPick, onClose, ...rest }: KeyPickerPopoverProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const box = boxRef.current?.getBoundingClientRect();
    const w = box?.width ?? 0;
    const h = box?.height ?? 0;
    const pad = 6;
    let x = a.left;
    let y = a.bottom + 4;
    if (x + w + pad > window.innerWidth) x = Math.max(pad, window.innerWidth - w - pad);
    if (y + h + pad > window.innerHeight) y = Math.max(pad, a.top - h - 4);
    setPos({ x, y });
  }, [anchor]);

  useEffect(() => {
    const inside = (t: EventTarget | null): boolean => !!boxRef.current?.contains(t as Node);
    const onDown = (e: MouseEvent): void => {
      if (inside(e.target) || (anchorToggles && anchor.contains(e.target as Node))) return;
      onClose();
    };
    const onScroll = (e: Event): void => {
      if (!inside(e.target)) onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, anchorToggles, onClose]);

  useEffect(() => () => anchor.focus?.(), [anchor]);

  const style: CSSProperties = {
    position: 'fixed',
    left: `${pos?.x ?? 0}px`,
    top: `${pos?.y ?? 0}px`,
    zIndex: Z_STACKED_MODAL,
    // Outside the app root, so it carries the root's type and the interaction layer's
    // custom properties itself (App.tsx rootStyle).
    fontFamily: SANS,
    fontSize: '14px',
    color: T.text,
    ...interactionVars(T),
    // Measured once before it is shown, so it never flashes at the window's corner. Opacity,
    // not visibility: a hidden element cannot take the focus the picker moves into itself.
    opacity: pos ? 1 : 0,
    pointerEvents: pos ? 'auto' : 'none'
  };
  // Portalled to the body, so no ancestor's overflow, filter or stacking context (a rail
  // that scrolls, ModalShell's blurred scrim) can clip or re-anchor it.
  return createPortal(
    <div ref={boxRef} style={style} data-key-picker-popover>
      <KeyPicker
        {...rest}
        onClose={onClose}
        onPick={(k) => {
          onPick(k);
          onClose();
        }}
      />
    </div>,
    document.body
  );
}
