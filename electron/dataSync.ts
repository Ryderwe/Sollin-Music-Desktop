import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import WebSocket, { WebSocketServer } from 'ws'
import type {
  DataSyncConfig,
  DataSyncConflictResolutionMode,
  DataSyncDeviceInfo,
  DataSyncMode,
  DataSyncSnapshot,
  DataSyncSnapshotData,
  DataSyncStatus,
} from './dataSyncShared'
import {
  DATA_SYNC_CONFLICT_RESOLUTION_MODES,
  DEFAULT_DATA_SYNC_PORT,
  createDefaultDataSyncConfig,
} from './dataSyncShared'
import { DataSyncLxCompatBridge, DataSyncLxCompatClient } from './dataSyncLxCompat'

type SyncPeer = WebSocket & {
  deviceInfo?: DataSyncDeviceInfo
  isAuthenticated?: boolean
}

type PersistedDataSyncState = {
  config: DataSyncConfig
  revision: number
  snapshot: DataSyncSnapshotData | null
}

const DATA_SYNC_STATE_FILE = 'data-sync-state.json'
const DATA_SYNC_SERVER_PATH = '/socket'

const joinUrlPath = (basePath: string, childPath: string) => {
  const normalizedBase = basePath && basePath !== '/'
    ? basePath.replace(/\/+$/, '')
    : ''
  return `${normalizedBase}${childPath.startsWith('/') ? childPath : `/${childPath}`}`
}

const normalizePort = (value: unknown): number => {
  const port = Number(value)
  if (!Number.isFinite(port)) return DEFAULT_DATA_SYNC_PORT
  return Math.min(65535, Math.max(1024, Math.trunc(port)))
}

const normalizeConflictResolutionMode = (value: unknown): DataSyncConflictResolutionMode => (
  DATA_SYNC_CONFLICT_RESOLUTION_MODES.includes(value as DataSyncConflictResolutionMode)
    ? value as DataSyncConflictResolutionMode
    : 'merge_local_remote'
)

const isRecord = (value: unknown): value is Record<string, any> => (
  typeof value === 'object' && value !== null && Object.prototype.toString.call(value) === '[object Object]'
)

const createDefaultSnapshot = (): DataSyncSnapshotData => ({
  user: {
    favorites: [],
    playlists: [],
    onlinePlaylists: [],
    recentlyPlayed: [],
    playHistory: [],
    playlistSectionOrder: ['custom', 'local', 'online'],
  },
  feature: {
    dislikeRules: '',
    searchHistory: [],
  },
  ui: {
    theme: 'dark',
    fontFamily: '',
    customFontDataUrl: '',
    closeBehavior: 'ask',
    backgroundSettings: {
      mode: 'album',
      solidColor: '#1a1a2e',
      gradientColor1: '#1a1a2e',
      gradientColor2: '#16213e',
      gradientAngle: 135,
      customImagePath: '',
      overlayColor: '#000000',
      overlayOpacity: 0,
      blurIntensity: 118,
      applyToHome: true,
    },
    lyricsPlayerMode: 'default',
    playerBackdropMode: 'dynamic',
  },
  download: {
    downloadFileNameRuleEnabled: false,
    downloadFileNameParts: ['artist', 'title'],
    downloadFileNameSeparator: '-',
    saveExternalMetadataFiles: false,
  },
  sourceSwitch: {
    enabled: true,
    rememberToggleChoices: true,
    stages: [
      { id: 'origin', enabled: true },
      { id: 'findMusic', enabled: true },
      { id: 'scripts', enabled: true },
    ],
    platformOrder: ['kuwo', 'kugou', 'migu', 'netease', 'qq'],
    platformEnabled: {
      netease: true,
      qq: true,
      kuwo: true,
      kugou: true,
      migu: true,
    },
    scriptOrder: [],
    scriptEnabled: {},
  },
})

