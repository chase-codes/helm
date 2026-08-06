// @vitest-environment jsdom
import { render, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MirrorView } from './MirrorView'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubGetDisplayMedia(impl: () => Promise<MediaStream>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl)
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: { getDisplayMedia: fn } as unknown as MediaDevices,
    userAgent: navigator.userAgent
  })
  return fn
}

describe('MirrorView', () => {
  it('shows an in-place failure message when capture is refused, never a silent black screen', async () => {
    stubGetDisplayMedia(() => Promise.reject(new Error('Permission denied')))
    const r = render(<MirrorView />)
    await waitFor(() =>
      expect(r.getByTestId('mirror-error').textContent).toMatch(/screen capture/i)
    )
  })

  it('names the macOS Screen Recording permission on mac user agents', async () => {
    stubGetDisplayMedia(() => Promise.reject(new Error('Permission denied')))
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getDisplayMedia: () => Promise.reject(new Error('denied'))
      } as unknown as MediaDevices,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    })
    const r = render(<MirrorView />)
    await waitFor(() =>
      expect(r.getByTestId('mirror-error').textContent).toMatch(/Screen Recording/)
    )
  })

  it('attaches the stream to the video element on success', async () => {
    const stop = vi.fn()
    const fakeStream = {
      getTracks: () => [{ stop, addEventListener: vi.fn(), removeEventListener: vi.fn() }]
    } as unknown as MediaStream
    stubGetDisplayMedia(() => Promise.resolve(fakeStream))
    const r = render(<MirrorView />)
    const video = (await waitFor(() => r.getByTestId('mirror-video'))) as HTMLVideoElement
    await waitFor(() => expect(video.srcObject).toBe(fakeStream))
    r.unmount()
    expect(stop).toHaveBeenCalled() // tracks stopped on unmount
  })
})
