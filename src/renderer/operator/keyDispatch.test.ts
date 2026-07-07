import { describe, expect, it, vi } from 'vitest'
import { dispatchModeKey } from './keyDispatch'
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

function ev(key: string, tag = 'body'): KeyboardEvent {
  return { key, target: { tagName: tag.toUpperCase() }, preventDefault: vi.fn() } as unknown as KeyboardEvent
}

const baseCtx = (): { settingsOpen: boolean; closeSettings: () => void } => ({ settingsOpen: false, closeSettings: vi.fn() })

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
    dispatchModeKey(ev('Delete', 'input'), { ...baseCtx(), handler: makeHandler({ onDelete }) })
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
    dispatchModeKey(ev('Escape'), { settingsOpen: true, closeSettings, handler: makeHandler({ onEscape }) })
    expect(closeSettings).toHaveBeenCalledTimes(1)
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('Enter goLive is suppressed while a modal is open', () => {
    const onGoLive = vi.fn()
    dispatchModeKey(ev('Enter'), { ...baseCtx(), handler: makeHandler({ onGoLive, isModalOpen: () => true }) })
    expect(onGoLive).not.toHaveBeenCalled()
  })

  it('Delete is suppressed while settings is open', () => {
    const onDelete = vi.fn()
    dispatchModeKey(ev('Delete'), { settingsOpen: true, closeSettings: vi.fn(), handler: makeHandler({ onDelete }) })
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('Delete is suppressed while the mode reports a modal open', () => {
    const onDelete = vi.fn()
    dispatchModeKey(ev('Delete'), { settingsOpen: false, closeSettings: vi.fn(), handler: makeHandler({ onDelete, isModalOpen: () => true }) })
    expect(onDelete).not.toHaveBeenCalled()
  })
})
