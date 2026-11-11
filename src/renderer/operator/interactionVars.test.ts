import { describe, expect, it } from 'vitest';
import { FAMILIES, themeFor, type ThemeFamily, type ThemeMode } from '../../shared/theme';
import { focusRing, interactionVars } from './interactionVars';

const PALETTES = (Object.keys(FAMILIES) as ThemeFamily[]).flatMap((family) =>
  (['dark', 'light'] as ThemeMode[]).map((mode) => [family, mode] as const)
);

describe('interactionVars', () => {
  it.each(PALETTES)('%s %s yields hex-alpha washes and the accent ring', (family, mode) => {
    const T = themeFor(family, mode);
    const vars = interactionVars(T) as Record<string, string>;
    // The washes append an alpha to T.text, so a palette whose text token stopped being a
    // 6-digit hex would produce a value the browser drops, and hover would vanish silently.
    expect(vars['--helm-hover']).toMatch(/^#[0-9a-f]{8}$/i);
    expect(vars['--helm-press']).toMatch(/^#[0-9a-f]{8}$/i);
    expect(vars['--helm-focus']).toBe(T.accent);
  });

  it('focusRing overrides only the ring colour', () => {
    expect(focusRing('#6f9cf0')).toEqual({ '--helm-focus': '#6f9cf0' });
  });
});