const cloneSnapshot = (snapshot: DataSyncSnapshotData): DataSyncSnapshotData => ({
  user: {
    favorites: snapshot.user.favorites,
    playlists: snapshot.user.playlists,
    onlinePlaylists: snapshot.user.onlinePlaylists,
    recentlyPlayed: snapshot.user.recentlyPlayed,
    playHistory: snapshot.user.playHistory,
    playlistSectionOrder: [...snapshot.user.playlistSectionOrder],
  },
  feature: {
    dislikeRules: snapshot.feature.dislikeRules,
    searchHistory: [...snapshot.feature.searchHistory],
  },
  ui: {
    theme: snapshot.ui.theme,
    fontFamily: snapshot.ui.fontFamily,
    customFontDataUrl: snapshot.ui.customFontDataUrl,
    closeBehavior: snapshot.ui.closeBehavior,
    backgroundSettings: { ...snapshot.ui.backgroundSettings },
    lyricsPlayerMode: snapshot.ui.lyricsPlayerMode,
    playerBackdropMode: snapshot.ui.playerBackdropMode,
  },
  download: {
    downloadFileNameRuleEnabled: snapshot.download.downloadFileNameRuleEnabled,
    downloadFileNameParts: [...snapshot.download.downloadFileNameParts],
    downloadFileNameSeparator: snapshot.download.downloadFileNameSeparator,
    saveExternalMetadataFiles: snapshot.download.saveExternalMetadataFiles,
  },
  sourceSwitch: {
    enabled: snapshot.sourceSwitch.enabled,
    rememberToggleChoices: snapshot.sourceSwitch.rememberToggleChoices,
    stages: snapshot.sourceSwitch.stages.map((stage: { id: string; enabled: boolean }) => ({ ...stage })),
    platformOrder: [...snapshot.sourceSwitch.platformOrder],
    platformEnabled: { ...snapshot.sourceSwitch.platformEnabled },
    scriptOrder: [...snapshot.sourceSwitch.scriptOrder],
    scriptEnabled: { ...snapshot.sourceSwitch.scriptEnabled },
  },
})

const isEmptySnapshot = (snapshot: DataSyncSnapshotData) => (
  snapshot.user.favorites.length === 0 &&
  snapshot.user.playlists.length === 0 &&
  snapshot.user.onlinePlaylists.length === 0 &&
  snapshot.user.recentlyPlayed.length === 0 &&
  snapshot.user.playHistory.length === 0 &&
  snapshot.feature.dislikeRules.trim() === '' &&
  snapshot.feature.searchHistory.length === 0 &&
  snapshot.sourceSwitch.scriptOrder.length === 0 &&
  snapshot.sourceSwitch.platformOrder.length === 0
)

const getSyncStatePath = () => path.join(app.getPath('userData'), DATA_SYNC_STATE_FILE)

const getLocalDeviceId = () => {
  const persistedPath = path.join(app.getPath('userData'), 'data-sync-device.json')
  try {
    if (fs.existsSync(persistedPath)) {
      const parsed = JSON.parse(fs.readFileSync(persistedPath, 'utf8'))
      if (typeof parsed?.deviceId === 'string' && parsed.deviceId.trim()) {
        return parsed.deviceId
      }
    }
  } catch {}

  const deviceId = randomBytes(16).toString('hex')
  try {
    fs.writeFileSync(persistedPath, JSON.stringify({ deviceId }, null, 2))
  } catch {}
  return deviceId
}

const getDeviceName = () => os.hostname() || 'Sollin'

const getDeviceInfo = (): Pick<DataSyncDeviceInfo, 'deviceId' | 'deviceName' | 'platform' | 'version'> => ({
  deviceId: getLocalDeviceId(),
  deviceName: getDeviceName(),
  platform: process.platform,
  version: app.getVersion(),
})

const getLocalAddressCandidates = (port: number) => {
  const addresses = new Set<string>([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ])

  for (const netInterface of Object.values(os.networkInterfaces())) {
    for (const item of netInterface || []) {
      if (!item || item.internal || item.family !== 'IPv4') continue
      addresses.add(`http://${item.address}:${port}`)
    }
  }

  return Array.from(addresses)
}

const createClientSocketUrl = (clientHost: string) => {
  const baseUrl = new URL(clientHost.trim())
  const wsProtocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = new URL(baseUrl.toString())
  wsUrl.protocol = wsProtocol
  wsUrl.pathname = joinUrlPath(baseUrl.pathname, DATA_SYNC_SERVER_PATH)
  return wsUrl
}

