import { useContext, useEffect, useRef, type CSSProperties, type JSX, type RefObject } from 'react'
import { ThemeCtx } from './ThemeCtx'
import { useDisplayStatus } from '../shared/useHelm'
import { DEFAULT_LEADER_SPLIT, LEADER_SPLIT_MAX, LEADER_SPLIT_MIN, OUTPUT_VIEWS } from '../../shared/displays/roles'
import type { OutputViewMode } from '../../shared/types'

const VIEW_LABEL: Record<OutputViewMode, string> = {
  slides: 'Slides',
  leader: 'Leader',
  mirror: 'Mirror'
}

/** Quick per-screen view switcher, anchored under the header's outputs chip. */
export function OutputViewPopover({
  onClose,
  containRef
}: {
  onClose: () => void
  containRef: RefObject<HTMLDivElement | null>
}): JSX.Element {
  const T = useContext(ThemeCtx)
  const { displays } = useDisplayStatus()
  const outputs = displays.filter((d) => !d.isOperator && d.role !== 'off')
  const popRef = useRef<HTMLDivElement | null>(null)

  // Dismiss on Escape key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Dismiss on outside click (capture phase) or window blur.
  // Check containRef (chip + popover) not just the popover, so clicks on the chip don't dismiss prematurely.
  // Mousedown in capture phase fires before the click handler, so inside-check is mandatory.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!containRef.current?.contains(e.target as Node)) onClose()
    }
    const dismiss = (): void => onClose()
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', dismiss)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', dismiss)
    }
  }, [onClose, containRef])

  const popStyle: CSSProperties = {
    position: 'absolute',
    top: '46px',
    right: 0,
    zIndex: 60,
    minWidth: '300px',
    background: T.panel,
    borderRadius: '12px',
    boxShadow: `0 12px 40px rgba(0,0,0,0.45), inset 0 0 0 1px ${T.hairline}`,
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  }
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 8px'
  }
  const nameStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontSize: '13px',
    fontWeight: 600,
    color: T.text,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }
  const roleStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '10px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: T.faint
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
    <div ref={popRef} style={popStyle} data-testid="output-view-popover">
      {outputs.length === 0 && (
        <div style={{ ...nameStyle, color: T.dim, padding: '6px 8px' }}>
          No output displays connected
        </div>
      )}
      {outputs.map((d) => {
        const name = d.label || `${d.width}×${d.height}`
        return (
          <div key={d.fingerprint}>
            <div style={rowStyle}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={nameStyle}>{name}</div>
                <div style={roleStyle}>{d.role ?? ''}</div>
              </div>
              <div style={segWrapStyle}>
                {OUTPUT_VIEWS.map((v) => (
                  <button
                    key={v}
                    style={segStyle(d.view === v)}
                    data-testid={`view-${d.fingerprint}-${v}`}
                    onClick={() => {
                      window.helm.displays.setView(d.fingerprint, v)
                      onClose()
                    }}
                  >
                    {VIEW_LABEL[v]}
                  </button>
                ))}
              </div>
            </div>
            {d.view === 'leader' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 8px 6px' }}>
                <span style={{ ...roleStyle, flexShrink: 0 }}>SPLIT</span>
                <input
                  type="range"
                  min={LEADER_SPLIT_MIN}
                  max={LEADER_SPLIT_MAX}
                  step={10}
                  value={d.leaderSplit ?? DEFAULT_LEADER_SPLIT}
                  data-testid={`split-${d.fingerprint}`}
                  style={{ flex: 1, accentColor: T.accent }}
                  onChange={(e) => window.helm.displays.setLeaderSplit(d.fingerprint, Number(e.target.value))}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
