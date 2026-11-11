import type { PresentationState } from '../types'

/** The three operator pages, in Header tab order. Mirrors `Mode` in
 * renderer/operator/App.tsx; shared code cannot import the renderer. */
export type ScreenPage = 'pre' | 'songs' | 'sermon'

/** How a page's status chip should read the screen: its own content (red), another
 * page's content (faint, because the Header already carries the red), logo, or black. */
export type ScreenTone = 'live' | 'elsewhere' | 'logo' | 'black'

export interface ScreenStatus {
  text: string
  tone: ScreenTone
}

/** Which page put each live-key kind on screen. The kind is the first `:` segment, the
 * same one `sameKind` compares. Every Sermon track (scripture, message quote, reading
 * view, media) belongs to the one Sermon tab. */
const PAGE_OF_KIND: Record<string, ScreenPage> = {
  song: 'songs',
  scr: 'sermon',
  msg: 'sermon',
  read: 'sermon',
  pres: 'sermon',
  pre: 'pre'
}

/** Upper-case Header tab names, as the status chip prints them. */
export const PAGE_LABEL: Record<ScreenPage, string> = {
  pre: 'PRE-SERVICE',
  songs: 'SONGS',
  sermon: 'SERMON'
}

export function pageOfKey(key: string | null): ScreenPage | null {
  if (!key) return null
  return PAGE_OF_KIND[key.split(':')[0]] ?? null
}

/** The one source of the status chip's words (docs/ux-vocabulary.md, decision 6). */
export function screenStatus(
  st: Pick<PresentationState, 'output' | 'liveKey'>,
  page: ScreenPage
): ScreenStatus {
  if (st.output === 'black') return { text: 'NOTHING ON SCREEN', tone: 'black' }
  if (st.output === 'logo') return { text: 'LOGO ON SCREEN', tone: 'logo' }
  const owner = pageOfKey(st.liveKey)
  if (owner !== null && owner !== page) return { text: `LIVE FROM ${PAGE_LABEL[owner]}`, tone: 'elsewhere' }
  return { text: 'LIVE ON SCREEN', tone: 'live' }
}
