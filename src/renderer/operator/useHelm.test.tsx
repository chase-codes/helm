// @vitest-environment jsdom
import { render, cleanup, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSX } from 'react'
import { useDisplayStatus, usePresentationState, useClock } from './useHelm'
import type { DisplayStatus, PresentationState } from '../../shared/types'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const IDLE_PRES: PresentationState = { output: 'black', liveKey: null, liveSnap: null, cuedKey: null, cuedSnap: null }
const NO_DISPLAYS: DisplayStatus = { outputs: 0, displays: [], released: false }

let presCb: (s: PresentationState) => void = () => {}
let displaysCb: (d: DisplayStatus) => void = () => {}
let resolvePresGet: (s: PresentationState) => void = () => {}
let resolveDisplaysGet: (d: DisplayStatus) => void = () => {}

function installHelmStub(): void {
  presCb = () => {}
  displaysCb = () => {}
  ;(window as unknown as { helm: unknown }).helm = {
    presentation: {
      get: vi.fn(
        () =>
          new Promise<PresentationState>((res) => {
            resolvePresGet = res
          })
      ),
      onState: vi.fn((cb: (s: PresentationState) => void) => {
        presCb = cb
        return () => {}
      })
    },
    displays: {
      get: vi.fn(
        () =>
          new Promise<DisplayStatus>((res) => {
            resolveDisplaysGet = res
          })
      ),
      onStatus: vi.fn((cb: (d: DisplayStatus) => void) => {
        displaysCb = cb
        return () => {}
      })
    }
  }
}

beforeEach(installHelmStub)

function PresProbe({ out }: { out: (s: PresentationState) => void }): JSX.Element {
  out(usePresentationState())
  return <div />
}

function DisplaysProbe({ out }: { out: (d: DisplayStatus) => void }): JSX.Element {
  out(useDisplayStatus())
  return <div />
}

describe('useHelm subscription hooks', () => {
  it('a push that lands while the initial fetch is in flight is not overwritten by the stale fetch result', async () => {
    let latest: PresentationState = IDLE_PRES
    render(<PresProbe out={(s) => (latest = s)} />)
    const pushed: PresentationState = { ...IDLE_PRES, output: 'live', liveKey: 'k1' }
    await act(async () => presCb(pushed))
    // Stale fetch resolves after the push — must be ignored.
    await act(async () => resolvePresGet(IDLE_PRES))
    expect(latest).toEqual(pushed)
  })

  it('applies the initial fetch result when no push has landed', async () => {
    let latest: DisplayStatus = NO_DISPLAYS
    render(<DisplaysProbe out={(d) => (latest = d)} />)
    const fetched: DisplayStatus = { outputs: 2, displays: [], released: false }
    await act(async () => resolveDisplaysGet(fetched))
    expect(latest).toEqual(fetched)
  })

  it('ignores a fetch that resolves after unmount (no setState-after-unmount)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(<DisplaysProbe out={() => {}} />)
    unmount()
    await act(async () => resolveDisplaysGet({ outputs: 1, displays: [], released: false }))
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe('useClock', () => {
  function ClockProbe({ onRender }: { onRender: () => void }): JSX.Element {
    onRender()
    return <div>{useClock()}</div>
  }

  it('renders 12-hour no-seconds time and only re-renders its host when the minute changes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 28, 14, 5, 30))
    let renders = 0
    const { getByText } = render(<ClockProbe onRender={() => renders++} />)
    expect(getByText('2:05 PM')).toBeTruthy()
    const after = renders
    // 29 ticks inside the same minute: label unchanged, host must not re-render.
    act(() => vi.advanceTimersByTime(29_000))
    expect(renders).toBe(after)
    // Crossing the minute boundary re-renders once with the new label.
    act(() => vi.advanceTimersByTime(1_000))
    expect(getByText('2:06 PM')).toBeTruthy()
  })
})
