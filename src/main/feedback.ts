const REPO_ISSUES = 'https://github.com/chase-codes/helm/issues/new'

// The prefilled `os` field is the main triage signal on incoming issues — name the
// platform, don't assume it. `release` is the kernel/OS release string (os.release()).
export function osLabel(platform: NodeJS.Platform, release: string): string {
  const name =
    platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform
  return `${name} (${release})`
}

export function reportProblemUrl(version: string, os: string): string {
  const params = new URLSearchParams({ template: 'bug_report.yml', version, os })
  return `${REPO_ISSUES}?${params}`
}
