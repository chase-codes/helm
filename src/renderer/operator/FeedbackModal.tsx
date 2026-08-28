import { useContext, useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { ModalShell } from './ModalShell'
import { ThemeCtx } from './ThemeCtx'
import { FEEDBACK_TEXT_MAX } from '../../shared/feedbackIssue'
import type { FeedbackContext, FeedbackPayload, FeedbackSendResult, FeedbackType } from '../../shared/types'

type Phase = { k: 'edit' } | { k: 'sending' } | { k: 'sent'; url: string } | { k: 'failed'; fallback: string } | { k: 'unconfigured'; fallback: string }

const PLACEHOLDER: Record<FeedbackType, string> = {
  bug: 'What happened, and what did you expect instead?',
  feature: 'What would you like Helm to do? When would you use it?',
}
const COUNTER_FROM = 3500
// Last-resort link when fallbackUrl() itself is unreachable — a blank issue beats no link.
const PLAIN_NEW_ISSUE_URL = 'https://github.com/chase-codes/helm/issues/new'

async function safeFallbackUrl(payload: FeedbackPayload): Promise<string> {
  try {
    return await window.helm.feedback.fallbackUrl(payload)
  } catch {
    return PLAIN_NEW_ISSUE_URL
  }
}

export function FeedbackModal({ onClose }: { onClose: () => void }): JSX.Element {
  const T = useContext(ThemeCtx)
  const [type, setType] = useState<FeedbackType>('feature')
  const [text, setText] = useState('')
  const [ctx, setCtx] = useState<FeedbackContext | null>(null)
  const [showCtx, setShowCtx] = useState(false)
  const [phase, setPhase] = useState<Phase>({ k: 'edit' })
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    window.helm.feedback.context()
      .then((c) => { if (mountedRef.current) setCtx(c) })
      .catch(() => { /* swallowed — submit() fetches it again lazily on send */ })
  }, [])

  // Auto-close after a successful send; Done closes sooner.
  useEffect(() => {
    if (phase.k !== 'sent') return
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [phase, onClose])

  // Doesn't wait on ctx resolving — Send enables on typed text alone; the context fetch
  // (usually already settled by the time anyone types) is awaited lazily inside submit().
  const canSend = text.trim().length > 0 && phase.k !== 'sending'

  const submit = async (): Promise<void> => {
    if (!canSend) return
    setPhase({ k: 'sending' })
    let resolvedCtx: FeedbackContext | null = ctx
    try {
      const c = resolvedCtx ?? (await window.helm.feedback.context())
      resolvedCtx = c
      if (mountedRef.current && !ctx) setCtx(c)
      const payload: FeedbackPayload = { type, text, context: c }
      const r: FeedbackSendResult = await window.helm.feedback.send(payload)
      if (!mountedRef.current) return
      if (r.ok) { setPhase({ k: 'sent', url: r.url }); return }
      const fallback = await safeFallbackUrl(payload)
      if (!mountedRef.current) return
      setPhase(r.reason === 'unconfigured' ? { k: 'unconfigured', fallback } : { k: 'failed', fallback })
    } catch {
      if (!mountedRef.current) return
      const fallback = resolvedCtx ? await safeFallbackUrl({ type, text, context: resolvedCtx }) : PLAIN_NEW_ISSUE_URL
      if (!mountedRef.current) return
      setPhase({ k: 'failed', fallback })
    }
  }

  // Fixed footprint: the card keeps one height across edit/sending/sent/failed.
  const bodyStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '14px', minHeight: '360px' }
  const h1: CSSProperties = { fontSize: '18px', fontWeight: 700, color: T.text }
  const sub: CSSProperties = { fontSize: '13px', color: T.dim, lineHeight: 1.5 }
  const pillsWrap: CSSProperties = { display: 'flex', gap: '4px', background: T.panel2, padding: '4px', borderRadius: '10px', alignSelf: 'flex-start' }
  const pill = (active: boolean): CSSProperties => ({
    height: '32px', padding: '0 14px', borderRadius: '8px', fontSize: '12.5px',
    fontWeight: active ? 700 : 600, color: active ? T.accentInk : T.dim,
    background: active ? T.accent : 'transparent', cursor: 'pointer',
  })
  const area: CSSProperties = {
    width: '100%', minHeight: '150px', padding: '10px 12px', background: T.inputBg,
    borderRadius: '9px', boxShadow: `inset 0 0 0 1px ${T.border}`, fontSize: '13.5px', lineHeight: 1.55, resize: 'vertical',
  }
  const faint: CSSProperties = { fontSize: '11.5px', color: T.faint }
  const disclosure: CSSProperties = { ...faint, cursor: 'pointer', fontWeight: 600, letterSpacing: '0.04em' }
  const row: CSSProperties = { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', marginTop: 'auto' }
  const cancel: CSSProperties = { height: '40px', padding: '0 18px', borderRadius: '10px', background: T.panel2, boxShadow: `inset 0 0 0 1px ${T.border}`, fontSize: '14px', color: T.dim }
  const primary = (enabled: boolean): CSSProperties => ({
    height: '40px', padding: '0 20px', borderRadius: '10px', background: T.accent, color: T.accentInk,
    fontWeight: 700, fontSize: '14px', opacity: enabled ? 1 : 0.5, cursor: enabled ? 'pointer' : 'not-allowed',
    display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
  })
  const link: CSSProperties = { color: T.accent, fontSize: '13px', textDecoration: 'underline' }

  const contextList = ctx && (
    <ul style={{ ...faint, margin: '6px 0 0 16px', lineHeight: 1.7 }}>
      <li>Version: {ctx.version}</li>
      <li>OS: {ctx.os}</li>
      <li>Arch: {ctx.arch}</li>
      <li>Displays: {ctx.displays}</li>
      <li>Bibles installed: {ctx.hasBibles ? 'yes' : 'no'}</li>
      <li>Songs in library: {ctx.hasSongs ? 'yes' : 'no'}</li>
    </ul>
  )

  return (
    <ModalShell onClose={onClose} variant="card" width="520px" maxWidth="96vw" maxHeight="88vh">
      <div style={bodyStyle}>
        {phase.k === 'sent' ? (
          <>
            <div style={h1}>Sent — thank you.</div>
            <div style={sub}>We read every one. If we need more detail we&apos;ll follow up on the issue.</div>
            <a href={phase.url} target="_blank" rel="noreferrer" style={link}>View on GitHub</a>
            <div style={row}><button style={primary(true)} onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            <div style={h1}>What would make Helm better?</div>
            <div style={sub}>Tell us about a problem or something you&apos;d like. It goes straight to the team.</div>
            <div style={pillsWrap}>
              <button style={pill(type === 'bug')} onClick={() => setType('bug')}>Something&apos;s wrong</button>
              <button style={pill(type === 'feature')} onClick={() => setType('feature')}>Something I&apos;d like</button>
            </div>
            <textarea
              style={area}
              value={text}
              maxLength={FEEDBACK_TEXT_MAX}
              placeholder={PLACEHOLDER[type]}
              disabled={phase.k === 'sending'}
              onChange={(e) => setText(e.target.value)}
            />
            {text.length >= COUNTER_FROM && <div style={{ ...faint, textAlign: 'right' }}>{text.length} / {FEEDBACK_TEXT_MAX}</div>}
            <div>
              <div style={disclosure} onClick={() => setShowCtx((s) => !s)}>
                {showCtx ? '▾' : '▸'} <span>Included with your report</span>
              </div>
              {showCtx && (
                <>
                  <div style={{ ...faint, marginTop: '6px' }}>We attach a few details so we can reproduce what you saw. Nothing you&apos;ve typed into Helm is included.</div>
                  {contextList}
                </>
              )}
            </div>
            {phase.k === 'failed' && (
              <div style={{ fontSize: '13px', color: T.dim }}>
                <span>Couldn&apos;t send right now.</span>{' '}
                <a href={phase.fallback} target="_blank" rel="noreferrer" style={link}>Open on GitHub instead</a>
                {' · '}
                <button style={{ ...link, background: 'none' }} onClick={() => setPhase({ k: 'edit' })}>Try again</button>
              </div>
            )}
            <div style={row}>
              <button style={cancel} onClick={onClose}>Cancel</button>
              {phase.k === 'unconfigured' ? (
                <a href={phase.fallback} target="_blank" rel="noreferrer" style={primary(true)}>Continue on GitHub</a>
              ) : (
                <button style={primary(canSend)} disabled={!canSend} onClick={() => void submit()}>
                  {phase.k === 'sending' ? 'Sending…' : 'Send'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  )
}