const readPersistedState = (): PersistedDataSyncState => {
  const defaultConfig = createDefaultDataSyncConfig()
  const fallback = {
    config: defaultConfig,
    revision: 0,
    snapshot: null,
  }

  try {
    const filePath = getSyncStatePath()
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf8').trim()
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PersistedDataSyncState>
    return {
      config: {
        ...defaultConfig,
        ...(isRecord(parsed.config) ? parsed.config as Partial<DataSyncConfig> : {}),
        serverPort: normalizePort(parsed.config?.serverPort),
        autoResolveSyncConflicts: typeof parsed.config?.autoResolveSyncConflicts === 'boolean'
          ? parsed.config.autoResolveSyncConflicts
          : defaultConfig.autoResolveSyncConflicts,
        conflictResolutionMode: normalizeConflictResolutionMode(parsed.config?.conflictResolutionMode),
        clientHost: typeof parsed.config?.clientHost === 'string' && parsed.config.clientHost.trim()
          ? parsed.config.clientHost.trim()
          : defaultConfig.clientHost,
        connectionCode: typeof parsed.config?.connectionCode === 'string' ? parsed.config.connectionCode.trim() : '',
      },
      revision: Number.isFinite(parsed.revision) ? Number(parsed.revision) : 0,
      snapshot: parsed.snapshot && isRecord(parsed.snapshot) ? cloneSnapshot({
        ...createDefaultSnapshot(),
        ...parsed.snapshot,
      } as DataSyncSnapshotData) : null,
    }
  } catch {
    return fallback
  }
}

const writePersistedState = () => {
  const state: PersistedDataSyncState = {
    config: { ...config },
    revision,
    snapshot: currentSnapshot ? cloneSnapshot(currentSnapshot.data) : null,
  }

  fs.promises.writeFile(getSyncStatePath(), JSON.stringify(state, null, 2)).catch((error) => {
    console.warn('[data-sync] persist failed:', error)
  })
}

let config = createDefaultDataSyncConfig()
let revision = 0
let currentSnapshot: DataSyncSnapshot | null = null
let currentStatus: DataSyncStatus = {
  available: true,
  enabled: false,
  mode: 'server',
  autoResolveSyncConflicts: false,
  conflictResolutionMode: 'merge_local_remote',
  serverRunning: false,
  clientConnected: false,
  serverPort: DEFAULT_DATA_SYNC_PORT,
  serverAddresses: [],
  clientHost: `http://127.0.0.1:${DEFAULT_DATA_SYNC_PORT}`,
  connectionCode: '',
  revision: 0,
  deviceId: getLocalDeviceId(),
  deviceName: getDeviceName(),
  connectedDevices: [],
  trustedDevices: [],
  lastError: null,
}

let httpServer: http.Server | null = null
let wsServer: WebSocketServer | null = null
let serverPeers = new Set<SyncPeer>()
let clientSocket: WebSocket | null = null
let clientReconnectTimer: NodeJS.Timeout | null = null
let clientHeartbeatTimer: NodeJS.Timeout | null = null
let lxCompatBridge: DataSyncLxCompatBridge | null = null
let lxCompatClient: DataSyncLxCompatClient | null = null
let disconnectingClient = false

const notifyStatus = () => {
  const lxCompatDevice = lxCompatClient?.getDeviceInfo()
  currentStatus = {
    ...currentStatus,
    enabled: config.enabled,
    mode: config.mode,
    autoResolveSyncConflicts: config.autoResolveSyncConflicts,
    conflictResolutionMode: config.conflictResolutionMode,
    serverRunning: Boolean(httpServer),
    clientConnected: Boolean(clientSocket && clientSocket.readyState === WebSocket.OPEN) || Boolean(lxCompatClient?.isConnected()),
    serverPort: config.serverPort,
    serverAddresses: httpServer ? getLocalAddressCandidates(config.serverPort) : [],
    clientHost: config.clientHost,
    connectionCode: config.connectionCode,
    revision,
    deviceId: getLocalDeviceId(),
    deviceName: getDeviceName(),
    connectedDevices: config.mode === 'client'
      ? lxCompatDevice ? [lxCompatDevice] : []
      : currentStatus.connectedDevices.slice(),
    trustedDevices: currentStatus.trustedDevices.slice(),
  }

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('data-sync:status', currentStatus)
  }
}

