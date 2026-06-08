import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { createHash } from 'crypto'
import { performHttpRequest, type HttpBridgeRequestOptions } from './httpRequest'
import {
  LX_SOURCE_CANDIDATE_PATHS,
  LX_SOURCE_INTERNAL_IPC,
  LX_SOURCE_PUBLIC_IPC,
  type LxBackupSourcePayload,
  type LxBackupStatePayload,
  type LxSourceInitResponse,
  type LxSourceRequestPayload,
  type LxSourceRuntimeInitPayload,
  type LxSourceRuntimeInitResult,
  type LxSourceRuntimeResponse,
  type LxSourceScriptInfo,
  type LxSourceStatus,
  type LxSourceUpdateAlertPayload,
} from './lxSourceShared'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timer: NodeJS.Timeout
}

type PendingInit = {
  resolve: (value: LxSourceInitResponse | undefined) => void
  reject: (reason?: unknown) => void
  timer: NodeJS.Timeout
}

type ManagedLxSourceConfig = {
  id: string
  type: 'local' | 'url'
  path: string
  url: string | null
  importedAt: number
  allowShowUpdateAlert: boolean
  scriptInfo: LxSourceScriptInfo
}

type LxSourceConfig = {
  activeSourceId?: string | null
  sources?: ManagedLxSourceConfig[]
  scriptPath?: string | null
  scriptUrl?: string | null
  allowShowUpdateAlert?: boolean
}

type SanitizedBackupSource = {
  id: string
  rawScript: string
  addedAt: number
  isActive: boolean
  allowShowUpdateAlert: boolean
  info: {
    name?: string | null
    description?: string | null
    version?: string | null
    author?: string | null
    homepage?: string | null
  }
}

let lxSourceWindow: BrowserWindow | null = null
let handlersRegistered = false
let configuredScriptPath: string | null = null
let configuredScriptUrl: string | null = null
let allowShowUpdateAlert = true
let activeSourceId: string | null = null
let managedSources: ManagedLxSourceConfig[] = []
let loadedScriptPath: string | null = null
let initWaiter: PendingInit | null = null
let ensureRuntimePromise: Promise<void> | null = null
const pendingRequests = new Map<string, PendingRequest>()
const runtimeReadyWaiters = new Set<PendingInit>()
const pendingUpdateAlerts: LxSourceUpdateAlertPayload[] = []
const shownUpdateAlertKeys = new Set<string>()
let runtimeOperationQueue: Promise<void> = Promise.resolve()

const runInRuntimeQueue = async<T>(task: () => Promise<T>): Promise<T> => {
  const previous = runtimeOperationQueue.catch(() => undefined)
  const current = previous.then(task, task)
  runtimeOperationQueue = current.then(() => undefined, () => undefined)
  return current
}

const status: LxSourceStatus = {
  activeSourceId: null,
  configuredPath: null,
  autoDetectedPath: null,
  scriptPath: null,
  scriptUrl: null,
  scriptExists: false,
  runtimeReady: false,
  scriptLoaded: false,
  allowShowUpdateAlert: true,
  scriptInfo: null,
  managedSources: [],
  supportedSources: {},
  lastError: null,
}

const INFO_FIELD_LIMITS = {
  name: 24,
  description: 36,
  author: 56,
  homepage: 1024,
  version: 36,
} as const

