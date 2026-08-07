import { describe, it, expect, vi } from 'vitest'
import { createUpdater, type UpdaterDriver } from './updater'

type Handler = (info?: { version?: string }) => void

function fakeDriver(): UpdaterDriver & { emit: (ev: string, info?: { version?: string }) => void } {
  const handlers = new Map<string, Handler[]>()
  return {
    autoDownload: false,
    checkForUpdates: vi.fn(() => Promise.resolve(undefined)),
    quitAndInstall: vi.fn(),
    on(ev: string, cb: Handler) {
      handlers.set(ev, [...(handlers.get(ev) ?? []), cb])
      return this
    },
    emit(ev: string, info?: { version?: string }) {
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
})
