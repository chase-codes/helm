// @vitest-environment jsdom
import { renderHook, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { OutputMode } from '../../shared/types'
import { useTakeGuard } from './useTakeGuard'

// This project's vitest config does not set `globals: true`, so
// @testing-library/react's auto afterEach(cleanup) never registers.
afterEach(cleanup)

// The four double-click handlers that resolve a fetch before they can take the screen all
// share this guard, so its rules are proved once here rather than four times over.
const mount = (
  output: OutputMode
): ReturnType<typeof renderHook<() => () => boolean, { output: OutputMode }>> =>
  renderHook(({ output: o }) => useTakeGuard(o), { initialProps: { output } })

describe('useTakeGuard', () => {
  it('lets a take that nothing interrupted through', () => {
    const { result } = mount('black')
    expect(result.current()()).toBe(true)
  })

  it('cancels an in-flight take when a later one is requested', () => {
    const { result } = mount('black')
    const first = result.current()
    const second = result.current()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  it('cancels an in-flight take when the operator takes the screen down', () => {
    const { result, rerender } = mount('live')
    const wanted = result.current()
    rerender({ output: 'black' })
    expect(wanted()).toBe(false)
  })

  // The take-down rule is a TRANSITION, not a level: the ordinary double-click starts from
  // a dark screen, and gating on `output === 'live'` would refuse every one of them.
  it('leaves a take from a dark screen alone', () => {
    const { result, rerender } = mount('black')
    const wanted = result.current()
    rerender({ output: 'black' })
    expect(wanted()).toBe(true)
  })

  it('leaves a take alone when the screen only changes what it is showing', () => {
    const { result, rerender } = mount('live')
    const wanted = result.current()
    rerender({ output: 'live' })
    expect(wanted()).toBe(true)
  })

  it('cancels an in-flight take when the mode unmounts', () => {
    const { result, unmount } = mount('black')
    const wanted = result.current()
    unmount()
    expect(wanted()).toBe(false)
  })
})
