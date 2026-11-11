import type { CSSProperties, JSX } from 'react'
import { MONO } from '../shared/fonts'

/** The digit that jumps to this row (grammar rule 9), shown so the 1 to 9 keys are
 * discoverable. Same width with or without a digit (rule 5): rows past the ninth keep the
 * column, blank, so titles stay aligned. The colour is passed in, always a theme token
 * (rule 8), because SchedulePanel and MessageSearchRail take their theme as a prop. */
export function RowNumber({ n, color }: { n: number; color: string }): JSX.Element {
  const style: CSSProperties = {
    fontFamily: MONO,
    fontSize: '11px',
    fontWeight: 600,
    width: '10px',
    flexShrink: 0,
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
    color
  }
  const shown = n >= 1 && n <= 9
  return (
    <span data-row-number={shown ? n : undefined} style={style}>
      {shown ? n : ''}
    </span>
  )
}
