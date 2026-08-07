const REPO_ISSUES = 'https://github.com/chase-codes/helm/issues/new'

export function reportProblemUrl(version: string, os: string): string {
  const params = new URLSearchParams({ template: 'bug_report.yml', version, os })
  return `${REPO_ISSUES}?${params}`
}
