import { useContext, useEffect, useState, type CSSProperties, type JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import type { UpdateStatus } from '../../shared/types'

/**
 * Quiet "restart when you like" affordance. Deliberately invisible unless an
 * update is downloaded AND no output window is up — the operator must never
 * see update chrome mid-service.
 */
export function UpdatePill(): JSX.Element | null {
  const T = useContext(ThemeCtx)
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle', version: null })
  const [outputs, setOutputs] = useState(0)

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
      setOutputs(d.outputs)
    })
    void window.helm.displays.get().then((d) => {
      if (!gotPush) setOutputs(d.outputs)
    })
    return off
  }, [])

  if (status.state !== 'ready' || outputs > 0) return null

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
