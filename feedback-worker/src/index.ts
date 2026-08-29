import { buildIssue } from '../../src/shared/feedbackIssue'
import { validate } from './validate'
import { allow } from './rateLimit'

export interface Env {
  GITHUB_REPO: string
  GITHUB_TOKEN: string
  CLIENT_KEY: string
  RATE: KVNamespace
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// A plain (non-overloaded) shape for `fetch` — matches what we actually call it with,
// and unlike `typeof fetch` (overloaded, CfProperties-flavored RequestInit) it's a type
// vi.fn() mocks are assignable to without per-call generic annotations in the tests.
type FetchFn = (url: string, init: RequestInit) => Promise<Response>

// Third param is injectable for tests; Cloudflare passes ExecutionContext there, which we ignore.
async function handle(request: Request, env: Env, fetchFn: FetchFn = fetch): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname !== '/v1/feedback') return json(404, { error: 'not found' })
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' })
  // Shared client key: deters drive-by posting from outside the app. It ships in
  // the binary, so treat it as obfuscation, not authentication — the rate limit
  // and the token's narrow scope are the real controls.
  if (request.headers.get('X-Helm-Client') !== env.CLIENT_KEY) return json(401, { error: 'unauthorized' })

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (!(await allow(env.RATE, ip, Date.now()))) return json(429, { error: 'too many requests' })

  let body: unknown
  try { body = await request.json() } catch { return json(400, { error: 'invalid json' }) }
  const v = validate(body)
  if (!v.ok) return json(400, { error: v.error })

  const issue = buildIssue(v.payload)
  const gh = await fetchFn(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'helm-feedback-worker',
    },
    body: JSON.stringify(issue),
  })
  if (!gh.ok) return json(502, { error: 'github error' })
  const created = (await gh.json()) as { number: number; html_url: string }
  return json(201, { number: created.number, url: created.html_url })
}

// `unknown`, not `ExecutionContext | FetchFn`: with @cloudflare/workers-types 5.x,
// a bare `vi.fn()` (no callback — the 401/400/404/405 tests, which never call
// fetchFn) isn't structurally assignable to that union, only to each member alone.
// The runtime narrowing below is unaffected.
export default {
  fetch: (request: Request, env: Env, ctxOrFetch?: unknown) =>
    handle(request, env, typeof ctxOrFetch === 'function' ? (ctxOrFetch as FetchFn) : undefined),
}
