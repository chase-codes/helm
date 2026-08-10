import { useEffect, useRef, type CSSProperties, type JSX } from 'react'
import type { Theme } from '../../shared/theme'

export interface ChapterRailProps {
  theme: Theme
  dark: boolean
  width: number
  book: string
  ch: number
  verseCount: number
  plannedSet: Set<number>
  cuedV: number
  isVerseLive: (v: number) => boolean
  previewOf: (v: number) => string
  selectedRange: { from: number; to: number } | null
  onSelectVerse: (v: number, shift: boolean) => void
  /** One-shot scroll command from SermonMode. 'start' pins the verse to the top of the
   * rail (schedule click / reading hotkey / lookup jump); 'nearest' just keeps it in
   * view (arrow steps). The nonce makes each request fire exactly once; verseCount is a
   * dep too so a cross-chapter jump re-applies once the new chapter's rows exist. */
  scrollRequest?: { v: number; align: 'start' | 'nearest'; nonce: number } | null
  /** Fired the moment a scrollRequest actually lands a scroll (its target row was found).
   * SermonMode records the highest consumed nonce and withholds a matching-or-older one
   * on a later mount, so remounting ChapterRail (track flipped away and back) doesn't
   * replay an already-consumed request. Not fired when the row isn't found yet — that's
   * the cross-chapter case, where the SAME request must still fire once the rows land. */
  onScrollConsumed?: (nonce: number) => void
}

const HINT = 'Tap a verse to go there — on screen when you\'re live. Shift-tap to build a range.'

/** Right rail for the Scripture track: one card per verse in the current chapter,
 * tinted by planned/cued/live tier. Tapping reports `(verse, shiftKey)` and leaves the
 * meaning to the caller — SermonMode reads a plain tap as "move the cursor here" (which
 * reaches the projector when output is live) and a shift-tap as "extend a range into the
 * ref builder", via `railSelect` in shared/scripture/selection.ts. The rail itself stays
 * presentational: `cuedV` marks the cursor, `selectedRange` marks a pending range, and it
 * decides neither. Mirrors SectionRail's tap-to-navigate shape. */
export function ChapterRail({
  theme: T,
  dark,
  width,
  book,
  ch,
  verseCount,
  plannedSet,
  cuedV,
  isVerseLive,
  previewOf,
  selectedRange,
  onSelectVerse,
  scrollRequest,
  onScrollConsumed
}: ChapterRailProps): JSX.Element {
  // Same width-derived font as SectionRail's secFont: the pastor reads this
  // column over the pulpit mirror, so widening the rail must enlarge the text.
  const verseFont = Math.round(Math.max(13, Math.min(18, width / 24)) * 10) / 10
  const panelStyle: CSSProperties = {
    width: `${width}px`,
    flexShrink: 0,
    background: T.panel,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0
  }
  const plannedLabel = plannedSet.size ? `${plannedSet.size} planned` : 'none planned'

  // Auto-scroll the selection's start row into view. A `useEffect` (rather than an inline
  // callback ref) so it only runs when the selected verse actually changes, not on every
  // re-render — a callback ref gets a fresh closure identity each render and React would
  // re-invoke it every time, fighting a user who's manually scrolled the rail away from the
  // selection.
  const selectedFromRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    selectedFromRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedRange?.from])

  // SermonMode's one-shot scroll requests: schedule-row clicks, the reading hotkey, and
  // goLiveFromBuilder all want the target verse pinned to the TOP of the rail ('start');
  // arrow verse-steps just want it kept in view ('nearest'). Looked up by data-verse
  // rather than threaded through a ref map, since the row list is built fresh each render.
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!scrollRequest) return
    const row = listRef.current?.querySelector(`[data-verse="${scrollRequest.v}"]`)
    // Row not there yet (cross-chapter jump, rows haven't landed) — leave the request
    // un-consumed so the verseCount dep below re-runs this same nonce once they do,
    // rather than reporting done on a scroll that never happened.
    if (!row) return
    row.scrollIntoView?.({ block: scrollRequest.align })
    onScrollConsumed?.(scrollRequest.nonce)
    // scrollRequest is consumed by identity of its nonce (one shot per request);
    // verseCount re-applies it when a cross-chapter jump's rows land a tick later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest?.nonce, verseCount])

  const rowStyle = (
    isLive: boolean,
    isCued: boolean,
    planned: boolean,
    selected: boolean
  ): CSSProperties => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '11px 13px',
    borderRadius: '11px',
    cursor: 'pointer',
    background: selected
      ? dark
        ? 'rgba(111,156,240,.18)'
        : 'rgba(63,107,181,.14)'
      : isLive
        ? dark
          ? 'rgba(111,156,240,.14)'
          : 'rgba(63,107,181,.11)'
        : isCued
          ? dark
            ? 'rgba(111,156,240,.09)'
            : 'rgba(63,107,181,.07)'
          : planned
            ? dark
              ? 'rgba(111,156,240,.05)'
              : 'rgba(63,107,181,.045)'
            : T.panel2,
    boxShadow: selected
      ? `inset 0 0 0 2px ${T.scripture}`
      : isLive
        ? `inset 0 0 0 2px ${T.scripture}`
        : isCued
          ? `inset 0 0 0 1.5px ${T.scripture}66`
          : planned
            ? `inset 0 0 0 1px ${T.scripture}44`
            : `inset 0 0 0 1px ${T.hairline}`
  })
  const labelStyle = (isCued: boolean, planned: boolean): CSSProperties => ({
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '10.5px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    fontWeight: 500,
    color: isCued || planned ? T.scripture : T.faint
  })
  const badgeStyle = (isLive: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '9px',
    letterSpacing: '0.08em',
    fontWeight: 600,
    color: isLive ? T.live : T.dim
  })
  const textStyle = (isCued: boolean, planned: boolean): CSSProperties => ({
    fontSize: `${verseFont}px`,
    lineHeight: 1.42,
    fontWeight: 500,
    color: isCued ? T.text : planned ? T.lineDim : T.dim,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden'
  })

  const verses = Array.from({ length: verseCount }, (_, i) => i + 1)

  return (
    <div style={panelStyle}>
      <div style={{ padding: '14px 15px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            style={{ fontSize: '11px', letterSpacing: '0.1em', color: T.faint, fontWeight: 600 }}
          >
            {book} {ch}
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: '10px',
              color: T.scripture
            }}
          >
            {plannedLabel}
          </div>
        </div>
        <div style={{ fontSize: '11.5px', color: T.faint, marginTop: '6px', lineHeight: 1.45 }}>
          {HINT}
        </div>
      </div>
      <div
        ref={listRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '0 12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}
      >
        {verses.map((v) => {
          const planned = plannedSet.has(v)
          const isCued = v === cuedV
          const isLive = isVerseLive(v)
          const showBadge = isCued || isLive
          const selected =
            selectedRange !== null && v >= selectedRange.from && v <= selectedRange.to
          return (
            <button
              key={v}
              data-selected={selected}
              data-verse={v}
              style={rowStyle(isLive, isCued, planned, selected)}
              onClick={(e) => onSelectVerse(v, e.shiftKey)}
              ref={v === selectedRange?.from ? selectedFromRef : undefined}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '6px'
                }}
              >
                <div style={labelStyle(isCued, planned)}>Verse {v}</div>
                {showBadge && (
                  <div style={badgeStyle(isLive)}>
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: 'currentColor',
                        display: 'inline-block'
                      }}
                    />
                    {isLive ? 'LIVE' : 'CUED'}
                  </div>
                )}
              </div>
              <div style={textStyle(isCued, planned)}>{previewOf(v)}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
