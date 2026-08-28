import { useContext, type CSSProperties, type JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import { useDisplayStatus, useUpdateStatus } from '../shared/useHelm'

/**
 * Quiet "restart when you like" affordance. Deliberately invisible unless an
 * update is downloaded AND no output window is up AND the screens aren't released
 * to a guest presenter (#66) — the operator must never see update chrome
 * mid-service, and installing relaunches, which would re-claim released screens.
 */
export function UpdatePill(): JSX.Element | null {
  const T = useContext(ThemeCtx)
  const status = useUpdateStatus()
  const displays = useDisplayStatus()

  if (status.state !== 'ready' || displays.outputs > 0 || displays.released) return null

  const pillStyle: CSSProperties = {
    height: '28px',
    padding: '0 11px',
    borderRadius: '8px',
    background: T.accent + '1c',
    boxShadow: `inset 0 0 0 1px ${T.accent}55`,
    color: T.accent,
    fontSize: '11.5px',
    fontWeight: 600,
    whiteSpace: 'nowrap'
  }

  return (
    <button
      style={pillStyle}
      title={`Helm ${status.version ?? ''} downloaded — restarts the app`}
      onClick={() => void window.helm.updates.install()}
    >
      Update ready — restart to apply
    </button>
  )
}
