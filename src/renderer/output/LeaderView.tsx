import { useEffect, useRef, useState, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react'
import type { BibleManifestEntry, ChapterData, OutputPayload, Song } from '../../shared/types'
import { parseSongKey } from '../../shared/presentation/core'
import { parseScriptureKey } from '../../shared/scripture/slides'
import { DEFAULT_LEADER_SPLIT, clampLeaderSplit } from '../../shared/displays/roles'
import { LYRICS_BAND, SlideCanvas } from '../shared/SlideCanvas'
import { useFitText, fitSizeValue } from '../shared/useFitText'
import { usePresentationState } from '../shared/useHelm'
import { DARK as T } from '../../shared/theme'
import { SlidesView } from './SlidesView'
import { MONO } from '../shared/fonts'


export function LeaderView({ payload }: { payload: OutputPayload }): JSX.Element {
  const st = usePresentationState()
  // Live-first: while output is live the leader is locked to the live song — the
  // congregation is singing it, and no amount of operator browsing/arming may move this
  // display. When output is down, follow the cue instead (prep view between songs).
  const shownKey = st.output === 'live' && st.liveKey ? st.liveKey : (st.cuedKey ?? st.liveKey)
  // The snap paired with shownKey — same live-first selection. For scripture it is the
  // exact projected slide (ref + version columns), which the hero re-renders verbatim.
  const shownSnap = st.output === 'live' && st.liveKey ? st.liveSnap : (st.cuedKey ? st.cuedSnap : st.liveSnap)
  const parsed = parseSongKey(shownKey)
  const scr = parsed ? null : parseScriptureKey(shownKey)
  const [song, setSong] = useState<Song | null>(null)
  useEffect(() => {
    // Nothing to fetch for non-song content — the render below already falls back to
    // SlidesView whenever `parsed` is null, regardless of whatever `song` still holds, so
    // there's no stale state to clear here (and clearing it would mean calling setState
    // synchronously in the effect body, which React flags as a footgun).
    if (!parsed) return
    let live = true
    void window.helm.songs
      .get(parsed.songId)
      .then((s) => {
        if (live) setSong(s)
      })
      .catch((err: unknown) => {
        // Leave `song` null — the render below falls back to SlidesView whenever
        // `current`/`section` can't be resolved, so an IPC failure here degrades to
        // that fallback instead of becoming an unhandled rejection.
        console.error('[helm] leader song fetch failed:', err)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.songId])

  // Scripture context (#188): the chapter's verses fill the rail so the leader can read
  // ahead of the projected verse. Same degrade contract as the song fetch above — a
  // failed or unresolved fetch leaves the SlidesView fallback showing the bare slide.
  const [chapter, setChapter] = useState<ChapterData | null>(null)
  useEffect(() => {
    if (!scr) return
    let live = true
    void window.helm.bibles
      .getChapter(scr.book, scr.ch)
      .then((c) => {
        if (live) setChapter(c)
      })
      .catch((err: unknown) => {
        console.error('[helm] leader chapter fetch failed:', err)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scr?.book, scr?.ch])
  const [manifest, setManifest] = useState<BibleManifestEntry[]>([])
  useEffect(() => {
    if (!scr || manifest.length) return
    let live = true
    void window.helm.bibles
      .manifest()
      .then((m) => {
        if (live) setManifest(m)
      })
      .catch((err: unknown) => {
        console.error('[helm] leader manifest fetch failed:', err)
      })
    return () => {
      live = false
    }
    // Keyed on the passage, not a boolean: a failed manifest fetch retries on the next
    // chapter crossing instead of leaving the rail translation-less all service.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scr?.book, scr?.ch])

  // Stale-chapter identity gate, same reason as the song gate below: on a cross-chapter
  // move `scr` points at the new chapter while `chapter` still holds the old rows.
  const scrChapter = scr && chapter && chapter.book === scr.book && chapter.chapter === scr.ch ? chapter : null
  // Rail text version: the projected slide's primary column (an abbr) mapped back to its
  // version id, else the first installed version. STRICT after that — a verse the
  // projected translation omits stays blank rather than silently showing another
  // translation's text (getChapter returns every installed version, unfiltered).
  const scrSnap = scr && shownSnap?.kind === 'scripture' ? shownSnap : null
  const primaryAbbr = scrSnap?.columns?.[0]?.version
  const primaryId =
    manifest.find((m) => m.abbr === primaryAbbr)?.id ?? manifest.find((m) => m.installed)?.id
  const verseText = (v: number): string => (primaryId ? (scrChapter?.verses[v]?.[primaryId] ?? '') : '')

  // Keep the live verse card in view as the operator advances — the whole point of the
  // rail is read-ahead, so center it and let the following verses show below it.
  const verseRefs = useRef<Record<number, HTMLDivElement | null>>({})
  useEffect(() => {
    if (!scr || !scrChapter) return
    verseRefs.current[scr.v]?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [scr?.book, scr?.ch, scr?.v, scrChapter])

  // Split: payload value is authoritative between drags; local state carries the live drag.
  // Adjusting `split` when `payload.leaderSplit` changes is React's sanctioned "adjust state
  // during render" pattern (mirrored-in-state previous value, compared and corrected before
  // paint) rather than an effect — react-hooks/set-state-in-effect flags an unconditional
  // setState at the top of a useEffect body; see SongImport.tsx's `openFor` for the same shape.
  // The mirror (`prevPayloadSplit`) advances unconditionally — even mid-drag — so that the
  // commit echo (setLeaderSplit(null, px) round-tripping back through this same window once
  // main persists it) is recognized as "already seen" and doesn't re-fire after the drag ends.
  // Only the *derived* update (`setSplit`) is gated on `!dragging`, so a payload change that
  // arrives mid-drag can't fight the live drag or clobber the just-dragged width on release.
  const clampedPayloadSplit = clampLeaderSplit(payload.leaderSplit ?? DEFAULT_LEADER_SPLIT)
  const [split, setSplit] = useState(clampedPayloadSplit)
  const [prevPayloadSplit, setPrevPayloadSplit] = useState(clampedPayloadSplit)
  const [dragging, setDragging] = useState(false)
  if (clampedPayloadSplit !== prevPayloadSplit) {
    setPrevPayloadSplit(clampedPayloadSplit)
    if (!dragging) setSplit(clampedPayloadSplit)
  }
  const dragCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => dragCleanupRef.current?.(), [])
  const startDrag = (e: ReactMouseEvent): void => {
    e.preventDefault()
    if (dragCleanupRef.current) return
    const startX = e.clientX
    const startW = split
    let latest = startW
    const onMove = (ev: MouseEvent): void => {
      // Rail is right-anchored: dragging left grows it.
      latest = clampLeaderSplit(startW - (ev.clientX - startX))
      setSplit(latest)
    }
    const cleanup = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      dragCleanupRef.current = null
    }
    const onUp = (): void => {
      cleanup()
      setDragging(false)
      window.helm.displays.setLeaderSplit(null, latest)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    dragCleanupRef.current = cleanup
    setDragging(true)
  }

  const rootRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  // Gate on identity, not just presence: on a direct song A -> song B switch, `parsed`
  // points at B immediately but `song` state still holds A until B's fetch resolves. Without
  // this check the render below would attribute A's title/section/rail to B's shown key for
  // that window — a stale-song frankenstein render, not the (harmless) "still loading"
  // fallback it's supposed to be.
  const current = parsed && song && song.id === parsed.songId ? song : null
  const section = current && parsed ? current.sections[parsed.section] : undefined
  useFitText(rootRef, heroRef, section ? LYRICS_BAND : null, [shownKey, song?.id, split])

  // Scripture renders its own branch only once everything it needs has landed: the
  // projected snap, the (identity-matched) chapter with the shown verse actually in
  // range (an out-of-range take would paint a rail with no live card and a no-op
  // scroll), and the manifest that names the rail's translation (without it the rail
  // could open in an arbitrary version and silently swap when the manifest lands).
  // Anything short of that renders the bare projected slide below — never a rail that
  // lies, and never a black screen.
  const scrReady =
    scr && scrSnap && scrChapter && scrChapter.verseCount > 0 && scr.v <= scrChapter.verseCount && !!primaryId

  const isLive = st.output === 'live' && st.liveKey === shownKey
  const outChip = st.output === 'logo' ? 'LOGO' : st.output === 'black' ? 'BLACK' : null

  const rootStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: T.appBg,
    color: T.text,
    display: 'flex',
    fontFamily: "'Hanken Grotesk',sans-serif"
  }
  const heroWrapStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    // Symmetric horizontal padding: the lyric block centers within this padded box, so
    // unequal sides would push the optical center off the panel center (the divider is a
    // flex sibling, not part of this panel — it doesn't stand in for right padding).
    padding: '3cqmin 4cqmin',
    containerType: 'size'
  }
  const heroMiddleStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // The actual fit-measurement box: containerType for cqmin (useFitText reads/writes
    // FIT_SIZE_VAR in cqmin, which must resolve against this element) and overflow:hidden
    // so a section that "fits" the outer hero column can't still spill past what's visible.
    containerType: 'size',
    overflow: 'hidden'
  }
  const titleRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexShrink: 0,
    fontFamily: MONO,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontSize: 'max(12px, 2.2cqmin)',
    color: T.faint
  }
  const chipStyle = (color: string): CSSProperties => ({
    padding: '2px 10px',
    borderRadius: '6px',
    background: `${color}2b`,
    color,
    fontWeight: 700
  })
  const lineStyle: CSSProperties = {
    fontWeight: 700,
    lineHeight: 1.22,
    letterSpacing: '-0.012em',
    whiteSpace: 'nowrap',
    color: T.text,
    fontSize: `max(14px, ${fitSizeValue('7.4cqmin')})`
  }
  const dividerStyle: CSSProperties = {
    width: '12px',
    flexShrink: 0,
    cursor: 'col-resize',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
  const gripStyle: CSSProperties = {
    width: '3px',
    height: '44px',
    borderRadius: '2px',
    background: dragging ? T.accent : T.border
  }
  const railStyle: CSSProperties = {
    width: `${split}px`,
    flexShrink: 0,
    overflowY: 'auto',
    borderLeft: `1px solid ${T.hairline}`,
    background: T.panel,
    padding: '2.5cqmin 2cqmin',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    containerType: 'size'
  }
  // Rail text scales with rail width, same shape as the operator's SectionRail formula —
  // wider bounds because this screen is read from further away.
  const railFont = Math.round(Math.max(13, Math.min(26, split / 18)) * 10) / 10
  const sectionCardStyle = (active: boolean): CSSProperties => ({
    padding: '12px 14px',
    borderRadius: '11px',
    background: active ? '#221d10' : T.panel2,
    boxShadow: active ? `inset 0 0 0 2px ${T.accent}` : `inset 0 0 0 1px ${T.hairline}`
  })
  const sectionLabelStyle = (active: boolean): CSSProperties => ({
    fontFamily: MONO,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontSize: `${Math.max(10.5, railFont * 0.62)}px`,
    fontWeight: 600,
    color: active ? T.accent : T.faint,
    marginBottom: '6px'
  })
  const sectionLineStyle = (active: boolean): CSSProperties => ({
    fontSize: `${railFont}px`,
    lineHeight: 1.45,
    fontWeight: 500,
    color: active ? T.text : '#b4b1aa'
  })

  // The one copy of the leader chrome — root, title row + chips, divider, rail — shared
  // by the song and scripture branches so a chip/divider/rail change can't silently miss
  // one of them.
  const shell = (titleCells: JSX.Element, hero: JSX.Element, railCards: JSX.Element): JSX.Element => (
    <div style={rootStyle} data-testid="leader-view">
      <div style={heroWrapStyle}>
        <div style={titleRowStyle}>
          {titleCells}
          <span style={chipStyle(isLive ? T.live : T.accent)}>{isLive ? 'LIVE' : 'CUED'}</span>
          {outChip && <span style={chipStyle(T.accent)}>{outChip}</span>}
        </div>
        {hero}
      </div>
      <div style={dividerStyle} data-testid="leader-divider" title="Drag to resize" onMouseDown={startDrag}>
        <div style={gripStyle} />
      </div>
      <div style={railStyle} data-testid="leader-rail">
        {railCards}
      </div>
    </div>
  )

  // Scripture (#188): hero re-renders the projected slide (the leader sees what the
  // audience sees — always the AUDIENCE variant, whatever role this display holds: a
  // livestream-role leader view must not get the chroma-key lower third — locked to the
  // projector's 16:9 so the fit and line breaks match the screen), and the rail adds
  // what the audience doesn't get: the whole chapter, live verse highlighted and kept
  // in view, so the person at the pulpit can read ahead.
  if (scrReady && scr && scrSnap && scrChapter)
    return shell(
      <span>{scrSnap.ref}</span>,
      <div style={{ ...heroMiddleStyle, justifyContent: 'center' }}>
        <div style={{ width: 'min(100cqw, 177.78cqh)', aspectRatio: '16 / 9' }}>
          <SlideCanvas slide={scrSnap} variant="audience" fill />
        </div>
      </div>,
      <>
        {Array.from({ length: scrChapter.verseCount }, (_, i) => i + 1).map((v) => {
          const active = scr.v === v
          return (
            <div
              key={v}
              ref={(el) => {
                verseRefs.current[v] = el
              }}
              style={sectionCardStyle(active)}
              data-testid={`leader-verse-${v}`}
              data-live={String(active)}
            >
              <div style={sectionLabelStyle(active)}>{v}</div>
              <div style={sectionLineStyle(active)}>{verseText(v)}</div>
            </div>
          )
        })}
      </>
    )

  // Scripture whose context hasn't landed (chapter mid-fetch or failed, verse out of
  // range, manifest missing): render the projected slide bare rather than falling to the
  // payload slide — which is {kind:'black'} whenever output is down, and would flash the
  // leader black on every chapter crossing (and leave it black all service on a failed
  // fetch) even though the snap holds a fully renderable verse.
  if (scr && scrSnap)
    return (
      <div data-testid="leader-view" style={{ position: 'fixed', inset: 0 }}>
        <SlideCanvas slide={scrSnap} variant="audience" fill />
      </div>
    )

  // Not a song or scripture (or the content was deleted, or a fetch hasn't resolved yet
  // for the shown key): show exactly what the slides view would, but keep the
  // `leader-view` testid contract OutputApp's view-branching test relies on.
  if (!parsed || !current || !section)
    return (
      <div data-testid="leader-view" style={{ position: 'fixed', inset: 0 }}>
        <SlidesView payload={payload} />
      </div>
    )

  return shell(
    <>
      <span>{current.title}</span>
      <span>· {section.label}</span>
      {current.key && <span>· Key {current.key}</span>}
    </>,
    <div ref={rootRef} style={heroMiddleStyle}>
      <div
        ref={heroRef}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.8em', width: '100%', textAlign: 'center' }}
      >
        {section.lines.map((ln, i) => (
          <div key={i} style={lineStyle}>
            {ln}
          </div>
        ))}
      </div>
    </div>,
    <>
      {current.sections.map((s, i) => {
        const active = parsed.section === i
        return (
          <div key={i} style={sectionCardStyle(active)} data-testid={`leader-section-${i}`} data-live={String(active)}>
            <div style={sectionLabelStyle(active)}>{s.label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {s.lines.map((ln, j) => (
                <div key={j} style={sectionLineStyle(active)}>
                  {ln}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
