// Pure: shared by the app (fallback URL + IPC types) and feedback-worker (proxy),
// so both paths file byte-identical issues.

export type FeedbackType = 'bug' | 'feature'

export interface FeedbackContext {
  version: string
  os: string
  arch: string
  displays: number
  hasBibles: boolean
  hasSongs: boolean
}

export interface FeedbackPayload {
  type: FeedbackType
  text: string
  context: FeedbackContext
}

export type FeedbackSendResult =
  | { ok: true; number: number; url: string }
  | { ok: false; reason: 'offline' | 'rejected' | 'unconfigured' }

export const FEEDBACK_TEXT_MAX = 4000
const TITLE_MAX = 72
const TITLE_PREFIX = 'Feedback: '

export function buildIssue(p: FeedbackPayload): { title: string; body: string; labels: string[] } {
  const firstLine = p.text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? (p.type === 'bug' ? 'Problem report' : 'Idea')
  const room = TITLE_MAX - TITLE_PREFIX.length
  const title = TITLE_PREFIX + (firstLine.length > room ? firstLine.slice(0, room - 1) + '…' : firstLine)
  const c = p.context
  const body = [
    p.text.trim(),
    '',
    '### Included automatically',
    `- Version: ${c.version}`,
    `- OS: ${c.os}`,
    `- Arch: ${c.arch}`,
    `- Displays: ${c.displays}`,
    `- Bibles installed: ${c.hasBibles ? 'yes' : 'no'}`,
    `- Songs in library: ${c.hasSongs ? 'yes' : 'no'}`,
  ].join('\n')
  return { title, body, labels: ['feedback', p.type === 'bug' ? 'bug' : 'enhancement'] }
}
