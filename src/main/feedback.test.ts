import { describe, it, expect, vi } from 'vitest'
import { osLabel, feedbackUrl, sendFeedback } from './feedback'
import type { FeedbackContext } from '../shared/feedbackIssue'

const ctx: FeedbackContext = { version: '0.5.0', os: 'macOS (25.5.0)', arch: 'arm64', displays: 1, hasBibles: false, hasSongs: true }

describe('feedbackUrl', () => {
  it('prefills the bug template with version, os and what-happened', () => {
    const url = new URL(feedbackUrl({ type: 'bug', text: 'Slides went black', context: ctx }))
    expect(url.origin + url.pathname).toBe('https://github.com/chase-codes/helm/issues/new')
    expect(url.searchParams.get('template')).toBe('bug_report.yml')
    expect(url.searchParams.get('version')).toBe('0.5.0')
    expect(url.searchParams.get('os')).toBe('macOS (25.5.0)')
    expect(url.searchParams.get('what-happened')).toContain('Slides went black')
    expect(url.searchParams.get('what-happened')).toContain('### Included automatically')
  })

  it('prefills the feature template into idea', () => {
    const url = new URL(feedbackUrl({ type: 'feature', text: 'Countdown timer', context: ctx }))
    expect(url.searchParams.get('template')).toBe('feature_request.yml')
    expect(url.searchParams.get('idea')).toContain('Countdown timer')
    expect(url.searchParams.get('version')).toBeNull()
  })

  it('truncates long text with a marker to stay under URL limits', () => {
    const url = new URL(feedbackUrl({ type: 'feature', text: 'a'.repeat(3000), context: ctx }))
    const idea = url.searchParams.get('idea')!
    expect(idea).toContain('… (trimmed — paste the rest below)')
    expect(idea.indexOf('… (trimmed')).toBe(1500)
  })
})

describe('sendFeedback', () => {
  const payload = { type: 'bug' as const, text: 'Slides went black', context: ctx }

  it('returns unconfigured without fetching when endpoint is empty', async () => {
    const fetchFn = vi.fn()
    expect(await sendFeedback(payload, { endpoint: '', client: 'c', fetchFn })).toEqual({ ok: false, reason: 'unconfigured' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('posts the payload with the client header and returns the issue', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ number: 12, url: 'https://github.com/chase-codes/helm/issues/12' }), { status: 201 }))
    const r = await sendFeedback(payload, { endpoint: 'https://fb.example/v1/feedback', client: 'secret', fetchFn })
    expect(r).toEqual({ ok: true, number: 12, url: 'https://github.com/chase-codes/helm/issues/12' })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://fb.example/v1/feedback')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Helm-Client']).toBe('secret')
    expect(JSON.parse(init.body as string)).toEqual(payload)
  })

  it('maps non-2xx to rejected and thrown fetch to offline', async () => {
    const bad = vi.fn(async () => new Response('nope', { status: 429 }))
    expect(await sendFeedback(payload, { endpoint: 'https://x', client: 'c', fetchFn: bad })).toEqual({ ok: false, reason: 'rejected' })
    const down = vi.fn(async () => { throw new TypeError('fetch failed') })
    expect(await sendFeedback(payload, { endpoint: 'https://x', client: 'c', fetchFn: down })).toEqual({ ok: false, reason: 'offline' })
  })
})

describe('osLabel', () => {
  it('labels each platform by name plus release', () => {
    expect(osLabel('darwin', '25.5.0')).toBe('macOS (25.5.0)')
    expect(osLabel('win32', '10.0.26100')).toBe('Windows (10.0.26100)')
    expect(osLabel('linux', '6.8.0')).toBe('Linux (6.8.0)')
  })

  it('falls back to the raw platform id for anything else', () => {
    expect(osLabel('freebsd', '14.1')).toBe('freebsd (14.1)')
  })
})
