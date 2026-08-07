import { describe, it, expect } from 'vitest'
import { reportProblemUrl } from './feedback'

describe('reportProblemUrl', () => {
  it('prefills the bug-report form with version and OS', () => {
    const url = new URL(reportProblemUrl('0.2.0', 'Windows 11 (10.0.26100)'))
    expect(url.origin + url.pathname).toBe('https://github.com/chase-codes/helm/issues/new')
    expect(url.searchParams.get('template')).toBe('bug_report.yml')
    expect(url.searchParams.get('version')).toBe('0.2.0')
    expect(url.searchParams.get('os')).toBe('Windows 11 (10.0.26100)')
  })
})
