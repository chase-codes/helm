import { useContext, type CSSProperties, type JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import { useDisplayStatus } from '../shared/useHelm'
import { OUTPUT_ROLES, OUTPUT_VIEWS } from '../../shared/displays/roles'
import type { OutputRole, OutputViewMode } from '../../shared/types'

const VIEW_LABEL: Record<OutputViewMode, string> = {
  slides: 'Slides',
  leader: 'Leader',
  mirror: 'Mirror'
}

export function DisplaysSettings(): JSX.Element {
  const T = useContext(ThemeCtx)
  const { displays } = useDisplayStatus()

  const sectionTitleStyle: CSSProperties = {
    fontSize: '15px',
    fontWeight: 700,
    marginBottom: '4px'
  }
  const sectionHintStyle: CSSProperties = {
    fontSize: '12.5px',
    color: T.dim,
    lineHeight: 1.4,
    marginBottom: '16px'
  }
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 4px',
    borderBottom: `1px solid ${T.hairline}`
  }
  const nameStyle: CSSProperties = { fontSize: '13.5px', fontWeight: 600, color: T.text }
  const specChipStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '11px',
    color: T.faint
  }
  const operatorTagStyle: CSSProperties = {
    fontSize: '12.5px',
    fontWeight: 600,
    color: T.accentInk,
    background: T.accent,
    padding: '4px 10px',
    borderRadius: '6px',
    whiteSpace: 'nowrap'
  }
  const roleSelectStyle: CSSProperties = {
    height: '30px',
    padding: '0 8px',
    borderRadius: '8px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '12.5px',
    fontWeight: 600,
    color: T.text
  }
  const segWrapStyle: CSSProperties = {
    display: 'flex',
    gap: '3px',
    background: T.panel2,
    padding: '3px',
    borderRadius: '8px'
  }
  const segStyle = (active: boolean): CSSProperties => ({
    padding: '4px 9px',
    borderRadius: '6px',
    fontSize: '11.5px',
    fontWeight: active ? 700 : 600,
    color: active ? T.accentInk : T.dim,
    background: active ? T.accent : 'transparent'
  })

  return (
    <>
      <div style={sectionTitleStyle}>Displays</div>
      <div style={sectionHintStyle}>
        Each screen Helm drives has a role (what feed it gets) and a view (how it shows it). Mirror
        shows this operator screen; Leader shows a clean song view for the pulpit. Off leaves a
        screen entirely alone — note two identical unlabeled monitors share one identity, so
        marking one off marks both.
      </div>
      {displays.map((d) => {
        const name = d.label || `${d.width}×${d.height}`
        return (
          <div key={d.fingerprint} style={rowStyle}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={nameStyle}>{name}</div>
              <div style={specChipStyle}>{`${d.width}×${d.height} @${d.scaleFactor}x`}</div>
            </div>
            {d.isOperator ? (
              <span style={operatorTagStyle}>Operator screen</span>
            ) : (
              <>
                <select
                  style={roleSelectStyle}
                  value={d.role ?? 'audience'}
                  data-testid={`role-${d.fingerprint}`}
                  onChange={(e) =>
                    window.helm.displays.setRole(d.fingerprint, e.target.value as OutputRole)
                  }
                >
                  {OUTPUT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                {d.role !== 'off' && (
                  <div style={segWrapStyle}>
                    {OUTPUT_VIEWS.map((v) => (
                      <button
                        key={v}
                        style={segStyle(d.view === v)}
                        data-testid={`view-${d.fingerprint}-${v}`}
                        onClick={() => window.helm.displays.setView(d.fingerprint, v)}
                      >
                        {VIEW_LABEL[v]}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </>
  )
}
