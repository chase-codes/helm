export interface Theme {
  appBg: string; panel: string; panel2: string; panel3: string;
  text: string; dim: string; faint: string; hairline: string; border: string;
  inputBg: string; accent: string; accentInk: string; live: string;
  scripture: string; sermon: string; message: string;
  selBg: string; lineDim: string; go: string;
  /** Elevation ladder, derived — see themeFor. floatShadow is the popover rung
   *  (VersionPicker, ContextMenu); modalShadow the heavier one ModalShell floats on. */
  floatShadow: string; modalShadow: string;
  /** The dim behind a modal. Near-black in both modes on purpose: it reads as
   *  "the room went quiet", which a light scrim can't do. */
  scrim: string;
}
export type ThemeFamily = 'classic' | 'helm' | 'contrast' | 'sanctuary' | 'grove';
export type ThemeMode = 'dark' | 'light';
type Palette = Omit<Theme, 'floatShadow' | 'modalShadow' | 'scrim'>;

const CLASSIC_DARK: Palette = { appBg: '#0f1115', panel: '#15171c', panel2: '#1c1f25', panel3: '#23262e', text: '#e8e6e1', dim: '#9a9488', faint: '#736f66', hairline: 'rgba(255,255,255,.06)', border: 'rgba(255,255,255,.08)', inputBg: '#1c1f25', accent: '#e0a341', accentInk: '#1a1206', live: '#cf6a5e', scripture: '#6f9cf0', sermon: '#6f9c7a', message: '#a88bc4', selBg: '#221d10', lineDim: '#b4b1aa', go: '#2f9e5b' };
const CLASSIC_LIGHT: Palette = { appBg: '#e7e5e0', panel: '#f1efeb', panel2: '#f9f8f5', panel3: '#ffffff', text: '#24231f', dim: '#6c6960', faint: '#96928a', hairline: 'rgba(0,0,0,.07)', border: 'rgba(0,0,0,.12)', inputBg: '#ffffff', accent: '#905b14', accentInk: '#fffaf2', live: '#b2453b', scripture: '#2f5cab', sermon: '#3d6f52', message: '#6b46a0', selBg: '#f6ead2', lineDim: '#5f5c53', go: '#237d45' };

const HELM_DARK: Palette = { appBg: '#0B1322', panel: '#101B30', panel2: '#16243E', panel3: '#1C2D4C', text: '#EFE9DC', dim: '#a89f8c', faint: '#6f6c60', hairline: 'rgba(239,233,220,.07)', border: 'rgba(239,233,220,.11)', inputBg: '#101B30', accent: '#E0A341', accentInk: '#1a1206', live: '#cf6a5e', scripture: '#7fa5ee', sermon: '#79a586', message: '#a88bc4', selBg: '#23283c', lineDim: '#aab2c2', go: '#2f9e5b' };
const HELM_LIGHT: Palette = { appBg: '#e7dfcc', panel: '#f0e9d9', panel2: '#f7f2e7', panel3: '#fffdf7', text: '#14243f', dim: '#55607a', faint: '#8a91a3', hairline: 'rgba(20,36,63,.10)', border: 'rgba(20,36,63,.16)', inputBg: '#fffdf7', accent: '#1e3a66', accentInk: '#f7f2e7', live: '#b0463c', scripture: '#1f4fa8', sermon: '#2f6b4f', message: '#6b4ba8', selBg: '#e3dcc0', lineDim: '#4d5670', go: '#26804a' };

const CONTRAST_DARK: Palette = { appBg: '#000000', panel: '#0c0c0d', panel2: '#16171a', panel3: '#22242a', text: '#ffffff', dim: '#cfd2d6', faint: '#a3a7ad', hairline: 'rgba(255,255,255,.16)', border: 'rgba(255,255,255,.28)', inputBg: '#000000', accent: '#ffd400', accentInk: '#14120a', live: '#ff6a5a', scripture: '#8fc0ff', sermon: '#6fe3a4', message: '#d5a8ff', selBg: '#2a2400', lineDim: '#d8dade', go: '#17b45c' };
const CONTRAST_LIGHT: Palette = { appBg: '#e9eaec', panel: '#f6f7f8', panel2: '#ffffff', panel3: '#ffffff', text: '#000000', dim: '#35383d', faint: '#55595f', hairline: 'rgba(0,0,0,.20)', border: 'rgba(0,0,0,.34)', inputBg: '#ffffff', accent: '#111111', accentInk: '#ffffff', live: '#b3110b', scripture: '#0b3d91', sermon: '#14562f', message: '#5a1e9c', selBg: '#dcdee2', lineDim: '#24262a', go: '#0f6b34' };

