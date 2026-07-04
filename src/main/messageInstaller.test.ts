import Database from 'better-sqlite3'
import { beforeEach, expect, test, vi } from 'vitest'
import { SCHEMA } from './db'
import { createMessageInstaller } from './messageInstaller'
import { createMessagesRepo, type MessagesRepo, type SermonIndexEntry } from './messagesRepo'
import type { MessageSource, SermonPayload } from './messageSource'
import type { AudioDownloadProgress, MessageInstallProgress } from '../shared/types'

function repo(): MessagesRepo {
  const db = new Database(':memory:')
  db.exec(SCHEMA)
  return createMessagesRepo(db)
}

const FIXTURE_INDEX: SermonIndexEntry[] = [
  { id: 'a', tapeNo: '65-1204', title: 'The Rapture', date: 'December 4, 1965', durationS: 9430 },
  { id: 'b', tapeNo: '47-0412', title: 'Faith', date: 'April 12, 1947', durationS: 3600 }
]

const FIXTURE_SERMON: SermonPayload = {
  paragraphs: [
    { label: 'E-1', text: 'Let us pray.' },
    { label: '76', text: 'Now, the Rapture is made up of three things.' }
  ],
  timing: [
    { ord: 0, tStart: 0, tEnd: 5 },
    { ord: 1, tStart: 5, tEnd: 12 }
  ]
}

function fakeSource(): MessageSource & { fetchSermonCalls: string[] } {
  const fetchSermonCalls: string[] = []
  return {
    fetchIndex: async (): Promise<SermonIndexEntry[]> => FIXTURE_INDEX,
    fetchSermon: async (id: string): Promise<SermonPayload> => {
      fetchSermonCalls.push(id)
      return FIXTURE_SERMON
    },
    audioUrl: async (entry: SermonIndexEntry): Promise<string> => `https://audio.example/${entry.tapeNo}.m4a`,
    fetchSermonCalls
  }
}

let broadcasts: (MessageInstallProgress | AudioDownloadProgress)[]
function capture(): (p: MessageInstallProgress | AudioDownloadProgress) => void {
  broadcasts = []
  return (p) => broadcasts.push(p)
}

function isAudioProgress(p: MessageInstallProgress | AudioDownloadProgress): p is AudioDownloadProgress {
  return 'msgId' in p
}

beforeEach(() => {
  broadcasts = []
})

test('installCorpus() broadcasts downloading -> installing (per entry) -> done, and installs the index + sermons', async () => {
  const r = repo()
  const broadcast = capture()
  const source = fakeSource()
  const installer = createMessageInstaller(r, broadcast, { source })

  installer.installCorpus()
  await vi.waitFor(() => expect(broadcasts.at(-1)?.phase).toBe('done'))

  expect(broadcasts.map((p) => p.phase)).toEqual(['downloading', 'installing', 'installing', 'done'])
  expect(source.fetchSermonCalls).toEqual(['a', 'b'])
  expect(r.count()).toBe(2)
  const msg = r.get('a')
  expect(msg?.paragraphs.length).toBeGreaterThan(0)
  expect(msg?.paragraphs).toEqual([
    { ord: 0, label: 'E-1', text: 'Let us pray.' },
    { ord: 1, label: '76', text: 'Now, the Rapture is made up of three things.' }
  ])
})

test('installCorpus() rejects a double-install while in flight', async () => {
  const r = repo()
  const broadcast = capture()
  let resolveIndex: (entries: SermonIndexEntry[]) => void
  const source: MessageSource = {
    fetchIndex: () =>
      new Promise((resolve) => {
        resolveIndex = resolve
      }),
    fetchSermon: async () => FIXTURE_SERMON,
    audioUrl: async (entry) => `https://audio.example/${entry.tapeNo}.m4a`
  }
  const fetchIndexSpy = vi.spyOn(source, 'fetchIndex')
  const installer = createMessageInstaller(r, broadcast, { source })

  installer.installCorpus()
  installer.installCorpus() // should be a no-op: install already in flight

  expect(fetchIndexSpy).toHaveBeenCalledTimes(1)
  resolveIndex!(FIXTURE_INDEX)
  await vi.waitFor(() => expect(r.count()).toBe(2))
})

