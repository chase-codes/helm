import { describe, it, expect } from 'vitest'
import { allow, type RateStore } from './rateLimit'

function fakeKv(): RateStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => { data.set(k, v) },
  }
}

describe('allow', () => {
  it('permits 5 per hour then blocks', async () => {
    const kv = fakeKv()
    const now = 1_700_000_000_000
    for (let i = 0; i < 5; i++) expect(await allow(kv, '1.2.3.4', now)).toBe(true)
    expect(await allow(kv, '1.2.3.4', now)).toBe(false)
    expect(await allow(kv, '5.6.7.8', now)).toBe(true)
  })
  it('resets after the window', async () => {
    const kv = fakeKv()
    const now = 1_700_000_000_000
    for (let i = 0; i < 5; i++) await allow(kv, 'a', now)
    expect(await allow(kv, 'a', now + 61 * 60 * 1000)).toBe(true)
  })
})
