import { describe, it, expect } from 'vitest'
import { osLabel, reportProblemUrl } from './feedback'

describe('reportProblemUrl', () => {
  it('prefills the bug-report form with version and OS', () => {
    const url = new URL(reportProblemUrl('0.2.0', 'Windows 11 (10.0.26100)'))
    expect(url.origin + url.pathname).toBe('https://github.com/chase-codes/helm/issues/new')
    expect(url.searchParams.get('template')).toBe('bug_report.yml')
    expect(url.searchParams.get('version')).toBe('0.2.0')
    expect(url.searchParams.get('os')).toBe('Windows 11 (10.0.26100)')
  })
})

describe('osLabel', () => {
  it('labels each platform by name plus release', () => {
    expect(osLabel('darwin', '25.5.0')).toBe('macOS (25.5.0)')
    expect(osLabel('win32', '10.0.26100')).toBe('Windows (10.0.26100)')
    expect(osLabel('linux', '6.8.0')).toBe('Linux (6.8.0)')
  })

  it('falls back to the raw platform id for anything else', () => {
    expect(osLabel('freebsd', '14.1')).toBe('freebsd (14.1)')
  })
})
