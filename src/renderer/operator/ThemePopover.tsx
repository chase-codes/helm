import { useContext, useEffect, type CSSProperties, type JSX, type RefObject } from 'react'
import { ThemeCtx } from './ThemeCtx'
import { FAMILIES, type ThemeFamily } from '../../shared/theme'

/** Theme-family picker, anchored under the header's themes button. */
export function ThemePopover({
  family,
  onSelect,
  onClose,
  containRef
}: {
  family: ThemeFamily
  onSelect: (f: ThemeFamily) => void
  onClose: () => void
  containRef: RefObject<HTMLDivElement | null>
}): JSX.Element {
  const T = useContext(ThemeCtx)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    minWidth: '220px',
    background: T.panel,
    borderRadius: '12px',
    boxShadow: `0 12px 40px rgba(0,0,0,0.45), inset 0 0 0 1px ${T.hairline}`,
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  }
  const rowStyle = (active: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: active ? 700 : 600,
    color: active ? T.text : T.dim,
    background: active ? T.panel2 : 'transparent',
    textAlign: 'left' as const
  })
  const swatchStyle = (bg: string, ring: string): CSSProperties => ({
    width: '14px',
    height: '14px',
    borderRadius: '4px',
    background: bg,
    boxShadow: `inset 0 0 0 1px ${ring}`,
    flexShrink: 0
  })

  return (
    <div style={popStyle} data-testid="theme-popover">
      {(Object.keys(FAMILIES) as ThemeFamily[]).map((f) => {
        const fam = FAMILIES[f]
        return (
          <button
            key={f}
            style={rowStyle(f === family)}
            onClick={() => {
              onSelect(f)
              onClose()
            }}
          >
            <span style={swatchStyle(fam.dark.appBg, T.border)} />
            <span style={swatchStyle(fam.dark.accent, T.border)} />
            <span style={{ flex: 1 }}>{fam.label}</span>
            {f === family && <span style={{ color: T.accent }}>✓</span>}
          </button>
        )
      })}
    </div>
  )
}
