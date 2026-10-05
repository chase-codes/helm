import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join, win32 } from 'path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, promises as fsp } from 'fs'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import {
  resolveMediaPath,
  parseRangeHeader,
  handleMediaRequest,
  type MediaFs,
  type MediaFileHandle,
  type MediaHandlerDeps
} from './library'

describe('resolveMediaPath', () => {
  const root = join('/', 'data', 'library')
  it('resolves a normal relative path under root', () => {
    expect(resolveMediaPath(root, 'images/a.jpg')).toBe(join(root, 'images', 'a.jpg'))
  })
  it('strips a leading slash', () => {
    expect(resolveMediaPath(root, '/decks/d1/1.png')).toBe(join(root, 'decks', 'd1', '1.png'))
  })
  it('rejects path traversal that escapes root', () => {
    expect(resolveMediaPath(root, '../secrets.txt')).toBeNull()
    expect(resolveMediaPath(root, 'images/../../etc/passwd')).toBeNull()
  })
})

describe('resolveMediaPath (Windows semantics via path.win32)', () => {
  const root = 'C:\\Users\\Some User\\AppData\\Roaming\\Helm\\library'
  const id = '3f2b8c1e-6a4d-4c0b-9e57-0d2a1b7c9f10'
  it('resolves a normal video path under a root containing spaces', () => {
    expect(resolveMediaPath(root, `video/${id}.MP4`, win32)).toBe(`${root}\\video\\${id}.MP4`)
    expect(resolveMediaPath(root, `/video/${id}.MP4`, win32)).toBe(`${root}\\video\\${id}.MP4`)
  })
  it('decodes percent-escapes in file names', () => {
    expect(resolveMediaPath(root, 'video/my%20clip.mp4', win32)).toBe(`${root}\\video\\my clip.mp4`)
  })
  it('rejects encoded forward-slash and backslash traversal', () => {
    expect(resolveMediaPath(root, '..%2f..%2fsecrets.txt', win32)).toBeNull()
    expect(resolveMediaPath(root, '..%5c..%5csecrets.txt', win32)).toBeNull()
    expect(resolveMediaPath(root, 'video/..%5c..%5c..%5cWindows%5cwin.ini', win32)).toBeNull()
    expect(resolveMediaPath(root, 'video/..%2f..%2f..%2fWindows/win.ini', win32)).toBeNull()
    expect(resolveMediaPath(root, 'video\\..\\..\\x', win32)).toBeNull()
  })
  it('rejects a sibling directory that merely shares the root prefix', () => {
    expect(resolveMediaPath(root, '..%5clibrary-evil%5ca.mp4', win32)).toBeNull()
  })
  it('rejects drive-qualified targets and confines UNC-looking ones to root', () => {
    expect(resolveMediaPath(root, 'C:%5cWindows%5cwin.ini', win32)).toBeNull()
    expect(resolveMediaPath(root, '/C:/Windows/win.ini', win32)).toBeNull()
    expect(resolveMediaPath(root, '%5c%5cserver%5cshare%5ca.mp4', win32)).toBe(
      `${root}\\server\\share\\a.mp4`
    )
    expect(resolveMediaPath(root, '//server/share/a.mp4', win32)).toBe(
      `${root}\\server\\share\\a.mp4`
    )
  })
  it('keeps traversal that stays inside root', () => {
    expect(resolveMediaPath(root, 'video/../images/a.jpg', win32)).toBe(`${root}\\images\\a.jpg`)
  })
  it('rejects undecodable escapes and NUL bytes instead of throwing', () => {
    expect(resolveMediaPath(root, 'video/%E0%A4%A.mp4', win32)).toBeNull()
    expect(resolveMediaPath(root, 'video/a%00.mp4', win32)).toBeNull()
  })
})

