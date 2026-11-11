// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VersionPicker } from './VersionPicker'
import { themeFor } from '../../shared/theme'
import type { BibleManifestEntry } from '../../shared/types'

afterEach(cleanup)

const MANIFEST: BibleManifestEntry[] = [
  { id: 'kjv', abbr: 'KJV', name: 'King James Version', installed: true },
  { id: 'web', abbr: 'WEB', name: 'World English Bible', installed: true }
]

const open = (versions: string[]): void => {
  render(
    <VersionPicker theme={themeFor('classic', 'dark')} manifest={MANIFEST} versions={versions} onPick={vi.fn()} onOpenSettings={vi.fn()} />
  )
  fireEvent.click(screen.getByTitle('Choose translations'))
}
const rowTitle = (name: string): string | null =>
  (screen.getByText(name).closest('button') as HTMLButtonElement).getAttribute('title')

describe('VersionPicker tooltips', () => {
  it('says what a click does to the comparison, in click words', () => {
    open(['kjv', 'web'])
    expect(rowTitle('World English Bible')).toBe('Click to stop showing this translation')
    expect(screen.queryByTitle(/Tap/)).toBeNull()
  })

  it('does not offer to hide the only translation shown', () => {
    open(['kjv'])
    expect(rowTitle('King James Version')).toBe('The only translation shown; pick another to compare')
    expect(rowTitle('World English Bible')).toBe('Click to show; two at once appear side by side')
  })
})
