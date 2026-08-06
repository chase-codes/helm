import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { OutputPayload, Song } from '../../shared/types'
import { parseSongKey } from '../../shared/presentation/core'
import { bandCandidates } from '../../shared/slides/fitText'
import { useFitText, fitSizeValue } from '../shared/useFitText'
import { usePresentationState } from '../operator/useHelm'
import { SlidesView } from './SlidesView'

// Hoisted for stable identity in useFitText's deps (same reasoning as SlideCanvas's bands).
const LEADER_BAND = bandCandidates(10.5, 3.5)

export function LeaderView({ payload }: { payload: OutputPayload }): JSX.Element {
  const st = usePresentationState()
  const parsed = parseSongKey(st.liveKey)
  const [song, setSong] = useState<Song | null>(null)
  useEffect(() => {
    // Nothing to fetch for non-song content — the render below already falls back to
    // SlidesView whenever `parsed` is null, regardless of whatever `song` still holds, so
    // there's no stale state to clear here (and clearing it would mean calling setState
    // synchronously in the effect body, which React flags as a footgun).
    if (!parsed) return
    let live = true
    void window.helm.songs.get(parsed.songId).then((s) => {
      if (live) setSong(s)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.songId])

  const rootRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const section = parsed && song ? song.sections[parsed.section] : undefined
  useFitText(rootRef, heroRef, section ? LEADER_BAND : null, [st.liveKey, song?.id])

  // Not a song (or the song was deleted): show exactly what the slides view would, but keep
  // the `leader-view` testid contract OutputApp's view-branching test relies on.
  if (!parsed || !song || !section)
    return (
      <div data-testid="leader-view" style={{ position: 'fixed', inset: 0 }}>
        <SlidesView payload={payload} />
      </div>
    )

  const dim = 'rgba(255,255,255,0.55)'
  const chip = st.output === 'logo' ? 'LOGO' : st.output === 'black' ? 'BLACK' : null
  const rootStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: '#000',
    color: '#fff',
    display: 'flex',
    fontFamily: "'Hanken Grotesk',sans-serif"
  }
  const heroWrapStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: '3cqmin 4cqmin',
    containerType: 'size'
  }
  const titleRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexShrink: 0,
    fontFamily: "'JetBrains Mono',monospace",
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontSize: 'max(12px, 2.2cqmin)',
    color: dim
  }
  const chipStyle: CSSProperties = {
    padding: '2px 10px',
    borderRadius: '6px',
    background: 'rgba(224,163,65,0.2)',
    color: '#e0a341',
    fontWeight: 700
  }
  const lineStyle: CSSProperties = {
    fontWeight: 700,
    lineHeight: 1.22,
    letterSpacing: '-0.012em',
    fontSize: `max(14px, ${fitSizeValue('7.4cqmin')})`
  }
  const railStyle: CSSProperties = {
    width: '30%',
    maxWidth: '420px',
    minWidth: '260px',
    flexShrink: 0,
    overflowY: 'auto',
    borderLeft: '1px solid rgba(255,255,255,0.14)',
    padding: '2.5cqmin 2cqmin',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.2cqmin',
    containerType: 'size'
  }
  const sectionCardStyle = (live: boolean): CSSProperties => ({
    padding: '1.6cqmin 1.8cqmin',
    borderRadius: '10px',
    background: live ? 'rgba(224,163,65,0.16)' : 'rgba(255,255,255,0.05)',
    boxShadow: live ? 'inset 0 0 0 2px #e0a341' : 'inset 0 0 0 1px rgba(255,255,255,0.10)'
  })
  const sectionLabelStyle = (live: boolean): CSSProperties => ({
    fontFamily: "'JetBrains Mono',monospace",
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontSize: 'max(11px, 2.4cqmin)',
    fontWeight: 700,
    color: live ? '#e0a341' : dim
  })
  const sectionSnippetStyle: CSSProperties = {
    fontSize: 'max(12px, 2.6cqmin)',
    color: 'rgba(255,255,255,0.8)',
    marginTop: '0.6cqmin',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }

  return (
    <div style={rootStyle} data-testid="leader-view">
      <div ref={rootRef} style={heroWrapStyle}>
        <div style={titleRowStyle}>
          <span>{song.title}</span>
          <span>· {section.label}</span>
          {chip && <span style={chipStyle}>{chip}</span>}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
          <div
            ref={heroRef}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.8em', width: '100%' }}
          >
            {section.lines.map((ln, i) => (
              <div key={i} style={lineStyle}>
                {ln}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={railStyle} data-testid="leader-rail">
        {song.sections.map((s, i) => {
          const live = parsed.section === i
          return (
            <div
              key={i}
              style={sectionCardStyle(live)}
              data-testid={`leader-section-${i}`}
              data-live={String(live)}
            >
              <div style={sectionLabelStyle(live)}>{s.label}</div>
              <div style={sectionSnippetStyle}>{s.lines[0] ?? ''}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