describe('parseRangeHeader', () => {
  const none = { kind: 'none' }
  const unsat = { kind: 'unsatisfiable' }
  it('returns none when there is no Range header', () => {
    expect(parseRangeHeader(null, 1000)).toEqual(none)
  })
  it('parses a closed range', () => {
    expect(parseRangeHeader('bytes=0-499', 1000)).toEqual({ kind: 'range', start: 0, end: 499 })
  })
  it('parses an open-ended range to the last byte', () => {
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ kind: 'range', start: 500, end: 999 })
    expect(parseRangeHeader('bytes=0-', 1000)).toEqual({ kind: 'range', start: 0, end: 999 })
  })
  it('parses a suffix range (last N bytes)', () => {
    expect(parseRangeHeader('bytes=-200', 1000)).toEqual({ kind: 'range', start: 800, end: 999 })
    expect(parseRangeHeader('bytes=-5000', 1000)).toEqual({ kind: 'range', start: 0, end: 999 })
  })
  it('clamps an end past EOF', () => {
    expect(parseRangeHeader('bytes=0-99999', 1000)).toEqual({ kind: 'range', start: 0, end: 999 })
  })
  it('accepts the unit case-insensitively and a single-byte range', () => {
    expect(parseRangeHeader('Bytes=999-999', 1000)).toEqual({ kind: 'range', start: 999, end: 999 })
  })
  it('reports a start at or past EOF as unsatisfiable', () => {
    expect(parseRangeHeader('bytes=2000-', 1000)).toEqual(unsat)
    expect(parseRangeHeader('bytes=1000-1001', 1000)).toEqual(unsat)
    expect(parseRangeHeader('bytes=-0', 1000)).toEqual(unsat)
    expect(parseRangeHeader('bytes=0-', 0)).toEqual(unsat)
  })
  it('ignores malformed, inverted and multi-range headers', () => {
    expect(parseRangeHeader('kilobytes=0-1', 1000)).toEqual(none)
    expect(parseRangeHeader('bytes=-', 1000)).toEqual(none)
    expect(parseRangeHeader('bytes=abc-', 1000)).toEqual(none)
    expect(parseRangeHeader('bytes=500-100', 1000)).toEqual(none)
    expect(parseRangeHeader('bytes=0-1,5-6', 1000)).toEqual(none)
  })
})

