import { useContext, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { ThemeCtx } from './ThemeCtx';
import { Z_MODAL } from './zLayers';

export interface ModalShellProps {
  /** Backdrop click closes. Omit to make the modal undismissable — SongImport does this
   *  mid-import, where a stray click on the dim would abandon work in flight. */
  onClose?: () => void;
  /** 'panel' — a header/body/footer column that clips its own scroll (imports, Settings).
   *  'card'  — a padded box that scrolls as one (the card editor, the deck fallback). */
  variant?: 'panel' | 'card';
  /** Stacking. 50 is the page-level default; 60 lifts a modal that can open over another
   *  one (SongImport and MessageImport both launch from an already-open surface). */
  zIndex?: number;
  width?: string;
  maxWidth?: string;
  /** A fixed frame. SongImport wants one: its wizard steps differ wildly in length, and
   *  without it the modal resizes under the operator between them. */
  height?: string;
  maxHeight?: string;
  /** Overlay inset. SongImport's fixed-height card wants the extra vertical room. */
  overlayPadding?: string;
  children: ReactNode;
}

const stop = (e: ReactMouseEvent): void => e.stopPropagation();

/**
 * The one modal shell: scrim + floating card. Six files hand-rolled this pair of styles
 * with the scrim colour and drop shadow written out as raw rgba() each time (#91), which
 * is how the same modal ends up three slightly different weights. Both values are theme
 * tokens now (`T.scrim`, `T.modalShadow`), so the shell moves in one place.
 *
 * Layout stays the caller's business — a shell that also owned widths would just push the
 * copy-paste inward. Everything below the card is `children`.
 */
export function ModalShell({
  onClose,
  variant = 'panel',
  zIndex = Z_MODAL,
  width,
  maxWidth,
  height,
  maxHeight,
  overlayPadding = '5vh 4vw',
  children
}: ModalShellProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex,
    background: T.scrim,
    backdropFilter: 'blur(3px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: overlayPadding
  };
  const cardStyle: CSSProperties = {
    width,
    maxWidth,
    height,
    maxHeight,
    background: T.panel,
    borderRadius: '16px',
    boxShadow: T.modalShadow,
    ...(variant === 'panel'
      ? {
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: `1px solid ${T.border}`
        }
      : { padding: '22px 24px', overflowY: 'auto' })
  };
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={stop}>
        {children}
      </div>
    </div>
  );
}
