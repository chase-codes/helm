export interface Theme {
  appBg: string; panel: string; panel2: string; panel3: string;
  text: string; dim: string; faint: string; hairline: string; border: string;
  inputBg: string; accent: string; accentInk: string; live: string;
  scripture: string; sermon: string; message: string; quote: string;
  floatShadow: string;
}
export type ThemeFamily = 'classic' | 'helm';
export type ThemeMode = 'dark' | 'light';
type Palette = Omit<Theme, 'floatShadow'>;

const CLASSIC_DARK: Palette = { appBg: '#0f1115', panel: '#15171c', panel2: '#1c1f25', panel3: '#23262e', text: '#e8e6e1', dim: '#9a9488', faint: '#736f66', hairline: 'rgba(255,255,255,.06)', border: 'rgba(255,255,255,.08)', inputBg: '#1c1f25', accent: '#e0a341', accentInk: '#1a1206', live: '#cf6a5e', scripture: '#6f9cf0', sermon: '#6f9c7a', message: '#a88bc4', quote: '#b98cf0' };
const CLASSIC_LIGHT: Palette = { appBg: '#ece5d6', panel: '#f7f3ea', panel2: '#fdfbf6', panel3: '#ffffff', text: '#2c2823', dim: '#7a7263', faint: '#a59c8a', hairline: 'rgba(0,0,0,.08)', border: 'rgba(0,0,0,.12)', inputBg: '#ffffff', accent: '#b87a2c', accentInk: '#ffffff', live: '#bf4f44', scripture: '#3f6bb5', sermon: '#4f7d5f', message: '#7d54ad', quote: '#8a5cc0' };
const HELM_DARK: Palette = { appBg: '#0B1322', panel: '#101B30', panel2: '#16243E', panel3: '#1C2D4C', text: '#EFE9DC', dim: '#a89f8c', faint: '#6f6c60', hairline: 'rgba(239,233,220,.07)', border: 'rgba(239,233,220,.11)', inputBg: '#101B30', accent: '#E0A341', accentInk: '#1a1206', live: '#cf6a5e', scripture: '#7fa5ee', sermon: '#79a586', message: '#a88bc4', quote: '#b98cf0' };
const HELM_LIGHT: Palette = { appBg: '#EFE9DC', panel: '#f5f0e5', panel2: '#faf7ef', panel3: '#ffffff', text: '#16243E', dim: '#5a6478', faint: '#8a91a3', hairline: 'rgba(22,36,62,.10)', border: 'rgba(22,36,62,.15)', inputBg: '#ffffff', accent: '#a9762a', accentInk: '#fff8ec', live: '#bf4f44', scripture: '#3f6bb5', sermon: '#4f7d5f', message: '#7d54ad', quote: '#8a5cc0' };

export const FAMILIES: Record<ThemeFamily, { label: string; presetName: Record<ThemeMode, string>; dark: Palette; light: Palette }> = {
  classic: { label: 'Classic', presetName: { dark: 'Charcoal', light: 'Parchment' }, dark: CLASSIC_DARK, light: CLASSIC_LIGHT },
  helm: { label: 'Helm', presetName: { dark: 'Helm Navy', light: 'Helm Parchment' }, dark: HELM_DARK, light: HELM_LIGHT },
};

/** Classic dark palette — LeaderView renders operator-dark regardless of the operator's pick. */
export const DARK = CLASSIC_DARK;

export function themeFor(family: ThemeFamily, mode: ThemeMode): Theme {
  const p = FAMILIES[family][mode];
  return { ...p, floatShadow: `0 18px 50px rgba(0,0,0,.45), inset 0 0 0 1px ${p.border}` };
}