describe('handleMediaRequest', () => {
  let root: string
  const SIZE = 300_000 // several chunks at the default 64 KiB
  const video = randomBytes(SIZE)
  const image = randomBytes(5000)

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'helm-media-test-'))
    mkdirSync(join(root, 'video'))
    mkdirSync(join(root, 'images'))
    writeFileSync(join(root, 'video', 'clip.mp4'), video)
    writeFileSync(join(root, 'video', 'UPPER.MP4'), video.subarray(0, 100))
    writeFileSync(join(root, 'video', 'empty.mp4'), Buffer.alloc(0))
    writeFileSync(join(root, 'images', 'a.jpg'), image)
    writeFileSync(join(root, '..', 'helm-media-outside.txt'), 'secret')
  })
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(join(root, '..', 'helm-media-outside.txt'), { force: true })
  })

  type Line = { event: string; data?: Record<string, unknown> }
  function logger(): { lines: Line[]; log: NonNullable<MediaHandlerDeps['log']> } {
    const lines: Line[] = []
    return { lines, log: (event, data) => lines.push({ event, data }) }
  }
  // fs seam that records every handle so tests can assert open/close balance.
  function trackingFs(
    over: Partial<MediaFileHandle> = {}
  ): MediaFs & { opened: number; closed: number; reads: number } {
    const t = {
      opened: 0,
      closed: 0,
      reads: 0,
      stat: (p: string) => fsp.stat(p),
      async open(p: string, flags: 'r'): Promise<MediaFileHandle> {
        const h = await fsp.open(p, flags)
        t.opened++
        return {
          read: (buf, off, len, pos) => {
            t.reads++
            return over.read ? over.read(buf, off, len, pos) : h.read(buf, off, len, pos)
          },
          close: async () => {
            t.closed++
            await h.close()
          }
        }
      }
    }
    return t
  }
  const get = (
    path: string,
    init: RequestInit = {},
    deps: MediaHandlerDeps = {}
  ): Promise<Response> =>
    handleMediaRequest(new Request(`helm-media://${path}`, init), root, { log: () => {}, ...deps })
  const bytes = async (res: Response): Promise<Buffer> => Buffer.from(await res.arrayBuffer())
  const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))

  it('serves a no-Range request as a full 200 with our own headers', async () => {
    const fs = trackingFs()
    const res = await get('video/clip.mp4', {}, { fs })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    expect(res.headers.get('Content-Length')).toBe(String(SIZE))
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Range')).toBeNull()
    expect((await bytes(res)).equals(video)).toBe(true)
    await tick()
    expect([fs.opened, fs.closed]).toEqual([1, 1])
  })

  it('serves bytes=0- as a 206 covering the whole file', async () => {
    const res = await get('video/clip.mp4', { headers: { Range: 'bytes=0-' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-${SIZE - 1}/${SIZE}`)
    expect(res.headers.get('Content-Length')).toBe(String(SIZE))
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    expect((await bytes(res)).equals(video)).toBe(true)
  })

  it('serves an exact closed range', async () => {
    const res = await get('video/clip.mp4', { headers: { Range: 'bytes=70000-200000' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 70000-200000/${SIZE}`)
    expect(res.headers.get('Content-Length')).toBe('130001')
    expect((await bytes(res)).equals(video.subarray(70000, 200001))).toBe(true)
  })

  it('serves a suffix range and clamps an end past EOF', async () => {
    const suffix = await get('video/clip.mp4', { headers: { Range: 'bytes=-1000' } })
    expect(suffix.status).toBe(206)
    expect(suffix.headers.get('Content-Range')).toBe(`bytes ${SIZE - 1000}-${SIZE - 1}/${SIZE}`)
    expect((await bytes(suffix)).equals(video.subarray(SIZE - 1000))).toBe(true)

    const clamped = await get('video/clip.mp4', {
      headers: { Range: `bytes=${SIZE - 10}-99999999` }
    })
    expect(clamped.headers.get('Content-Range')).toBe(`bytes ${SIZE - 10}-${SIZE - 1}/${SIZE}`)
    expect(clamped.headers.get('Content-Length')).toBe('10')
    expect((await bytes(clamped)).equals(video.subarray(SIZE - 10))).toBe(true)
  })

  it('answers a start past EOF with an empty 416 and never opens the file', async () => {
    const fs = trackingFs()
    const res = await get('video/clip.mp4', { headers: { Range: `bytes=${SIZE}-` } }, { fs })
    expect(res.status).toBe(416)
    expect(res.headers.get('Content-Range')).toBe(`bytes */${SIZE}`)
    expect(res.headers.get('Content-Length')).toBe('0')
    expect(res.body).toBeNull()
    expect(fs.opened).toBe(0)
  })

  it('ignores a malformed or multi-range header and serves the full 200', async () => {
    for (const Range of ['kilobytes=0-1', 'bytes=0-1,5-6', 'bytes=9-2']) {
      const res = await get('video/clip.mp4', { headers: { Range } })
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Length')).toBe(String(SIZE))
      expect((await bytes(res)).equals(video)).toBe(true)
    }
  })

  it('answers HEAD with headers and no body, without opening the file', async () => {
    const fs = trackingFs()
    const res = await get('video/clip.mp4', { method: 'HEAD' }, { fs })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe(String(SIZE))
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    expect(res.body).toBeNull()

    const ranged = await get(
      'video/clip.mp4',
      { method: 'HEAD', headers: { Range: 'bytes=10-19' } },
      { fs }
    )
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get('Content-Range')).toBe(`bytes 10-19/${SIZE}`)
    expect(ranged.body).toBeNull()
    expect(fs.opened).toBe(0)
  })

  it('rejects other methods with 405', async () => {
    const res = await get('video/clip.mp4', { method: 'DELETE' })
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET, HEAD')
  })

  it('returns 404 for a missing file and for a directory', async () => {
    expect((await get('video/nope.mp4')).status).toBe(404)
    expect((await get('video/nope.mp4', { headers: { Range: 'bytes=0-' } })).status).toBe(404)
    expect((await get('video')).status).toBe(404)
  })

  it('returns 403 for an escape attempt and never touches the fs', async () => {
    const fs = trackingFs()
    let stats = 0
    const guarded: MediaFs = { open: fs.open, stat: (p) => (stats++, fs.stat(p)) }
    for (const path of [
      'video/..%2f..%2fhelm-media-outside.txt',
      'x/%2e%2e%2f%2e%2e%2fhelm-media-outside.txt',
      'video/%E0%A4%A'
    ]) {
      const res = await get(path, {}, { fs: guarded })
      expect(res.status).toBe(403)
      expect(await res.text()).toBe('')
    }
    expect([stats, fs.opened]).toEqual([0, 0])
  })

  it('derives Content-Type from an uppercase extension', async () => {
    const res = await get('video/UPPER.MP4', { headers: { Range: 'bytes=0-' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    expect((await bytes(res)).length).toBe(100)
  })

  it('serves a zero-byte file as an empty 200 even with a Range header', async () => {
    const fs = trackingFs()
    const res = await get('video/empty.mp4', { headers: { Range: 'bytes=0-' } }, { fs })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe('0')
    expect((await bytes(res)).length).toBe(0)
    expect(fs.opened).toBe(0)
  })

  it('does not open the file until the body is read', async () => {
    const fs = trackingFs()
    const res = await get('video/clip.mp4', {}, { fs })
    await tick(20)
    expect(fs.opened).toBe(0)
    await res.body!.cancel()
    expect([fs.opened, fs.closed]).toEqual([0, 0])
  })

  it('applies backpressure: a slow consumer gets exact bytes and reads are never ahead of demand', async () => {
    const big = randomBytes(2 * 1024 * 1024 + 123)
    writeFileSync(join(root, 'video', 'big.mp4'), big)
    const fs = trackingFs()
    const res = await get('video/big.mp4', { headers: { Range: 'bytes=1000-' } }, { fs })
    const reader = res.body!.getReader()
    const chunks: Uint8Array[] = []
    let n = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      n++
      expect(value.length).toBeLessThanOrEqual(64 * 1024)
      if (n % 8 === 0) await tick(2) // stall the consumer
      expect(fs.reads).toBeLessThanOrEqual(n + 1) // at most one read in flight beyond what we consumed
    }
    expect(Buffer.concat(chunks).equals(big.subarray(1000))).toBe(true)
    await tick()
    expect([fs.opened, fs.closed]).toEqual([1, 1])
  })

  it('closes the handle when the consumer cancels mid-stream', async () => {
    const fs = trackingFs()
    const { lines, log } = logger()
    const res = await get('video/clip.mp4', { headers: { Range: 'bytes=0-' } }, { fs, log })
    const reader = res.body!.getReader()
    const first = await reader.read()
    expect(first.value!.length).toBe(64 * 1024)
    await reader.cancel()
    await tick(10)
    expect([fs.opened, fs.closed]).toEqual([1, 1])
    expect(fs.reads).toBe(1)
    expect(lines.map((l) => l.event)).toEqual(['request', 'stream-cancel'])
    expect(lines[1].data).toMatchObject({
      path: 'video/clip.mp4',
      start: 0,
      bytes: 64 * 1024,
      of: SIZE
    })
  })

  it('survives a cancel that lands while a read is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fs = trackingFs({
      read: async (buf, _off, len) => {
        await gate
        buf.fill(7, 0, len)
        return { bytesRead: len }
      }
    })
    const rejections: unknown[] = []
    const onRejection = (e: unknown): void => void rejections.push(e)
    process.on('unhandledRejection', onRejection)
    try {
      const res = await get('video/clip.mp4', {}, { fs })
      const reader = res.body!.getReader()
      const pending = reader.read()
      while (fs.reads === 0) await tick() // the read is now parked on the gate
      await reader.cancel()
      expect(fs.closed).toBe(1)
      release() // the late read resolves into an already-cancelled stream
      await expect(pending).resolves.toEqual({ done: true, value: undefined })
      await tick(20)
      expect([fs.opened, fs.closed, fs.reads]).toEqual([1, 1, 1])
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  it('closes the handle and errors the body when the request is aborted mid-stream', async () => {
    const fs = trackingFs()
    const { lines, log } = logger()
    const ac = new AbortController()
    const res = await get('video/clip.mp4', { signal: ac.signal }, { fs, log })
    const reader = res.body!.getReader()
    await reader.read()
    ac.abort()
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    await tick(10)
    expect([fs.opened, fs.closed]).toEqual([1, 1])
    expect(lines.map((l) => l.event)).toEqual(['request', 'stream-abort'])
  })

  it('closes the handle and errors the body on a read failure or a truncated file', async () => {
    const boom = Object.assign(new Error('boom'), { code: 'EIO' })
    const failing = trackingFs({ read: () => Promise.reject(boom) })
    const { lines, log } = logger()
    const res = await get('images/a.jpg', {}, { fs: failing, log })
    await expect(res.arrayBuffer()).rejects.toThrow()
    await tick(10)
    expect([failing.opened, failing.closed]).toEqual([1, 1])
    expect(lines).toHaveLength(1) // images log errors only
    expect(lines[0]).toMatchObject({
      event: 'stream-error',
      data: { path: 'images/a.jpg', error: 'EIO' }
    })

    const truncated = trackingFs({ read: () => Promise.resolve({ bytesRead: 0 }) })
    const res2 = await get('video/clip.mp4', {}, { fs: truncated })
    await expect(res2.arrayBuffer()).rejects.toThrow()
    await tick(10)
    expect([truncated.opened, truncated.closed]).toEqual([1, 1])
  })

  it('errors the body (no throw) when the file vanishes between stat and open', async () => {
    const gone: MediaFs = {
      stat: (p) => fsp.stat(p),
      open: () => Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
    }
    const { lines, log } = logger()
    const res = await get('video/clip.mp4', {}, { fs: gone, log })
    expect(res.status).toBe(200)
    await expect(res.arrayBuffer()).rejects.toThrow()
    expect(lines.at(-1)).toMatchObject({
      event: 'stream-error',
      data: { error: 'ENOENT', bytes: 0 }
    })
  })

  it('logs video requests with relative paths only, and keeps images silent', async () => {
    const { lines, log } = logger()
    await bytes(await get('images/a.jpg', {}, { log }))
    expect(lines).toEqual([])

    await bytes(await get('video/clip.mp4', { headers: { Range: 'bytes=100-199' } }, { log }))
    await tick()
    expect(lines.map((l) => l.event)).toEqual(['request', 'stream-end'])
    expect(lines[0].data).toMatchObject({
      method: 'GET',
      path: 'video/clip.mp4',
      range: 'bytes=100-199',
      status: 206,
      start: 100,
      end: 199,
      size: SIZE,
      mime: 'video/mp4'
    })
    expect(lines[1].data).toMatchObject({ path: 'video/clip.mp4', bytes: 100, of: 100 })

    await get('images/missing.png', {}, { log })
    expect(lines.at(-1)).toMatchObject({
      event: 'request',
      data: { path: 'images/missing.png', status: 404 }
    })
    expect(JSON.stringify(lines)).not.toContain(root)
  })

  it('keeps serving when the logger throws', async () => {
    const res = await get(
      'video/clip.mp4',
      {},
      {
        log: () => {
          throw new Error('logger down')
        }
      }
    )
    expect(res.status).toBe(200)
    expect((await bytes(res)).equals(video)).toBe(true)
  })

  it('survives the Readable.fromWeb bridge Electron uses, including an early destroy', async () => {
    const { Readable } = await import('stream')
    const fs = trackingFs()
    const res = await get('video/clip.mp4', { headers: { Range: 'bytes=0-' } }, { fs })
    // Electron: cb({ data: Readable.fromWeb(res.body) }); an aborted request destroys that Readable.
    const node = Readable.fromWeb(res.body as never)
    await new Promise<void>((resolve) => node.once('data', () => resolve()))
    node.destroy()
    await tick(20)
    expect([fs.opened, fs.closed]).toEqual([1, 1])

    const full = Readable.fromWeb((await get('video/clip.mp4', {}, { fs })).body as never)
    const parts: Buffer[] = []
    for await (const c of full) parts.push(Buffer.from(c))
    expect(Buffer.concat(parts).equals(video)).toBe(true)
    await tick()
    expect([fs.opened, fs.closed]).toEqual([2, 2])
  })
})