const sendSnapshotToWindows = (snapshot: DataSyncSnapshot) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('data-sync:snapshot', snapshot)
  }
}

const setCurrentSnapshot = (nextData: DataSyncSnapshotData, sourceId = getLocalDeviceId(), sourceName = getDeviceName()) => {
  revision += 1
  currentSnapshot = {
    revision,
    sourceId,
    sourceName,
    updatedAt: Date.now(),
    data: cloneSnapshot(nextData),
  }
  currentStatus = {
    ...currentStatus,
    revision,
    lastError: null,
  }
  writePersistedState()
  notifyStatus()
  sendSnapshotToWindows(currentSnapshot)
  lxCompatBridge?.onSnapshotUpdated(currentSnapshot.data, sourceId)
  lxCompatClient?.onSnapshotUpdated(currentSnapshot.data, sourceId)
}

const updateConnectedDevices = () => {
  if (!wsServer) return
  const devices = Array.from(wsServer.clients as Set<SyncPeer>)
    .map((peer) => peer.deviceInfo)
    .filter((item): item is DataSyncDeviceInfo => Boolean(item))
  currentStatus = {
    ...currentStatus,
    connectedDevices: devices,
  }
  notifyStatus()
}

const broadcastSnapshot = (snapshot: DataSyncSnapshot, exclude?: SyncPeer | null) => {
  if (!wsServer) return
  const message = JSON.stringify({ type: 'snapshot', snapshot })
  for (const peer of wsServer.clients as Set<SyncPeer>) {
    if (peer.readyState !== WebSocket.OPEN) continue
    if (exclude && peer === exclude) continue
    peer.send(message)
  }
}

const stopClientHeartbeat = () => {
  if (clientHeartbeatTimer) {
    clearInterval(clientHeartbeatTimer)
    clientHeartbeatTimer = null
  }
}

const stopClientReconnect = () => {
  if (clientReconnectTimer) {
    clearTimeout(clientReconnectTimer)
    clientReconnectTimer = null
  }
}

const disconnectClient = () => {
  disconnectingClient = true
  stopClientHeartbeat()
  stopClientReconnect()
  const socket = clientSocket
  clientSocket = null
  if (socket) {
    try {
      socket.close()
    } catch {}
  }
  void lxCompatClient?.disconnect()
  lxCompatClient = null
  currentStatus = {
    ...currentStatus,
    clientConnected: false,
    connectedDevices: [],
  }
  notifyStatus()
  disconnectingClient = false
}

const closeServer = async() => {
  if (wsServer) {
    for (const peer of wsServer.clients as Set<SyncPeer>) {
      try {
        peer.close()
      } catch {}
    }
    await new Promise<void>((resolve) => {
      wsServer?.close(() => resolve())
      wsServer = null
    }).catch(() => {})
  }

  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer?.close(() => resolve())
      httpServer = null
    }).catch(() => {})
  }

  serverPeers = new Set()
  currentStatus = {
    ...currentStatus,
    serverRunning: false,
    connectedDevices: [],
    trustedDevices: [],
    serverAddresses: [],
  }
  notifyStatus()
}

