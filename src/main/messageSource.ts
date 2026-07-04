import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { join } from 'node:path'
import type { SermonIndexEntry } from './messagesRepo'
import { parseMessageText } from '../shared/message/parseImport'

export interface SermonPayload {
  paragraphs: { label: string; text: string }[]
  timing: { ord: number; tStart: number; tEnd: number }[] // [] in slice 4; aeneas fills in 4b
}

export interface MessageSource {
  fetchIndex(): Promise<SermonIndexEntry[]>
  fetchSermon(id: string): Promise<SermonPayload>
  audioUrl(entry: SermonIndexEntry): Promise<string>
}

// ---------------------------------------------------------------------------
// Pure normalizers — validate + shape untrusted payloads. Mirrors the
// normalizeGetBible discipline in bibleSource.ts: throw a clear Error on
// anything malformed rather than silently produce a broken record.
// ---------------------------------------------------------------------------

interface RawIndexEntry {
  id?: unknown
  tapeNo?: unknown
  title?: unknown
  date?: unknown
  durationS?: unknown
}

export function normalizeIndex(raw: unknown): SermonIndexEntry[] {
  if (!Array.isArray(raw)) {
    throw new Error('normalizeIndex: expected an array of sermon index entries')
  }
  return raw.map((entryRaw, i) => {
    const e = (entryRaw ?? {}) as RawIndexEntry
    if (typeof e.id !== 'string' || e.id.length === 0) {
      throw new Error(`normalizeIndex: entry ${i} is missing a string "id"`)
    }
    if (typeof e.tapeNo !== 'string' || e.tapeNo.length === 0) {
      throw new Error(`normalizeIndex: entry ${i} ("${e.id}") is missing a string "tapeNo"`)
    }
    return {
      id: e.id,
      tapeNo: e.tapeNo,
      title: typeof e.title === 'string' ? e.title : '',
      date: typeof e.date === 'string' ? e.date : '',
      durationS: typeof e.durationS === 'number' ? e.durationS : 0
    }
  })
}

interface RawParagraph {
  label?: unknown
  text?: unknown
}
interface RawTiming {
  ord?: unknown
  tStart?: unknown
  tEnd?: unknown
}
interface RawSermon {
  paragraphs?: unknown
  timing?: unknown
}

export function normalizeSermon(raw: unknown): SermonPayload {
  const data = (raw ?? {}) as RawSermon
  if (!Array.isArray(data.paragraphs)) {
    throw new Error('normalizeSermon: expected an object with a "paragraphs" array')
  }

  const paragraphs = data.paragraphs.map((pRaw, i) => {
    const p = (pRaw ?? {}) as RawParagraph
    if (typeof p.text !== 'string') {
      throw new Error(`normalizeSermon: paragraph ${i} is missing a string "text"`)
    }
    // Coerce label to a string — some transcript sources emit numeric labels.
    const label = typeof p.label === 'string' ? p.label : String(p.label ?? '')
    return { label, text: p.text }
  })

  const timing = Array.isArray(data.timing)
    ? data.timing.map((tRaw, i) => {
        const t = (tRaw ?? {}) as RawTiming
        if (
          typeof t.ord !== 'number' ||
          typeof t.tStart !== 'number' ||
          typeof t.tEnd !== 'number'
        ) {
          throw new Error(`normalizeSermon: timing entry ${i} has a non-numeric ord/tStart/tEnd`)
        }
        return { ord: t.ord, tStart: t.tStart, tEnd: t.tEnd }
      })
    : []

  return { paragraphs, timing }
}

// ---------------------------------------------------------------------------
// Interim fixture-backed source — the working source for the slice-4 pipeline
// while the real scraper (below) is verified in slice 4a. Reads the same
// structural fixtures the normalizer tests exercise.
// ---------------------------------------------------------------------------

export function createFixtureMessageSource(): MessageSource {
  const indexPath = join(__dirname, '__fixtures__/message-index.sample.json')
  const sermonPath = join(__dirname, '__fixtures__/message-sermon.sample.json')

  return {
    async fetchIndex(): Promise<SermonIndexEntry[]> {
      const raw = JSON.parse(readFileSync(indexPath, 'utf-8')) as unknown
      return normalizeIndex(raw)
    },
    // Interim dev/fake source: any id resolves to the same fixture sermon (param unused).
    async fetchSermon(): Promise<SermonPayload> {
      const raw = JSON.parse(readFileSync(sermonPath, 'utf-8')) as unknown
      return normalizeSermon(raw)
    },
    async audioUrl(entry: SermonIndexEntry): Promise<string> {
      return `file://interim-fixture/${entry.tapeNo}.m4a`
    }
  }
}

// ---------------------------------------------------------------------------
// Real source — authoritative scrape per the 2026-07-03 spike
// (docs/superpowers/notes/2026-07-03-the-table-acquisition.md). Thin, not
// unit-tested (mirrors downloadAndNormalize in bibleSource.ts); live-HTML
// correctness is verified manually in slice 4a, not here.
// ---------------------------------------------------------------------------

