export interface Theme {
  appBg: string; panel: string; panel2: string; panel3: string;
  text: string; dim: string; faint: string; hairline: string; border: string;
  inputBg: string; accent: string; accentInk: string; live: string;
  scripture: string; sermon: string; message: string; quote: string;
  floatShadow: string;
}
export const DARK = { appBg: '#0f1115', panel: '#15171c', panel2: '#1c1f25', panel3: '#23262e', text: '#e8e6e1', dim: '#9a9488', faint: '#736f66', hairline: 'rgba(255,255,255,.06)', border: 'rgba(255,255,255,.08)', inputBg: '#1c1f25', accent: '#e0a341', accentInk: '#1a1206', live: '#cf6a5e', scripture: '#6f9cf0', sermon: '#6f9c7a', quote: '#b98cf0' };
export const LIGHT = { appBg: '#ece5d6', panel: '#f7f3ea', panel2: '#fdfbf6', panel3: '#ffffff', text: '#2c2823', dim: '#7a7263', faint: '#a59c8a', hairline: 'rgba(0,0,0,.08)', border: 'rgba(0,0,0,.12)', inputBg: '#ffffff', accent: '#b87a2c', accentInk: '#ffffff', live: '#bf4f44', scripture: '#3f6bb5', sermon: '#4f7d5f', quote: '#8a5cc0' };
export type Tone = 'Warm' | 'Cool' | 'Earthen';
export const TONES = {
  Warm:    { scripture: '#6f9cf0', sermon: '#6f9c7a', message: '#a88bc4' },
  Cool:    { accent: '#5aa9d6', scripture: '#7c8cf0', sermon: '#56b39a', message: '#8f7ce0', live: '#d06a8a' },
  Earthen: { accent: '#cf9646', scripture: '#8f9bc2', sermon: '#88a06a', message: '#a08a9e', live: '#c46a52' },
} as const;
export function themeFor(mode: 'dark' | 'light', tone: Tone = 'Warm'): Theme {
  const base = mode === 'light' ? LIGHT : DARK;
  const merged = { ...base, ...TONES[tone] };
  return { ...merged, floatShadow: `0 18px 50px rgba(0,0,0,.45), inset 0 0 0 1px ${merged.border}` } as Theme;
}
