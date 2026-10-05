import { app, protocol } from 'electron'
import * as nodePath from 'path'
import { join } from 'path'
import { mkdirSync, promises as fsp } from 'fs'

export const MEDIA_SCHEME = 'helm-media'

export function libraryRoot(): string {
  const root = join(app.getPath('userData'), 'library')
  mkdirSync(root, { recursive: true })
  return root
}

// The slice of `path` the media code needs. Injectable so Windows semantics
// (`path.win32`) can be unit-tested on any host.
export type MediaPath = Pick<
  nodePath.PlatformPath,
  'join' | 'normalize' | 'sep' | 'isAbsolute' | 'extname' | 'relative'
>

// Pure: no Electron dependency, unit-tested. Returns an absolute path inside `root`,
// or null if the request escapes it (or is not decodable at all).
export function resolveMediaPath(
  root: string,
  urlPath: string,
  p: MediaPath = nodePath
): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null // malformed percent-escape
  }
  if (decoded.includes('\0')) return null
  // On Windows a backslash is a separator too, so strip both kinds of leading slash.
  const rel = decoded.replace(p.sep === '\\' ? /^[\\/]+/ : /^\/+/, '')
  if (p.isAbsolute(rel)) return null
  const abs = p.normalize(p.join(root, rel))
  const prefix = root.endsWith(p.sep) ? root : root + p.sep
  if (abs !== root && !abs.startsWith(prefix)) return null
  return abs
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo'
}
function mimeFor(file: string, p: MediaPath = nodePath): string {
  return MIME[p.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

export type ParsedRange =
  | { kind: 'none' } // absent, malformed, multi-range, or inverted: ignore the header (RFC 9110 §14.2)
  | { kind: 'unsatisfiable' } // well-formed but selects no bytes: 416
  | { kind: 'range'; start: number; end: number } // inclusive byte interval, clamped to the file

// Pure: parse an HTTP Range header against a known file size.
export function parseRangeHeader(header: string | null, size: number): ParsedRange {
  if (!header) return { kind: 'none' }
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!m) return { kind: 'none' }
  const [, s, e] = m
  if (s === '') {
    if (e === '') return { kind: 'none' }
    const n = parseInt(e, 10)
    if (n === 0 || size === 0) return { kind: 'unsatisfiable' }
    return { kind: 'range', start: Math.max(0, size - n), end: size - 1 }
  }
  const start = parseInt(s, 10)
  const end = e === '' ? Infinity : parseInt(e, 10)
  if (start > end) return { kind: 'none' }
  if (start >= size) return { kind: 'unsatisfiable' }
  return { kind: 'range', start, end: Math.min(end, size - 1) }
}

// ---------------------------------------------------------------------------
// helm-media:// request handler. Pure with respect to Electron: it takes a
// WHATWG Request and returns a WHATWG Response, so it is unit-tested directly.
//
// Every response is built here (no net.fetch(file://) fallback), because
// Chromium's media loader treats non-HTTP schemes specially: it does NOT look at
// the status code or Content-Range, it assumes the body starts exactly at the
// byte it asked for and computes the resource length as
// `Content-Length + requested offset` (resource_multi_buffer_data_provider.cc).
// So a Range request must never be answered with a body that starts elsewhere,
// and Content-Length must always be exact.
// ---------------------------------------------------------------------------

export type MediaLog = (event: string, data?: Record<string, unknown>) => void

export interface MediaFileHandle {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number }>
  close(): Promise<void>
}

export interface MediaFs {
  stat(path: string): Promise<{ size: number; isFile(): boolean }>
  open(path: string, flags: 'r'): Promise<MediaFileHandle>
}

export interface MediaHandlerDeps {
  /** One structured line per event. Defaults to `console.log('[helm-media] <event> <json>')`. */
  log?: MediaLog
  /** File-system seam (tests). Defaults to `fs.promises`. */
  fs?: MediaFs
  /** Path seam (tests exercise `path.win32`). Defaults to the host `path`. */
  path?: MediaPath
  /** Bytes per read / stream chunk. Defaults to 64 KiB. */
  chunkSize?: number
}

