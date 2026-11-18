// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeyPicker, KeyPickerPopover } from './KeyPicker'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import { MUSIC_KEYS } from '../../shared/songs/musicKey'

afterEach(cleanup)

const T = themeFor('classic', 'dark')

type Spy = ReturnType<typeof vi.fn>
const renderPicker = (value = '', extra: { onSkip?: () => void } = {}): ReturnType<typeof render> & { onPick: Spy; onClose: Spy } => {
  const onPick = vi.fn()
  const onClose = vi.fn()
  const utils = render(
    <ThemeCtx.Provider value={T}>
      <KeyPicker value={value} onPick={onPick} onClose={onClose} {...extra} />
    </ThemeCtx.Provider>
  )
  return { ...utils, onPick, onClose }
}

/** The key buttons, in grid order. */
const labels = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-key]')].map((b) => b.dataset.key!)
const lit = (): string | undefined =>
  document.querySelector<HTMLElement>('[data-key][aria-current]')?.dataset.key
const press = (...keys: string[]): void => {
  for (const key of keys) fireEvent.keyDown(document.activeElement ?? document.body, { key })
}

describe('KeyPicker', () => {
  it('shows twelve keys in chromatic order, with the other spelling under the ambiguous ones', () => {
    renderPicker()
    expect(labels()).toEqual(['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'])
    const alt = (k: string): string => document.querySelector(`[data-key="${k}"]`)!.textContent!.slice(k.length)
    expect(alt('Db')).toBe('C#')
    expect(alt('F#')).toBe('Gb')
    expect(alt('Ab')).toBe('G#')
    expect(alt('Bb')).toBe('A#')
    expect(alt('G')).toBe('')
  })

  it('clicking a key saves it', () => {
    const { onPick } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Key Eb' }))
    expect(onPick).toHaveBeenCalledWith('Eb')
  })

  it('Minor relabels all twelve per appendix A without resizing them', () => {
    renderPicker()
    const sizes = (): string[] =>
      [...document.querySelectorAll<HTMLElement>('[data-key]')].map((b) => `${b.style.width}x${b.style.height}`)
    const before = sizes()
    fireEvent.click(screen.getByRole('button', { name: 'Minor' }))
    expect(labels()).toEqual(['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'])
    expect(sizes()).toEqual(before)
    expect(new Set(sizes())).toEqual(new Set(['50pxx46px']))
    const alt = (k: string): string => document.querySelector(`[data-key="${k}"]`)!.textContent!.slice(k.length)
    expect(alt('Ebm')).toBe('D#m')
    expect(alt('G#m')).toBe('Abm')
    expect(alt('Bbm')).toBe('A#m')
    expect(alt('C#m')).toBe('')
    // Every label is a canonical key.
    expect(labels().every((k) => (MUSIC_KEYS as readonly string[]).includes(k))).toBe(true)
  })

  it('highlights the saved key and opens in its mode', () => {
    renderPicker('F#m')
    expect(labels()[0]).toBe('Cm')
    expect(lit()).toBe('F#m')
  })

  it('typing picks the root, b and # change it, m toggles minor, Enter saves the highlight', () => {
    const { onPick } = renderPicker()
    expect(lit()).toBeUndefined()
    press('Enter')
    expect(onPick).not.toHaveBeenCalled() // nothing lit, nothing to save

    press('e')
    expect(lit()).toBe('E')
    press('b')
    expect(lit()).toBe('Eb')
    press('m')
    expect(lit()).toBe('Ebm')
    press('Enter')
    expect(onPick).toHaveBeenLastCalledWith('Ebm')

    press('m', 'f', '#')
    expect(lit()).toBe('F#')
    press('b') // a new root after an accidental: B
    expect(lit()).toBe('B')
    press('b') // straight after the root: flat
    expect(lit()).toBe('Bb')
    press('c', '#')
    expect(lit()).toBe('Db') // spelled canonically
    press('Enter')
    expect(onPick).toHaveBeenLastCalledWith('Db')
  })

  it('arrows walk the grid', () => {
    renderPicker('G')
    press('ArrowRight')
    expect(lit()).toBe('Ab')
    press('ArrowDown') // six on, wrapping
    expect(lit()).toBe('D')
    press('ArrowLeft', 'ArrowUp')
    expect(lit()).toBe('G')
  })

  it('Capo… works out the sounding key: capo 2 playing G shapes is A, and Enter saves it', () => {
    const { onPick } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Capo…' }))
    const line = document.querySelector('[data-capo-line]') as HTMLElement
    expect(line.textContent).toMatch(/Capo.*playing.*shapes →.*Key A/)
    expect(lit()).toBe('A') // the highlight shows what Enter will save
    press('Enter')
    expect(onPick).toHaveBeenLastCalledWith('A')
  })

  it('Capo… follows the selects, typed shapes and digits, and keeps the mode', () => {
    const { onPick } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Capo…' }))
    fireEvent.change(screen.getByLabelText('Capo'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Shapes'), { target: { value: '2' } }) // D shapes
    expect(lit()).toBe('F')
    press('e', 'm', '3') // capo 3, Em shapes
    expect(lit()).toBe('Gm')
    const save = document.querySelector('[data-capo-save]') as HTMLElement
    expect(save.textContent).toBe('Key Gm')
    fireEvent.click(save)
    expect(onPick).toHaveBeenLastCalledWith('Gm')
  })

  it('Escape steps back one layer: the Capo… line, then a typed highlight, then closes', () => {
    const { onClose, onPick } = renderPicker('G')
    press('a')
    fireEvent.click(screen.getByRole('button', { name: 'Capo…' }))
    expect(lit()).toBe('A') // capo 2, G shapes

    press('Escape')
    expect(document.querySelector('[data-capo-line]')).toBeNull()
    expect(lit()).toBe('A') // the typed highlight is back
    expect(onClose).not.toHaveBeenCalled()

    press('Escape')
    expect(lit()).toBe('G') // back to the saved key
    expect(onClose).not.toHaveBeenCalled()

    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('a Major/Minor change is undone by Escape before it closes', () => {
    const { onClose } = renderPicker('G')
    press('m')
    expect(lit()).toBe('Gm')
    press('Escape')
    expect(lit()).toBe('G')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Clear key saves no key, and ghosts when there is none', () => {
    const { onPick } = renderPicker('Bb')
    fireEvent.click(screen.getByRole('button', { name: 'Clear key' }))
    expect(onPick).toHaveBeenCalledWith(null)
    cleanup()
    renderPicker('')
    expect((screen.getByRole('button', { name: 'Clear key' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders Skip only when given one', () => {
    renderPicker()
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    cleanup()
    const onSkip = vi.fn()
    renderPicker('', { onSkip })
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onSkip).toHaveBeenCalled()
  })

  it('owns the keys it reads: none of them reach a document listener', () => {
    const doc = vi.fn()
    document.addEventListener('keydown', doc)
    try {
      renderPicker('G')
      press('Enter', 'b', 'c', 't', 'ArrowRight', '1', 'Escape')
      expect(doc).not.toHaveBeenCalled()
      // Mod chords pass through (Mod+B releases the screens behind anything).
      fireEvent.keyDown(document.body, { key: 'b', metaKey: true })
      expect(doc).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', doc)
    }
  })

  it('a legacy value shows nothing lit and still offers Clear key', () => {
    const { onPick } = renderPicker('capo 2 G')
    expect(lit()).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Clear key' }))
    expect(onPick).toHaveBeenCalledWith(null)
  })

  it('uses no on-air red', () => {
    const { container } = renderPicker('G')
    fireEvent.click(screen.getByRole('button', { name: 'Capo…' }))
    expect(container.innerHTML.toLowerCase()).not.toContain(T.live.toLowerCase())
  })
})

describe('KeyPickerPopover', () => {
  const renderPopover = (anchorToggles = false): { anchor: HTMLButtonElement; onPick: Spy; onClose: Spy } => {
    const anchor = document.createElement('button')
    document.body.appendChild(anchor)
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(
      <ThemeCtx.Provider value={T}>
        <KeyPickerPopover anchor={anchor} anchorToggles={anchorToggles} value="" onPick={onPick} onClose={onClose} />
      </ThemeCtx.Provider>
    )
    return { anchor, onPick, onClose }
  }

  it('saving closes it', () => {
    const { onPick, onClose } = renderPopover()
    fireEvent.click(screen.getByRole('button', { name: 'Key D' }))
    expect(onPick).toHaveBeenCalledWith('D')
    expect(onClose).toHaveBeenCalled()
  })

  it('a click outside closes it; a click on a toggling anchor does not', () => {
    const { anchor, onClose } = renderPopover(true)
    fireEvent.mouseDown(anchor)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalled()
    anchor.remove()
  })
})
