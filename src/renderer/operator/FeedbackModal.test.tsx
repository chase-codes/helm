// @vitest-environment jsdom
import { render, cleanup, fireEvent, waitFor, act, type RenderResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeedbackModal } from './FeedbackModal'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { FeedbackContext, FeedbackSendResult } from '../../shared/types'

afterEach(cleanup)

const ctx: FeedbackContext = { version: '0.5.0', os: 'macOS (25.5.0)', arch: 'arm64', displays: 2, hasBibles: true, hasSongs: false }
let send: ReturnType<typeof vi.fn>

function stub(result: FeedbackSendResult): void {
  send = vi.fn(async () => result)
  ;(window as unknown as { helm: unknown }).helm = {
    feedback: {
      context: vi.fn(async () => ctx),
      send,
      fallbackUrl: vi.fn(async () => 'https://github.com/chase-codes/helm/issues/new?template=feature_request.yml'),
    },
  }
}

function mount(onClose = vi.fn()): RenderResult & { onClose: ReturnType<typeof vi.fn> } {
  return { onClose, ...render(<ThemeCtx.Provider value={themeFor('helm', 'dark')}><FeedbackModal onClose={onClose} /></ThemeCtx.Provider>) }
}

beforeEach(() => stub({ ok: true, number: 7, url: 'https://github.com/chase-codes/helm/issues/7' }))

describe('FeedbackModal', () => {
  it('defaults to an idea and switches placeholder on type change', async () => {
    const { getByPlaceholderText, getByText } = mount()
    getByPlaceholderText('What would you like Helm to do? When would you use it?')
    fireEvent.click(getByText("Something's wrong"))
    getByPlaceholderText('What happened, and what did you expect instead?')
  })

  it('disables Send until text is non-blank', () => {
    const { getByText, getByRole } = mount()
    const btn = getByText('Send') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.change(getByRole('textbox'), { target: { value: '   ' } })
    expect(btn.disabled).toBe(true)
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer' } })
    expect(btn.disabled).toBe(false)
  })

  it('shows the attached context when expanded', async () => {
    const { getByText, findByText } = mount()
    fireEvent.click(getByText('Included with your report'))
    await findByText(/Version: 0\.5\.0/)
    await findByText(/OS: macOS \(25\.5\.0\)/)
    await findByText(/Arch: arm64/)
    await findByText(/Displays: 2/)
    await findByText(/Bibles installed: yes/)
    await findByText(/Songs in library: no/)
  })

  it('sends the typed payload and shows the issue link', async () => {
    const { getByText, getByRole, findByText } = mount()
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer' } })
    fireEvent.click(getByText('Send'))
    await findByText('Sent — thank you.')
    expect(send).toHaveBeenCalledWith({ type: 'feature', text: 'Countdown timer', context: ctx })
    const link = (await findByText('View on GitHub')) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('https://github.com/chase-codes/helm/issues/7')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('on failure keeps the text and offers the GitHub fallback', async () => {
    stub({ ok: false, reason: 'offline' })
    const { getByText, getByRole, findByText } = mount()
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer' } })
    fireEvent.click(getByText('Send'))
    await findByText("Couldn't send right now.")
    expect((getByRole('textbox') as HTMLTextAreaElement).value).toBe('Countdown timer')
    const link = getByText('Open on GitHub instead') as HTMLAnchorElement
    expect(link.getAttribute('href')).toContain('feature_request.yml')
    getByText('Try again')
  })

  it('reads Continue on GitHub when the proxy is unconfigured', async () => {
    stub({ ok: false, reason: 'unconfigured' })
    const { getByText, getByRole, findByText } = mount()
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer' } })
    fireEvent.click(getByText('Send'))
    const btn = await findByText('Continue on GitHub')
    expect(btn.closest('a')?.getAttribute('href')).toContain('feature_request.yml')
  })

  it('editing after unconfigured reverts to Send and drops the stale fallback link', async () => {
    stub({ ok: false, reason: 'unconfigured' })
    const { getByText, getByRole, findByText, queryByText } = mount()
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer' } })
    fireEvent.click(getByText('Send'))
    await findByText('Continue on GitHub')
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer, updated' } })
    expect(queryByText('Continue on GitHub')).toBeNull()
    getByText('Send')
  })

  it('editing after a failed send reverts to Send and drops the stale fallback link', async () => {
    stub({ ok: false, reason: 'offline' })
    const { getByText, getByRole, findByText, queryByText } = mount()
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer' } })
    fireEvent.click(getByText('Send'))
    await findByText("Couldn't send right now.")
    fireEvent.click(getByText("Something's wrong"))
    expect(queryByText("Couldn't send right now.")).toBeNull()
    getByText('Send')
  })

  it('caps text at 4000 and shows a counter past 3500', () => {
    const { getByRole, getByText } = mount()
    fireEvent.change(getByRole('textbox'), { target: { value: 'a'.repeat(3600) } })
    getByText('3600 / 4000')
    expect((getByRole('textbox') as HTMLTextAreaElement).maxLength).toBe(4000)
  })

  it('shows the fallback when send() rejects instead of resolving', async () => {
    send = vi.fn(async () => { throw new Error('network down') })
    ;(window as unknown as { helm: unknown }).helm = {
      feedback: {
        context: vi.fn(async () => ctx),
        send,
        fallbackUrl: vi.fn(async () => 'https://github.com/chase-codes/helm/issues/new?template=feature_request.yml'),
      },
    }
    const { getByText, getByRole, findByText } = mount()
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer' } })
    fireEvent.click(getByText('Send'))
    await findByText("Couldn't send right now.")
    const link = getByText('Open on GitHub instead') as HTMLAnchorElement
    expect(link.getAttribute('href')).toContain('feature_request.yml')
  })

  it('cancelling while sending does not throw or warn when the send later settles', async () => {
    let resolveSend!: (r: FeedbackSendResult) => void
    send = vi.fn(() => new Promise<FeedbackSendResult>((resolve) => { resolveSend = resolve }))
    ;(window as unknown as { helm: unknown }).helm = {
      feedback: {
        context: vi.fn(async () => ctx),
        send,
        fallbackUrl: vi.fn(async () => 'https://github.com/chase-codes/helm/issues/new?template=feature_request.yml'),
      },
    }
    const { getByText, getByRole, unmount } = mount()
    fireEvent.change(getByRole('textbox'), { target: { value: 'Countdown timer' } })
    fireEvent.click(getByText('Send'))
    await waitFor(() => expect(send).toHaveBeenCalled())
    fireEvent.click(getByText('Cancel'))
    unmount()
    await act(async () => { resolveSend({ ok: true, number: 7, url: 'https://github.com/chase-codes/helm/issues/7' }) })
  })
})