const sanitizeErrorMessage = (error: unknown) => {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

const getConfigPath = () => path.join(app.getPath('userData'), 'lx-source-config.json')
const getImportedScriptDir = () => path.join(app.getPath('userData'), 'lx-source-imports')

const parseScriptInfo = (script: string, fallbackName?: string): LxSourceScriptInfo => {
  const commentBlock = /^\/\*[\s\S]+?\*\//.exec(script)
  if (!commentBlock) {
    throw new Error('无效的 LX 音源脚本')
  }

  const info = {
    name: '',
    description: '',
    author: '',
    homepage: '',
    version: '',
  }

  const lines = commentBlock[0].split(/\r?\n/)
  const matcher = /^\s?\*\s?@(\w+)\s(.+)$/
  for (const line of lines) {
    const result = matcher.exec(line)
    if (!result) continue
    const key = result[1] as keyof typeof info
    if (!(key in info)) continue
    const nextValue = result[2].trim()
    const maxLength = INFO_FIELD_LIMITS[key]
    info[key] = nextValue.length > maxLength ? `${nextValue.slice(0, maxLength)}...` : nextValue
  }

  if (!info.name) {
    info.name = path.basename(fallbackName || status.scriptPath || 'lx-source.js')
  }

  return info
}

const createFallbackScriptInfo = (fallbackName?: string): LxSourceScriptInfo => ({
  name: path.basename(fallbackName || status.scriptPath || 'lx-source.js'),
  description: '',
  author: '',
  homepage: '',
  version: '',
})

const getStoredScriptInfo = (scriptPath: string) => {
  try {
    if (!fs.existsSync(scriptPath)) return createFallbackScriptInfo(scriptPath)
    return parseScriptInfo(fs.readFileSync(scriptPath, 'utf8'), path.basename(scriptPath))
  } catch {
    return createFallbackScriptInfo(scriptPath)
  }
}

const createManagedSourceId = () => `lx_source_item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const normalizeManagedSourceRecord = (source: Partial<ManagedLxSourceConfig> | null | undefined): ManagedLxSourceConfig | null => {
  if (!source?.id || !source?.path) return null
  return {
    id: source.id,
    type: source.type === 'url' ? 'url' : 'local',
    path: source.path,
    url: typeof source.url === 'string' && source.url.trim() ? source.url.trim() : null,
    importedAt: typeof source.importedAt === 'number' ? source.importedAt : Date.now(),
    allowShowUpdateAlert: typeof source.allowShowUpdateAlert === 'boolean' ? source.allowShowUpdateAlert : true,
    scriptInfo: source.scriptInfo || getStoredScriptInfo(source.path),
  }
}

const getManagedSourceById = (sourceId: string | null | undefined) => {
  if (!sourceId) return null
  return managedSources.find((source) => source.id === sourceId) || null
}

const getManagedSourceByPath = (scriptPath: string) => {
  return managedSources.find((source) => source.path === scriptPath) || null
}

const getManagedSourceByUrl = (scriptUrl: string) => {
  return managedSources.find((source) => source.url === scriptUrl) || null
}

const setManagedSources = (sources: ManagedLxSourceConfig[]) => {
  managedSources = [...sources].sort((left, right) => right.importedAt - left.importedAt)
}

const syncConfiguredSourceMirror = () => {
  const activeSource = getManagedSourceById(activeSourceId)
  if (!activeSource) activeSourceId = null
  const resolvedSource = getManagedSourceById(activeSourceId)
  configuredScriptPath = resolvedSource?.path || null
  configuredScriptUrl = resolvedSource?.url || null
  allowShowUpdateAlert = resolvedSource?.allowShowUpdateAlert ?? true
  status.activeSourceId = activeSourceId
}

const loadConfiguredScriptPath = () => {
  managedSources = []
  activeSourceId = null
  configuredScriptPath = null
  configuredScriptUrl = null
  allowShowUpdateAlert = true

  try {
    const configPath = getConfigPath()
    if (!fs.existsSync(configPath)) {
      syncConfiguredSourceMirror()
      return
    }

    const raw = fs.readFileSync(configPath, 'utf8').trim()
    if (!raw) {
      syncConfiguredSourceMirror()
      return
    }

    const parsed = JSON.parse(raw) as LxSourceConfig
    const nextSources = Array.isArray(parsed?.sources)
      ? parsed.sources
        .map((source) => normalizeManagedSourceRecord(source))
        .filter((source): source is ManagedLxSourceConfig => Boolean(source))
      : []

    if (nextSources.length > 0) {
      setManagedSources(nextSources)
      activeSourceId = typeof parsed?.activeSourceId === 'string' && nextSources.some((source) => source.id === parsed.activeSourceId)
        ? parsed.activeSourceId
        : nextSources[0]?.id || null
      syncConfiguredSourceMirror()
      return
    }

    const legacyPath = typeof parsed?.scriptPath === 'string' && parsed.scriptPath.trim()
      ? parsed.scriptPath.trim()
      : null

    if (legacyPath) {
      const legacySource: ManagedLxSourceConfig = {
        id: createManagedSourceId(),
        type: typeof parsed?.scriptUrl === 'string' && parsed.scriptUrl.trim() ? 'url' : 'local',
        path: legacyPath,
        url: typeof parsed?.scriptUrl === 'string' && parsed.scriptUrl.trim() ? parsed.scriptUrl.trim() : null,
        importedAt: Date.now(),
        allowShowUpdateAlert: typeof parsed?.allowShowUpdateAlert === 'boolean' ? parsed.allowShowUpdateAlert : true,
        scriptInfo: getStoredScriptInfo(legacyPath),
      }
      setManagedSources([legacySource])
      activeSourceId = legacySource.id
    }
  } catch (error) {
    console.warn('Load LX source config failed:', error)
  }

  syncConfiguredSourceMirror()
}

const saveConfiguredScriptPath = () => {
  try {
    syncConfiguredSourceMirror()
    fs.writeFileSync(getConfigPath(), JSON.stringify({
      activeSourceId,
      sources: managedSources,
      scriptPath: configuredScriptPath,
      scriptUrl: configuredScriptUrl,
      allowShowUpdateAlert,
    }, null, 2))
  } catch (error) {
    console.warn('Save LX source config failed:', error)
  }
}

const sanitizeImportedScriptName = (value: string) => {
  const normalized = value
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:\"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
  return (normalized || 'lx-source').slice(0, 80)
}

const saveImportedScript = (script: string, scriptInfo: LxSourceScriptInfo, sourceUrl: string) => {
  const urlHash = createHash('sha1').update(sourceUrl).digest('hex').slice(0, 12)
  const filename = `${sanitizeImportedScriptName(scriptInfo.name)}-${urlHash}.js`
  const dirPath = getImportedScriptDir()
  fs.mkdirSync(dirPath, { recursive: true })
  const filePath = path.join(dirPath, filename)
  fs.writeFileSync(filePath, script, 'utf8')
  return filePath
}

const saveBackupImportedScript = (script: string, scriptInfo: LxSourceScriptInfo, sourceId: string) => {
  const fileHash = createHash('sha1').update(`${sourceId}:${script}`).digest('hex').slice(0, 12)
  const filename = `${sanitizeImportedScriptName(scriptInfo.name)}-${fileHash}.js`
  const dirPath = getImportedScriptDir()
  fs.mkdirSync(dirPath, { recursive: true })
  const filePath = path.join(dirPath, filename)
  fs.writeFileSync(filePath, script, 'utf8')
  return filePath
}

const cleanupManagedSourceFiles = (sources: ManagedLxSourceConfig[]) => {
  for (const source of sources) {
    if (!source.path.startsWith(getImportedScriptDir())) continue
    if (!fs.existsSync(source.path)) continue
    try {
      fs.unlinkSync(source.path)
    } catch {
      // ignore cleanup errors
    }
  }
}

const sanitizeBackupSource = (raw: unknown): SanitizedBackupSource | null => {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Partial<LxBackupSourcePayload>
  const info = source.info && typeof source.info === 'object' ? source.info : null
  const rawScript = typeof info?.rawScript === 'string' ? info.rawScript.trim() : ''
  if (!rawScript) return null

  const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : createManagedSourceId()
  const addedAt = typeof source.addedAt === 'string' ? Date.parse(source.addedAt) : NaN

  return {
    id,
    rawScript,
    addedAt: Number.isFinite(addedAt) ? addedAt : Date.now(),
    isActive: Boolean(source.isActive),
    allowShowUpdateAlert: typeof source.allowShowUpdateAlert === 'boolean' ? source.allowShowUpdateAlert : true,
    info: {
      name: typeof info?.name === 'string' ? info.name : null,
      description: typeof info?.description === 'string' ? info.description : null,
      version: typeof info?.version === 'string' ? info.version : null,
      author: typeof info?.author === 'string' ? info.author : null,
      homepage: typeof info?.homepage === 'string' ? info.homepage : null,
    },
  }
}

const normalizeImportedUrl = (rawUrl: string) => {
  const value = rawUrl.trim()
  if (!/^https?:\/\//i.test(value)) {
    throw new Error('请输入有效的音源 URL')
  }
  return new URL(value).toString()
}

const createUpdateAlertKey = (payload: LxSourceUpdateAlertPayload) => [
  payload.sourceId || '',
  status.scriptPath || '',
  payload.version || '',
  payload.updateUrl || '',
  payload.log || '',
].join('::')

const broadcastUpdateAlert = (payload: LxSourceUpdateAlertPayload) => {
  const alertKey = createUpdateAlertKey(payload)
  if (shownUpdateAlertKeys.has(alertKey)) return
  shownUpdateAlertKeys.add(alertKey)
  pendingUpdateAlerts.push(payload)

  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (browserWindow.isDestroyed()) continue
    if (lxSourceWindow && browserWindow.id === lxSourceWindow.id) continue
    browserWindow.webContents.send(LX_SOURCE_PUBLIC_IPC.updateAlert, payload)
  }
}

const detectAutoScriptPath = () => {
  for (const candidate of LX_SOURCE_CANDIDATE_PATHS) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

const resolveActiveScriptPath = () => {
  const autoDetectedPath = detectAutoScriptPath()
  syncConfiguredSourceMirror()

  status.activeSourceId = activeSourceId
  status.autoDetectedPath = autoDetectedPath
  status.configuredPath = configuredScriptPath
  status.allowShowUpdateAlert = allowShowUpdateAlert
  status.managedSources = managedSources.map((source) => ({
    id: source.id,
    type: source.type,
    path: source.path,
    url: source.url,
    importedAt: source.importedAt,
    allowShowUpdateAlert: source.allowShowUpdateAlert,
    exists: fs.existsSync(source.path),
    isActive: source.id === activeSourceId,
    scriptInfo: { ...source.scriptInfo },
  }))

  if (configuredScriptPath && fs.existsSync(configuredScriptPath)) {
    status.scriptUrl = configuredScriptUrl
    status.scriptPath = configuredScriptPath
  } else {
    status.scriptPath = autoDetectedPath
    status.scriptUrl = null
  }

  status.scriptExists = Boolean(status.scriptPath && fs.existsSync(status.scriptPath))
  return status.scriptPath
}

const getStatusSnapshot = (): LxSourceStatus => ({
  activeSourceId: status.activeSourceId,
  configuredPath: status.configuredPath,
  autoDetectedPath: status.autoDetectedPath,
  scriptPath: status.scriptPath,
  scriptUrl: status.scriptUrl,
  scriptExists: status.scriptExists,
  runtimeReady: status.runtimeReady,
  scriptLoaded: status.scriptLoaded,
  allowShowUpdateAlert: status.allowShowUpdateAlert,
  scriptInfo: status.scriptInfo ? { ...status.scriptInfo } : null,
  managedSources: status.managedSources.map((source) => ({
    id: source.id,
    type: source.type,
    path: source.path,
    url: source.url,
    importedAt: source.importedAt,
    allowShowUpdateAlert: source.allowShowUpdateAlert,
    exists: source.exists,
    isActive: source.isActive,
    scriptInfo: { ...source.scriptInfo },
  })),
  supportedSources: Object.fromEntries(
    Object.entries(status.supportedSources).map(([key, value]) => [key, {
      type: value.type,
      actions: [...value.actions],
      qualitys: [...value.qualitys],
    }])
  ),
  lastError: status.lastError,
})

const rejectPendingRequests = (error: Error) => {
  for (const [requestKey, pending] of pendingRequests.entries()) {
    clearTimeout(pending.timer)
    pending.reject(error)
    pendingRequests.delete(requestKey)
  }
}

const rejectRuntimeReadyWaiters = (error: Error) => {
  for (const waiter of runtimeReadyWaiters) {
    clearTimeout(waiter.timer)
    waiter.reject(error)
    runtimeReadyWaiters.delete(waiter)
  }
}

const resetRuntimeState = (errorMessage?: string) => {
  status.runtimeReady = false
  status.scriptLoaded = false
  status.supportedSources = {}
  loadedScriptPath = null
  if (errorMessage) {
    status.lastError = errorMessage
  }
}

const destroyLxSourceWindow = async(errorMessage?: string) => {
  if (initWaiter) {
    clearTimeout(initWaiter.timer)
    initWaiter.reject(new Error(errorMessage || 'LX 音源运行时已关闭'))
    initWaiter = null
  }

  rejectPendingRequests(new Error(errorMessage || 'LX 音源运行时已关闭'))
  rejectRuntimeReadyWaiters(new Error(errorMessage || 'LX 音源运行时已关闭'))
  resetRuntimeState(errorMessage)

  if (!lxSourceWindow || lxSourceWindow.isDestroyed()) {
    lxSourceWindow = null
    return
  }

  const target = lxSourceWindow
  lxSourceWindow = null
  target.destroy()
}

const ensureLxSourceWindow = async() => {
  if (lxSourceWindow && !lxSourceWindow.isDestroyed()) {
    return lxSourceWindow
  }

  status.runtimeReady = false

  lxSourceWindow = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    frame: false,
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'lxSourcePreload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      spellcheck: false,
      webSecurity: true,
      autoplayPolicy: 'document-user-activation-required',
      webgl: false,
    },
  })

  lxSourceWindow.setMenuBarVisibility(false)
  lxSourceWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  lxSourceWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  lxSourceWindow.on('closed', () => {
    void destroyLxSourceWindow('LX 音源运行时窗口已关闭')
  })

  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\">",
    '<title>LX Source Runtime</title>',
    '</head>',
    '<body></body>',
    '</html>',
  ].join('')

  await lxSourceWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
  return lxSourceWindow
}

const waitForRuntimeReady = async() => {
  if (status.runtimeReady) return

  await new Promise<void>((resolve, reject) => {
    const waiter: PendingInit = {
      resolve: () => {
        clearTimeout(waiter.timer)
        runtimeReadyWaiters.delete(waiter)
        resolve()
      },
      reject: (error) => {
        clearTimeout(waiter.timer)
        runtimeReadyWaiters.delete(waiter)
        reject(error)
      },
      timer: setTimeout(() => {
        runtimeReadyWaiters.delete(waiter)
        reject(new Error('等待 LX 音源运行时就绪超时'))
      }, 10000),
    }
    runtimeReadyWaiters.add(waiter)
  })
}

const sendInitPayload = async(payload: LxSourceRuntimeInitPayload) => {
  if (!lxSourceWindow || lxSourceWindow.isDestroyed()) {
    throw new Error('LX 音源运行时窗口不存在')
  }

  const initData = await new Promise<LxSourceInitResponse | undefined>((resolve, reject) => {
    initWaiter = {
      resolve: (value) => {
        clearTimeout(initWaiter?.timer)
        initWaiter = null
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(initWaiter?.timer)
        initWaiter = null
        reject(error)
      },
      timer: setTimeout(() => {
        initWaiter = null
        reject(new Error('LX 音源脚本初始化超时'))
      }, 15000),
    }

    lxSourceWindow!.webContents.send(LX_SOURCE_INTERNAL_IPC.initEnv, payload)
  })

  return initData
}

const resolveRuntimeTarget = (sourceOverride?: ManagedLxSourceConfig | null) => {
  if (sourceOverride) {
    if (!fs.existsSync(sourceOverride.path)) {
      throw new Error('目标音源脚本不存在')
    }
    return {
      scriptPath: sourceOverride.path,
      scriptUrl: sourceOverride.url,
      scriptInfo: sourceOverride.scriptInfo,
      allowShowUpdateAlert: sourceOverride.allowShowUpdateAlert,
    }
  }

  const activeScriptPath = resolveActiveScriptPath()
  return {
    scriptPath: activeScriptPath,
    scriptUrl: configuredScriptUrl,
    scriptInfo: activeScriptPath ? getStoredScriptInfo(activeScriptPath) : null,
    allowShowUpdateAlert,
  }
}

const ensureRuntimeLoaded = async(sourceOverride?: ManagedLxSourceConfig | null) => {
  const runtimeTarget = resolveRuntimeTarget(sourceOverride)
  const targetScriptPath = runtimeTarget.scriptPath

  if (
    targetScriptPath &&
    status.scriptLoaded &&
    status.runtimeReady &&
    loadedScriptPath === targetScriptPath &&
    lxSourceWindow &&
    !lxSourceWindow.isDestroyed()
  ) {
    status.scriptPath = targetScriptPath
    status.scriptUrl = runtimeTarget.scriptUrl
    status.scriptExists = true
    status.scriptInfo = runtimeTarget.scriptInfo
    status.allowShowUpdateAlert = runtimeTarget.allowShowUpdateAlert
    return
  }

  if (ensureRuntimePromise) return ensureRuntimePromise

  ensureRuntimePromise = (async() => {
    if (!targetScriptPath) {
      resetRuntimeState('未找到 LX 音源脚本，请先设置脚本路径')
      throw new Error(status.lastError || '未找到 LX 音源脚本，请先设置脚本路径')
    }

    const script = fs.readFileSync(targetScriptPath, 'utf8')
    const scriptInfo = parseScriptInfo(script, path.basename(targetScriptPath))

    status.scriptPath = targetScriptPath
    status.scriptUrl = runtimeTarget.scriptUrl
    status.scriptExists = true
    status.scriptInfo = scriptInfo
    status.allowShowUpdateAlert = runtimeTarget.allowShowUpdateAlert

    if (!lxSourceWindow || lxSourceWindow.isDestroyed() || loadedScriptPath !== targetScriptPath) {
      await destroyLxSourceWindow()
      await ensureLxSourceWindow()
    }

    await waitForRuntimeReady()
    const initData = await sendInitPayload({
      scriptPath: targetScriptPath,
      script,
      scriptInfo,
    })

    status.scriptPath = targetScriptPath
    status.scriptUrl = runtimeTarget.scriptUrl
    status.scriptExists = true
    status.scriptLoaded = true
    status.scriptInfo = scriptInfo
    status.allowShowUpdateAlert = runtimeTarget.allowShowUpdateAlert
    status.supportedSources = initData?.sources || {}
    status.lastError = null
    loadedScriptPath = targetScriptPath
  })().finally(() => {
    ensureRuntimePromise = null
  })

  return ensureRuntimePromise
}

const createRequestKey = () => `lx_source_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

const dispatchLxSourceRequest = async(payload: Omit<LxSourceRequestPayload, 'sourceId'>) => {
  if (!lxSourceWindow || lxSourceWindow.isDestroyed()) {
    throw new Error('LX 音源运行时不可用')
  }

  const requestKey = createRequestKey()

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestKey)
      reject(new Error('LX 音源请求超时'))
    }, 20000)

    pendingRequests.set(requestKey, { resolve, reject, timer })
    lxSourceWindow!.webContents.send(LX_SOURCE_INTERNAL_IPC.request, {
      requestKey,
      data: payload,
    })
  })
}

