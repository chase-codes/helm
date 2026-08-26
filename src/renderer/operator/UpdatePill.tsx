import { useContext, useEffect, useState, type CSSProperties, type JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import type { DisplayStatus, UpdateStatus } from '../../shared/types'

/**
 * Quiet "restart when you like" affordance. Deliberately invisible unless an
 * update is downloaded AND no output window is up AND the screens aren't released
 * to a guest presenter (#66) — the operator must never see update chrome
 * mid-service, and installing relaunches, which would re-claim released screens.
 */
export function UpdatePill(): JSX.Element | null {
  const T = useContext(ThemeCtx)
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle', version: null })
  const [displays, setDisplays] = useState<DisplayStatus>({ outputs: 0, displays: [], released: false })

  useEffect(() => {
    // A pushed onStatus event is always at least as fresh as the in-flight
    // initial fetch, so once one arrives, ignore the fetch's stale result.
    let gotPush = false
    const off = window.helm.updates.onStatus((s) => {
      gotPush = true
      setStatus(s)
    })
    void window.helm.updates.getStatus().then((s) => {
      if (!gotPush) setStatus(s)
    })
    return off
  }, [])

  useEffect(() => {
    let gotPush = false
    const off = window.helm.displays.onStatus((d) => {
      gotPush = true
      setDisplays(d)
    })
    void window.helm.displays.get().then((d) => {
      if (!gotPush) setDisplays(d)
    })
    return off
  }, [])

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
