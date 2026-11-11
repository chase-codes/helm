// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  blurFocusedField,
  clearSelectionRung,
  runEscapeLadder,
  takeDownWhenLive
} from './escapeLadder'

afterEach(() => {
  document.body.innerHTML = ''
})

const focusNew = (tag: 'input' | 'textarea' | 'button'): HTMLElement => {
  const el = document.createElement(tag)
  document.body.appendChild(el)
  el.focus()
  return el
}

describe('runEscapeLadder', () => {
  it('walks the rungs in the house order and stops at the first that consumes', () => {
    const calls: string[] = []
    const r =
      (name: string, consumes: boolean): (() => boolean) =>
      () => {
        calls.push(name)
        return consumes
      }
    // Declared out of order on purpose: the helper, not the caller, owns the order.
    const consumed = runEscapeLadder({
      takeDown: r('takeDown', true),
      clearSelection: r('clearSelection', true),
      leaveField: r('leaveField', true),
      cancelEdit: r('cancelEdit', false),
      closeOverlay: r('closeOverlay', false)
    })
    expect(consumed).toBe(true)
    expect(calls).toEqual(['closeOverlay', 'cancelEdit', 'clearSelection'])
  })

  it('reports false when no rung consumes', () => {
    expect(runEscapeLadder({ closeOverlay: () => false, takeDown: () => false })).toBe(false)
  })

  it('leaves a focused text field by default, before the screen', () => {
    const input = focusNew('input')
    const takeDown = vi.fn(() => true)
    expect(runEscapeLadder({ takeDown })).toBe(true)
    expect(document.activeElement).not.toBe(input)
    expect(takeDown).not.toHaveBeenCalled()
  })

  it('leaveField: false skips the blur rung', () => {
    const input = focusNew('input')
    const takeDown = vi.fn(() => true)
    runEscapeLadder({ leaveField: false, takeDown })
    expect(document.activeElement).toBe(input)
    expect(takeDown).toHaveBeenCalledTimes(1)
  })
})

describe('blurFocusedField', () => {
  it('blurs a textarea', () => {
    const ta = focusNew('textarea')
    expect(blurFocusedField()).toBe(true)
    expect(document.activeElement).not.toBe(ta)
  })

  it('passes on a focused button', () => {
    const btn = focusNew('button')
    expect(blurFocusedField()).toBe(false)
    expect(document.activeElement).toBe(btn)
  })
})

describe('takeDownWhenLive', () => {
  it('takes down only while live, never from black or logo', () => {
    const down = vi.fn()
    expect(takeDownWhenLive('black', down)()).toBe(false)
    expect(takeDownWhenLive('logo', down)()).toBe(false)
    expect(down).not.toHaveBeenCalled()
    expect(takeDownWhenLive('live', down)()).toBe(true)
    expect(down).toHaveBeenCalledTimes(1)
  })
})

describe('clearSelectionRung', () => {
  it('clears a non-empty selection and consumes the press', () => {
    const clear = vi.fn()
    expect(clearSelectionRung({ selectedIds: ['a'], clear })()).toBe(true)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('passes on an empty selection', () => {
    const clear = vi.fn()
    expect(clearSelectionRung({ selectedIds: [], clear })()).toBe(false)
    expect(clear).not.toHaveBeenCalled()
  })
})