const handleRequestLxSource = async(payload: LxSourceRequestPayload) => {
  if (!payload || payload.action !== 'musicUrl') {
    throw new Error('仅支持 musicUrl 请求')
  }

  const requestedSource = payload.sourceId ? getManagedSourceById(payload.sourceId) : null
  if (payload.sourceId && !requestedSource) {
    throw new Error('未找到目标音源')
  }

  const needsTemporarySource = Boolean(requestedSource && requestedSource.id !== activeSourceId)

  try {
    await ensureRuntimeLoaded(needsTemporarySource ? requestedSource : null)
    return await dispatchLxSourceRequest({
      source: payload.source,
      action: payload.action,
      info: payload.info,
    })
  } finally {
    if (needsTemporarySource) {
      try {
        await ensureRuntimeLoaded()
      } catch (error) {
        console.warn('Restore active LX source runtime failed:', error)
      }
    }
  }
}

const reloadActiveSourceRuntime = async() => {
  saveConfiguredScriptPath()
  await destroyLxSourceWindow()
  resolveActiveScriptPath()

  if (status.scriptPath) {
    try {
      await ensureRuntimeLoaded()
    } catch (error) {
      status.lastError = sanitizeErrorMessage(error)
    }
  }

  return getStatusSnapshot()
}

const handleSetScriptPath = async(nextPath: string) => {
  const targetPath = typeof nextPath === 'string' ? nextPath.trim() : ''
  if (!targetPath) {
    activeSourceId = null
    return reloadActiveSourceRuntime()
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error('音源脚本不存在')
  }

  const scriptInfo = getStoredScriptInfo(targetPath)
  const existingSource = getManagedSourceByPath(targetPath)
  const sourceId = existingSource?.id || createManagedSourceId()
  const nextSource: ManagedLxSourceConfig = {
    id: sourceId,
    type: existingSource?.type || 'local',
    path: targetPath,
    url: existingSource?.url || null,
    importedAt: existingSource?.importedAt || Date.now(),
    allowShowUpdateAlert: existingSource?.allowShowUpdateAlert ?? true,
    scriptInfo,
  }

  setManagedSources([
    nextSource,
    ...managedSources.filter((source) => source.id !== sourceId),
  ])
  activeSourceId = sourceId
  return reloadActiveSourceRuntime()
}

