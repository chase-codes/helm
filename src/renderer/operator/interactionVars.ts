import type { CSSProperties } from 'react';
import type { Theme } from '../../shared/theme';

/**
 * The theme's share of the interaction layer in `global.css`.
 *
 * Operator chrome is styled inline, and an inline style cannot say `:hover` or
 * `:focus-visible`. Rather than thread hover state through every button (what
 * DangerGhostButton had to do), the stylesheet owns those two states once and reads its
 * colours from the custom properties set here on the app root, so grammar rule 8 still
 * holds: the colours come from the theme, the stylesheet only says where they go.
 *
 * - `--helm-hover` / `--helm-press`: a wash of `T.text` laid over whatever the control
 *   already wears. Text is the palette's contrast pole, so the same token lightens a
 *   control in dark mode and darkens it in light mode.
 * - `--helm-focus`: the keyboard-focus ring and the focused-field ring.
 *
 * `T.text` must stay a 6-digit hex token, as `tintChip` requires of its accent: the alpha
 * is appended. `interactionVars.test.ts` holds every palette to that.
 */
export function interactionVars(T: Theme): CSSProperties {
  return {
    '--helm-hover': `${T.text}14`,
    '--helm-press': `${T.text}24`,
    '--helm-focus': T.accent
  } as CSSProperties;
}

/** A field whose ring should wear its track's colour rather than the accent (the
 *  Scripture and Message entries). Spread over the wrapper that carries `data-field`. */
export function focusRing(color: string): CSSProperties {
  return { '--helm-focus': color } as CSSProperties;
}
