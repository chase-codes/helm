import { useContext, type CSSProperties, type JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import { FAMILIES, type ThemeFamily, type ThemeMode } from '../../shared/theme'

export interface AppearanceSettingsProps {
  family: ThemeFamily
  onFamilyChange: (f: ThemeFamily) => void
  themeMode: ThemeMode
  onModeChange: (m: ThemeMode) => void
}

/** Settings › Appearance: theme-family cards + dark/light mode control. */
export function AppearanceSettings({
  family,
  onFamilyChange,
  themeMode,
  onModeChange
}: AppearanceSettingsProps): JSX.Element {
  const T = useContext(ThemeCtx)

  const titleStyle: CSSProperties = { fontSize: '15px', fontWeight: 700, marginBottom: '4px' }
  const hintStyle: CSSProperties = {
    fontSize: '12.5px',
    color: T.dim,
    lineHeight: 1.4,
    marginBottom: '16px'
  }
  const groupLabelStyle: CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: T.dim,
    margin: '18px 0 10px'
  }
  const cardsRowStyle: CSSProperties = { display: 'flex', gap: '12px' }
  const cardStyle = (active: boolean): CSSProperties => ({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '12px 14px',
    borderRadius: '10px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 ${active ? 2 : 1}px ${active ? T.accent : T.border}`,
    textAlign: 'left'
  })
  const swatchRowStyle: CSSProperties = { display: 'flex', gap: '6px' }
  const swatchStyle = (bg: string): CSSProperties => ({
    width: '18px',
    height: '18px',
    borderRadius: '5px',
    background: bg,
    boxShadow: `inset 0 0 0 1px ${T.border}`
  })
  const segWrapStyle: CSSProperties = {
    display: 'inline-flex',
    gap: '4px',
    background: T.panel2,
    padding: '4px',
    borderRadius: '10px'
  }
  const segBtnStyle = (active: boolean): CSSProperties => ({
    padding: '7px 16px',
    borderRadius: '7px',
    fontSize: '13px',
    fontWeight: active ? 700 : 600,
    color: active ? T.accentInk : T.dim,
    background: active ? T.accent : 'transparent'
  })

  return (
    <>
      <div style={titleStyle}>Appearance</div>
      <div style={hintStyle}>
        Pick a theme for the operator screen. Changes apply instantly; the header sun/moon
        button flips the same dark/light setting.
      </div>
      <div style={groupLabelStyle}>Theme</div>
      <div style={cardsRowStyle}>
        {(Object.keys(FAMILIES) as ThemeFamily[]).map((f) => {
          const fam = FAMILIES[f]
          const active = f === family
          return (
            <button
              key={f}
              style={cardStyle(active)}
              onClick={() => onFamilyChange(f)}
              data-testid={`family-${f}`}
            >
              <span style={swatchRowStyle}>
                <span style={swatchStyle(fam[themeMode].appBg)} />
                <span style={swatchStyle(fam[themeMode].accent)} />
              </span>
              <span style={{ fontSize: '13.5px', fontWeight: 700, color: T.text }}>
                {fam.label} {active && <span style={{ color: T.accent }}>✓</span>}
              </span>
              <span style={{ fontSize: '12px', color: T.dim }}>{fam.presetName[themeMode]}</span>
            </button>
          )
        })}
      </div>
      <div style={groupLabelStyle}>Mode</div>
      <div style={segWrapStyle}>
        {(['dark', 'light'] as ThemeMode[]).map((m) => (
          <button key={m} style={segBtnStyle(m === themeMode)} onClick={() => onModeChange(m)}>
            {m === 'dark' ? 'Dark' : 'Light'}
          </button>
        ))}
      </div>
    </>
  )
}
