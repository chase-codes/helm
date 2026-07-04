import type { CSSProperties, JSX } from 'react'
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
}

const HINT = 'Planned verses are highlighted. Tap any verse — and keep reading right past the plan.'

/** Right rail for the Scripture track: one card per verse in the current chapter,
 * tinted by planned/cued/live tier, click jumps `scrV` (the cue effect in SermonMode
 * handles cueing/hot-updating live output). Mirrors SectionRail's tap-to-navigate shape. */
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
  onSelectVerse
}: ChapterRailProps): JSX.Element {
  const panelStyle: CSSProperties = {
    width: `${width}px`,
    flexShrink: 0,
    background: T.panel,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0
  }
  const plannedLabel = plannedSet.size ? `${plannedSet.size} planned` : 'none planned'

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
    fontSize: '12.5px',
    lineHeight: 1.42,
    fontWeight: 500,
    color: isCued ? T.text : planned ? (dark ? '#b4b1aa' : '#5f5848') : T.dim,
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
              style={rowStyle(isLive, isCued, planned, selected)}
              onClick={(e) => onSelectVerse(v, e.shiftKey)}
              ref={
                selected && v === selectedRange?.from
                  ? (el) => el?.scrollIntoView?.({ block: 'nearest' })
                  : undefined
              }
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
