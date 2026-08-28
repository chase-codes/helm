import { buildIssue, type FeedbackPayload, type FeedbackSendResult } from '../shared/feedbackIssue'

const REPO_ISSUES = 'https://github.com/chase-codes/helm/issues/new'
// GitHub's new-issue form accepts prefilled fields via query params; browsers and
// GitHub both start dropping very long GETs around 8 KB, so clip the text.
const URL_TEXT_MAX = 1500
const TRIM_MARK = '… (trimmed — paste the rest below)'

// The prefilled `os` field is the main triage signal on incoming issues — name the
// platform, don't assume it. `release` is the kernel/OS release string (os.release()).
export function osLabel(platform: NodeJS.Platform, release: string): string {
  const name =
    platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform
  return `${name} (${release})`
}

/** Fallback when the proxy is unconfigured/unreachable: the same issue, but the
 * reporter submits it on GitHub. Field ids match .github/ISSUE_TEMPLATE/*.yml. */
export function feedbackUrl(p: FeedbackPayload): string {
  const text = p.text.length > URL_TEXT_MAX ? p.text.slice(0, URL_TEXT_MAX) + TRIM_MARK : p.text
  const { body } = buildIssue({ ...p, text })
  const params =
    p.type === 'bug'
      ? new URLSearchParams({ template: 'bug_report.yml', version: p.context.version, os: p.context.os, 'what-happened': body })
      : new URLSearchParams({ template: 'feature_request.yml', idea: body })
  return `${REPO_ISSUES}?${params}`
}

export interface SendOpts {
  endpoint: string
  client: string
  fetchFn?: typeof fetch
  timeoutMs?: number
}

/** Main does the network call so the renderer never learns the endpoint. Never throws. */
export async function sendFeedback(p: FeedbackPayload, opts: SendOpts): Promise<FeedbackSendResult> {
  if (!opts.endpoint) return { ok: false, reason: 'unconfigured' }
  const fetchFn = opts.fetchFn ?? fetch
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15_000)
  try {
    const res = await fetchFn(opts.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Helm-Client': opts.client },
      body: JSON.stringify(p),
      signal: ctl.signal,
    })
    if (!res.ok) return { ok: false, reason: 'rejected' }
    const j = (await res.json()) as { number: number; url: string }
    return { ok: true, number: j.number, url: j.url }
  } catch {
    return { ok: false, reason: 'offline' }
  } finally {
    clearTimeout(timer)
  }
}