const DEFAULT_CHUNK = 64 * 1024

const defaultLog: MediaLog = (event, data) => {
  console.log(`[helm-media] ${event}${data ? ' ' + JSON.stringify(data) : ''}`)
}

let nextRequestId = 1

type StreamOutcome = 'end' | 'cancel' | 'abort' | 'error'

// A pull-driven ReadableStream over `length` bytes of `abs` starting at `start`.
//
// Hand-rolled rather than Readable.toWeb(createReadStream()) on purpose:
// Chromium's media loader cancels range bodies mid-flight all the time, and the
// Node adapter can throw an uncatchable ERR_INVALID_STATE ("Controller is
// already closed") when a cancel races the fs stream (nodejs/node#54205). Here
// every controller call is guarded by `settled`, one read is in flight at most
// (so backpressure is exact), the file is opened on the first pull (a body that
// is never read never holds a handle) and it is closed exactly once on
// end / cancel / abort / error.
function fileBodyStream(
  abs: string,
  start: number,
  length: number,
  o: {
    fs: MediaFs
    chunkSize: number
    signal?: AbortSignal
    onDone: (outcome: StreamOutcome, bytes: number, err?: unknown) => void
    onCloseError: (err: unknown) => void
  }
): ReadableStream<Uint8Array> {
  let handle: MediaFileHandle | null = null
  let position = start
  let remaining = length
  let settled = false
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null

  const closeHandle = (h: MediaFileHandle): void => {
    // FileHandle.close() waits for an in-flight read, so this is safe mid-read.
    h.close().catch(o.onCloseError)
  }
  const finish = (outcome: StreamOutcome, err?: unknown): boolean => {
    if (settled) return false
    settled = true
    o.signal?.removeEventListener('abort', onAbort)
    const h = handle
    handle = null
    if (h) closeHandle(h)
    o.onDone(outcome, length - remaining, err)
    return true
  }
  const fail = (outcome: 'abort' | 'error', err: unknown): void => {
    if (!finish(outcome, err)) return
    try {
      controllerRef?.error(err)
    } catch {
      /* stream already closed/cancelled */
    }
  }
  function onAbort(): void {
    fail('abort', o.signal?.reason ?? new Error('aborted'))
  }

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controllerRef = controller
        if (o.signal?.aborted) onAbort()
        else o.signal?.addEventListener('abort', onAbort, { once: true })
      },
      async pull(controller) {
        if (settled) return
        try {
          if (!handle) {
            const h = await o.fs.open(abs, 'r')
            if (settled) return closeHandle(h) // cancelled while opening
            handle = h
          }
          const buf = new Uint8Array(Math.min(o.chunkSize, remaining))
          const { bytesRead } = await handle.read(buf, 0, buf.length, position)
          if (settled) return // cancelled while reading; handle already closed
          if (bytesRead <= 0)
            throw new Error(`unexpected EOF at byte ${position} (file truncated?)`)
          position += bytesRead
          remaining -= bytesRead
          controller.enqueue(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead))
          if (remaining === 0 && finish('end')) controller.close()
        } catch (err) {
          fail('error', err)
        }
      },
      cancel() {
        finish('cancel')
      }
    },
    // No read-ahead: touch the disk only when the consumer asks for data.
    { highWaterMark: 0 }
  )
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code
}

