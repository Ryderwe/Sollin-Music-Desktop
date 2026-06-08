import { APP_VERSION, GITHUB_REPO } from '@/config'

export interface GithubUpdateInfo {
  hasUpdate: boolean
  latestVersion: string
  releaseNotes: string[]
  downloadUrl: string
  releaseUrl: string
  publishedAt?: string
}

interface GithubReleaseAsset {
  name?: string
  browser_download_url?: string
}

interface GithubRelease {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  prerelease?: boolean
  draft?: boolean
  assets?: GithubReleaseAsset[]
}

const normalizeVersion = (value: string) => value.trim().replace(/^v/i, '')

const parseVersionParts = (value: string): number[] => {
  const normalized = normalizeVersion(value)
  const match = normalized.match(/\d+(?:\.\d+)*/)
  if (!match) return [0]
  return match[0].split('.').map((part) => Number.parseInt(part, 10) || 0)
}

export const compareVersions = (left: string, right: string): number => {
  const a = parseVersionParts(left)
  const b = parseVersionParts(right)
  const length = Math.max(a.length, b.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0)
    if (diff !== 0) return diff
  }

  return 0
}

const getPlatformAssetHints = (): string[] => {
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('mac')) return ['arm64.dmg', 'x64.dmg', '.dmg', '.zip']
  if (userAgent.includes('linux')) return ['.appimage', '.deb']
  return ['.exe']
}

const pickDownloadUrl = (release: GithubRelease): string => {
  const assets = Array.isArray(release.assets) ? release.assets : []
  const hints = getPlatformAssetHints()

  for (const hint of hints) {
    const matched = assets.find((asset) => {
      const name = String(asset.name || '').toLowerCase()
      return name.includes(hint)
    })
    if (matched?.browser_download_url) return matched.browser_download_url
  }

  return assets.find((asset) => asset.browser_download_url)?.browser_download_url
    || release.html_url
    || `https://github.com/${GITHUB_REPO}/releases`
}

const parseReleaseNotes = (body?: string): string[] => {
  const lines = String(body || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30)

  return lines.length ? lines : ['查看 GitHub Release 获取更新内容。']
}

export const checkGithubUpdate = async(currentVersion = APP_VERSION): Promise<GithubUpdateInfo> => {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub Release 检查失败：${response.status}`)
  }

  const release = await response.json() as GithubRelease
  const latestVersion = normalizeVersion(release.tag_name || release.name || '')
  const releaseUrl = release.html_url || `https://github.com/${GITHUB_REPO}/releases`

  if (!latestVersion) {
    return {
      hasUpdate: false,
      latestVersion: currentVersion,
      releaseNotes: [],
      downloadUrl: releaseUrl,
      releaseUrl,
      publishedAt: release.published_at,
    }
  }

  return {
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    latestVersion,
    releaseNotes: parseReleaseNotes(release.body),
    downloadUrl: pickDownloadUrl(release),
    releaseUrl,
    publishedAt: release.published_at,
  }
}
