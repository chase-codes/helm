// @vitest-environment jsdom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReleaseToggle } from './ReleaseToggle'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { DisplayStatus } from '../../shared/types'
import type { HotkeyOverrides } from '../../shared/hotkeys/actions'

afterEach(cleanup)

function installHelmStub(status: DisplayStatus): { toggleReleased: ReturnType<typeof vi.fn> } {
  const toggleReleased = vi.fn()
  ;(window as unknown as { helm: unknown }).helm = {
    displays: {
      get: () => Promise.resolve(status),
      onStatus: () => () => {},
      toggleReleased
    }
  }
  return { toggleReleased }
}

const renderToggle = (overrides: HotkeyOverrides = {}): ReturnType<typeof render> =>
  render(
    <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
      <ReleaseToggle hotkeyOverrides={overrides} />
    </ThemeCtx.Provider>
  )

describe('ReleaseToggle', () => {
  it('offers to release and fires toggleReleased on click', async () => {
    const { toggleReleased } = installHelmStub({ outputs: 1, displays: [], released: false })
    const r = renderToggle()
    await waitFor(() => expect(r.getByText('RELEASE SCREENS')).toBeTruthy())
    fireEvent.click(r.getByTestId('release-toggle'))
    expect(toggleReleased).toHaveBeenCalledTimes(1)
  })

  it('shows the released state loudly and offers to take back', async () => {
    installHelmStub({ outputs: 0, displays: [], released: true })
    const r = renderToggle()
    await waitFor(() => expect(r.getByText('SCREENS RELEASED · TAKE BACK')).toBeTruthy())
  })

  it('tooltip chip shows the default binding', async () => {
    installHelmStub({ outputs: 1, displays: [], released: false })
    const r = renderToggle()
    await waitFor(() => expect(r.getByTestId('release-toggle').title).toMatch(/⌘B|Ctrl\+B/))
  })

  it('tooltip chip follows a user rebind (#67)', async () => {
    installHelmStub({ outputs: 1, displays: [], released: false })
    const r = renderToggle({ 'displays.release': ['F9'] })
    await waitFor(() => expect(r.getByTestId('release-toggle').title).toContain('(F9)'))
    expect(r.getByTestId('release-toggle').title).not.toMatch(/⌘B|Ctrl\+B/)
  })

  it('tooltip drops the chip when the user cleared the binding', async () => {
    installHelmStub({ outputs: 1, displays: [], released: false })
    const r = renderToggle({ 'displays.release': [] })
    await waitFor(() => expect(r.getByTestId('release-toggle').title).toBe('Release every screen to other apps'))
  })
})
