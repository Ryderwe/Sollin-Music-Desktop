import {
  GITHUB_ANNOUNCEMENT_AUTHOR,
  GITHUB_ANNOUNCEMENT_ISSUE_NUMBER,
  GITHUB_ANNOUNCEMENT_REPO,
} from '@/config'

export interface GithubAnnouncement {
  id: string
  body: string
  htmlUrl: string
  author: string
  createdAt?: string
  updatedAt?: string
}

interface GithubIssueComment {
  id?: number
  body?: string
  html_url?: string
  created_at?: string
  updated_at?: string
  user?: {
    login?: string
  }
}

export const GITHUB_ANNOUNCEMENT_STORAGE_KEY = 'sollin-dismissed-github-announcement'

const MAX_COMMENT_PAGES = 10

const normalizeLogin = (value: string) => value.trim().toLowerCase()

const parseDate = (value?: string) => {
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? time : 0
}

const parseGithubRepo = (repo: string): [string, string] | null => {
  const [owner, name, ...rest] = repo.trim().split('/')
  if (!owner || !name || rest.length > 0) return null
  return [owner, name]
}

const parseLastPage = (linkHeader: string | null): number => {
  if (!linkHeader) return 1
  const match = linkHeader.match(/[?&]page=(\d+)[^>]*>\s*;\s*rel="last"/)
  if (!match) return 1
  const parsed = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1
}

const buildCommentsUrl = (owner: string, repo: string, issueNumber: number, page: number) => {
  const safeOwner = encodeURIComponent(owner)
  const safeRepo = encodeURIComponent(repo)
  return `https://api.github.com/repos/${safeOwner}/${safeRepo}/issues/${issueNumber}/comments?per_page=100&page=${page}`
}

const fetchCommentPage = async(owner: string, repo: string, issueNumber: number, page: number) => {
  const response = await fetch(buildCommentsUrl(owner, repo, issueNumber, page), {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub 公告获取失败：${response.status}`)
  }

  const comments = await response.json() as GithubIssueComment[]
  return {
    comments: Array.isArray(comments) ? comments : [],
    lastPage: parseLastPage(response.headers.get('Link')),
  }
}

const pickAnnouncement = (comments: GithubIssueComment[], issueNumber: number): GithubAnnouncement | null => {
  const author = normalizeLogin(GITHUB_ANNOUNCEMENT_AUTHOR)
  if (!author) return null

  const matched = comments
    .filter((comment) => normalizeLogin(comment.user?.login || '') === author)
    .filter((comment) => typeof comment.id === 'number' && String(comment.body || '').trim())
    .sort((left, right) => {
      const rightTime = Math.max(parseDate(right.updated_at), parseDate(right.created_at))
      const leftTime = Math.max(parseDate(left.updated_at), parseDate(left.created_at))
      return rightTime - leftTime
    })

  const latest = matched[0]
  if (!latest?.id) return null

  return {
    id: String(latest.id),
    body: String(latest.body || '').trim(),
    htmlUrl: latest.html_url || `https://github.com/${GITHUB_ANNOUNCEMENT_REPO}/issues/${issueNumber}`,
    author: latest.user?.login || GITHUB_ANNOUNCEMENT_AUTHOR,
    createdAt: latest.created_at,
    updatedAt: latest.updated_at,
  }
}

export const getGithubAnnouncementFingerprint = (announcement: GithubAnnouncement) => {
  return [announcement.id, announcement.updatedAt || announcement.createdAt || ''].join(':')
}

export const fetchGithubAnnouncement = async(): Promise<GithubAnnouncement | null> => {
  if (!GITHUB_ANNOUNCEMENT_ISSUE_NUMBER) return null

  const repoParts = parseGithubRepo(GITHUB_ANNOUNCEMENT_REPO)
  if (!repoParts) return null

  const [owner, repo] = repoParts
  const issueNumber = GITHUB_ANNOUNCEMENT_ISSUE_NUMBER
  const firstPage = await fetchCommentPage(owner, repo, issueNumber, 1)
  const lastPage = firstPage.lastPage

  const pages = new Set<number>([1])
  const firstExtraPage = Math.max(2, lastPage - MAX_COMMENT_PAGES + 2)
  for (let page = firstExtraPage; page <= lastPage; page += 1) {
    pages.add(page)
  }

  const otherPages = [...pages]
    .filter((page) => page !== 1)
    .map((page) => fetchCommentPage(owner, repo, issueNumber, page))

  const rest = await Promise.all(otherPages)
  return pickAnnouncement([
    ...firstPage.comments,
    ...rest.flatMap((page) => page.comments),
  ], issueNumber)
}
