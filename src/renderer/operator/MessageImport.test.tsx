// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageImport } from './MessageImport'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

describe('MessageImport', () => {
  // Same create verb as the song modal (QuickAdd's "Add to library").
  it('saves a new message with Add to library', () => {
    render(
      <ThemeCtx.Provider value={themeFor('classic', 'dark')}>
        <MessageImport open onClose={vi.fn()} onSaved={vi.fn()} />
      </ThemeCtx.Provider>
    )
    const save = screen.getByRole('button', { name: 'Add to library' }) as HTMLButtonElement
    expect(save.disabled).toBe(true) // nothing parsed yet
    expect(screen.queryByText('Save to library')).toBeNull()
  })
})
