import { useState, type CSSProperties, type JSX, type KeyboardEvent, type RefObject } from 'react';
import type { Theme } from '../../shared/theme';
import type { RefGhost } from '../../shared/scripture/refBuilder';
import { MONO } from '../shared/fonts';
import { focusRing } from './interactionVars';

/** Shared by the input and its ghost overlay — they must render at the exact same size or
 * the transparent spacer copy drifts out from under the typed text (see Finding 3). */
const entryFont: CSSProperties = { fontSize: '13.5px', fontFamily: MONO };

export interface ScriptureEntryProps {
  theme: Theme;
  /** The host's track colour: the chevron and the focus ring wear it (`T.scripture` on
   * the Scripture track, `T.accent` in the pre-service card editor). */
  accent: string;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Book-name completion preview. Non-null exactly when space (or Tab) would commit a
   * book while the entry has focus — see `bookCompletion` in refBuilder. Rendered as a dim
   * overlay, never as part of `value`, and only while the input is focused: away from
   * focus, space does nothing to the entry (it is not a go-live key either, #52), so a
   * stale ghost must not imply it would still be accepted (see Finding 1). */
  ghost?: RefGhost | null;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
}

/**
 * The scripture reference entry: one field that takes a reference ("John 3:16") or a word
 * search, with the book-name ghost. The Scripture track and the pre-service card editor
 * both render this one, so the completion looks and behaves the same wherever a verse is
 * looked up. The state machine behind it is `refBuilder`; this component only draws it.
 */
export function ScriptureEntry({
  theme: T,
  accent,
  value,
  onChange,
  onKeyDown,
  ghost,
  placeholder,
  inputRef,
  autoFocus
}: ScriptureEntryProps): JSX.Element {
  // The ghost is derived from builder state alone and knows nothing about focus, but "space
  // commits the book" is only true while this input has focus — when it doesn't, space
  // reaches no handler at all (see Finding 1). Track focus locally and gate the overlay on it.
  const [focused, setFocused] = useState(false);
  const frameStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    height: '42px',
    padding: '0 12px',
    background: T.inputBg,
    borderRadius: '10px',
    boxShadow: `inset 0 0 0 1px ${T.border}`
  };
  return (
    <div data-field style={{ ...frameStyle, ...focusRing(accent) }}>
      <span style={{ fontFamily: MONO, fontSize: '14px', color: accent }}>&rsaquo;</span>
      <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
        <input
          ref={inputRef}
          style={{ ...entryFont, flex: 1, minWidth: 0 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoFocus={autoFocus}
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
  );
}
