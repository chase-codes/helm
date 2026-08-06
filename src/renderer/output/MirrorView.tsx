import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'

const RETRY_MS = 3000

/** Live video mirror of the operator's screen. The main process's
 *  setDisplayMediaRequestHandler picks the operator display as the source, so this
 *  getDisplayMedia call shows no picker and needs no user gesture. */
export function MirrorView(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    let stream: MediaStream | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const stop = (): void => {
      if (stream) for (const t of stream.getTracks()) t.stop()
      stream = null
    }
    const start = (): void => {
      // Wrapped in Promise.resolve().then(...) so a missing/undefined mediaDevices API
      // (some embedders, or a test environment without it stubbed) is routed through the
      // same .catch() error path below, instead of throwing synchronously and crashing
      // the component past the in-place error message.
      Promise.resolve()
        .then(() =>
          navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
        )
        .then((s) => {
          if (!live) {
            for (const t of s.getTracks()) t.stop()
            return
          }
          if (stream) {
            // A concurrent acquisition already won (e.g. two tracks' 'ended' listeners each
            // scheduled a retry before the timer clear below was in place to dedupe them) —
            // stop this newcomer rather than clobbering the stream already attached.
            for (const t of s.getTracks()) t.stop()
            return
          }
          stream = s
          setError(null)
          const video = videoRef.current
          if (video) {
            video.srcObject = s
            void video.play?.()
          }
          // If the capture dies (display topology change, permission revoked), retry.
          // { once: true } plus the retryTimer clear below keep a multi-track stream's
          // 'ended' events (one per track) from arming more than one concurrent restart.
          for (const t of s.getTracks())
            t.addEventListener(
              'ended',
              () => {
                if (live) {
                  stop()
                  if (retryTimer) clearTimeout(retryTimer)
                  retryTimer = setTimeout(start, RETRY_MS)
                }
              },
              { once: true }
            )
        })
        .catch(() => {
          if (!live) return
          const isMac = navigator.userAgent.includes('Macintosh')
          setError(
            isMac
              ? 'Screen capture unavailable. Helm needs the Screen Recording permission: System Settings → Privacy & Security → Screen Recording, then relaunch Helm.'
              : 'Screen capture unavailable. Check that no other app is blocking screen capture, or switch this display back to Slides view.'
          )
          if (retryTimer) clearTimeout(retryTimer)
          retryTimer = setTimeout(start, RETRY_MS)
        })
    }
    start()
    return () => {
      live = false
      if (retryTimer) clearTimeout(retryTimer)
      stop()
    }
  }, [])

  const rootStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
  const videoStyle: CSSProperties = { width: '100%', height: '100%', objectFit: 'contain' }
  const errorStyle: CSSProperties = {
    maxWidth: '70%',
    textAlign: 'center',
    color: 'rgba(255,255,255,0.85)',
    fontFamily: "'Hanken Grotesk',sans-serif",
    fontSize: 'max(16px, 2.5vmin)',
    lineHeight: 1.5
  }

  return (
    <div style={rootStyle} data-testid="mirror-view">
      {error ? (
        <div style={errorStyle} data-testid="mirror-error">
          {error}
        </div>
      ) : (
        <video
          ref={videoRef}
          style={videoStyle}
          autoPlay
          muted
          playsInline
          data-testid="mirror-video"
        />
      )}
    </div>
  )
}
