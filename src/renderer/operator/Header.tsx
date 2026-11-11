import { useContext, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { Mode, ThemeMode } from './App'
import type { HotkeyOverrides } from '../../shared/hotkeys/actions'
import { ThemeCtx } from './ThemeCtx'
import { usePresentationState, useDisplayStatus, useClock } from '../shared/useHelm'
import { statusChipStyle, statusDotStyle } from './transport'
import { OutputViewPopover } from './OutputViewPopover'
import { ReleaseToggle } from './ReleaseToggle'
import { UpdatePill } from './UpdatePill'
import { HelmMark } from '../shared/HelmMark'
import type { IconProps } from '../shared/icons'
import { FeedbackIcon, MoonIcon, PreServiceIcon, ScreenBlackIcon, SermonIcon, SettingsIcon, SongsIcon, SunIcon } from '../shared/icons'
import { MONO } from '../shared/fonts'

export interface HeaderProps {
  mode: Mode
  setMode: (m: Mode) => void
  themeMode: ThemeMode
  toggleTheme: () => void
  onOpenSettings: () => void
  onOpenFeedback: () => void
  hotkeyOverrides: HotkeyOverrides
}

const MODE_TABS: Array<{ id: Mode; label: string; Icon: (p: IconProps) => JSX.Element }> = [
  { id: 'pre', label: 'Pre-service', Icon: PreServiceIcon },
  { id: 'songs', label: 'Songs', Icon: SongsIcon },
  { id: 'sermon', label: 'Sermon', Icon: SermonIcon }
]

export function Header({
  mode,
  setMode,
  themeMode,
  toggleTheme,
  onOpenSettings,
  onOpenFeedback,
  hotkeyOverrides
}: HeaderProps): JSX.Element {
  const T = useContext(ThemeCtx)
  const { output, liveSnap } = usePresentationState()
  const { outputs } = useDisplayStatus()
  const [viewsOpen, setViewsOpen] = useState(false)
  const outputsContainerRef = useRef<HTMLDivElement | null>(null)

  const isLive = output === 'live'
  const snapLbl = liveSnap ? (liveSnap.label ?? liveSnap.ref ?? liveSnap.title ?? '') : ''
  // The state word never truncates; what is live rides behind it as `outDetail`, the one
  // piece of the header that gives way when the window is narrow.
  const outLabel = output === 'black' ? 'NOTHING ON SCREEN' : output === 'logo' ? 'LOGO' : 'LIVE'
  const outDetail = isLive && snapLbl ? '— ' + snapLbl.toUpperCase().slice(0, 30) : ''
  const outColor = output === 'black' ? T.dim : output === 'logo' ? T.accent : T.live

  const handleLiveClick = (): void => {
    if (isLive) window.helm.presentation.setOutput('black')
  }

  const headerStyle: CSSProperties = {
    height: '56px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    // Every child keeps its footprint (nowrap, no shrink) except the live chip's detail
    // and, as the last resort, the service title: a header that wraps pushes the clock
    // off the window (grammar rule 5).
    gap: '12px',
    padding: '0 16px',
    background: T.panel,
    borderBottom: '1px solid ' + T.hairline
  }
  const modeWrapStyle: CSSProperties = {
    display: 'flex',
    flexShrink: 0,
    gap: '4px',
    background: T.panel2,
    padding: '4px',
    borderRadius: '11px'
  }
  const modeTabStyle = (active: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    padding: '7px 14px',
    borderRadius: '8px',
    fontSize: '13.5px',
    whiteSpace: 'nowrap',
    fontWeight: active ? 700 : 600,
    color: active ? T.accentInk : T.dim,
    background: active ? T.accent : 'transparent'
  })
  const outputsChipStyle: CSSProperties = {
    fontFamily: MONO,
    fontSize: '11px',
    letterSpacing: '0.06em',
    color: outputs > 0 ? T.dim : T.faint,
    whiteSpace: 'nowrap',
    flexShrink: 0
  }
  const liveStatusStyle: CSSProperties = {
    ...statusChipStyle(outColor),
    gap: '7px',
    height: isLive ? '32px' : '28px',
    padding: '0 11px',
    borderRadius: '8px',
    cursor: isLive ? 'pointer' : 'default',
    whiteSpace: 'nowrap',
    // Takes all of the squeeze until it is down to its fixed parts (dot, state word,
    // TAKE DOWN); only then does the service title start to give. Shrink is shared in
    // proportion to this factor, and even a sub-pixel share would put an ellipsis on the
    // title, hence a factor large enough that the title's share rounds to nothing.
    flexShrink: 10000,
    minWidth: 'min-content'
  }
  const outTextStyle: CSSProperties = {
    fontFamily: MONO,
    fontSize: '11px',
    letterSpacing: '0.08em',
    flexShrink: 0
  }
  // One line that may break anywhere and clamps to that line, so its min-content width is
  // a single character: the chip can shrink to its fixed parts and the label still ends
  // in an ellipsis. `nowrap` + `text-overflow` would pin min-content at the full label.
  const outDetailStyle: CSSProperties = {
    ...outTextStyle,
    flexShrink: 1,
    minWidth: 0,
    whiteSpace: 'normal',
    wordBreak: 'break-all',
    display: '-webkit-box',
    WebkitLineClamp: 1,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden'
  }
  const liveDotStyle: CSSProperties = {
    ...statusDotStyle(outColor, isLive),
    width: '7px',
    height: '7px'
  }
  // Same verb and same mark as every Take down button (#92) — only the case differs,
  // because this is a chip inside the header's uppercase-mono status row.
  const takeDownChipStyle: CSSProperties = {
    fontFamily: MONO,
    fontSize: '9.5px',
    letterSpacing: '0.08em',
    fontWeight: 700,
    color: T.live,
    background: T.live + '22',
    padding: '3px 7px',
    borderRadius: '6px',
    marginLeft: '2px',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px'
  }
  const themeBtnStyle: CSSProperties = {
    width: '34px',
    height: '34px',
    flexShrink: 0,
    borderRadius: '9px',
    background: T.panel2,
    boxShadow: 'inset 0 0 0 1px ' + T.hairline,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    color: T.dim
  }

  return (
    <div style={headerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '11px', minWidth: 0 }}>
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
          <HelmMark size={28} color={T.accent} />
        </span>
        <div
          style={{
            fontWeight: 700,
            fontSize: '16px',
            letterSpacing: '-0.01em',
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          Sunday Service
        </div>
      </div>
      <div style={modeWrapStyle}>
        {MODE_TABS.map((t) => (
          <button key={t.id} style={modeTabStyle(mode === t.id)} onClick={() => setMode(t.id)}>
            <t.Icon size={15} />
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }} />
      <ReleaseToggle hotkeyOverrides={hotkeyOverrides} />
      <div ref={outputsContainerRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          style={{ ...outputsChipStyle, cursor: 'pointer', background: 'transparent' }}
          onClick={() => setViewsOpen((o) => !o)}
          title="Output views"
        >
          {outputs} OUTPUT{outputs === 1 ? '' : 'S'}
          {isLive ? ' · LIVE' : ''}
        </button>
        {viewsOpen && (
          <OutputViewPopover onClose={() => setViewsOpen(false)} containRef={outputsContainerRef} />
        )}
      </div>
      <button
        style={liveStatusStyle}
        onClick={handleLiveClick}
        data-inert={isLive ? undefined : ''}
        title={isLive ? 'Black the audience screen' : 'Nothing on screen'}
      >
        <span style={{ ...liveDotStyle, flexShrink: 0 }} />
        <span style={outTextStyle}>{outLabel}</span>
        {outDetail && <span style={outDetailStyle}>{outDetail}</span>}
        {isLive && (
          <span style={takeDownChipStyle}>
            <ScreenBlackIcon size={11} /> TAKE DOWN
          </span>
        )}
      </button>
      <UpdatePill />
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        <button style={themeBtnStyle} onClick={toggleTheme} title="Light/dark">
          {themeMode === 'dark' ? <SunIcon size={17} /> : <MoonIcon size={17} />}
        </button>
        <button style={themeBtnStyle} onClick={onOpenSettings} title="Settings">
          <SettingsIcon size={17} />
        </button>
        <button style={themeBtnStyle} onClick={onOpenFeedback} title="Send feedback">
          <FeedbackIcon size={17} />
        </button>
      </div>
      <Clock
        style={{
          fontFamily: MONO,
          fontSize: '15px',
          color: T.dim,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          flexShrink: 0
        }}
      />
    </div>
  )
}

// Leaf holder for the 1Hz clock tick, so the always-mounted header itself
// never re-renders on it.
function Clock({ style }: { style: CSSProperties }): JSX.Element {
  const clock = useClock()
  return <div style={style}>{clock}</div>
}
