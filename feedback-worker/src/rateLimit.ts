export interface RateStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
}

const LIMIT = 5
const WINDOW_MS = 60 * 60 * 1000

/** Fixed window per key. KV is eventually consistent, so a burst can slightly
 * exceed LIMIT — acceptable for spam deterrence, not billing. */
export async function allow(store: RateStore, ip: string, nowMs: number): Promise<boolean> {
  const key = `rate:${ip}`
  const raw = await store.get(key)
  let start = nowMs
  let count = 0
  if (raw) {
    const parsed = JSON.parse(raw) as { start: number; count: number }
    if (nowMs - parsed.start < WINDOW_MS) { start = parsed.start; count = parsed.count }
  }
  if (count >= LIMIT) return false
  await store.put(key, JSON.stringify({ start, count: count + 1 }), { expirationTtl: Math.ceil(WINDOW_MS / 1000) })
  return true
}
