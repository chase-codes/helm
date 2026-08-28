import { describe, expect, it, vi } from 'vitest'
import { dispatchModeKey, type KeyDispatchCtx } from './keyDispatch'
import type { ModeKeyHandler } from './App'

function makeHandler(over: Partial<ModeKeyHandler> = {}): ModeKeyHandler {
  return {
    onEscape: vi.fn(() => false),
    onArrow: vi.fn(),
    onGoLive: vi.fn(),
    isModalOpen: vi.fn(() => false),
    ...over
  }
}

function ev(key: string, opts: Partial<{ tag: string; ctrl: boolean; meta: boolean }> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: !!opts.ctrl,
    metaKey: !!opts.meta,
    altKey: false,
    shiftKey: false,
    target: { tagName: (opts.tag ?? 'body').toUpperCase() },
    preventDefault: vi.fn()
  } as unknown as KeyboardEvent
}

// isMac:false in tests → ctrlKey is Mod.
const baseCtx = (over: Partial<KeyDispatchCtx> = {}): Omit<KeyDispatchCtx, 'handler'> => ({
  settingsOpen: false,
  closeSettings: vi.fn(),
  scope: null,
  overrides: {},
  onAppAction: vi.fn(),
  isMac: false,
  ...over
})

describe('dispatchModeKey', () => {
  it('Delete dispatches onDelete when the mode provides one', () => {
    const onDelete = vi.fn()
    const e = ev('Delete')
    dispatchModeKey(e, { ...baseCtx(), handler: makeHandler({ onDelete }) })
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('Backspace also dispatches onDelete', () => {
    const onDelete = vi.fn()
    dispatchModeKey(ev('Backspace'), { ...baseCtx(), handler: makeHandler({ onDelete }) })
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('Delete while typing in an input is ignored', () => {
    const onDelete = vi.fn()
    dispatchModeKey(ev('Delete', { tag: 'input' }), { ...baseCtx(), handler: makeHandler({ onDelete }) })
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('Delete is a no-op (no preventDefault) when the mode has no onDelete', () => {
    const e = ev('Delete')
    dispatchModeKey(e, { ...baseCtx(), handler: makeHandler() })
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('arrows still step the cue (regression guard on the extraction)', () => {
    const onArrow = vi.fn()
    dispatchModeKey(ev('ArrowRight'), { ...baseCtx(), handler: makeHandler({ onArrow }) })
    expect(onArrow).toHaveBeenCalledWith(1)
  })

  it('Escape closes settings first when open', () => {
    const closeSettings = vi.fn()
    const onEscape = vi.fn(() => false)
    dispatchModeKey(ev('Escape'), { ...baseCtx({ settingsOpen: true, closeSettings }), handler: makeHandler({ onEscape }) })
    expect(closeSettings).toHaveBeenCalledTimes(1)
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('Space does nothing: no goLive, and no preventDefault (#52)', () => {
    const onGoLive = vi.fn()
    const e = ev(' ')
    dispatchModeKey(e, { ...baseCtx(), handler: makeHandler({ onGoLive }) })
    expect(onGoLive).not.toHaveBeenCalled()
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('Enter goLive is suppressed while a modal is open', () => {
    const onGoLive = vi.fn()
    dispatchModeKey(ev('Enter'), { ...baseCtx(), handler: makeHandler({ onGoLive, isModalOpen: () => true }) })
    expect(onGoLive).not.toHaveBeenCalled()
  })

  it('Delete is suppressed while settings is open', () => {
    const onDelete = vi.fn()
    dispatchModeKey(ev('Delete'), { ...baseCtx({ settingsOpen: true }), handler: makeHandler({ onDelete }) })
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('Delete is suppressed while the mode reports a modal open', () => {
    const onDelete = vi.fn()
    dispatchModeKey(ev('Delete'), { ...baseCtx(), handler: makeHandler({ onDelete, isModalOpen: () => true }) })
    expect(onDelete).not.toHaveBeenCalled()
  })
})

describe('dispatchModeKey — hotkey actions', () => {
  it('Mod+2 fires the page.songs app action', () => {
    const ctx = baseCtx()
    dispatchModeKey(ev('2', { ctrl: true }), { ...ctx, handler: makeHandler() })
    expect(ctx.onAppAction).toHaveBeenCalledWith('page.songs')
  })

  it('Mod+K fires scripture.lookup even while typing', () => {
    const ctx = baseCtx()
    dispatchModeKey(ev('k', { ctrl: true, tag: 'input' }), { ...ctx, handler: makeHandler() })
    expect(ctx.onAppAction).toHaveBeenCalledWith('scripture.lookup')
  })

  it('Mod+L fires song.search even while typing (#52)', () => {
    const ctx = baseCtx()
    const e = ev('l', { ctrl: true, tag: 'input' })
    dispatchModeKey(e, { ...ctx, handler: makeHandler() })
    expect(ctx.onAppAction).toHaveBeenCalledWith('song.search')
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('song.search is a page action: suppressed behind Settings or a mode modal', () => {
    const settings = baseCtx({ settingsOpen: true })
    dispatchModeKey(ev('l', { ctrl: true }), { ...settings, handler: makeHandler() })
    expect(settings.onAppAction).not.toHaveBeenCalled()
    const modal = baseCtx()
    dispatchModeKey(ev('l', { ctrl: true }), { ...modal, handler: makeHandler({ isModalOpen: () => true }) })
    expect(modal.onAppAction).not.toHaveBeenCalled()
  })

  it('app actions are suppressed while settings is open', () => {
    const ctx = baseCtx({ settingsOpen: true })
    dispatchModeKey(ev('2', { ctrl: true }), { ...ctx, handler: makeHandler() })
    expect(ctx.onAppAction).not.toHaveBeenCalled()
  })

  it('app actions are suppressed while the mode reports a modal open (the isModalOpen half of the same guard)', () => {
    const ctx = baseCtx()
    dispatchModeKey(ev('2', { ctrl: true }), { ...ctx, handler: makeHandler({ isModalOpen: () => true }) })
    expect(ctx.onAppAction).not.toHaveBeenCalled()
  })

  it('C in songs scope reaches onAction as song.chorus', () => {
    const onAction = vi.fn()
    dispatchModeKey(ev('c'), { ...baseCtx({ scope: 'songs' }), handler: makeHandler({ onAction }) })
    expect(onAction).toHaveBeenCalledWith({ id: 'song.chorus' })
  })

  it('onAction is suppressed while settings is open (the settings half of the shared guard)', () => {
    const onAction = vi.fn()
    dispatchModeKey(ev('c'), { ...baseCtx({ scope: 'songs', settingsOpen: true }), handler: makeHandler({ onAction }) })
    expect(onAction).not.toHaveBeenCalled()
  })

  it('digit 3 routes per scope (song.verse vs scripture.reading)', () => {
    const onAction = vi.fn()
    dispatchModeKey(ev('3'), { ...baseCtx({ scope: 'songs' }), handler: makeHandler({ onAction }) })
    expect(onAction).toHaveBeenCalledWith({ id: 'song.verse', digit: 3 })
    onAction.mockClear()
    dispatchModeKey(ev('3'), { ...baseCtx({ scope: 'scripture' }), handler: makeHandler({ onAction }) })
    expect(onAction).toHaveBeenCalledWith({ id: 'scripture.reading', digit: 3 })
  })

  it('slash focuses search when idle but is ignored while typing', () => {
    const onAction = vi.fn()
    dispatchModeKey(ev('/'), { ...baseCtx({ scope: 'songs' }), handler: makeHandler({ onAction }) })
    expect(onAction).toHaveBeenCalledWith({ id: 'focus.search' })
    onAction.mockClear()
    dispatchModeKey(ev('/', { tag: 'input' }), { ...baseCtx({ scope: 'songs' }), handler: makeHandler({ onAction }) })
    expect(onAction).not.toHaveBeenCalled()
  })

  it('Mod+Backspace while typing reaches onAction as field.clear (not onDelete)', () => {
    const onAction = vi.fn()
    const onDelete = vi.fn()
    dispatchModeKey(ev('Backspace', { ctrl: true, tag: 'input' }), { ...baseCtx(), handler: makeHandler({ onAction, onDelete }) })
    expect(onAction).toHaveBeenCalledWith({ id: 'field.clear' })
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('onAction is suppressed while a mode modal is open', () => {
    const onAction = vi.fn()
    dispatchModeKey(ev('c'), { ...baseCtx({ scope: 'songs' }), handler: makeHandler({ onAction, isModalOpen: () => true }) })
    expect(onAction).not.toHaveBeenCalled()
  })

  it('Mod+B dispatches displays.release', () => {
    const onAppAction = vi.fn()
    const e = ev('b', { ctrl: true })
    dispatchModeKey(e, { ...baseCtx({ onAppAction }), handler: makeHandler() })
    expect(onAppAction).toHaveBeenCalledWith('displays.release')
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('Mod+B works even with settings open or a modal up — it is a panic control', () => {
    const onAppAction = vi.fn()
    dispatchModeKey(ev('b', { ctrl: true }), {
      ...baseCtx({ settingsOpen: true, onAppAction }),
      handler: makeHandler({ isModalOpen: vi.fn(() => true) })
    })
    expect(onAppAction).toHaveBeenCalledWith('displays.release')
  })
})