const handleImportScriptUrl = async(rawUrl: string) => {
  const sourceUrl = normalizeImportedUrl(rawUrl)
  const response = await performHttpRequest({
    url: sourceUrl,
    method: 'GET',
    timeoutMs: 30000,
    maxRedirects: 3,
    headers: {
      'user-agent': `Sollin/${app.getVersion()} LXSourceImporter`,
      accept: 'application/javascript,text/javascript,text/plain,*/*',
    },
  })

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`下载音源失败（HTTP ${response.status}）`)
  }

  const script = response.bodyText
  if (!script.trim()) {
    throw new Error('下载的音源内容为空')
  }

  if (Buffer.byteLength(script, 'utf8') > 9_000_000) {
    throw new Error('音源脚本体积过大')
  }

  const fallbackName = path.basename(new URL(sourceUrl).pathname || 'lx-source.js') || 'lx-source.js'
  const scriptInfo = parseScriptInfo(script, fallbackName)
  const importedPath = saveImportedScript(script, scriptInfo, sourceUrl)
  const existingSource = getManagedSourceByUrl(sourceUrl) || getManagedSourceByPath(importedPath)
  const sourceId = existingSource?.id || createManagedSourceId()
  const previousPath = existingSource?.path
  const nextSource: ManagedLxSourceConfig = {
    id: sourceId,
    type: 'url',
    path: importedPath,
    url: sourceUrl,
    importedAt: existingSource?.importedAt || Date.now(),
    allowShowUpdateAlert: existingSource?.allowShowUpdateAlert ?? true,
    scriptInfo,
  }

  setManagedSources([
    nextSource,
    ...managedSources.filter((source) => source.id !== sourceId),
  ])
  activeSourceId = sourceId

  if (previousPath && previousPath !== importedPath && previousPath.startsWith(getImportedScriptDir()) && fs.existsSync(previousPath)) {
    try {
      fs.unlinkSync(previousPath)
    } catch {
      // ignore cleanup errors
    }
  }

  return reloadActiveSourceRuntime()
}

