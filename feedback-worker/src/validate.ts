import { FEEDBACK_TEXT_MAX, type FeedbackPayload } from '../../src/shared/feedbackIssue'

const STR_MAX = 100
const CONTEXT_KEYS = ['version', 'os', 'arch', 'displays', 'hasBibles', 'hasSongs'] as const

export type Validation = { ok: true; payload: FeedbackPayload } | { ok: false; error: string }

export function validate(input: unknown): Validation {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'body must be an object' }
  const o = input as Record<string, unknown>
  if (o.type !== 'bug' && o.type !== 'feature') return { ok: false, error: 'type must be bug|feature' }
  if (typeof o.text !== 'string' || o.text.trim().length === 0 || o.text.length > FEEDBACK_TEXT_MAX)
    return { ok: false, error: `text must be 1–${FEEDBACK_TEXT_MAX} chars` }
  const c = o.context
  if (typeof c !== 'object' || c === null) return { ok: false, error: 'context required' }
  const cx = c as Record<string, unknown>
  const keys = Object.keys(cx)
  if (keys.length !== CONTEXT_KEYS.length || keys.some((k) => !(CONTEXT_KEYS as readonly string[]).includes(k)))
    return { ok: false, error: 'context has unexpected keys' }
  for (const k of ['version', 'os', 'arch'] as const)
    if (typeof cx[k] !== 'string' || (cx[k] as string).length > STR_MAX) return { ok: false, error: `context.${k} invalid` }
  if (typeof cx.displays !== 'number' || !Number.isInteger(cx.displays) || cx.displays < 0 || cx.displays > 32)
    return { ok: false, error: 'context.displays invalid' }
  if (typeof cx.hasBibles !== 'boolean' || typeof cx.hasSongs !== 'boolean') return { ok: false, error: 'context flags invalid' }
  return {
    ok: true,
    payload: {
      type: o.type,
      text: o.text,
      context: { version: cx.version as string, os: cx.os as string, arch: cx.arch as string, displays: cx.displays, hasBibles: cx.hasBibles, hasSongs: cx.hasSongs },
    },
  }
}
