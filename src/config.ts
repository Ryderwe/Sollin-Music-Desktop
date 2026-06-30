// 应用配置
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.3.4'
export const GITHUB_REPO = import.meta.env.VITE_GITHUB_REPO || 'Ryderwe/Sollin-Music-Desktop'
const DEFAULT_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER = '1'

const parsePositiveInteger = (value?: string): number | null => {
  const trimmed = String(value || '').trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export const GITHUB_ANNOUNCEMENT_REPO = import.meta.env.VITE_GITHUB_ANNOUNCEMENT_REPO || GITHUB_REPO
export const GITHUB_ANNOUNCEMENT_ISSUE_NUMBER = parsePositiveInteger(
  import.meta.env.VITE_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER ?? DEFAULT_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER,
)
export const GITHUB_ANNOUNCEMENT_AUTHOR = import.meta.env.VITE_GITHUB_ANNOUNCEMENT_AUTHOR || 'ryderwe'