const handleSetAllowUpdateAlert = (enable: boolean) => {
  const activeSource = getManagedSourceById(activeSourceId)
  if (activeSource) {
    setManagedSources(managedSources.map((source) => source.id === activeSource.id
      ? { ...source, allowShowUpdateAlert: Boolean(enable) }
      : source))
  } else {
    allowShowUpdateAlert = Boolean(enable)
  }
  if (!enable) pendingUpdateAlerts.splice(0, pendingUpdateAlerts.length)
  saveConfiguredScriptPath()
  resolveActiveScriptPath()
  return getStatusSnapshot()
}

const handleSetSourceAllowUpdateAlert = (sourceId: string, enable: boolean) => {
  const targetSource = getManagedSourceById(sourceId)
  if (!targetSource) {
    throw new Error('未找到目标音源')
  }
  setManagedSources(managedSources.map((source) => source.id === sourceId
    ? { ...source, allowShowUpdateAlert: Boolean(enable) }
    : source))
  if (sourceId === activeSourceId) allowShowUpdateAlert = Boolean(enable)
  if (!enable && sourceId === activeSourceId) pendingUpdateAlerts.splice(0, pendingUpdateAlerts.length)
  saveConfiguredScriptPath()
  resolveActiveScriptPath()
  return getStatusSnapshot()
}