test('installCorpus() broadcasts an error phase instead of throwing when the index fetch fails', async () => {
  const r = repo()
  const broadcast = capture()
  const source: MessageSource = {
    fetchIndex: async () => {
      throw new Error('network down')
    },
    fetchSermon: async () => FIXTURE_SERMON,
    audioUrl: async (entry) => `https://audio.example/${entry.tapeNo}.m4a`
  }
  const installer = createMessageInstaller(r, broadcast, { source })

  expect(() => installer.installCorpus()).not.toThrow()
  await vi.waitFor(() => expect(broadcasts.at(-1)?.phase).toBe('error'))

  expect(broadcasts.map((p) => p.phase)).toEqual(['downloading', 'error'])
  expect(r.count()).toBe(0)
})

test('downloadAudio() awaits audioUrl, writes the bytes via writeAudio, sets the audio path, and broadcasts done', async () => {
  const r = repo()
  r.installIndex(FIXTURE_INDEX)
  const broadcast = capture()
  const source = fakeSource()
  const writeAudio = vi.fn().mockResolvedValue('/fake/library/65-1204.m4a')
  const fakeBytes = new ArrayBuffer(4)
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => fakeBytes
  })
  vi.stubGlobal('fetch', fetchMock)

  const installer = createMessageInstaller(r, broadcast, { source, writeAudio })
  installer.downloadAudio('a')
  await vi.waitFor(() => expect(broadcasts.at(-1)?.phase).toBe('done'))

  expect(fetchMock).toHaveBeenCalledWith('https://audio.example/65-1204.m4a')
  expect(writeAudio).toHaveBeenCalledWith('65-1204', fakeBytes)
  expect(r.list().find((m) => m.id === 'a')?.hasAudio).toBe(true)
  const audioBroadcasts = broadcasts.filter(isAudioProgress)
  expect(audioBroadcasts.map((p) => p.phase)).toEqual(['downloading', 'done'])
  expect(audioBroadcasts.every((p) => p.msgId === 'a')).toBe(true)

  vi.unstubAllGlobals()
})

test('downloadAudio() ignores a second call for the same id while the first is still in flight', async () => {
  const r = repo()
  r.installIndex(FIXTURE_INDEX)
  const broadcast = capture()
  const source = fakeSource()
  const audioUrlSpy = vi.spyOn(source, 'audioUrl')
  let resolveFetch: (res: { ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }) => void
  const fetchMock = vi.fn(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  const writeAudio = vi.fn().mockResolvedValue('/fake/library/65-1204.m4a')

  const installer = createMessageInstaller(r, broadcast, { source, writeAudio })
  installer.downloadAudio('a')
  installer.downloadAudio('a') // should be a no-op: id already in flight

  await vi.waitFor(() => expect(audioUrlSpy).toHaveBeenCalledTimes(1))
  resolveFetch!({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(2) })
  await vi.waitFor(() => expect(writeAudio).toHaveBeenCalledTimes(1))

  vi.unstubAllGlobals()
})

test('downloadAudio() broadcasts an error phase for an unknown message id', async () => {
  const r = repo()
  const broadcast = capture()
  const source = fakeSource()
  const installer = createMessageInstaller(r, broadcast, { source })

  installer.downloadAudio('missing')
  await vi.waitFor(() => expect(broadcasts.at(-1)?.phase).toBe('error'))

  const audioBroadcasts = broadcasts.filter(isAudioProgress)
  expect(audioBroadcasts.map((p) => p.phase)).toEqual(['downloading', 'error'])
  expect(audioBroadcasts[1].error).toMatch(/unknown message id/)
})