const startServer = async() => {
  if (httpServer) return

  const port = config.serverPort
  const serverCode = config.connectionCode || randomBytes(3).toString('hex').slice(0, 6).toUpperCase()
  config = {
    ...config,
    connectionCode: serverCode,
  }

  lxCompatBridge = new DataSyncLxCompatBridge({
    getConnectionCode: () => config.connectionCode,
    getCurrentSnapshotData: () => currentSnapshot ? cloneSnapshot(currentSnapshot.data) : null,
    setCurrentSnapshotData: (data, sourceId, sourceName) => setCurrentSnapshot(data, sourceId, sourceName),
    getDefaultSyncMode: () => config.autoResolveSyncConflicts ? config.conflictResolutionMode : null,
    onDevicesChanged: (devices, trustedDevices) => {
      currentStatus = {
        ...currentStatus,
        connectedDevices: devices.map((device) => ({
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          platform: device.platform,
          version: device.version,
          connectedAt: device.connectedAt,
          lastSeenAt: device.lastSeenAt,
        })),
        trustedDevices: trustedDevices.map((device) => ({
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          platform: device.platform,
          version: device.version,
          connectedAt: device.connectedAt,
          lastSeenAt: device.lastSeenAt,
        })),
      }
      notifyStatus()
    },
  })

  await new Promise<void>((resolve, reject) => {
    httpServer = http.createServer((req, res) => {
      if (lxCompatBridge?.handleHttpRequest(req, res)) return

      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
      if (requestUrl.pathname === '/hello') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Hello~::^-^::~v4~')
        return
      }
      if (requestUrl.pathname === '/id') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(`OjppZDo6${getLocalDeviceId()}`)
        return
      }
      if (requestUrl.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Sollin Data Sync Service')
        return
      }

      res.writeHead(404)
      res.end('Not Found')
    })

    wsServer = new WebSocketServer({ noServer: true })

    wsServer.on('connection', (socket: SyncPeer, request) => {
      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
      const code = requestUrl.searchParams.get('code') || ''
      const deviceId = requestUrl.searchParams.get('deviceId') || `device-${randomBytes(4).toString('hex')}`
      const deviceName = requestUrl.searchParams.get('deviceName') || 'Sollin'
      const version = requestUrl.searchParams.get('version') || app.getVersion()

      if (code !== config.connectionCode) {
        socket.close(4001, 'Invalid connection code')
        return
      }

      socket.isAuthenticated = true
      socket.deviceInfo = {
        deviceId,
        deviceName,
        platform: requestUrl.searchParams.get('platform') || process.platform,
        version,
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
      }
      serverPeers.add(socket)
      updateConnectedDevices()

      socket.send(JSON.stringify({
        type: 'snapshot',
        snapshot: currentSnapshot || {
          revision,
          sourceId: getLocalDeviceId(),
          sourceName: getDeviceName(),
          updatedAt: Date.now(),
          data: cloneSnapshot(createDefaultSnapshot()),
        },
      }))

      socket.on('message', (raw) => {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8')
        let payload: any
        try {
          payload = JSON.parse(text)
        } catch {
          return
        }

        if (payload?.type === 'snapshot' && isRecord(payload.snapshot) && isRecord(payload.snapshot.data)) {
          const snapshot = payload.snapshot as DataSyncSnapshot
          setCurrentSnapshot(snapshot.data, snapshot.sourceId || deviceId, snapshot.sourceName || deviceName)
          broadcastSnapshot(currentSnapshot!, socket)
          return
        }

        if (payload?.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', at: Date.now() }))
        }
      })

      socket.on('close', () => {
        serverPeers.delete(socket)
        updateConnectedDevices()
      })
    })

    httpServer.on('upgrade', (request, socket, head) => {
      if (lxCompatBridge?.handleUpgrade(request, socket, head)) return

      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
      if (requestUrl.pathname !== DATA_SYNC_SERVER_PATH) {
        socket.destroy()
        return
      }

      const code = requestUrl.searchParams.get('code') || ''
      if (code !== config.connectionCode) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      wsServer?.handleUpgrade(request, socket, head, (ws) => {
        wsServer?.emit('connection', ws, request)
      })
    })

    httpServer.on('error', (error) => {
      currentStatus = {
        ...currentStatus,
        lastError: error instanceof Error ? error.message : 'Data sync server failed',
      }
      notifyStatus()
      reject(error)
    })

    httpServer.listen(port, '0.0.0.0', () => {
      currentStatus = {
        ...currentStatus,
        serverRunning: true,
        serverPort: port,
        serverAddresses: getLocalAddressCandidates(port),
        lastError: null,
      }
      notifyStatus()
      resolve()
    })
  })

}

const reconnectClientLater = () => {
  stopClientReconnect()
  clientReconnectTimer = setTimeout(() => {
    clientReconnectTimer = null
    void connectClient().catch((error) => {
      currentStatus = {
        ...currentStatus,
        clientConnected: false,
        lastError: error instanceof Error ? error.message : '同步客户端重连失败',
      }
      notifyStatus()
    })
  }, 3000)
}

