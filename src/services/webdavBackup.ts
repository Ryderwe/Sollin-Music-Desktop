import { httpClient } from '@/services/httpClient'
import type { WebDavBackupConfig, WebDavRemoteFile } from '@/types/backup'

export const DEFAULT_WEBDAV_REMOTE_DIRECTORY = 'sollin_music_backups'
const LEGACY_REMOTE_DIRECTORY = 'cyrene_music_backups'
const USER_AGENT = 'Microsoft-WebDAV-MiniRedir/10.0.22621'
const WEBDAV_LOG_PREFIX = '[WebDAV]'
const XML_PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>\n<d:propfind xmlns:d="DAV:">\n  <d:prop>\n    <d:displayname />\n    <d:getcontentlength />\n    <d:getlastmodified />\n    <d:getetag />\n    <d:resourcetype />\n  </d:prop>\n</d:propfind>`

const STORAGE_KEYS = {
  serverUrl: 'webdav_backup_url_v1',
  username: 'webdav_backup_username_v1',
  password: 'webdav_backup_password_v1',
  remoteDirectory: 'webdav_backup_directory_v1',
} as const

const canUseStorage = () => typeof window !== 'undefined' && !!window.localStorage

const encodeBase64Utf8 = (value: string) => {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    const bytes = new TextEncoder().encode(value)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return window.btoa(binary)
  }

  return value
}

const normalizeServerUrl = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('请输入 WebDAV 地址')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('WebDAV 地址格式无效')
  }
  if (!/^https?:$/i.test(url.protocol)) {
    throw new Error('WebDAV 地址必须是 http 或 https')
  }
  return url.toString().replace(/\/+$/, '')
}

const normalizeRemoteDirectory = (value: string) => {
  const trimmed = value.trim() || DEFAULT_WEBDAV_REMOTE_DIRECTORY
  const migrated = trimmed === LEGACY_REMOTE_DIRECTORY ? DEFAULT_WEBDAV_REMOTE_DIRECTORY : trimmed
  const segments = migrated.split('/').map((item) => item.trim()).filter(Boolean)
  return (segments.length ? segments : [DEFAULT_WEBDAV_REMOTE_DIRECTORY]).join('/')
}

const buildHeaders = (config: WebDavBackupConfig, method: string, extraHeaders?: Record<string, string>) => {
  const headers: Record<string, string> = {
    Authorization: `Basic ${encodeBase64Utf8(`${config.username}:${config.password}`)}`,
    Accept: '*/*',
    'User-Agent': USER_AGENT,
    'X-FORMS_BASED_AUTH_ACCEPTED': 'f',
    ...(extraHeaders || {}),
  }

  if (method === 'GET' || method === 'HEAD') {
    headers.Translate = 'f'
  }

  return headers
}

const DOWNLOAD_HEADER_PROFILES: Array<{ name: string; headers: Record<string, string> }> = [
  {
    name: 'mini-redir',
    headers: {
      'User-Agent': 'Microsoft-WebDAV-MiniRedir/10.0.22621',
      'X-FORMS_BASED_AUTH_ACCEPTED': 'f',
      Translate: 'f',
    },
  },
  {
    name: 'ms-dav-provider',
    headers: {
      'User-Agent': 'Microsoft Data Access Internet Publishing Provider DAV',
      Translate: 'f',
    },
  },
  {
    name: 'finder',
    headers: {
      'User-Agent': 'WebDAVFS/3.0',
      Translate: 'f',
    },
  },
  {
    name: 'generic',
    headers: {
      'User-Agent': 'SollinMusic-WebDAV-Backup',
      Translate: 'f',
    },
  },
]

const buildLogPayload = (
  config: WebDavBackupConfig,
  url: string,
  method: string,
  headers?: Record<string, string>,
  body?: string,
  label?: string,
) => {
  const normalizedHeaders = { ...(headers || {}) }
  if (normalizedHeaders.Authorization) {
    normalizedHeaders.Authorization = 'Basic ***'
  }

  return {
    label: label || null,
    method,
    url,
    username: config.username,
    remoteDirectory: config.remoteDirectory,
    headers: normalizedHeaders,
    bodyLength: body ? body.length : 0,
  }
}

const getResponsePreview = (bodyText: string) => {
  const normalized = bodyText.replace(/\s+/g, ' ').trim()
  return normalized.length > 500 ? `${normalized.slice(0, 500)}…` : normalized
}

const stringifyLog = (value: unknown) => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const logRequestStart = (payload: ReturnType<typeof buildLogPayload>) => {
  console.info(`${WEBDAV_LOG_PREFIX} request`, payload)
  console.info(`${WEBDAV_LOG_PREFIX} request:json ${stringifyLog(payload)}`)
}

const logRequestEnd = (
  payload: ReturnType<typeof buildLogPayload>,
  response: { status: number; headers: Record<string, string>; bodyText: string }
) => {
  const logPayload = {
    ...payload,
    status: response.status,
    responseHeaders: response.headers,
  }

  if (response.status >= 400) {
    console.error(`${WEBDAV_LOG_PREFIX} response`, {
      ...logPayload,
      responsePreview: getResponsePreview(response.bodyText),
    })
    console.error(`${WEBDAV_LOG_PREFIX} response:json ${stringifyLog({
      ...logPayload,
      responsePreview: getResponsePreview(response.bodyText),
    })}`)
    return
  }

  console.info(`${WEBDAV_LOG_PREFIX} response`, logPayload)
  console.info(`${WEBDAV_LOG_PREFIX} response:json ${stringifyLog(logPayload)}`)
}

const logRequestFailure = (payload: ReturnType<typeof buildLogPayload>, error: unknown) => {
  console.error(`${WEBDAV_LOG_PREFIX} failure`, {
    ...payload,
    error: error instanceof Error ? error.message : String(error),
  })
  console.error(`${WEBDAV_LOG_PREFIX} failure:json ${stringifyLog({
    ...payload,
    error: error instanceof Error ? error.message : String(error),
  })}`)
}

const runAccessDiagnostics = async(config: WebDavBackupConfig, fileUrl: string) => {
  const diagnostics: Array<{ method: string; status?: number; preview?: string; error?: string }> = []

  for (const item of [
    { method: 'HEAD', headers: undefined, body: undefined },
    { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' }, body: XML_PROPFIND_BODY },
  ]) {
    try {
      const response = await request(config, fileUrl, item.method, item.headers, item.body)
      diagnostics.push({
        method: item.method,
        status: response.status,
        preview: getResponsePreview(response.bodyText),
      })
    } catch (error) {
      diagnostics.push({
        method: item.method,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  console.error(`${WEBDAV_LOG_PREFIX} diagnostics`, diagnostics)
  console.error(`${WEBDAV_LOG_PREFIX} diagnostics:json ${stringifyLog(diagnostics)}`)
  return diagnostics
}

const joinUrlPath = (baseUrl: string, segments: string[]) => {
  const url = new URL(baseUrl)
  const baseSegments = url.pathname.split('/').filter(Boolean)
  url.pathname = `/${[...baseSegments, ...segments].map((item) => encodeURIComponent(item)).join('/')}`
  return url.toString()
}

const getDirectorySegments = (config: WebDavBackupConfig) => normalizeRemoteDirectory(config.remoteDirectory).split('/')

const getDirectoryUrl = (config: WebDavBackupConfig) => joinUrlPath(normalizeServerUrl(config.serverUrl), getDirectorySegments(config))

const parseXml = (xmlText: string) => {
  const parser = new DOMParser()
  return parser.parseFromString(xmlText, 'application/xml')
}

const getFirstText = (element: Element, localName: string) => {
  return element.getElementsByTagNameNS('*', localName)[0]?.textContent?.trim() || null
}

const normalizeHrefPath = (href: string, baseUrl: string) => {
  try {
    return decodeURIComponent(new URL(href, baseUrl).pathname.replace(/\/+$/, ''))
  } catch {
    return href.replace(/\/+$/, '')
  }
}

const parsePropfindFiles = (xmlText: string, baseUrl: string): WebDavRemoteFile[] => {
  const doc = parseXml(xmlText)
  const responses = Array.from(doc.getElementsByTagNameNS('*', 'response'))

  return responses.map((response) => {
    const href = getFirstText(response, 'href') || ''
    const modifiedAt = getFirstText(response, 'getlastmodified')
    const etag = getFirstText(response, 'getetag')
    const sizeValue = getFirstText(response, 'getcontentlength')
    const isDirectory = response.getElementsByTagNameNS('*', 'collection').length > 0
    const hrefUrl = new URL(href, baseUrl).toString()
    const pathname = normalizeHrefPath(href, baseUrl)
    const name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '')

    return {
      name,
      href,
      size: Number.parseInt(sizeValue || '0', 10) || 0,
      modifiedAt: modifiedAt ? new Date(modifiedAt).toISOString() : null,
      etag,
      isDirectory,
      url: hrefUrl,
    }
  })
}

export const getStoredWebDavConfig = (): WebDavBackupConfig => {
  if (!canUseStorage()) {
    return { serverUrl: '', username: '', password: '', remoteDirectory: DEFAULT_WEBDAV_REMOTE_DIRECTORY }
  }

  return {
    serverUrl: window.localStorage.getItem(STORAGE_KEYS.serverUrl) || '',
    username: window.localStorage.getItem(STORAGE_KEYS.username) || '',
    password: window.localStorage.getItem(STORAGE_KEYS.password) || '',
    remoteDirectory: window.localStorage.getItem(STORAGE_KEYS.remoteDirectory) || DEFAULT_WEBDAV_REMOTE_DIRECTORY,
  }
}

export const normalizeWebDavConfig = (config: WebDavBackupConfig): WebDavBackupConfig => {
  const username = config.username.trim()
  const password = config.password
  if (!username) throw new Error('请输入 WebDAV 账号')
  if (!password.trim()) throw new Error('请输入 WebDAV 密码')

  return {
    serverUrl: normalizeServerUrl(config.serverUrl),
    username,
    password,
    remoteDirectory: normalizeRemoteDirectory(config.remoteDirectory),
  }
}

export const saveWebDavConfig = (config: WebDavBackupConfig) => {
  if (!canUseStorage()) return
  window.localStorage.setItem(STORAGE_KEYS.serverUrl, config.serverUrl)
  window.localStorage.setItem(STORAGE_KEYS.username, config.username)
  window.localStorage.setItem(STORAGE_KEYS.password, config.password)
  window.localStorage.setItem(STORAGE_KEYS.remoteDirectory, config.remoteDirectory)
}

const request = async(
  config: WebDavBackupConfig,
  url: string,
  method: string,
  headers?: Record<string, string>,
  body?: string,
  label?: string,
) => {
  const requestHeaders = buildHeaders(config, method, headers)
  const payload = buildLogPayload(config, url, method, requestHeaders, body, label)
  logRequestStart(payload)

  try {
    const response = await httpClient.request({
      url,
      method,
      headers: requestHeaders,
      body,
    })
    logRequestEnd(payload, response)
    return response
  } catch (error) {
    logRequestFailure(payload, error)
    throw error
  }
}

export const testWebDavConnection = async(config: WebDavBackupConfig) => {
  const normalized = normalizeWebDavConfig(config)
  const response = await request(normalized, normalized.serverUrl, 'PROPFIND', {
    Depth: '0',
    'Content-Type': 'application/xml; charset=utf-8',
  }, XML_PROPFIND_BODY)

  if (response.status !== 207) {
    throw new Error(`连接测试失败（HTTP ${response.status}）`)
  }

  return normalized
}

export const ensureWebDavDirectory = async(config: WebDavBackupConfig) => {
  const normalized = normalizeWebDavConfig(config)
  const baseUrl = normalizeServerUrl(normalized.serverUrl)
  const segments = getDirectorySegments(normalized)

  for (let index = 0; index < segments.length; index += 1) {
    const url = joinUrlPath(baseUrl, segments.slice(0, index + 1))
    const response = await request(normalized, url, 'MKCOL')
    if (response.status === 201 || response.status === 405) continue
    if (response.status === 409) {
      throw new Error(`创建远端目录失败：${segments[index]}`)
    }
    throw new Error(`创建远端目录失败（HTTP ${response.status}）`)
  }

  return normalized
}

export const listWebDavBackups = async(config: WebDavBackupConfig): Promise<WebDavRemoteFile[]> => {
  const normalized = normalizeWebDavConfig(config)
  const directoryUrl = getDirectoryUrl(normalized)
  const response = await request(normalized, directoryUrl, 'PROPFIND', {
    Depth: '1',
    'Content-Type': 'application/xml; charset=utf-8',
  }, XML_PROPFIND_BODY)

  if (response.status === 404) return []
  if (response.status !== 207) {
    throw new Error(`读取备份列表失败（HTTP ${response.status}）`)
  }

  const currentDirectoryPath = normalizeHrefPath(directoryUrl, directoryUrl)
  const files = parsePropfindFiles(response.bodyText, directoryUrl)
    .filter((item) => !item.isDirectory)
    .filter((item) => item.name.endsWith('.json'))
    .filter((item) => normalizeHrefPath(item.href, directoryUrl) !== currentDirectoryPath)
    .sort((left, right) => {
      const leftTime = left.modifiedAt ? new Date(left.modifiedAt).getTime() : 0
      const rightTime = right.modifiedAt ? new Date(right.modifiedAt).getTime() : 0
      return rightTime - leftTime
    })

  console.info(`${WEBDAV_LOG_PREFIX} list parsed`, {
    directoryUrl,
    count: files.length,
    files: files.map((item) => ({ name: item.name, href: item.href, url: item.url, modifiedAt: item.modifiedAt, size: item.size })),
  })

  return files
}

export const uploadWebDavBackup = async(config: WebDavBackupConfig, fileName: string, content: string) => {
  const normalized = await ensureWebDavDirectory(config)
  const fileUrl = `${getDirectoryUrl(normalized)}/${encodeURIComponent(fileName)}`
  const response = await request(normalized, fileUrl, 'PUT', {
    'Content-Type': 'application/json; charset=utf-8',
  }, content)

  if (![200, 201, 204].includes(response.status)) {
    throw new Error(`上传备份失败（HTTP ${response.status}）`)
  }
}

const buildRemoteFileUrl = (config: WebDavBackupConfig, file: Pick<WebDavRemoteFile, 'url' | 'name'>) => {
  const normalizedName = file.name?.trim()
  if (normalizedName) {
    return `${getDirectoryUrl(config)}/${encodeURIComponent(normalizedName)}`
  }
  return file.url
}

export const downloadWebDavBackup = async(config: WebDavBackupConfig, file: Pick<WebDavRemoteFile, 'url' | 'name'>) => {
  const normalized = normalizeWebDavConfig(config)
  const fileUrl = buildRemoteFileUrl(normalized, file)
  console.info(`${WEBDAV_LOG_PREFIX} download target`, {
    fileName: file.name,
    rawUrl: file.url,
    resolvedUrl: fileUrl,
    remoteDirectory: normalized.remoteDirectory,
  })
  let lastResponse: Awaited<ReturnType<typeof request>> | null = null

  for (const profile of DOWNLOAD_HEADER_PROFILES) {
    const response = await request(normalized, fileUrl, 'GET', profile.headers, undefined, `download:${profile.name}`)
    if (response.status === 200) {
      console.info(`${WEBDAV_LOG_PREFIX} download profile success`, { profile: profile.name, fileUrl })
      return response.bodyText
    }
    lastResponse = response
  }

  if (lastResponse) {
    const diagnostics = lastResponse.status === 401 || lastResponse.status === 403
      ? await runAccessDiagnostics(normalized, fileUrl)
      : []
    const diagnosticSummary = diagnostics.length
      ? `；诊断：${diagnostics.map((item) => item.error ? `${item.method}=ERR(${item.error})` : `${item.method}=${item.status}`).join(', ')}`
      : ''
    throw new Error(`下载备份失败（HTTP ${lastResponse.status}${diagnosticSummary}）`)
  }

  throw new Error('下载备份失败（未收到有效响应）')
}

export const deleteWebDavBackup = async(config: WebDavBackupConfig, file: Pick<WebDavRemoteFile, 'url' | 'name'>) => {
  const normalized = normalizeWebDavConfig(config)
  const fileUrl = buildRemoteFileUrl(normalized, file)
  console.info(`${WEBDAV_LOG_PREFIX} delete target`, {
    fileName: file.name,
    rawUrl: file.url,
    resolvedUrl: fileUrl,
    remoteDirectory: normalized.remoteDirectory,
  })
  const response = await request(normalized, fileUrl, 'DELETE')
  if (![200, 204].includes(response.status)) {
    throw new Error(`删除备份失败（HTTP ${response.status}）`)
  }
}
