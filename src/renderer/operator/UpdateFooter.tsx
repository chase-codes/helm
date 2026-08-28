import { useContext, useEffect, useState, type CSSProperties, type JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import { useDisplayStatus, useUpdateStatus } from './useHelm'

const SITE_URL = 'https://chase-codes.github.io/helm/'

/**
 * Settings-sidebar footer: current version plus a manual "Check for updates".
 * The only surface that renders the manual-only updater states (checking /
 * downloading / upToDate / error / unsupported) — the header UpdatePill stays
 * ready-only so no update chrome ever appears mid-service. This is also where
 * the outputs-up install deferral is explained rather than hidden.
 */
export function UpdateFooter(): JSX.Element {
  const T = useContext(ThemeCtx)
  const status = useUpdateStatus()
  const { outputs } = useDisplayStatus()
  const [version, setVersion] = useState('')

  useEffect(() => {
    let live = true
    void window.helm.app.version().then((v) => {
      if (live) setVersion(v)
    })
    return () => {
      live = false
    }
  }, [])

  const wrapStyle: CSSProperties = {
    marginTop: 'auto',
    paddingTop: '10px',
    borderTop: `1px solid ${T.hairline}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  }
  const versionStyle: CSSProperties = { fontSize: '11px', color: T.faint, padding: '0 12px' }
  const noteStyle: CSSProperties = {
    fontSize: '11.5px',
    color: T.dim,
    lineHeight: 1.35,
    padding: '0 12px'
  }
  const btnStyle: CSSProperties = {
    margin: '0 12px',
    height: '26px',
    borderRadius: '7px',
    background: T.panel3,
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '11.5px',
    fontWeight: 600,
    color: T.dim,
    whiteSpace: 'nowrap'
  }
  const linkStyle: CSSProperties = { ...noteStyle, color: T.accent, textDecoration: 'underline' }

  const checkBtn = (label: string): JSX.Element => (
    <button style={btnStyle} onClick={() => void window.helm.updates.check()}>
      {label}
    </button>
  )

  let body: JSX.Element
  switch (status.state) {
    case 'checking':
      body = <span style={noteStyle}>Checking…</span>
      break
    case 'downloading':
      body = <span style={noteStyle}>Downloading… {Math.round(status.percent ?? 0)}%</span>
      break
    case 'upToDate':
      body = (
        <>
          <span style={noteStyle}>You’re up to date</span>
          {checkBtn('Check for updates')}
        </>
      )
      break
    case 'error':
      body = (
        <>
          <span style={noteStyle}>
            Couldn’t check for updates{status.message ? ` — ${status.message}` : ''}
          </span>
          {checkBtn('Retry')}
        </>
      )
      break
    case 'unsupported':
      body = (
        <>
          <span style={noteStyle}>In-app updates aren’t available on macOS yet.</span>
          <a href={SITE_URL} target="_blank" rel="noreferrer" style={linkStyle}>
            Download the latest from the Helm site
          </a>
        </>
      )
      break
    case 'ready':
      body =
        outputs > 0 ? (
          <span style={noteStyle}>Update ready — installs once output displays are closed</span>
        ) : (
          <button style={btnStyle} onClick={() => void window.helm.updates.install()}>
            Restart to update
          </button>
        )
      break
    default: // idle | available — nothing manual in flight, offer the check
      body = checkBtn('Check for updates')
  }

  return (
    <div style={wrapStyle}>
      <div style={versionStyle}>{version ? `Helm ${version}` : ''}</div>
      {body}
    </div>
  )
}