const setClientConnectionError = (message: string | null) => {
  currentStatus = {
    ...currentStatus,
    lastError: message,
  }
  notifyStatus()
}

const createLxCompatClient = () => new DataSyncLxCompatClient({
  getCurrentSnapshotData: () => currentSnapshot ? cloneSnapshot(currentSnapshot.data) : null,
  setCurrentSnapshotData: (data, sourceId, sourceName) => setCurrentSnapshot(data, sourceId, sourceName),
  getDefaultSyncMode: () => config.autoResolveSyncConflicts ? config.conflictResolutionMode : null,
  onStatusChanged: () => notifyStatus(),
  onDisconnected: () => {
    if (!disconnectingClient && config.enabled && config.mode === 'client') {
      reconnectClientLater()
    }
  },
  onError: (message) => setClientConnectionError(message),
  getDeviceName,
})

const connectNativeClient = async(connectionCode: string) => new Promise<void>((resolve, reject) => {
  const wsUrl = createClientSocketUrl(config.clientHost)
  wsUrl.searchParams.set('code', connectionCode.trim())
  wsUrl.searchParams.set('deviceId', getLocalDeviceId())
  wsUrl.searchParams.set('deviceName', getDeviceName())
  wsUrl.searchParams.set('platform', process.platform)
  wsUrl.searchParams.set('version', app.getVersion())

  const socket = new WebSocket(wsUrl.toString())
  clientSocket = socket
  let settled = false
  let opened = false
  const timeout = setTimeout(() => {
    fail(new Error('同步客户端连接超时'))
    try {
      socket.close()
    } catch {}
  }, 30000)

  const fail = (error: Error) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    stopClientHeartbeat()
    if (clientSocket === socket) {
      clientSocket = null
    }
    currentStatus = {
      ...currentStatus,
      clientConnected: false,
      lastError: error.message,
    }
    notifyStatus()
    reject(error)
  }

  const succeed = () => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    resolve()
  }

  const heartbeat = () => {
    stopClientHeartbeat()
    clientHeartbeatTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
  }

  socket.on('open', () => {
    opened = true
    currentStatus = {
      ...currentStatus,
      clientConnected: true,
      lastError: null,
    }
    notifyStatus()
    heartbeat()
    succeed()
  })

  socket.on('unexpected-response', (_request, response) => {
    let body = ''
    response.setEncoding('utf8')
    response.on('data', (chunk: string) => {
      body += chunk
    })
    response.on('end', () => {
      const detail = body.trim()
      fail(new Error(detail
        ? `同步服务返回 ${response.statusCode}: ${detail}`
        : `同步服务返回 ${response.statusCode || '未知状态码'}`))
    })
  })

  socket.on('message', (raw) => {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8')
    let payload: any
    try {
      payload = JSON.parse(text)
    } catch {
      return
    }

    if (payload?.type === 'snapshot' && isRecord(payload.snapshot) && isRecord(payload.snapshot.data)) {
      const snapshot = payload.snapshot as DataSyncSnapshot
      revision = Number.isFinite(snapshot.revision) ? snapshot.revision : revision
      currentSnapshot = {
        revision,
        sourceId: snapshot.sourceId || getLocalDeviceId(),
        sourceName: snapshot.sourceName || getDeviceName(),
        updatedAt: Number.isFinite(snapshot.updatedAt) ? snapshot.updatedAt : Date.now(),
        data: cloneSnapshot(snapshot.data),
      }
      currentStatus = {
        ...currentStatus,
        revision,
      }
      writePersistedState()
      sendSnapshotToWindows(currentSnapshot)
      notifyStatus()
      return
    }
  })

  socket.on('close', () => {
    stopClientHeartbeat()
    const wasActiveSocket = clientSocket === socket
    if (wasActiveSocket) clientSocket = null
    currentStatus = {
      ...currentStatus,
      clientConnected: false,
    }
    notifyStatus()
    if (!opened) {
      fail(new Error('同步客户端连接已关闭'))
      return
    }
    if (wasActiveSocket && !disconnectingClient && config.enabled && config.mode === 'client') {
      reconnectClientLater()
    }
  })

  socket.on('error', (error) => {
    const nextError = error instanceof Error ? error : new Error('同步客户端连接失败')
    if (!opened) {
      fail(nextError)
      return
    }
    currentStatus = {
      ...currentStatus,
      lastError: nextError.message,
      clientConnected: false,
    }
    notifyStatus()
  })
})

