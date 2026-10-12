// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParagraphRail } from './ParagraphRail'
import { railHint } from './railHints'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

describe('ParagraphRail', () => {
  it('explains its gestures in the shared rail sentence', () => {
    render(
      <ParagraphRail
        theme={themeFor('classic', 'dark')}
        dark
        width={330}
        title="TAPE 65-1204"
        plannedCount={0}
        paragraphs={[{ ord: 1, label: '1', text: 'First paragraph' }]}
        cuedOrd={1}
        isLive={() => false}
        plannedSet={new Set<number>()}
        onSelect={vi.fn()}
        onActivate={vi.fn()}
      />
    )
    expect(screen.getByText(railHint('paragraph'))).toBeTruthy()
    expect(screen.queryByText(/[Tt]ap /)).toBeNull()
  })
})
