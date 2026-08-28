import { useContext, useEffect, useState, type CSSProperties, type JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import {
  HOTKEY_ACTIONS,
  type HotkeyAction,
  type HotkeyOverrides,
  type HotkeyScope
} from '../../shared/hotkeys/actions'
import { bindingConflict, eventToBinding, formatBinding } from '../../shared/hotkeys/match'
import { MONO } from '../shared/fonts'

export interface ShortcutsSettingsProps {
  overrides: HotkeyOverrides
  onChange: (next: HotkeyOverrides) => void
}

const GROUPS: { scope: HotkeyScope; title: string }[] = [
  { scope: 'global', title: 'Everywhere' },
  { scope: 'songs', title: 'Songs page' },
  { scope: 'scripture', title: 'Scripture page' }
]

/** Settings → Shortcuts. Renders straight from HOTKEY_ACTIONS so the pane can never
 * disagree with what the dispatcher resolves. Rebinds live in `overrides` (owned by App,
 * persisted to the settings store) — this component is a pure editor over that map. */
export function ShortcutsSettings({ overrides, onChange }: ShortcutsSettingsProps): JSX.Element {
  const T = useContext(ThemeCtx)
  const [capturingId, setCapturingId] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ binding: string; holder: HotkeyAction } | null>(null)

  // Window-level capture-phase listener while a chip is armed: it must see the key
  // before App's document dispatcher does, and swallow it entirely.
  useEffect(() => {
    if (!capturingId) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturingId(null)
        setConflict(null)
        return
      }
      const binding = eventToBinding(e)
      if (!binding) return // bare modifier — keep capturing
      const holder = bindingConflict(binding, capturingId, overrides)
      if (holder) {
        setConflict({ binding, holder })
        return
      }
      const action = HOTKEY_ACTIONS.find((a) => a.id === capturingId)
      const current = action ? (overrides[action.id] ?? action.defaults) : []
      // Rebinding to a key the action already holds is a no-op — recording it anyway would
      // write a redundant single-binding override (dropping any OTHER synonym default holds)
      // and mark the row "customized" for a rebind that changed nothing.
      if (!current.includes(binding)) {
        onChange({ ...overrides, [capturingId]: [binding] })
      }
      setCapturingId(null)
      setConflict(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturingId, overrides, onChange])

  const resetOne = (id: string): void => {
    const next = { ...overrides }
    delete next[id]
    onChange(next)
  }

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '9px 4px',
    borderBottom: `1px solid ${T.hairline}`
  }
  const chipStyle = (fixed: boolean, capturing: boolean): CSSProperties => ({
    fontFamily: MONO,
    fontSize: '11px',
    fontWeight: 600,
    padding: '5px 9px',
    borderRadius: '7px',
    background: capturing ? `${T.accent}22` : T.panel3,
    boxShadow: `inset 0 0 0 1px ${capturing ? T.accent : T.border}`,
    color: fixed ? T.faint : T.text,
    cursor: fixed ? 'default' : 'pointer',
    whiteSpace: 'nowrap'
  })
  const groupTitleStyle: CSSProperties = {
    fontSize: '11px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: T.faint,
    fontWeight: 700,
    margin: '18px 0 4px'
  }
  const resetBtnStyle: CSSProperties = {
    height: '26px',
    padding: '0 10px',
    borderRadius: '7px',
    background: 'transparent',
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '11.5px',
    fontWeight: 600,
    color: T.dim
  }

  return (
    <div>
      <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '4px' }}>Shortcuts</div>
      <div style={{ fontSize: '12.5px', color: T.dim, lineHeight: 1.4, marginBottom: '4px' }}>
        Click a key to rebind it, then press the new key. Single-letter keys never fire while
        you&rsquo;re typing in a field.
      </div>
      {GROUPS.map((g) => (
        <div key={g.scope}>
          <div style={groupTitleStyle}>{g.title}</div>
          {HOTKEY_ACTIONS.filter((a) => a.scope === g.scope).map((a) => {
            const bindings = a.fixed ? a.defaults : (overrides[a.id] ?? a.defaults)
            const overridden = !a.fixed && a.id in overrides
            const capturing = capturingId === a.id
            // Each synonym renders as its own text node (not one joined string) so a
            // single-binding action's chip text stays independently queryable in tests
            // and screen readers, even when a sibling action ships multiple synonyms.
            const chipText: JSX.Element | string = a.digitBlock ? (
              '1–9'
            ) : capturing ? (
              'Press a key…'
            ) : (
              <>
                {bindings.map((b, i) => (
                  <span key={b}>
                    {i > 0 && ' / '}
                    {formatBinding(b)}
                  </span>
                ))}
              </>
            )
            return (
              <div key={a.id} style={rowStyle}>
                <span
                  style={{
                    flex: 1,
                    fontSize: '13px',
                    fontWeight: 500,
                    color: a.fixed ? T.dim : T.text
                  }}
                >
                  {a.label}
                  {overridden && <span style={{ color: T.accent }}> •</span>}
                </span>
                {capturing && conflict && (
                  <span data-conflict style={{ fontSize: '11.5px', color: T.live }}>
                    {formatBinding(conflict.binding)} is used by “{conflict.holder.label}”
                  </span>
                )}
                {overridden && (
                  <button
                    aria-label={`reset ${a.label}`}
                    style={resetBtnStyle}
                    onClick={() => resetOne(a.id)}
                  >
                    Reset
                  </button>
                )}
                {a.fixed ? (
                  <span style={chipStyle(true, false)} title="Not rebindable">
                    {chipText}
                  </span>
                ) : (
                  <button
                    aria-label={`rebind ${a.label}`}
                    style={chipStyle(false, capturing)}
                    onClick={() => {
                      setConflict(null)
                      setCapturingId(capturing ? null : a.id)
                    }}
                  >
                    {chipText}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ))}
      <div style={{ marginTop: '16px' }}>
        <button aria-label="reset all shortcuts" style={resetBtnStyle} onClick={() => onChange({})}>
          Reset all to defaults
        </button>
      </div>
    </div>
  )
}