const handleSetActiveSource = async(sourceId: string | null) => {
  if (!sourceId) {
    activeSourceId = null
    return reloadActiveSourceRuntime()
  }

  if (!getManagedSourceById(sourceId)) {
    throw new Error('未找到目标音源')
  }

  activeSourceId = sourceId
  return reloadActiveSourceRuntime()
}

const handleRemoveSource = async(sourceId: string) => {
  const targetSource = getManagedSourceById(sourceId)
  if (!targetSource) {
    throw new Error('未找到目标音源')
  }

  setManagedSources(managedSources.filter((source) => source.id !== sourceId))
  if (activeSourceId === sourceId) {
    activeSourceId = null
  }

  if (targetSource.type === 'url' && targetSource.path.startsWith(getImportedScriptDir()) && fs.existsSync(targetSource.path)) {
    try {
      fs.unlinkSync(targetSource.path)
    } catch {
      // ignore cleanup errors
    }
  }

  return reloadActiveSourceRuntime()
}

const handleExportBackupState = (): LxBackupStatePayload => {
  const sources: LxBackupSourcePayload[] = managedSources.flatMap((source) => {
    try {
      if (!fs.existsSync(source.path)) return []
      const rawScript = fs.readFileSync(source.path, 'utf8')
      if (!rawScript.trim()) return []
      return [{
        id: source.id,
        info: {
          name: source.scriptInfo.name,
          description: source.scriptInfo.description,
          version: source.scriptInfo.version,
          author: source.scriptInfo.author,
          homepage: source.scriptInfo.homepage,
          rawScript,
        },
        addedAt: new Date(source.importedAt).toISOString(),
        isActive: source.id === activeSourceId,
        allowShowUpdateAlert: source.allowShowUpdateAlert,
      }]
    } catch {
      return []
    }
  })

  return {
    sources,
    activeSourceId,
  }
}

