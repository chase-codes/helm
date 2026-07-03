import { join } from 'node:path'
import { matchBook } from '../shared/scripture/refs'
import type { NormalizedBible } from '../shared/types'

export interface ManifestEntryDef {
  id: string
  abbr: string
  name: string
  url: string
  bundled?: boolean
}

export const BIBLE_MANIFEST: ManifestEntryDef[] = [
  {
    id: 'kjv',
    abbr: 'KJV',
    name: 'King James Version',
    url: 'https://api.getbible.net/v2/kjv.json',
    bundled: true
  },
  {
    id: 'web',
    abbr: 'WEB',
    name: 'World English Bible',
    url: 'https://api.getbible.net/v2/web.json'
  },
  {
    id: 'asv',
    abbr: 'ASV',
    name: 'American Standard Version',
    url: 'https://api.getbible.net/v2/asv.json'
  },
  {
    id: 'darby',
    abbr: 'DARBY',
    name: 'Darby Translation',
    url: 'https://api.getbible.net/v2/darby.json'
  }
]

interface GetBibleVerse {
  verse: number
  text: string
}
interface GetBibleChapter {
  chapter: number
  verses: GetBibleVerse[]
}
interface GetBibleBook {
  nr: number
  name: string
  chapters: GetBibleChapter[]
}
interface GetBibleRoot {
  lang?: string
  books: GetBibleBook[]
}

export function normalizeGetBible(raw: unknown, entry: ManifestEntryDef): NormalizedBible {
  const data = raw as Partial<GetBibleRoot> | null | undefined
  if (!data || !Array.isArray(data.books)) {
    throw new Error(`normalizeGetBible: invalid getbible payload for "${entry.id}"`)
  }

  const unmapped = data.books.map((b) => b.name).filter((name) => !matchBook(name))
  if (unmapped.length > 0) {
    throw new Error(
      `normalizeGetBible: unmapped book name(s) for "${entry.id}": ${unmapped.join(', ')}`
    )
  }

  return {
    id: entry.id,
    abbr: entry.abbr,
    name: entry.name,
    language: data.lang ?? 'en',
    books: data.books.map((b) => ({
      name: matchBook(b.name) as string,
      chapters: b.chapters.map((c) => ({
        n: c.chapter,
        verses: c.verses.map((v) => ({ n: v.verse, text: v.text.trimEnd() }))
      }))
    }))
  }
}

export function bundledKjvPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron')
  return app.isPackaged
    ? join(process.resourcesPath, 'bibles/kjv.json')
    : join(app.getAppPath(), 'resources/bibles/kjv.json')
}

export async function downloadAndNormalize(id: string): Promise<NormalizedBible> {
  const entry = BIBLE_MANIFEST.find((e) => e.id === id)
  if (!entry) {
    throw new Error(`downloadAndNormalize: unknown bible id "${id}"`)
  }
  const res = await fetch(entry.url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) {
    throw new Error(`downloadAndNormalize: failed to fetch "${id}" (${res.status})`)
  }
  const raw = await res.json()
  return normalizeGetBible(raw, entry)
}
