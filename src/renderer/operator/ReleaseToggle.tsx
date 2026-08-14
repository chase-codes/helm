import { useContext, type CSSProperties, type JSX } from 'react'
import { ThemeCtx } from './ThemeCtx'
import { useDisplayStatus } from './useHelm'
import { formatBinding } from '../../shared/hotkeys/match'
import { HOTKEY_ACTIONS } from '../../shared/hotkeys/actions'

/** Transient release/take of every output screen (#51): releasing destroys all output
 * windows so another app can present, without touching saved roles; taking back re-syncs.
 * State lives in main and arrives via displayStatus, so every window agrees. */
export function ReleaseToggle(): JSX.Element {
  const T = useContext(ThemeCtx)
  const { released } = useDisplayStatus()
  const chip = formatBinding(HOTKEY_ACTIONS.find((a) => a.id === 'displays.release')!.defaults[0])
  const style: CSSProperties = {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: '10px',
    letterSpacing: '0.07em',
    fontWeight: 700,
    padding: '5px 9px',
    borderRadius: '7px',
    whiteSpace: 'nowrap',
    color: released ? T.live : T.dim,
    background: released ? T.live + '22' : 'transparent',
    boxShadow: released ? `inset 0 0 0 1px ${T.live}88` : `inset 0 0 0 1px ${T.hairline}`
  }
  return (
    <button
      data-testid="release-toggle"
      style={style}
      aria-pressed={released}
      onClick={() => window.helm.displays.toggleReleased()}
      title={
        released
          ? `Take the screens back (${chip})`
          : `Release every screen to other apps (${chip})`
      }
    >
      {released ? 'SCREENS RELEASED · TAKE BACK' : 'RELEASE SCREENS'}
    </button>
  )
}