const handleRestoreBackupState = async(payload: LxBackupStatePayload | null | undefined) => {
  const inputSources = Array.isArray(payload?.sources)
    ? payload.sources.map((item) => sanitizeBackupSource(item)).filter((item): item is SanitizedBackupSource => Boolean(item))
    : []

  cleanupManagedSourceFiles(managedSources)

  const nextSources: ManagedLxSourceConfig[] = inputSources.map((source) => {
    const parsedInfo = parseScriptInfo(source.rawScript, source.info.name || undefined)
    const scriptInfo: LxSourceScriptInfo = {
      ...parsedInfo,
      name: source.info.name || parsedInfo.name,
      description: source.info.description || parsedInfo.description,
      version: source.info.version || parsedInfo.version,
      author: source.info.author || parsedInfo.author,
      homepage: source.info.homepage || parsedInfo.homepage,
    }

    return {
      id: source.id,
      type: 'url',
      path: saveBackupImportedScript(source.rawScript, scriptInfo, source.id),
      url: null,
      importedAt: source.addedAt,
      allowShowUpdateAlert: source.allowShowUpdateAlert,
      scriptInfo,
    }
  })

  setManagedSources(nextSources)

  const requestedActiveSourceId = typeof payload?.activeSourceId === 'string' && payload.activeSourceId.trim()
    ? payload.activeSourceId.trim()
    : null
  const fallbackActiveSource = inputSources.find((item) => item.isActive)?.id || null

  activeSourceId = requestedActiveSourceId && nextSources.some((source) => source.id === requestedActiveSourceId)
    ? requestedActiveSourceId
    : fallbackActiveSource && nextSources.some((source) => source.id === fallbackActiveSource)
      ? fallbackActiveSource
      : null

  allowShowUpdateAlert = activeSourceId
    ? nextSources.find((source) => source.id === activeSourceId)?.allowShowUpdateAlert ?? true
    : true

  return reloadActiveSourceRuntime()
}

const handleConsumeUpdateAlerts = () => {
  const alerts = [...pendingUpdateAlerts]
  pendingUpdateAlerts.splice(0, pendingUpdateAlerts.length)
  return alerts
}

const handleHttpRequest = async(options: HttpBridgeRequestOptions) => {
  const response = await performHttpRequest(options)
  return {
    status: response.status,
    headers: response.headers,
    setCookies: response.setCookies,
    bodyText: response.bodyText,
    bodyBase64: response.bodyBuffer.toString('base64'),
  }
}

