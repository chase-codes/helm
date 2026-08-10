import { useEffect, useState } from 'react';
import { FAMILIES, themeFor, type Theme, type ThemeFamily, type ThemeMode } from '../../shared/theme';

export interface Appearance {
  family: ThemeFamily;
  mode: ThemeMode;
}

const DEFAULT_APPEARANCE: Appearance = { family: 'classic', mode: 'dark' };

/** Per-field fallback so a stale/garbled settings row can never wedge the UI. */
export function sanitizeAppearance(v: unknown): Appearance {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    family: typeof o.family === 'string' && o.family in FAMILIES ? (o.family as ThemeFamily) : 'classic',
    mode: o.mode === 'light' ? 'light' : 'dark'
  };
}

/**
 * Operator appearance = theme family + dark/light mode, persisted under the
 * 'appearance' settings key. First paint renders the default until the async
 * hydrate resolves (same tradeoff as the hotkeys load in App).
 */
export function useAppearance(): {
  family: ThemeFamily;
  mode: ThemeMode;
  theme: Theme;
  toggleMode: () => void;
  setMode: (m: ThemeMode) => void;
  setFamily: (f: ThemeFamily) => void;
} {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    void window.helm.settings
      .get<unknown>('appearance', DEFAULT_APPEARANCE)
      .then((v) => setAppearance(sanitizeAppearance(v)))
      .catch(console.error);
  }, []);

  const update = (next: Appearance): void => {
    setAppearance(next);
    window.helm.settings.set('appearance', next);
  };

  return {
    family: appearance.family,
    mode: appearance.mode,
    theme: themeFor(appearance.family, appearance.mode),
    toggleMode: () => update({ ...appearance, mode: appearance.mode === 'dark' ? 'light' : 'dark' }),
    setMode: (mode) => update({ ...appearance, mode }),
    setFamily: (family) => update({ ...appearance, family })
  };
}