export async function handleMediaRequest(
  req: Request,
  root: string,
  deps: MediaHandlerDeps = {}
): Promise<Response> {
  const p = deps.path ?? nodePath
  const fs = deps.fs ?? (fsp as MediaFs)
  const chunkSize = Math.max(1, deps.chunkSize ?? DEFAULT_CHUNK)
  const rawLog = deps.log ?? defaultLog
  const log: MediaLog = (event, data) => {
    try {
      rawLog(event, data)
    } catch {
      /* a broken logger must never break playback */
    }
  }

  const id = nextRequestId++
  const method = req.method.toUpperCase()
  const rangeHeader = req.headers.get('Range')
  let rel = '?'

  // Videos are logged in full; everything else (a deck of thumbnails) only
  // when something goes wrong.
  const respond = (
    status: number,
    headers: Record<string, string>,
    body: ReadableStream<Uint8Array> | null,
    info: Record<string, unknown> = {}
  ): Response => {
    const isVideo = (headers['Content-Type'] ?? '').startsWith('video/')
    if (isVideo || status >= 400)
      log('request', { id, method, path: rel, range: rangeHeader, status, ...info })
    return new Response(body, { status, headers })
  }
  const plain = (
    status: number,
    extra: Record<string, string> = {},
    info: Record<string, unknown> = {}
  ): Response => respond(status, { 'Content-Length': '0', ...extra }, null, info)

  try {
    const { host, pathname } = new URL(req.url) // helm-media://images/a.jpg -> host=images, pathname=/a.jpg
    const abs = resolveMediaPath(root, host + pathname, p)
    if (!abs) {
      rel = '(outside library)'
      return plain(403)
    }
    // Never log the absolute path: it contains the OS user name.
    rel = p.relative(root, abs).split(p.sep).join('/')

    if (method !== 'GET' && method !== 'HEAD') return plain(405, { Allow: 'GET, HEAD' })

    let size: number
    try {
      const st = await fs.stat(abs)
      if (!st.isFile()) return plain(404, {}, { error: 'not a file' })
      size = st.size
    } catch (err) {
      const code = errCode(err)
      return plain(
        code === 'ENOENT' || code === 'ENOTDIR' ? 404 : 500,
        {},
        { error: code ?? String(err) }
      )
    }

    const mime = mimeFor(abs, p)
    const isVideo = mime.startsWith('video/')
    const base = { 'Content-Type': mime, 'Accept-Ranges': 'bytes' }

    // A zero-byte file has no satisfiable range; serve the (empty) whole thing.
    const range: ParsedRange = size === 0 ? { kind: 'none' } : parseRangeHeader(rangeHeader, size)

    if (range.kind === 'unsatisfiable') {
      // Empty body + Content-Length 0: see the header comment on non-HTTP schemes.
      return respond(
        416,
        { ...base, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' },
        null,
        { size, mime }
      )
    }

    const start = range.kind === 'range' ? range.start : 0
    const end = range.kind === 'range' ? range.end : size - 1
    const length = end - start + 1
    const status = range.kind === 'range' ? 206 : 200
    const headers: Record<string, string> = { ...base, 'Content-Length': String(length) }
    if (range.kind === 'range') headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    const info = { start, end, size, mime }

    if (method === 'HEAD' || length === 0) return respond(status, headers, null, info)

    const t0 = Date.now()
    const body = fileBodyStream(abs, start, length, {
      fs,
      chunkSize,
      signal: req.signal,
      onDone: (outcome, bytes, err) => {
        if (outcome === 'error') {
          log('stream-error', {
            id,
            path: rel,
            start,
            bytes,
            of: length,
            ms: Date.now() - t0,
            error: errCode(err) ?? String(err)
          })
        } else if (isVideo) {
          log(`stream-${outcome}`, { id, path: rel, start, bytes, of: length, ms: Date.now() - t0 })
        }
      },
      onCloseError: (err) =>
        log('close-error', { id, path: rel, error: errCode(err) ?? String(err) })
    })
    return respond(status, headers, body, info)
  } catch (err) {
    return plain(500, {}, { error: errCode(err) ?? String(err) })
  }
}

export function registerMediaProtocol(root: string, deps: MediaHandlerDeps = {}): void {
  protocol.handle(MEDIA_SCHEME, (req) => handleMediaRequest(req, root, deps))
}
