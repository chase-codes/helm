import { describe, it, expect, vi } from 'vitest'
import worker, { type Env } from './index'

const good = { type: 'feature', text: 'Countdown timer', context: { version: '0.5.0', os: 'macOS (25.5.0)', arch: 'arm64', displays: 2, hasBibles: true, hasSongs: false } }

function env(overrides: Partial<Env> = {}): Env {
  const data = new Map<string, string>()
  return {
    GITHUB_REPO: 'chase-codes/helm',
    GITHUB_TOKEN: 'ghp_test',
    CLIENT_KEY: 'client-secret',
    RATE: { get: async (k: string) => data.get(k) ?? null, put: async (k: string, v: string) => { data.set(k, v) } } as unknown as KVNamespace,
    ...overrides,
  }
}

function req(body: unknown, headers: Record<string, string> = { 'X-Helm-Client': 'client-secret' }): Request {
  return new Request('https://fb.example/v1/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: JSON.stringify(body) })
}

describe('worker', () => {
  it('files an issue and returns its number and url', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ number: 42, html_url: 'https://github.com/chase-codes/helm/issues/42' }), { status: 201 }))
    const res = await worker.fetch(req(good), env(), fetchFn)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ number: 42, url: 'https://github.com/chase-codes/helm/issues/42' })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/chase-codes/helm/issues')
    const h = init.headers as Record<string, string>
    expect(h.Authorization).toBe('Bearer ghp_test')
    const sent = JSON.parse(init.body as string)
    expect(sent.title).toBe('Feedback: Countdown timer')
    expect(sent.labels).toEqual(['feedback', 'enhancement'])
    expect(sent.body).toContain('### Included automatically')
  })
  it('401s without the client header', async () => {
    expect((await worker.fetch(req(good, {}), env(), vi.fn())).status).toBe(401)
  })
  it('400s on a bad payload', async () => {
    expect((await worker.fetch(req({ ...good, type: 'rant' }), env(), vi.fn())).status).toBe(400)
  })
  it('429s past the rate limit', async () => {
    const e = env()
    const ok = vi.fn(async () => new Response(JSON.stringify({ number: 1, html_url: 'u' }), { status: 201 }))
    for (let i = 0; i < 5; i++) expect((await worker.fetch(req(good), e, ok)).status).toBe(201)
    expect((await worker.fetch(req(good), e, ok)).status).toBe(429)
  })
  it('502s when GitHub fails', async () => {
    const bad = vi.fn(async () => new Response('boom', { status: 500 }))
    expect((await worker.fetch(req(good), env(), bad)).status).toBe(502)
  })
  it('404s other routes and 405s other methods', async () => {
    expect((await worker.fetch(new Request('https://fb.example/'), env(), vi.fn())).status).toBe(404)
    expect((await worker.fetch(new Request('https://fb.example/v1/feedback'), env(), vi.fn())).status).toBe(405)
  })
})