const connectClient = async(connectionCode = config.connectionCode, options: { forceCompatCodeAuth?: boolean } = {}) => {
  if (!config.clientHost.trim()) throw new Error('请先填写同步服务地址')
  if (!connectionCode.trim()) throw new Error('请先填写连接码')

  disconnectClient()

  try {
    await connectNativeClient(connectionCode)
    return
  } catch (nativeError) {
    const nativeMessage = nativeError instanceof Error ? nativeError.message : '原生同步协议连接失败'
    stopClientHeartbeat()
    if (clientSocket) {
      try {
        clientSocket.close()
      } catch {}
    }
    clientSocket = null

    lxCompatClient = createLxCompatClient()
    try {
      await lxCompatClient.connect(config.clientHost, connectionCode.trim(), options.forceCompatCodeAuth === true)
      currentStatus = {
        ...currentStatus,
        clientConnected: true,
        lastError: null,
      }
      notifyStatus()
      return
    } catch (compatError) {
      const compatMessage = compatError instanceof Error ? compatError.message : 'LX 兼容同步协议连接失败'
      await lxCompatClient?.disconnect()
      lxCompatClient = null
      const message = `${nativeMessage}；${compatMessage}`
      currentStatus = {
        ...currentStatus,
        clientConnected: false,
        lastError: message,
      }
      notifyStatus()
      throw new Error(message)
    }
  }
}

export const initializeDataSyncRuntime = async() => {
  const persisted = readPersistedState()
  config = persisted.config
  revision = persisted.revision
  currentSnapshot = persisted.snapshot
    ? {
        revision: persisted.revision,
        sourceId: getLocalDeviceId(),
        sourceName: getDeviceName(),
        updatedAt: Date.now(),
        data: cloneSnapshot(persisted.snapshot),
      }
    : null

  currentStatus = {
    ...currentStatus,
    enabled: config.enabled,
    mode: config.mode,
    autoResolveSyncConflicts: config.autoResolveSyncConflicts,
    conflictResolutionMode: config.conflictResolutionMode,
    serverRunning: false,
    clientConnected: false,
    serverPort: config.serverPort,
    serverAddresses: [],
    clientHost: config.clientHost,
    connectionCode: config.connectionCode,
    revision,
    deviceId: getLocalDeviceId(),
    deviceName: getDeviceName(),
    connectedDevices: [],
    trustedDevices: [],
    lastError: null,
  }

  if (config.enabled) {
    if (config.mode === 'server') {
      await startServer()
    } else {
      await connectClient(config.connectionCode).catch((error) => {
        currentStatus = {
          ...currentStatus,
          clientConnected: false,
          lastError: error instanceof Error ? error.message : '同步客户端连接失败',
        }
      })
    }
  }

  notifyStatus()
}

export const disposeDataSyncRuntime = async() => {
  disconnectClient()
  await closeServer()
  await lxCompatBridge?.stop()
  lxCompatBridge = null
  writePersistedState()
}

export const getDataSyncStatus = (): DataSyncStatus => currentStatus

export const getDataSyncSnapshot = (): DataSyncSnapshot | null => currentSnapshot