const BRANHAM_ORIGIN = 'https://branham.org'
const sermonPageUrl = (tapeNo: string): string => `${BRANHAM_ORIGIN}/en/messagestream/ENG=${tapeNo}`
// TODO(slice-4a): verify the real listing endpoint/pagination against live branham.org.
// This assumes a single enumerable HTML page listing all 1,206 sermons; it may in fact be
// paginated, JS-rendered, or served from a different route entirely.
const SERMON_INDEX_URL = `${BRANHAM_ORIGIN}/en/messagestream`

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) {
    throw new Error(`messageSource: failed to fetch ${url} (${res.status})`)
  }
  return res.text()
}

// TODO(slice-4a): verify against live branham.org sermon-page HTML. The href-ending-in-.pdf
// heuristic is a reasonable guess from the spike's manual inspection, not machine-verified
// across the catalog (some sermons may have multiple PDF links, e.g. multiple languages).
function findPdfUrl(pageHtml: string): string {
  const m = pageHtml.match(/href="([^"]+\.pdf)"/i)
  if (!m) {
    throw new Error('messageSource: could not locate a PDF transcript link on the sermon page')
  }
  return new URL(m[1], BRANHAM_ORIGIN).toString()
}

// TODO(slice-4a): verify against live branham.org sermon-page HTML. The spike confirmed the
// CloudFront host + .m4a extension pattern; the surrounding markup (which element/attribute
// carries it) was not machine-verified beyond that.
function findAudioUrl(pageHtml: string): string {
  const m = pageHtml.match(/https:\/\/[a-z0-9-]+\.cloudfront\.net\/[^"'\s]+\.m4a/i)
  if (!m) {
    throw new Error('messageSource: could not locate a .m4a audio URL on the sermon page')
  }
  return m[0]
}

// TODO(slice-4a): verify against live branham.org listing HTML. Guesses a row shape of one
// <a href="...ENG=<tapeNo>"> per sermon with the title as link text; date/durationS are not
// available from a listing page in this guess and default to '' / 0 — a real implementation
// may need a secondary per-sermon fetch or a different listing source entirely.
function parseIndexHtml(html: string): unknown[] {
  const entries: unknown[] = []
  const rowRe = /<a[^>]+href="[^"]*ENG=([\d-]+)"[^>]*>([^<]*)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(html))) {
    const tapeNo = m[1]
    const title = m[2].trim()
    entries.push({ id: tapeNo, tapeNo, title, date: '', durationS: 0 })
  }
  return entries
}

function unescapePdfString(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, esc: string) => {
    switch (esc) {
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 't':
        return '\t'
      case 'b':
        return '\b'
      case 'f':
        return '\f'
      case '(':
        return '('
      case ')':
        return ')'
      case '\\':
        return '\\'
      default:
        return String.fromCharCode(parseInt(esc, 8))
    }
  })
}

// TODO(slice-4a): verify against real branham.org PDF transcripts. This is a minimal,
// dependency-free PDF text extractor (decompress FlateDecode content streams, pull literal
// strings out of Tj/TJ text-showing operators). It recovers plain text reasonably well for
// simple text-based PDFs but does not handle every PDF variant (CID-keyed fonts, non-Flate
// filters, image-only pages, etc). If the real transcripts don't extract cleanly, swap in a
// real PDF library here rather than hardening this by hand.
function extractPdfText(buf: Buffer): string {
  const raw = buf.toString('latin1')
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  const chunks: string[] = []
  let m: RegExpExecArray | null
  while ((m = streamRe.exec(raw))) {
    let content: string
    try {
      content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')
    } catch {
      continue // not a Flate-compressed content stream (e.g. image/font binary) — skip
    }
    const textRe = /\(((?:\\.|[^()\\])*)\)\s*Tj|\[((?:[^\]])*)\]\s*TJ/g
    let tm: RegExpExecArray | null
    while ((tm = textRe.exec(content))) {
      if (tm[1] !== undefined) {
        chunks.push(unescapePdfString(tm[1]))
      } else if (tm[2] !== undefined) {
        const parts = tm[2].match(/\(((?:\\.|[^()\\])*)\)/g) ?? []
        chunks.push(parts.map((p) => unescapePdfString(p.slice(1, -1))).join(''))
      }
    }
    chunks.push('\n')
  }
  return chunks.join('')
}

export function createMessageSource(): MessageSource {
  return {
    async fetchIndex(): Promise<SermonIndexEntry[]> {
      const html = await fetchText(SERMON_INDEX_URL)
      return normalizeIndex(parseIndexHtml(html))
    },
    async fetchSermon(id: string): Promise<SermonPayload> {
      // `id` doubles as the tape number for the real source's URL scheme, matching the
      // fixture/index shape (SermonIndexEntry.id === SermonIndexEntry.tapeNo in practice).
      const pageHtml = await fetchText(sermonPageUrl(id))
      const pdfUrl = findPdfUrl(pageHtml)
      const pdfRes = await fetch(pdfUrl, { signal: AbortSignal.timeout(60_000) })
      if (!pdfRes.ok) {
        throw new Error(`messageSource: failed to fetch PDF transcript (${pdfRes.status})`)
      }
      const pdfBuf = Buffer.from(await pdfRes.arrayBuffer())
      const text = extractPdfText(pdfBuf)
      const parsed = parseMessageText(text)
      return { paragraphs: parsed.paragraphs, timing: [] }
    },
    async audioUrl(entry: SermonIndexEntry): Promise<string> {
      const pageHtml = await fetchText(sermonPageUrl(entry.tapeNo))
      return findAudioUrl(pageHtml)
    }
  }
}