const handlePickScriptPath = async(browserWindow?: BrowserWindow | null) => {
  const options: Electron.OpenDialogOptions = {
    title: '选择 LX 音源脚本',
    properties: ['openFile'],
    filters: [
      { name: 'JavaScript', extensions: ['js', 'mjs', 'cjs'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  }

  const result = browserWindow
    ? await dialog.showOpenDialog(browserWindow, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
}

const isRuntimeSender = (sender: Electron.WebContents) => {
  return sender === lxSourceWindow?.webContents
}

export const setupLxSourceIpcHandlers = () => {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.on(LX_SOURCE_INTERNAL_IPC.runtimeReady, (event) => {
    if (!isRuntimeSender(event.sender)) return
    status.runtimeReady = true
    for (const waiter of runtimeReadyWaiters) {
      waiter.resolve(undefined)
    }
  })

  ipcMain.on(LX_SOURCE_INTERNAL_IPC.initResult, (event, payload: LxSourceRuntimeInitResult) => {
    if (!isRuntimeSender(event.sender)) return
    if (!initWaiter) return

    if (payload.ok) {
      initWaiter.resolve(payload.data)
    } else {
      const errorMessage = payload.error || 'LX 音源脚本初始化失败'
      status.lastError = errorMessage
      status.scriptLoaded = false
      initWaiter.reject(new Error(errorMessage))
    }
  })

  ipcMain.on(LX_SOURCE_INTERNAL_IPC.response, (event, payload: LxSourceRuntimeResponse) => {
    if (!isRuntimeSender(event.sender)) return

    const pending = pendingRequests.get(payload.requestKey)
    if (!pending) return

    pendingRequests.delete(payload.requestKey)
    clearTimeout(pending.timer)

    if (payload.ok) {
      pending.resolve(payload.result)
      return
    }

    pending.reject(new Error(payload.error || 'LX 音源请求失败'))
  })

  ipcMain.on(LX_SOURCE_INTERNAL_IPC.updateAlert, (event, payload: { log?: unknown; updateUrl?: unknown }) => {
    if (!isRuntimeSender(event.sender)) return
    if (!allowShowUpdateAlert) return

    const log = typeof payload?.log === 'string' ? payload.log.trim() : ''
    if (!log) return

    broadcastUpdateAlert({
      sourceId: activeSourceId,
      name: status.scriptInfo?.name || 'LX 音源',
      description: status.scriptInfo?.description || '',
      version: status.scriptInfo?.version || '',
      scriptUrl: configuredScriptUrl,
      updateUrl: typeof payload?.updateUrl === 'string' && payload.updateUrl.trim() ? payload.updateUrl.trim() : undefined,
      log,
    })
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.getStatus, () => {
    resolveActiveScriptPath()
    return getStatusSnapshot()
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.setScriptPath, (_event, nextPath: string) => {
    return runInRuntimeQueue(() => handleSetScriptPath(nextPath))
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.pickScriptPath, (event) => {
    return handlePickScriptPath(BrowserWindow.fromWebContents(event.sender))
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.importScriptUrl, (_event, url: string) => {
    return runInRuntimeQueue(() => handleImportScriptUrl(url))
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.exportBackupState, () => {
    return handleExportBackupState()
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.restoreBackupState, (_event, payload: LxBackupStatePayload) => {
    return runInRuntimeQueue(() => handleRestoreBackupState(payload))
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.setAllowUpdateAlert, (_event, enable: boolean) => {
    return runInRuntimeQueue(() => Promise.resolve(handleSetAllowUpdateAlert(enable)))
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.setSourceAllowUpdateAlert, (_event, payload: { sourceId: string; enable: boolean }) => {
    return runInRuntimeQueue(() => Promise.resolve(handleSetSourceAllowUpdateAlert(payload?.sourceId, payload?.enable)))
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.setActiveSource, (_event, sourceId: string | null) => {
    return runInRuntimeQueue(() => handleSetActiveSource(sourceId))
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.removeSource, (_event, sourceId: string) => {
    return runInRuntimeQueue(() => handleRemoveSource(sourceId))
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.consumeUpdateAlerts, () => {
    return handleConsumeUpdateAlerts()
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.request, (_event, payload: LxSourceRequestPayload) => {
    return runInRuntimeQueue(() => handleRequestLxSource(payload))
  })

  ipcMain.handle(LX_SOURCE_PUBLIC_IPC.httpRequest, (_event, options: HttpBridgeRequestOptions) => {
    return handleHttpRequest(options)
  })
}

export const initializeLxSourceRuntime = async() => {
  loadConfiguredScriptPath()
  resolveActiveScriptPath()

  if (!status.scriptPath) {
    status.lastError = '未找到 LX 音源脚本，请先设置脚本路径'
    return
  }

  try {
    await runInRuntimeQueue(() => ensureRuntimeLoaded())
  } catch (error) {
    status.lastError = sanitizeErrorMessage(error)
    console.warn('Initialize LX source runtime failed:', error)
  }
}

export const disposeLxSourceRuntime = async() => {
  await destroyLxSourceWindow('应用正在退出')
}
