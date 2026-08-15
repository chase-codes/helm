import { describe, it, expect, vi } from 'vitest'
import { createUpdater, type UpdaterDriver } from './updater'
import type { UpdateStatus } from '../shared/types'

type Handler = (info?: { version?: string; percent?: number; message?: string }) => void

function fakeDriver(): UpdaterDriver & { emit: (ev: string, info?: { version?: string; percent?: number; message?: string }) => void } {
  const handlers = new Map<string, Handler[]>()
  return {
    autoDownload: false,
    checkForUpdates: vi.fn(() => Promise.resolve(undefined)),
    quitAndInstall: vi.fn(),
    on(ev: string, cb: Handler) {
      handlers.set(ev, [...(handlers.get(ev) ?? []), cb])
      return this
    },
    emit(ev: string, info?: { version?: string; percent?: number; message?: string }) {
      for (const h of handlers.get(ev) ?? []) h(info)
    }
  }
}

describe('createUpdater', () => {
  it('starts idle, checks on start, and reports ready after update-downloaded', () => {
    const driver = fakeDriver()
    const statuses: unknown[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    expect(u.status()).toEqual({ state: 'idle', version: null })
    u.start()
    expect(driver.autoDownload).toBe(true)
    expect(driver.checkForUpdates).toHaveBeenCalled()
    driver.emit('update-available', { version: '0.2.0' })
    expect(u.status()).toEqual({ state: 'available', version: '0.2.0' })
    driver.emit('update-downloaded', { version: '0.2.0' })
    expect(u.status()).toEqual({ state: 'ready', version: '0.2.0' })
    expect(statuses).toEqual([
      { state: 'available', version: '0.2.0' },
      { state: 'ready', version: '0.2.0' }
    ])
  })

  it('install() refuses while any output window is up', () => {
    const driver = fakeDriver()
    let outputs = 1
    const u = createUpdater(driver, { outputCount: () => outputs, broadcast: () => {}, schedule: () => {} })
    u.start()
    driver.emit('update-downloaded', { version: '0.2.0' })
    expect(u.install()).toBe(false)
    expect(driver.quitAndInstall).not.toHaveBeenCalled()
    outputs = 0
    expect(u.install()).toBe(true)
    expect(driver.quitAndInstall).toHaveBeenCalled()
  })

  it('install() refuses when no update is ready', () => {
    const driver = fakeDriver()
    const u = createUpdater(driver, { outputCount: () => 0, broadcast: () => {}, schedule: () => {} })
    u.start()
    expect(u.install()).toBe(false)
    expect(driver.quitAndInstall).not.toHaveBeenCalled()
  })

  it('errors reset to idle without throwing, and rechecks are scheduled', () => {
    const driver = fakeDriver()
    let tick: (() => void) | null = null
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: () => {},
      schedule: (fn) => { tick = fn }
    })
    u.start()
    driver.emit('update-available', { version: '0.2.0' })
    driver.emit('error')
    expect(u.status()).toEqual({ state: 'idle', version: null })
    tick!()
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('null driver (dev mode) is a no-op', () => {
    const u = createUpdater(null, { outputCount: () => 0, broadcast: () => {}, schedule: () => {} })
    u.start()
    expect(u.status()).toEqual({ state: 'idle', version: null })
    expect(u.install()).toBe(false)
  })

  it('manual check reports checking, downloading progress, then ready', () => {
    const driver = fakeDriver()
    const statuses: UpdateStatus[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    u.start()
    u.check()
    driver.emit('update-available', { version: '0.4.0' })
    driver.emit('download-progress', { percent: 42 })
    driver.emit('update-downloaded', { version: '0.4.0' })
    expect(statuses).toEqual([
      { state: 'checking', version: null },
      { state: 'downloading', version: '0.4.0', percent: 0 },
      { state: 'downloading', version: '0.4.0', percent: 42 },
      { state: 'ready', version: '0.4.0' }
    ])
  })

  it('background events never broadcast the manual-only states', () => {
    const driver = fakeDriver()
    const statuses: UpdateStatus[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    u.start()
    driver.emit('update-not-available')
    driver.emit('update-available', { version: '0.4.0' })
    driver.emit('download-progress', { percent: 10 })
    driver.emit('update-downloaded', { version: '0.4.0' })
    expect(statuses).toEqual([
      { state: 'available', version: '0.4.0' },
      { state: 'ready', version: '0.4.0' }
    ])
  })

  it('manual check reports up to date; a later background not-available stays silent', () => {
    const driver = fakeDriver()
    const statuses: UpdateStatus[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    u.start()
    u.check()
    driver.emit('update-not-available')
    expect(statuses).toEqual([
      { state: 'checking', version: null },
      { state: 'upToDate', version: null }
    ])
    statuses.length = 0
    driver.emit('update-not-available') // background recheck later
    expect(statuses).toEqual([])
  })

  it('manual check surfaces error events; background errors stay silent', () => {
    const driver = fakeDriver()
    const statuses: UpdateStatus[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    u.start()
    u.check()
    driver.emit('error', { message: 'offline' })
    expect(u.status()).toEqual({ state: 'error', version: null, message: 'offline' })
    statuses.length = 0
    driver.emit('error', { message: 'offline' }) // background failure later
    expect(statuses).toEqual([])
  })

  it('manual check surfaces a rejected checkForUpdates', async () => {
    const driver = fakeDriver()
    driver.checkForUpdates = vi.fn(() => Promise.reject(new Error('net down')))
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: () => {},
      schedule: () => {}
    })
    u.start() // startup check also rejects — background, must stay silent
    u.check()
    await new Promise((r) => setTimeout(r, 0))
    expect(u.status()).toEqual({ state: 'error', version: null, message: 'net down' })
  })

  it('a background error after download does not forget the ready update', () => {
    const driver = fakeDriver()
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: () => {},
      schedule: () => {}
    })
    u.start()
    driver.emit('update-downloaded', { version: '0.4.0' })
    driver.emit('error')
    expect(u.status()).toEqual({ state: 'ready', version: '0.4.0' })
  })

  it('manual check while ready re-broadcasts ready without a network hit', () => {
    const driver = fakeDriver()
    const statuses: UpdateStatus[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    u.start()
    driver.emit('update-downloaded', { version: '0.4.0' })
    statuses.length = 0
    u.check()
    expect(statuses).toEqual([{ state: 'ready', version: '0.4.0' }])
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1) // startup only
  })

  it('manual check reports unsupported on unsupported platforms and dev builds', () => {
    const driver = fakeDriver()
    const statuses: UpdateStatus[] = []
    const u = createUpdater(driver, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      supported: false,
      schedule: () => {}
    })
    u.start()
    u.check()
    expect(statuses).toEqual([{ state: 'unsupported', version: null }])
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1) // startup only — manual never hits network

    const dev = createUpdater(null, {
      outputCount: () => 0,
      broadcast: (s) => statuses.push(s),
      schedule: () => {}
    })
    dev.check()
    expect(statuses.at(-1)).toEqual({ state: 'unsupported', version: null })
  })
})