const SANCTUARY_DARK: Palette = { appBg: '#1a100e', panel: '#241512', panel2: '#2e1b17', panel3: '#3a231d', text: '#f2e4d6', dim: '#b39a85', faint: '#857062', hairline: 'rgba(242,228,214,.07)', border: 'rgba(242,228,214,.12)', inputBg: '#241512', accent: '#d2793c', accentInk: '#1b1206', live: '#e0574a', scripture: '#6f9bd6', sermon: '#9aae6a', message: '#c295c9', selBg: '#33190f', lineDim: '#bfa895', go: '#2f8f56' };
const SANCTUARY_LIGHT: Palette = { appBg: '#eaddcf', panel: '#f3e9dd', panel2: '#fbf4ec', panel3: '#fffcf7', text: '#38201a', dim: '#7a5849', faint: '#a08069', hairline: 'rgba(56,32,26,.10)', border: 'rgba(56,32,26,.17)', inputBg: '#fffcf7', accent: '#8c3a2e', accentInk: '#fff3ea', live: '#c64a38', scripture: '#2f5f9e', sermon: '#4f6e3a', message: '#7a4a9b', selBg: '#efd8c8', lineDim: '#6b4a3c', go: '#2c7a4a' };

const GROVE_DARK: Palette = { appBg: '#0c1310', panel: '#111a16', panel2: '#17231d', panel3: '#1f2e26', text: '#e6eadf', dim: '#9ba893', faint: '#6e7a69', hairline: 'rgba(230,234,223,.07)', border: 'rgba(230,234,223,.12)', inputBg: '#111a16', accent: '#a8c46a', accentInk: '#0f1a0c', live: '#d2695c', scripture: '#7fa9e8', sermon: '#86c08a', message: '#b69ad4', selBg: '#1b2612', lineDim: '#aab5a1', go: '#2f9e5b' };
const GROVE_LIGHT: Palette = { appBg: '#e2e6da', panel: '#edf0e6', panel2: '#f6f8f1', panel3: '#ffffff', text: '#1e2a1f', dim: '#5c6a57', faint: '#889383', hairline: 'rgba(30,42,31,.10)', border: 'rgba(30,42,31,.15)', inputBg: '#ffffff', accent: '#4b6b2f', accentInk: '#f3f7ec', live: '#a94134', scripture: '#2f5b9e', sermon: '#3d6b3f', message: '#6a4a9e', selBg: '#dde7c9', lineDim: '#48543f', go: '#2c7a4a' };

export const FAMILIES: Record<ThemeFamily, { label: string; presetName: Record<ThemeMode, string>; dark: Palette; light: Palette }> = {
  classic:   { label: 'Classic',   presetName: { dark: 'Charcoal',  light: 'Chalk' },          dark: CLASSIC_DARK,   light: CLASSIC_LIGHT },
  helm:      { label: 'Helm',      presetName: { dark: 'Helm Navy', light: 'Helm Parchment' }, dark: HELM_DARK,      light: HELM_LIGHT },
  contrast:  { label: 'Contrast',  presetName: { dark: 'Ink',       light: 'Paper' },          dark: CONTRAST_DARK,  light: CONTRAST_LIGHT },
  sanctuary: { label: 'Sanctuary', presetName: { dark: 'Vespers',   light: 'Chapel' },         dark: SANCTUARY_DARK, light: SANCTUARY_LIGHT },
  grove:     { label: 'Grove',     presetName: { dark: 'Cedar',     light: 'Sage' },           dark: GROVE_DARK,     light: GROVE_LIGHT },
};

/** Classic dark palette — LeaderView renders operator-dark regardless of the operator's pick. */
export const DARK = CLASSIC_DARK;

export function themeFor(family: ThemeFamily, mode: ThemeMode): Theme {
  const p = FAMILIES[family][mode];
  return {
    ...p,
    floatShadow: `0 18px 50px rgba(0,0,0,.45), inset 0 0 0 1px ${p.border}`,
    modalShadow: '0 30px 80px rgba(0,0,0,.5)',
    scrim: 'rgba(8,9,12,.6)'
  };
}
