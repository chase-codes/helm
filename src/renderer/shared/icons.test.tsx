// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as icons from './icons'

afterEach(cleanup)

const ICON_NAMES = [
  'DisplayIcon', 'GoLiveIcon', 'ImportIcon', 'LogoIcon', 'MessageIcon',
  'PreServiceIcon', 'ScheduleIcon', 'ScreenBlackIcon', 'SearchIcon',
  'SermonIcon', 'SettingsIcon', 'SongsIcon', 'ThemesIcon', 'SunIcon', 'MoonIcon'
] as const

describe('icons', () => {
  it.each(ICON_NAMES)('%s renders a 20-viewBox currentColor svg', (name) => {
    const Icon = icons[name]
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg!.getAttribute('viewBox')).toBe('0 0 20 20')
    expect(svg!.getAttribute('stroke')).toBe('currentColor')
    expect(svg!.getAttribute('width')).toBe('20')
  })

  it('honors the size prop', () => {
    const { container } = render(<icons.SearchIcon size={15} />)
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('15')
  })
})