export const updateDataSyncConfig = async(patch: Partial<DataSyncConfig>) => {
  const nextConfig: DataSyncConfig = {
    ...config,
    ...patch,
    serverPort: normalizePort(patch.serverPort ?? config.serverPort),
    clientHost: typeof patch.clientHost === 'string' && patch.clientHost.trim()
      ? patch.clientHost.trim()
      : config.clientHost,
    connectionCode: typeof patch.connectionCode === 'string'
      ? patch.connectionCode.trim()
      : config.connectionCode,
    autoResolveSyncConflicts: typeof patch.autoResolveSyncConflicts === 'boolean'
      ? patch.autoResolveSyncConflicts
      : config.autoResolveSyncConflicts,
    conflictResolutionMode: normalizeConflictResolutionMode(patch.conflictResolutionMode ?? config.conflictResolutionMode),
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : config.enabled,
    mode: patch.mode === 'client' ? 'client' : patch.mode === 'server' ? 'server' : config.mode,
  }

  const modeChanged = nextConfig.mode !== config.mode
  const portChanged = nextConfig.serverPort !== config.serverPort
  const hostChanged = nextConfig.clientHost !== config.clientHost
  const enabledChanged = nextConfig.enabled !== config.enabled

  config = nextConfig

  if (!config.enabled) {
    disconnectClient()
    await closeServer()
  } else if (config.mode === 'server') {
    disconnectClient()
    if (httpServer && (modeChanged || portChanged)) {
      await closeServer()
      await startServer()
    } else if (!httpServer) {
      await startServer()
    }
  } else {
    await closeServer()
    if (enabledChanged || modeChanged || hostChanged || patch.connectionCode) {
      await connectClient(config.connectionCode, { forceCompatCodeAuth: Boolean(patch.connectionCode) })
    }
  }

  writePersistedState()
  notifyStatus()
  return getDataSyncStatus()
}

export const refreshDataSyncCode = async() => {
  config = {
    ...config,
    connectionCode: randomBytes(3).toString('hex').slice(0, 6).toUpperCase(),
  }
  if (config.enabled && config.mode === 'server') {
    await closeServer()
    await startServer()
  }
  writePersistedState()
  notifyStatus()
  return getDataSyncStatus()
}

export const removeDataSyncDevice = async(deviceId: string) => {
  if (!deviceId.trim()) return getDataSyncStatus()
  lxCompatBridge?.removeDevice(deviceId.trim())
  currentStatus = {
    ...currentStatus,
    connectedDevices: currentStatus.connectedDevices.filter((device) => device.deviceId !== deviceId.trim()),
    trustedDevices: currentStatus.trustedDevices.filter((device) => device.deviceId !== deviceId.trim()),
  }
  notifyStatus()
  return getDataSyncStatus()
}

export const connectDataSyncClient = async(connectionCode: string) => {
  config = {
    ...config,
    connectionCode: connectionCode.trim(),
    enabled: true,
    mode: 'client',
  }
  writePersistedState()
  await connectClient(connectionCode, { forceCompatCodeAuth: true })
  notifyStatus()
  return getDataSyncStatus()
}

export const disconnectDataSync = async() => {
  config = {
    ...config,
    enabled: false,
  }
  disconnectClient()
  if (config.mode === 'server') {
    await closeServer()
  }
  await lxCompatBridge?.stop()
  writePersistedState()
  notifyStatus()
  return getDataSyncStatus()
}

export const pushDataSyncSnapshot = async(snapshotData: DataSyncSnapshotData) => {
  const nextSnapshot = cloneSnapshot(snapshotData)
  setCurrentSnapshot(nextSnapshot)

  if (config.enabled && config.mode === 'server' && wsServer) {
    broadcastSnapshot(currentSnapshot!)
  }

  if (config.enabled && config.mode === 'client' && clientSocket && clientSocket.readyState === WebSocket.OPEN) {
    clientSocket.send(JSON.stringify({
      type: 'snapshot',
      snapshot: currentSnapshot,
    }))
  }

  return currentSnapshot
}

export const setupDataSyncIpcHandlers = () => {
  ipcMain.handle('data-sync:get-status', () => getDataSyncStatus())
  ipcMain.handle('data-sync:get-snapshot', () => getDataSyncSnapshot())
  ipcMain.handle('data-sync:update-config', async(_event, patch: Partial<DataSyncConfig>) => updateDataSyncConfig(patch))
  ipcMain.handle('data-sync:connect-client', async(_event, code: unknown) => connectDataSyncClient(String(code || '')))
  ipcMain.handle('data-sync:disconnect', async() => disconnectDataSync())
  ipcMain.handle('data-sync:refresh-code', async() => refreshDataSyncCode())
  ipcMain.handle('data-sync:remove-device', async(_event, deviceId: unknown) => removeDataSyncDevice(String(deviceId || '')))
  ipcMain.on('data-sync:push-snapshot', (_event, snapshot: DataSyncSnapshotData) => {
    void pushDataSyncSnapshot(snapshot)
  })
}
