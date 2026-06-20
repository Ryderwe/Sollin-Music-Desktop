import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { constants, createCipheriv, createDecipheriv, createHash, generateKeyPair, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto'
import { gzip, gunzip } from 'node:zlib'
import WebSocket, { WebSocketServer } from 'ws'
import { createMsg2call } from 'message2call'
import type { DataSyncConflictResolutionMode, DataSyncDeviceInfo, DataSyncSnapshotData } from './dataSyncShared'

const HELLO_MSG = 'Hello~::^-^::~v4~'
const ID_PREFIX = 'OjppZDo6'
const AUTH_MSG = 'lx-music auth::'
const AUTH_FAILED = 'Auth failed'
const BLOCKED_IP = 'Blocked IP'
const CONNECT_MSG = 'lx-music connect'
const SOCKET_PATH = '/socket'
const CLOSE_CODE_FAILED = 4100
const COMPAT_STATE_FILE = 'data-sync-lx-compat.json'
const MAX_COMPAT_SNAPSHOT_COUNT = 10

type LxCompatClientKeyInfo = {
  clientId: string
  key: string
  deviceName: string
  isMobile: boolean
  lastConnectDate: number
}

type LxCompatClientStoredAuthKey = {
  clientId: string
  key: string
  serverName: string
}

type LxCompatSnapshotClientInfo = {
  snapshotKey: string
  lastSyncDate: number
}

type LxCompatSnapshotInfo = {
  latest: string | null
  time: number
  list: string[]
  clients: Record<string, LxCompatSnapshotClientInfo>
}

type LxCompatPersistedState = {
  serverId: string
  clients: Record<string, LxCompatClientKeyInfo>
  clientAuthKeys: Record<string, LxCompatClientStoredAuthKey>
  listSnapshotInfo: LxCompatSnapshotInfo
  dislikeSnapshotInfo: LxCompatSnapshotInfo
  listSnapshots: Record<string, LxListData>
  dislikeSnapshots: Record<string, string>
}

type LxMusicInfo = {
  id: string
  name: string
  singer: string
  source: string
  interval: string | null
  meta: Record<string, any>
}

type LxUserListInfoFull = {
  id: string
  name: string
  source?: string
  sourceListId?: string
  locationUpdateTime: number | null
  list: LxMusicInfo[]
}

type LxListData = {
  defaultList: LxMusicInfo[]
  loveList: LxMusicInfo[]
  userList: LxUserListInfoFull[]
}

type LxCompatPeer = WebSocket & {
  keyInfo: LxCompatClientKeyInfo
  remote: any
  remoteQueueList: any
  remoteQueueDislike: any
  moduleReadys: {
    list: boolean
    dislike: boolean
  }
  feature: {
    list: false | { skipSnapshot: boolean }
    dislike: false | { skipSnapshot: boolean }
  }
  isReady: boolean
  cleanup: () => void
}

type LxCompatBridgeOptions = {
  getConnectionCode: () => string
  getCurrentSnapshotData: () => DataSyncSnapshotData | null
  setCurrentSnapshotData: (data: DataSyncSnapshotData, sourceId?: string, sourceName?: string) => void
  getDefaultSyncMode: () => DataSyncConflictResolutionMode | null
  onDevicesChanged: (devices: DataSyncDeviceInfo[], trustedDevices: DataSyncDeviceInfo[]) => void
}

type LxCompatClientOptions = {
  getCurrentSnapshotData: () => DataSyncSnapshotData | null
  setCurrentSnapshotData: (data: DataSyncSnapshotData, sourceId?: string, sourceName?: string) => void
  getDefaultSyncMode: () => DataSyncConflictResolutionMode | null
  onStatusChanged: () => void
  onDisconnected?: () => void
  onError?: (message: string | null) => void
  getDeviceName: () => string
}

type LxCompatClientAuthInfo = {
  clientId: string
  key: string
  serverName: string
}

type LxCompatClientSocket = WebSocket & {
  keyInfo: LxCompatClientAuthInfo
  remote: any
  remoteQueueList: any
  remoteQueueDislike: any
  moduleReadys: {
    list: boolean
    dislike: boolean
  }
  feature: {
    list: false | { skipSnapshot: boolean }
    dislike: false | { skipSnapshot: boolean }
  }
  isReady: boolean
  cleanup: () => void
}

type LxListSyncMode =
  | 'merge_local_remote'
  | 'merge_remote_local'
  | 'overwrite_local_remote'
  | 'overwrite_remote_local'
  | 'overwrite_local_remote_full'
  | 'overwrite_remote_local_full'
  | 'cancel'

type LxDislikeSyncMode = LxListSyncMode

const emptySnapshot = (): DataSyncSnapshotData => ({
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
    backgroundSettings: {},
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

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const gzipText = async(data: string) => new Promise<string>((resolve, reject) => {
  gzip(data, (error, buffer) => {
    if (error) {
      reject(error)
      return
    }
    resolve(buffer.toString('base64'))
  })
})

const gunzipText = async(data: string) => new Promise<string>((resolve, reject) => {
  gunzip(Buffer.from(data, 'base64'), (error, buffer) => {
    if (error) {
      reject(error)
      return
    }
    resolve(buffer.toString())
  })
})

const encodeCompatMessage = async(data: string) => (
  data.length > 1024 ? `cg_${await gzipText(data)}` : data
)

const decodeCompatMessage = async(data: string) => (
  data.startsWith('cg_') ? gunzipText(data.slice(3)) : data
)

const toMd5 = (value: string) => createHash('md5').update(value).digest('hex')

const aesEncrypt = (buffer: string | Buffer, key: string) => {
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(key, 'base64'), null)
  return Buffer.concat([cipher.update(buffer), cipher.final()]).toString('base64')
}

const aesDecrypt = (text: string, key: string) => {
  const decipher = createDecipheriv('aes-128-ecb', Buffer.from(key, 'base64'), null)
  return Buffer.concat([decipher.update(Buffer.from(text, 'base64')), decipher.final()]).toString()
}

const rsaEncrypt = (buffer: Buffer, key: string) => (
  publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING }, buffer).toString('base64')
)

const rsaDecrypt = (buffer: Buffer, key: string) => (
  privateDecrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING }, buffer).toString()
)

const normalizeBaseUrl = (host: string) => {
  const url = new URL(host.trim())
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error('同步服务地址必须以 http:// 或 https:// 开头')
  }
  if (url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  }
  return url
}

const createCompatHttpUrl = (host: string, childPath: string) => {
  const url = normalizeBaseUrl(host)
  const normalizedBase = url.pathname && url.pathname !== '/'
    ? url.pathname.replace(/\/+$/, '')
    : ''
  url.pathname = `${normalizedBase}${childPath.startsWith('/') ? childPath : `/${childPath}`}`
  url.search = ''
  url.hash = ''
  return url
}

const createCompatSocketUrl = (host: string) => {
  const url = createCompatHttpUrl(host, SOCKET_PATH)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

const requestText = async(url: URL, options: { headers?: Record<string, string>; timeoutMs?: number } = {}) => new Promise<{ statusCode: number; text: string }>((resolve, reject) => {
  const transport = url.protocol === 'https:' ? https : http
  const req = transport.request(url, {
    method: 'GET',
    headers: options.headers,
    timeout: options.timeoutMs ?? 10000,
  }, (res) => {
    let text = ''
    res.setEncoding('utf8')
    res.on('data', (chunk: string) => {
      text += chunk
    })
    res.on('end', () => {
      resolve({
        statusCode: res.statusCode || 0,
        text,
      })
    })
  })

  req.on('timeout', () => {
    req.destroy(new Error('同步服务连接超时'))
  })
  req.on('error', reject)
  req.end()
})

const generateRsaKeyPair = async() => new Promise<{ publicKey: string; privateKey: string }>((resolve, reject) => {
  generateKeyPair('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  }, (error, publicKey, privateKey) => {
    if (error) {
      reject(error)
      return
    }
    resolve({ publicKey, privateKey })
  })
})

const formatInterval = (duration: unknown) => {
  const totalSeconds = Number(duration)
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const parseInterval = (interval: string | null | undefined) => {
  if (!interval) return 0
  const parts = interval.split(':').map((item) => Number.parseInt(item, 10))
  if (parts.some((item) => !Number.isFinite(item))) return 0
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1]
  }
  return 0
}

const toLxSource = (platform: string) => {
  switch (platform) {
    case 'netease':
      return 'wy'
    case 'qq':
      return 'tx'
    case 'kuwo':
      return 'kw'
    case 'kugou':
      return 'kg'
    case 'migu':
      return 'mg'
    case 'local':
      return 'local'
    default:
      return 'wy'
  }
}

const fromLxSource = (source: string) => {
  switch (source) {
    case 'wy':
      return 'netease'
    case 'tx':
      return 'qq'
    case 'kw':
      return 'kuwo'
    case 'kg':
      return 'kugou'
    case 'mg':
      return 'migu'
    case 'local':
      return 'local'
    default:
      return 'netease'
  }
}

const getSongIdentity = (song: { source?: string; id?: string; meta?: Record<string, any> }) => {
  const source = song.source || 'wy'
  const songId = song.meta?.filePath || song.meta?.songId || song.id || ''
  return `${source}:${songId}`
}

const toLxMusicInfo = (song: any): LxMusicInfo => {
  const source = toLxSource(song.platform)
  const baseMeta: Record<string, any> = {
    songId: song.lx?.songId || song.id,
    albumName: song.album || song.lx?.albumName || '',
    picUrl: song.cover || song.lx?.img || null,
  }

  if (source === 'local') {
    baseMeta.filePath = song.localPath || song.id
    baseMeta.ext = typeof song.localPath === 'string'
      ? path.extname(song.localPath).replace(/^\./, '') || 'mp3'
      : 'mp3'
  } else {
    baseMeta.qualitys = []
    baseMeta._qualitys = {}
    if (song.albumId || song.lx?.albumId) baseMeta.albumId = song.albumId || song.lx?.albumId
    if (source === 'kg') {
      baseMeta.hash = song.lx?.hash || song.id
    }
    if (source === 'tx') {
      baseMeta.strMediaMid = song.lx?.strMediaMid || ''
      if (song.lx?.albumMid) baseMeta.albumMid = song.lx.albumMid
      if (song.lx?.songId) baseMeta.id = Number.parseInt(String(song.lx.songId), 10)
    }
    if (source === 'mg') {
      baseMeta.copyrightId = song.lx?.copyrightId || song.id
      if (song.lx?.lrcUrl) baseMeta.lrcUrl = song.lx.lrcUrl
      if (song.lx?.mrcUrl) baseMeta.mrcUrl = song.lx.mrcUrl
      if (song.lx?.trcUrl) baseMeta.trcUrl = song.lx.trcUrl
    }
  }

  return {
    id: String(song.id || song.localPath || baseMeta.songId || ''),
    name: song.name || '未知歌曲',
    singer: song.artist || song.singer || '未知歌手',
    source,
    interval: formatInterval(song.duration),
    meta: baseMeta,
  }
}

const fromLxMusicInfo = (song: LxMusicInfo) => {
  const platform = fromLxSource(song.source)
  const songId = song.meta?.filePath || song.meta?.songId || song.id
  return {
    id: String(songId),
    name: song.name || '未知歌曲',
    artist: song.singer || '未知歌手',
    album: song.meta?.albumName || '',
    duration: parseInterval(song.interval),
    cover: song.meta?.picUrl || undefined,
    platform,
    localPath: platform === 'local' ? song.meta?.filePath || undefined : undefined,
    lx: platform === 'local' ? undefined : {
      source: song.source,
      songId: String(song.meta?.songId || song.id || ''),
      albumId: song.meta?.albumId ? String(song.meta.albumId) : undefined,
      albumMid: song.meta?.albumMid || undefined,
      strMediaMid: song.meta?.strMediaMid || undefined,
      hash: song.meta?.hash || undefined,
      copyrightId: song.meta?.copyrightId || undefined,
      lrcUrl: song.meta?.lrcUrl || undefined,
      mrcUrl: song.meta?.mrcUrl || undefined,
      trcUrl: song.meta?.trcUrl || undefined,
      albumName: song.meta?.albumName || undefined,
      img: song.meta?.picUrl || undefined,
      types: [],
      _types: {},
    },
  }
}

const mergeSongLists = (preferred: LxMusicInfo[], fallback: LxMusicInfo[]) => {
  const map = new Map<string, LxMusicInfo>()
  const order: string[] = []

  for (const list of [preferred, fallback]) {
    for (const song of list) {
      const key = getSongIdentity(song)
      if (!key) continue
      if (map.has(key)) continue
      order.push(key)
      map.set(key, clone(song))
    }
  }

  return order.map((key) => map.get(key)!).filter(Boolean)
}

const mergeUserLists = (preferred: LxUserListInfoFull[], fallback: LxUserListInfoFull[]) => {
  const userListDataObj = new Map<string, LxUserListInfoFull>()
  const newUserList = preferred.map((playlist) => {
    const cloned = clone(playlist)
    userListDataObj.set(cloned.id, cloned)
    return cloned
  })

  fallback.forEach((playlist, index) => {
    const targetUpdateTime = playlist?.locationUpdateTime ?? 0
    const sourceList = userListDataObj.get(playlist.id)
    if (sourceList) {
      sourceList.list = mergeSongLists(sourceList.list || [], playlist.list || [])
      const sourceUpdateTime = sourceList?.locationUpdateTime ?? 0
      if (targetUpdateTime >= sourceUpdateTime) return
      const currentIndex = newUserList.findIndex((list) => list.id === playlist.id)
      if (currentIndex < 0) return
      const [newList] = newUserList.splice(currentIndex, 1)
      newList.locationUpdateTime = targetUpdateTime
      newUserList.splice(Math.min(index, newUserList.length), 0, newList)
    } else if (targetUpdateTime) {
      newUserList.splice(Math.min(index, newUserList.length), 0, clone(playlist))
    } else {
      newUserList.push(clone(playlist))
    }
  })

  return newUserList
}

const hasListData = (data: LxListData) => (
  data.defaultList.length > 0 || data.loveList.length > 0 || data.userList.length > 0
)

const mergeListData = (localData: LxListData, remoteData: LxListData): LxListData => ({
  defaultList: mergeSongLists(localData.defaultList, remoteData.defaultList),
  loveList: mergeSongLists(localData.loveList, remoteData.loveList),
  userList: mergeUserLists(localData.userList, remoteData.userList),
})

const overwriteListData = (sourceListData: LxListData, targetListData: LxListData): LxListData => {
  const newListData: LxListData = {
    defaultList: clone(sourceListData.defaultList),
    loveList: clone(sourceListData.loveList),
    userList: clone(sourceListData.userList),
  }
  const sourceUserListIds = new Set(sourceListData.userList.map((list) => list.id))
  targetListData.userList.forEach((list, index) => {
    if (sourceUserListIds.has(list.id)) return
    if (list?.locationUpdateTime) {
      newListData.userList.splice(Math.min(index, newListData.userList.length), 0, clone(list))
    } else {
      newListData.userList.push(clone(list))
    }
  })
  return newListData
}

const normalizeListData = (value: unknown): LxListData => {
  const raw = (value && typeof value === 'object') ? value as Partial<LxListData> : {}
  return {
    defaultList: Array.isArray(raw.defaultList) ? raw.defaultList as LxMusicInfo[] : [],
    loveList: Array.isArray(raw.loveList) ? raw.loveList as LxMusicInfo[] : [],
    userList: Array.isArray(raw.userList) ? raw.userList as LxUserListInfoFull[] : [],
  }
}

const normalizeDislikeRules = (value: unknown) => (
  typeof value === 'string' ? value : ''
)

const mergeDislikeRules = (localRules: string, remoteRules: string) => {
  const merged = new Set<string>()
  for (const rule of `${localRules}\n${remoteRules}`.split(/\r?\n/)) {
    const normalized = rule.trim()
    if (!normalized) continue
    merged.add(normalized)
  }
  return Array.from(merged).join('\n')
}

const filterDislikeRules = (rules: string) => {
  const filtered = new Set<string>()
  for (const rule of normalizeDislikeRules(rules).split(/\r?\n/)) {
    const normalized = rule.trim()
    if (normalized) filtered.add(normalized)
  }
  return filtered
}

const getListDataKey = (listData: LxListData) => toMd5(JSON.stringify(normalizeListData(listData)))
const getDislikeDataKey = (rules: string) => toMd5(normalizeDislikeRules(rules).trim())
const isSameData = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const createUserListDataObj = (listData: LxListData) => {
  const userListDataObj = new Map<string, LxUserListInfoFull>()
  for (const list of listData.userList) userListDataObj.set(list.id, list)
  return userListDataObj
}

const selectSnapshotData = <T,>(snapshot: T | null | undefined, local: T, remote: T): T => (
  snapshot === local ? remote : local
)

const mergeSongListsFromSnapshot = (
  localList: LxMusicInfo[],
  remoteList: LxMusicInfo[],
  snapshotList: LxMusicInfo[],
) => {
  const removedListIds = new Set<string>()
  const localListItemIds = new Set(localList.map(getSongIdentity))
  const remoteListItemIds = new Set(remoteList.map(getSongIdentity))

  for (const song of snapshotList || []) {
    const key = getSongIdentity(song)
    if (!localListItemIds.has(key) || !remoteListItemIds.has(key)) removedListIds.add(key)
  }

  const map = new Map<string, LxMusicInfo>()
  const ids: string[] = []
  for (const item of [...localList, ...remoteList]) {
    const key = getSongIdentity(item)
    if (!key || map.has(key) || removedListIds.has(key)) continue
    ids.push(key)
    map.set(key, clone(item))
  }
  return ids.map((id) => map.get(id)!).filter(Boolean)
}

const mergeListDataFromSnapshot = (localListData: LxListData, remoteListData: LxListData, snapshot: LxListData): LxListData => {
  const newListData: LxListData = {
    defaultList: mergeSongListsFromSnapshot(localListData.defaultList, remoteListData.defaultList, snapshot.defaultList),
    loveList: mergeSongListsFromSnapshot(localListData.loveList, remoteListData.loveList, snapshot.loveList),
    userList: [],
  }

  const localUserListData = createUserListDataObj(localListData)
  const remoteUserListData = createUserListDataObj(remoteListData)
  const snapshotUserListData = createUserListDataObj(snapshot)
  const removedListIds = new Set<string>()
  const localUserListIds = new Set(localListData.userList.map((list) => list.id))
  const remoteUserListIds = new Set(remoteListData.userList.map((list) => list.id))

  for (const list of snapshot.userList) {
    if (!localUserListIds.has(list.id) || !remoteUserListIds.has(list.id)) removedListIds.add(list.id)
  }

  const newUserList: LxUserListInfoFull[] = []
  for (const list of localListData.userList) {
    if (removedListIds.has(list.id)) continue
    const remoteList = remoteUserListData.get(list.id)
    let newList: LxUserListInfoFull
    if (remoteList) {
      const snapshotList = snapshotUserListData.get(list.id) ?? {
        id: list.id,
        name: null as unknown as string,
        source: null as unknown as string,
        sourceListId: null as unknown as string,
        locationUpdateTime: null,
        list: [],
      }
      newList = {
        ...list,
        name: selectSnapshotData(snapshotList.name, list.name, remoteList.name),
        source: selectSnapshotData(snapshotList.source, list.source, remoteList.source),
        sourceListId: selectSnapshotData(snapshotList.sourceListId, list.sourceListId, remoteList.sourceListId),
        locationUpdateTime: list.locationUpdateTime,
        list: mergeSongListsFromSnapshot(list.list || [], remoteList.list || [], snapshotList.list || []),
      }
    } else {
      newList = clone(list)
    }
    newUserList.push(newList)
  }

  remoteListData.userList.forEach((list, index) => {
    if (removedListIds.has(list.id)) return
    const remoteUpdateTime = list?.locationUpdateTime ?? 0
    if (localUserListData.has(list.id)) {
      const localUpdateTime = localUserListData.get(list.id)?.locationUpdateTime ?? 0
      if (localUpdateTime >= remoteUpdateTime) return
      const currentIndex = newUserList.findIndex((item) => item.id === list.id)
      if (currentIndex < 0) return
      const [newList] = newUserList.splice(currentIndex, 1)
      newList.locationUpdateTime = localUpdateTime
      newUserList.splice(Math.min(index, newUserList.length), 0, newList)
    } else if (remoteUpdateTime) {
      newUserList.splice(Math.min(index, newUserList.length), 0, clone(list))
    } else {
      newUserList.push(clone(list))
    }
  })

  newListData.userList = newUserList
  return newListData
}

const mergeDislikeDataFromSnapshot = (localRules: string, remoteRules: string, snapshotRules: string) => {
  const removedRules = new Set<string>()
  const localRuleSet = filterDislikeRules(localRules)
  const remoteRuleSet = filterDislikeRules(remoteRules)

  for (const rule of filterDislikeRules(snapshotRules)) {
    if (!localRuleSet.has(rule) || !remoteRuleSet.has(rule)) removedRules.add(rule)
  }

  return Array.from(new Set([...localRuleSet, ...remoteRuleSet].filter((rule) => !removedRules.has(rule)))).join('\n')
}

const createDefaultSnapshotInfo = (): LxCompatSnapshotInfo => ({
  latest: null,
  time: 0,
  list: [],
  clients: {},
})

const createDefaultPersistedState = (): LxCompatPersistedState => ({
  serverId: randomBytes(16).toString('base64'),
  clients: {},
  clientAuthKeys: {},
  listSnapshotInfo: createDefaultSnapshotInfo(),
  dislikeSnapshotInfo: createDefaultSnapshotInfo(),
  listSnapshots: {},
  dislikeSnapshots: {},
})

const normalizeSnapshotInfo = (value: unknown): LxCompatSnapshotInfo => {
  const raw = value && typeof value === 'object' ? value as Partial<LxCompatSnapshotInfo> : {}
  return {
    latest: typeof raw.latest === 'string' && raw.latest ? raw.latest : null,
    time: Number.isFinite(raw.time) ? Number(raw.time) : 0,
    list: Array.isArray(raw.list) ? raw.list.filter((item): item is string => typeof item === 'string') : [],
    clients: raw.clients && typeof raw.clients === 'object'
      ? Object.fromEntries(Object.entries(raw.clients).filter((entry): entry is [string, LxCompatSnapshotClientInfo] => {
          const [, client] = entry
          return Boolean(client && typeof client === 'object' && typeof client.snapshotKey === 'string')
        }).map(([clientId, client]) => [clientId, {
          snapshotKey: client.snapshotKey,
          lastSyncDate: Number.isFinite(client.lastSyncDate) ? Number(client.lastSyncDate) : 0,
        }]))
      : {},
  }
}

const normalizeCompatPersistedState = (value: unknown): LxCompatPersistedState => {
  const fallback = createDefaultPersistedState()
  const raw = value && typeof value === 'object' ? value as Partial<LxCompatPersistedState> : {}
  return {
    serverId: typeof raw.serverId === 'string' && raw.serverId.trim() ? raw.serverId : fallback.serverId,
    clients: raw.clients && typeof raw.clients === 'object'
      ? raw.clients as Record<string, LxCompatClientKeyInfo>
      : {},
    clientAuthKeys: raw.clientAuthKeys && typeof raw.clientAuthKeys === 'object'
      ? raw.clientAuthKeys as Record<string, LxCompatClientStoredAuthKey>
      : {},
    listSnapshotInfo: normalizeSnapshotInfo(raw.listSnapshotInfo),
    dislikeSnapshotInfo: normalizeSnapshotInfo(raw.dislikeSnapshotInfo),
    listSnapshots: raw.listSnapshots && typeof raw.listSnapshots === 'object'
      ? Object.fromEntries(Object.entries(raw.listSnapshots).map(([key, value]) => [key, normalizeListData(value)]))
      : {},
    dislikeSnapshots: raw.dislikeSnapshots && typeof raw.dislikeSnapshots === 'object'
      ? Object.fromEntries(Object.entries(raw.dislikeSnapshots).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {},
  }
}

const getCompatStateFilePath = () => path.join(app.getPath('userData'), COMPAT_STATE_FILE)

const readCompatPersistedState = () => {
  try {
    const filePath = getCompatStateFilePath()
    if (!fs.existsSync(filePath)) return createDefaultPersistedState()
    const raw = fs.readFileSync(filePath, 'utf8').trim()
    if (!raw) return createDefaultPersistedState()
    return normalizeCompatPersistedState(JSON.parse(raw))
  } catch {
    return createDefaultPersistedState()
  }
}

let compatPersistWriteQueue = Promise.resolve()

const writeCompatPersistedState = (state: LxCompatPersistedState) => {
  const payload = JSON.stringify(state, null, 2)
  compatPersistWriteQueue = compatPersistWriteQueue
    .catch(() => {})
    .then(() => fs.promises.writeFile(getCompatStateFilePath(), payload))
    .catch((error) => {
      console.warn('[data-sync][lx-compat] persist failed:', error)
    })
}

const getPromptWindow = () => (
  BrowserWindow.getFocusedWindow()
  ?? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
  ?? null
)

const chooseListSyncMode = async(deviceName: string, defaultMode: DataSyncConflictResolutionMode | null): Promise<LxListSyncMode> => {
  if (defaultMode) return defaultMode

  const promptWindow = getPromptWindow()
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    buttons: [
      '本地合并远端',
      '远端合并本地',
      '本地覆盖远端',
      '远端覆盖本地',
      '取消同步',
    ],
    defaultId: 0,
    cancelId: 4,
    noLink: true,
    title: '数据同步',
    message: `检测到本地与「${deviceName}」都已有歌单/收藏数据`,
    detail: '请选择同步方式：\n\n本地合并远端：保留本地为主，把手机端不同内容并进来\n远端合并本地：保留手机端为主，把本地不同内容并进来\n本地覆盖远端：用本地内容替换手机端\n远端覆盖本地：用手机端内容替换本地',
  }
  const result = promptWindow
    ? await dialog.showMessageBox(promptWindow, options)
    : await dialog.showMessageBox(options)

  switch (result.response) {
    case 0:
      return 'merge_local_remote'
    case 1:
      return 'merge_remote_local'
    case 2:
      return 'overwrite_local_remote'
    case 3:
      return 'overwrite_remote_local'
    default:
      return 'cancel'
  }
}

const chooseDislikeSyncMode = async(deviceName: string, defaultMode: DataSyncConflictResolutionMode | null): Promise<LxDislikeSyncMode> => {
  if (defaultMode) return defaultMode

  const promptWindow = getPromptWindow()
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    buttons: [
      '合并屏蔽规则',
      '本地覆盖远端',
      '远端覆盖本地',
      '取消同步',
    ],
    defaultId: 0,
    cancelId: 3,
    noLink: true,
    title: '数据同步',
    message: `检测到本地与「${deviceName}」都已有屏蔽规则`,
    detail: '请选择同步方式：\n\n合并屏蔽规则：合并两边规则并去重\n本地覆盖远端：用本地规则替换手机端\n远端覆盖本地：用手机端规则替换本地',
  }
  const result = promptWindow
    ? await dialog.showMessageBox(promptWindow, options)
    : await dialog.showMessageBox(options)

  switch (result.response) {
    case 0:
      return 'merge_local_remote'
    case 1:
      return 'overwrite_local_remote'
    case 2:
      return 'overwrite_remote_local'
    default:
      return 'cancel'
  }
}

const buildLxListData = (snapshot: DataSyncSnapshotData): LxListData => {
  const favorites = Array.isArray(snapshot.user.favorites) ? snapshot.user.favorites as any[] : []
  const playlists = Array.isArray(snapshot.user.playlists) ? snapshot.user.playlists as any[] : []
  const onlinePlaylists = Array.isArray(snapshot.user.onlinePlaylists) ? snapshot.user.onlinePlaylists as any[] : []

  return {
    defaultList: [],
    loveList: favorites.map(toLxMusicInfo),
    userList: [
      ...playlists.map((playlist) => ({
        id: String(playlist.id),
        name: playlist.name || '未命名歌单',
        locationUpdateTime: Date.parse(playlist.updatedAt || playlist.createdAt || '') || Date.now(),
        list: Array.isArray(playlist.songs) ? playlist.songs.map(toLxMusicInfo) : [],
      })),
      ...onlinePlaylists.map((playlist) => ({
        id: String(playlist.id),
        name: playlist.name || '未命名歌单',
        source: toLxSource(playlist.source || 'netease'),
        sourceListId: String(playlist.sourceId || playlist.id),
        locationUpdateTime: Date.parse(playlist.lastSyncedAt || playlist.importedAt || '') || Date.now(),
        list: Array.isArray(playlist.songs) ? playlist.songs.map((song: any) => toLxMusicInfo({
          ...song,
          artist: song.artist || song.singer,
          platform: song.platform,
        })) : [],
      })),
    ],
  }
}

const applyLxListDataToSnapshot = (currentSnapshot: DataSyncSnapshotData, listData: LxListData): DataSyncSnapshotData => {
  const nextSnapshot = clone(currentSnapshot)
  const userLists = Array.isArray(listData.userList) ? listData.userList : []

  nextSnapshot.user.favorites = listData.loveList.map(fromLxMusicInfo)
  nextSnapshot.user.playlists = userLists
    .filter((playlist) => !playlist.source || !playlist.sourceListId)
    .map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      description: '',
      cover: playlist.list[0]?.meta?.picUrl || '',
      songs: playlist.list.map(fromLxMusicInfo),
      songCount: playlist.list.length,
      createdAt: new Date(playlist.locationUpdateTime || Date.now()).toISOString(),
      updatedAt: new Date(playlist.locationUpdateTime || Date.now()).toISOString(),
      isPublic: false,
    }))
  nextSnapshot.user.onlinePlaylists = userLists
    .filter((playlist) => Boolean(playlist.source && playlist.sourceListId))
    .map((playlist) => ({
      id: playlist.id,
      sourceId: String(playlist.sourceListId || playlist.id),
      source: fromLxSource(String(playlist.source || 'wy')),
      name: playlist.name,
      cover: playlist.list[0]?.meta?.picUrl || undefined,
      songs: playlist.list.map((song) => {
        const normalized = fromLxMusicInfo(song)
        return {
          id: normalized.id,
          name: normalized.name,
          artist: normalized.artist,
          album: normalized.album,
          duration: normalized.duration,
          cover: normalized.cover,
          platform: normalized.platform,
          types: [],
        }
      }),
      songCount: playlist.list.length,
      importedAt: new Date(playlist.locationUpdateTime || Date.now()).toISOString(),
      externalType: 'playlist',
      autoUpdate: false,
      lastSyncedAt: new Date(playlist.locationUpdateTime || Date.now()).toISOString(),
      lastSyncError: null,
    }))

  return nextSnapshot
}

const applyDislikeRulesToSnapshot = (currentSnapshot: DataSyncSnapshotData, dislikeRules: string): DataSyncSnapshotData => {
  const nextSnapshot = clone(currentSnapshot)
  nextSnapshot.feature.dislikeRules = dislikeRules
  return nextSnapshot
}

const getLxListById = (listData: LxListData, listId: string, createIfMissing = false) => {
  if (listId === 'default') return listData.defaultList
  if (listId === 'love') return listData.loveList

  let userList = listData.userList.find((item) => item.id === listId)
  if (!userList && createIfMissing) {
    userList = {
      id: listId,
      name: '未命名歌单',
      locationUpdateTime: Date.now(),
      list: [],
    }
    listData.userList.push(userList)
  }
  return userList?.list || null
}

const dedupeLxSongsForAppend = (targetList: LxMusicInfo[], songs: LxMusicInfo[]) => {
  const existingIds = new Set(targetList.map((song) => song.id))
  return songs.filter((song) => {
    if (existingIds.has(song.id)) return false
    existingIds.add(song.id)
    return true
  })
}

const insertLxSongs = (targetList: LxMusicInfo[], songs: LxMusicInfo[], location: unknown) => {
  const nextSongs = dedupeLxSongsForAppend(targetList, songs)
  if (!nextSongs.length) return
  if (location === 'top') {
    targetList.unshift(...nextSongs)
  } else {
    targetList.push(...nextSongs)
  }
}

const reorderLxUserLists = (listData: LxListData, position: number, ids: string[]) => {
  const moveIds = new Set(ids)
  const moving: LxUserListInfoFull[] = []
  const remaining = listData.userList.filter((list) => {
    if (!moveIds.has(list.id)) return true
    moving.push({
      ...list,
      locationUpdateTime: Date.now(),
    })
    return false
  })
  remaining.splice(Math.min(Math.max(position, 0), remaining.length), 0, ...moving)
  listData.userList = remaining
}

const applyLxListAction = (listData: LxListData, action: any): LxListData => {
  const nextData = normalizeListData(clone(listData))
  const actionName = action?.action
  const payload = action?.data

  switch (actionName) {
    case 'list_data_overwrite':
      return normalizeListData(payload)
    case 'list_create': {
      const listInfos = Array.isArray(payload?.listInfos) ? payload.listInfos : []
      const position = Number.isFinite(payload?.position) ? Number(payload.position) : nextData.userList.length
      const newLists = listInfos
        .filter((listInfo: any) => listInfo?.id && !nextData.userList.some((item) => item.id === String(listInfo.id)))
        .map((listInfo: any) => ({
          id: String(listInfo.id),
          name: listInfo.name || '未命名歌单',
          source: listInfo.source,
          sourceListId: listInfo.sourceListId,
          locationUpdateTime: Number.isFinite(listInfo.locationUpdateTime) ? Number(listInfo.locationUpdateTime) : Date.now(),
          list: [],
        }))
      nextData.userList.splice(Math.min(Math.max(position, 0), nextData.userList.length), 0, ...newLists)
      return nextData
    }
    case 'list_remove': {
      const removeIds = new Set(Array.isArray(payload) ? payload.map((id) => String(id)) : [])
      nextData.userList = nextData.userList.filter((list) => !removeIds.has(list.id))
      return nextData
    }
    case 'list_update': {
      const updates = Array.isArray(payload) ? payload : []
      for (const update of updates) {
        const target = nextData.userList.find((list) => list.id === String(update?.id || ''))
        if (!target) continue
        target.name = update.name || target.name
        target.source = update.source
        target.sourceListId = update.sourceListId
        target.locationUpdateTime = Number.isFinite(update.locationUpdateTime) ? Number(update.locationUpdateTime) : Date.now()
      }
      return nextData
    }
    case 'list_update_position':
      reorderLxUserLists(nextData, Number(payload?.position) || 0, Array.isArray(payload?.ids) ? payload.ids.map((id: unknown) => String(id)) : [])
      return nextData
    case 'list_music_add': {
      const targetList = getLxListById(nextData, String(payload?.id || ''), true)
      if (targetList) insertLxSongs(targetList, normalizeListData({ defaultList: payload?.musicInfos }).defaultList, payload?.addMusicLocationType)
      return nextData
    }
    case 'list_music_move': {
      const songs = normalizeListData({ defaultList: payload?.musicInfos }).defaultList
      const songIds = new Set(songs.map((song) => song.id))
      const fromList = getLxListById(nextData, String(payload?.fromId || ''), false)
      if (fromList) {
        const filtered = fromList.filter((song) => !songIds.has(song.id))
        fromList.splice(0, fromList.length, ...filtered)
      }
      const toList = getLxListById(nextData, String(payload?.toId || ''), true)
      if (toList) insertLxSongs(toList, songs, payload?.addMusicLocationType)
      return nextData
    }
    case 'list_music_remove': {
      const targetList = getLxListById(nextData, String(payload?.listId || ''), false)
      const ids = new Set(Array.isArray(payload?.ids) ? payload.ids.map((id: unknown) => String(id)) : [])
      if (targetList) {
        const filtered = targetList.filter((song) => !ids.has(song.id))
        targetList.splice(0, targetList.length, ...filtered)
      }
      return nextData
    }
    case 'list_music_update': {
      const updates = Array.isArray(payload) ? payload : []
      for (const update of updates) {
        const targetList = getLxListById(nextData, String(update?.id || ''), false)
        if (!targetList || !update?.musicInfo) continue
        const index = targetList.findIndex((song) => song.id === String(update.musicInfo.id || ''))
        if (index < 0) continue
        targetList.splice(index, 1, {
          ...targetList[index],
          ...update.musicInfo,
          meta: {
            ...(targetList[index].meta || {}),
            ...(update.musicInfo.meta || {}),
          },
        })
      }
      return nextData
    }
    case 'list_music_update_position': {
      const targetList = getLxListById(nextData, String(payload?.listId || ''), false)
      if (!targetList) return nextData
      const ids: string[] = Array.isArray(payload?.ids) ? payload.ids.map((id: unknown) => String(id)) : []
      const idSet = new Set(ids)
      const byId = new Map<string, LxMusicInfo>(targetList.map((song: LxMusicInfo) => [song.id, song]))
      const moving = ids.map((id: string) => byId.get(id)).filter((song: LxMusicInfo | undefined): song is LxMusicInfo => Boolean(song))
      const remaining = targetList.filter((song: LxMusicInfo) => !idSet.has(song.id))
      remaining.splice(Math.min(Math.max(Number(payload?.position) || 0, 0), remaining.length), 0, ...moving)
      targetList.splice(0, targetList.length, ...remaining)
      return nextData
    }
    case 'list_music_overwrite': {
      const targetList = getLxListById(nextData, String(payload?.listId || ''), true)
      if (targetList) {
        targetList.splice(0, targetList.length, ...normalizeListData({ defaultList: payload?.musicInfos }).defaultList)
      }
      return nextData
    }
    case 'list_music_clear': {
      const ids = Array.isArray(payload) ? payload.map((id) => String(id)) : []
      for (const id of ids) {
        const targetList = getLxListById(nextData, id, false)
        if (targetList) targetList.splice(0, targetList.length)
      }
      return nextData
    }
    default:
      return nextData
  }
}

const applyLxDislikeAction = (rules: string, action: any) => {
  switch (action?.action) {
    case 'dislike_data_overwrite':
      return normalizeDislikeRules(action.data)
    case 'dislike_music_add': {
      const additions = Array.isArray(action.data)
        ? action.data.map((item: any) => `${item?.name || ''}@${item?.singer || ''}`)
        : []
      return mergeDislikeRules(rules, additions.join('\n'))
    }
    case 'dislike_music_clear':
      return ''
    default:
      return rules
  }
}

const createClientKeyInfo = (deviceName: string, isMobile: boolean): LxCompatClientKeyInfo => ({
  clientId: randomBytes(16).toString('base64'),
  key: randomBytes(16).toString('base64'),
  deviceName,
  isMobile,
  lastConnectDate: 0,
})

export class DataSyncLxCompatClient {
  private readonly options: LxCompatClientOptions
  private socket: LxCompatClientSocket | null = null
  private connectSerial = 0
  private persisted: LxCompatPersistedState

  constructor(options: LxCompatClientOptions) {
    this.options = options
    this.persisted = readCompatPersistedState()
  }

  private getCurrentSnapshotOrDefault() {
    return clone(this.options.getCurrentSnapshotData() || emptySnapshot())
  }

  private setLastError(message: string | null) {
    this.options.onError?.(message)
  }

  isConnected() {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN && this.socket.isReady)
  }

  getDeviceInfo(): DataSyncDeviceInfo | null {
    if (!this.socket?.keyInfo) return null
    return {
      deviceId: this.socket.keyInfo.clientId,
      deviceName: this.socket.keyInfo.serverName || 'LX Sync Server',
      platform: 'lx-server',
      version: 'lx-sync',
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
    }
  }

  private persistState() {
    writeCompatPersistedState(this.persisted)
  }

  private saveAuthKey(serverId: string, keyInfo: LxCompatClientAuthInfo) {
    this.persisted.clientAuthKeys[serverId] = {
      clientId: keyInfo.clientId,
      key: keyInfo.key,
      serverName: keyInfo.serverName,
    }
    this.persistState()
  }

  private async authWithStoredKey(clientHost: string, keyInfo: LxCompatClientStoredAuthKey) {
    const authMessage = aesEncrypt(`${AUTH_MSG}${this.options.getDeviceName()}`, keyInfo.key)
    const authResponse = await requestText(createCompatHttpUrl(clientHost, '/ah'), {
      headers: {
        i: keyInfo.clientId,
        m: authMessage,
      },
    })
    if (authResponse.statusCode !== 200) throw new Error('LX 同步已保存认证无效')

    let text: string
    try {
      text = aesDecrypt(authResponse.text.trim(), keyInfo.key)
    } catch {
      throw new Error('LX 同步已保存认证解析失败')
    }
    if (text !== HELLO_MSG) throw new Error('LX 同步已保存认证无效')
  }

  private async authWithConnectionCode(clientHost: string, serverId: string, connectionCode: string): Promise<LxCompatClientAuthInfo> {
    if (!connectionCode.trim()) throw new Error('请先填写连接码')

    let authKey = toMd5(connectionCode).substring(0, 16)
    authKey = Buffer.from(authKey).toString('base64')

    const { publicKey, privateKey } = await generateRsaKeyPair()
    const publicKeyBody = publicKey
      .replace(/\n/g, '')
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
    const authMessage = aesEncrypt(`${AUTH_MSG}\n${publicKeyBody}\n${this.options.getDeviceName()}\nlx_music_desktop`, authKey)
    const authResponse = await requestText(createCompatHttpUrl(clientHost, '/ah'), {
      headers: { m: authMessage },
    })

    const responseText = authResponse.text.trim()
    if (responseText === BLOCKED_IP) {
      throw new Error('LX 同步服务已暂时阻止当前 IP，请稍后再试')
    }
    if (responseText === AUTH_FAILED || authResponse.statusCode !== 200) {
      throw new Error('LX 同步连接码无效或已过期')
    }

    let parsed: Partial<LxCompatClientAuthInfo>
    try {
      parsed = JSON.parse(rsaDecrypt(Buffer.from(responseText, 'base64'), privateKey)) as Partial<LxCompatClientAuthInfo>
    } catch {
      throw new Error('LX 同步认证响应解析失败')
    }

    if (!parsed.clientId || !parsed.key) {
      throw new Error('LX 同步认证响应缺少客户端密钥')
    }

    const keyInfo = {
      clientId: parsed.clientId,
      key: parsed.key,
      serverName: parsed.serverName || 'LX Sync Server',
    }
    this.saveAuthKey(serverId, keyInfo)
    return keyInfo
  }

  private async auth(clientHost: string, connectionCode?: string, forceCodeAuth = false): Promise<LxCompatClientAuthInfo> {
    const helloResponse = await requestText(createCompatHttpUrl(clientHost, '/hello'))
    if (helloResponse.statusCode !== 200 || helloResponse.text.trim() !== HELLO_MSG) {
      throw new Error(`LX 同步服务握手失败 (${helloResponse.statusCode || '无状态码'})`)
    }

    const idResponse = await requestText(createCompatHttpUrl(clientHost, '/id'))
    if (idResponse.statusCode !== 200 || !idResponse.text.startsWith(ID_PREFIX)) {
      throw new Error(`LX 同步服务 ID 获取失败 (${idResponse.statusCode || '无状态码'})`)
    }
    const serverId = idResponse.text.slice(ID_PREFIX.length)

    const storedKey = this.persisted.clientAuthKeys[serverId]
    if (!forceCodeAuth && storedKey) {
      await this.authWithStoredKey(clientHost, storedKey)
      return storedKey
    }

    return this.authWithConnectionCode(clientHost, serverId, connectionCode || '')
  }

  async connect(clientHost: string, connectionCode?: string, forceCodeAuth = false) {
    await this.disconnect()
    const serial = ++this.connectSerial
    this.setLastError(null)

    const keyInfo = await this.auth(clientHost, connectionCode, forceCodeAuth)
    if (serial !== this.connectSerial) throw new Error('LX 同步连接已取消')

    const socketUrl = createCompatSocketUrl(clientHost)
    socketUrl.searchParams.set('i', keyInfo.clientId)
    socketUrl.searchParams.set('t', aesEncrypt(CONNECT_MSG, keyInfo.key))

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let initialized = false
      const socket = new WebSocket(socketUrl.toString()) as LxCompatClientSocket
      const timeout = setTimeout(() => {
        fail(new Error('LX 同步连接超时'))
        try {
          socket.close(CLOSE_CODE_FAILED)
        } catch {}
      }, 120000)

      const fail = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.setLastError(error.message)
        reject(error)
      }

      const succeed = () => {
        if (settled) return
        settled = true
        initialized = true
        clearTimeout(timeout)
        this.setLastError(null)
        this.options.onStatusChanged()
        resolve()
      }

      socket.keyInfo = keyInfo
      socket.isReady = false
      socket.moduleReadys = {
        list: false,
        dislike: false,
      }
      socket.feature = {
        list: false,
        dislike: false,
      }

      const message2call = createMsg2call<any>({
        funcsObj: {
          getEnabledFeatures: async(activeSocket: LxCompatClientSocket, _serverType: string, supportedFeatures: Record<string, number>) => {
            const features: Record<string, false | { skipSnapshot: boolean }> = {}
            if (supportedFeatures?.list === 1) features.list = { skipSnapshot: false }
            if (supportedFeatures?.dislike === 1) features.dislike = { skipSnapshot: false }
            activeSocket.feature = {
              list: features.list || false,
              dislike: features.dislike || false,
            }
            return features
          },
          finished: async(activeSocket: LxCompatClientSocket) => {
            activeSocket.isReady = true
            succeed()
          },
          onFeatureChanged: async(activeSocket: LxCompatClientSocket, feature: any) => {
            if (feature?.list != null) {
              activeSocket.feature.list = feature.list
              activeSocket.moduleReadys.list = false
            }
            if (feature?.dislike != null) {
              activeSocket.feature.dislike = feature.dislike
              activeSocket.moduleReadys.dislike = false
            }
          },
          onListSyncAction: async(activeSocket: LxCompatClientSocket, action: any) => {
            if (!activeSocket.moduleReadys.list) return
            await this.handleIncomingListAction(activeSocket, action)
          },
          onDislikeSyncAction: async(activeSocket: LxCompatClientSocket, action: any) => {
            if (!activeSocket.moduleReadys.dislike) return
            await this.handleIncomingDislikeAction(activeSocket, action)
          },
          list_sync_get_md5: async() => (
            toMd5(JSON.stringify(buildLxListData(this.getCurrentSnapshotOrDefault())))
          ),
          list_sync_get_sync_mode: async() => (
            chooseListSyncMode(keyInfo.serverName, this.options.getDefaultSyncMode())
          ),
          list_sync_get_list_data: async() => (
            buildLxListData(this.getCurrentSnapshotOrDefault())
          ),
          list_sync_set_list_data: async(_socket: LxCompatClientSocket, data: unknown) => {
            const nextSnapshot = applyLxListDataToSnapshot(this.getCurrentSnapshotOrDefault(), normalizeListData(data))
            this.options.setCurrentSnapshotData(nextSnapshot, keyInfo.clientId, keyInfo.serverName)
          },
          list_sync_finished: async(activeSocket: LxCompatClientSocket) => {
            activeSocket.moduleReadys.list = true
          },
          dislike_sync_get_md5: async() => (
            toMd5(normalizeDislikeRules(this.getCurrentSnapshotOrDefault().feature.dislikeRules).trim())
          ),
          dislike_sync_get_sync_mode: async() => (
            chooseDislikeSyncMode(keyInfo.serverName, this.options.getDefaultSyncMode())
          ),
          dislike_sync_get_list_data: async() => (
            normalizeDislikeRules(this.getCurrentSnapshotOrDefault().feature.dislikeRules)
          ),
          dislike_sync_set_list_data: async(_socket: LxCompatClientSocket, data: unknown) => {
            const nextSnapshot = applyDislikeRulesToSnapshot(this.getCurrentSnapshotOrDefault(), normalizeDislikeRules(data))
            this.options.setCurrentSnapshotData(nextSnapshot, keyInfo.clientId, keyInfo.serverName)
          },
          dislike_sync_finished: async(activeSocket: LxCompatClientSocket) => {
            activeSocket.moduleReadys.dislike = true
          },
        },
        timeout: 120000,
        sendMessage: (data: unknown) => {
          void encodeCompatMessage(JSON.stringify(data)).then((payload) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(payload)
            }
          }).catch((error) => {
            console.warn('[data-sync][lx-compat-client] send message failed:', error)
            socket.close(CLOSE_CODE_FAILED)
          })
        },
        onCallBeforeParams: (rawArgs: any[]) => [socket, ...rawArgs],
        onError: (error: Error, path: string[], groupName: string | null) => {
          console.warn('[data-sync][lx-compat-client] call error:', groupName, path.join('.'), error.message)
        },
      })

      socket.remote = message2call.remote
      socket.remoteQueueList = message2call.createQueueRemote<any>('list')
      socket.remoteQueueDislike = message2call.createQueueRemote<any>('dislike')
      socket.cleanup = () => {
        message2call.destroy()
      }

      socket.on('open', () => {
        this.options.onStatusChanged()
      })

      socket.on('message', (raw) => {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8')
        if (text === 'ping') return
        void decodeCompatMessage(text).then((payload) => {
          message2call.message(JSON.parse(payload))
        }).catch((error) => {
          console.warn('[data-sync][lx-compat-client] decode message failed:', error)
          socket.close(CLOSE_CODE_FAILED)
        })
      })

      socket.on('unexpected-response', (_request, response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          body += chunk
        })
        response.on('end', () => {
          fail(new Error(body.trim() ? `LX 同步服务返回 ${response.statusCode}: ${body.trim()}` : `LX 同步服务返回 ${response.statusCode || '未知状态码'}`))
        })
      })

      socket.on('error', (error) => {
        const message = error instanceof Error ? error.message : 'LX 同步客户端连接失败'
        if (!initialized) {
          fail(new Error(message))
          return
        }
        this.setLastError(message)
        this.options.onStatusChanged()
      })

      socket.on('close', (code, reason) => {
        clearTimeout(timeout)
        socket.cleanup()
        if (this.socket === socket) {
          this.socket = null
        }
        this.options.onStatusChanged()

        if (!initialized) {
          const detail = reason.toString('utf8') || (code ? `关闭码 ${code}` : '连接已关闭')
          fail(new Error(`LX 同步连接失败：${detail}`))
          return
        }

        if (code !== 1000) {
          this.options.onDisconnected?.()
        }
      })

      this.socket = socket
    })
  }

  async disconnect() {
    ++this.connectSerial
    const socket = this.socket
    this.socket = null
    if (!socket) return
    try {
      socket.cleanup?.()
    } catch {}
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      try {
        socket.close(1000)
      } catch {}
    }
    this.options.onStatusChanged()
  }

  private async handleIncomingListAction(socket: LxCompatClientSocket, action: any) {
    const currentListData = buildLxListData(this.getCurrentSnapshotOrDefault())
    const nextListData = applyLxListAction(currentListData, action)
    const nextSnapshot = applyLxListDataToSnapshot(this.getCurrentSnapshotOrDefault(), nextListData)
    this.options.setCurrentSnapshotData(nextSnapshot, socket.keyInfo.clientId, socket.keyInfo.serverName)
  }

  private async handleIncomingDislikeAction(socket: LxCompatClientSocket, action: any) {
    const currentRules = normalizeDislikeRules(this.getCurrentSnapshotOrDefault().feature.dislikeRules)
    const nextRules = applyLxDislikeAction(currentRules, action)
    const nextSnapshot = applyDislikeRulesToSnapshot(this.getCurrentSnapshotOrDefault(), nextRules)
    this.options.setCurrentSnapshotData(nextSnapshot, socket.keyInfo.clientId, socket.keyInfo.serverName)
  }

  onSnapshotUpdated(snapshotData: DataSyncSnapshotData, sourceId?: string) {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN || !socket.isReady) return
    if (sourceId === socket.keyInfo.clientId) return

    if (socket.moduleReadys.list && socket.feature.list) {
      void socket.remoteQueueList.onListSyncAction({
        action: 'list_data_overwrite',
        data: buildLxListData(snapshotData),
      }).catch((error: Error) => {
        console.warn('[data-sync][lx-compat-client] push list overwrite failed:', error)
        socket.close(CLOSE_CODE_FAILED)
      })
    }

    if (socket.moduleReadys.dislike && socket.feature.dislike) {
      void socket.remoteQueueDislike.onDislikeSyncAction({
        action: 'dislike_data_overwrite',
        data: normalizeDislikeRules(snapshotData.feature.dislikeRules),
      }).catch((error: Error) => {
        console.warn('[data-sync][lx-compat-client] push dislike overwrite failed:', error)
        socket.close(CLOSE_CODE_FAILED)
      })
    }
  }
}

export class DataSyncLxCompatBridge {
  private readonly options: LxCompatBridgeOptions
  private compatWsServer: WebSocketServer | null = null
  private readonly peers = new Set<LxCompatPeer>()
  private pingTimer: NodeJS.Timeout | null = null
  private requestIps = new Map<string, number>()
  private persisted: LxCompatPersistedState

  constructor(options: LxCompatBridgeOptions) {
    this.options = options
    this.persisted = this.loadPersistedState()
  }

  private loadPersistedState(): LxCompatPersistedState {
    return readCompatPersistedState()
  }

  private persistState() {
    writeCompatPersistedState(this.persisted)
  }

  private getRequestIp(req: http.IncomingMessage) {
    return req.socket.remoteAddress || null
  }

  private getAvailableIp(req: http.IncomingMessage) {
    const ip = this.getRequestIp(req)
    if (!ip) return null
    return (this.requestIps.get(ip) ?? 0) < 10 ? ip : null
  }

  private getCurrentSnapshotOrDefault() {
    return clone(this.options.getCurrentSnapshotData() || emptySnapshot())
  }

  private clearOldSnapshots(type: 'list' | 'dislike') {
    const info = type === 'list' ? this.persisted.listSnapshotInfo : this.persisted.dislikeSnapshotInfo
    const referencedKeys = new Set<string>([
      ...(info.latest ? [info.latest] : []),
      ...Object.values(info.clients).map((client) => client.snapshotKey).filter(Boolean),
    ])
    const removableKeys = info.list.filter((key) => !referencedKeys.has(key))
    while (removableKeys.length > MAX_COMPAT_SNAPSHOT_COUNT) {
      const key = removableKeys.pop()
      if (!key) break
      if (type === 'list') {
        delete this.persisted.listSnapshots[key]
      } else {
        delete this.persisted.dislikeSnapshots[key]
      }
      const index = info.list.indexOf(key)
      if (index >= 0) info.list.splice(index, 1)
    }
  }

  private createListSnapshot(listData: LxListData) {
    const normalized = normalizeListData(listData)
    const key = getListDataKey(normalized)
    const info = this.persisted.listSnapshotInfo
    this.persisted.listSnapshots[key] = clone(normalized)
    if (info.latest !== key) {
      if (info.latest && !info.list.includes(info.latest)) info.list.unshift(info.latest)
      const existingIndex = info.list.indexOf(key)
      if (existingIndex >= 0) info.list.splice(existingIndex, 1)
      info.latest = key
      info.time = Date.now()
    }
    this.clearOldSnapshots('list')
    this.persistState()
    return key
  }

  private createDislikeSnapshot(dislikeRules: string) {
    const normalized = normalizeDislikeRules(dislikeRules)
    const key = getDislikeDataKey(normalized)
    const info = this.persisted.dislikeSnapshotInfo
    this.persisted.dislikeSnapshots[key] = normalized
    if (info.latest !== key) {
      if (info.latest && !info.list.includes(info.latest)) info.list.unshift(info.latest)
      const existingIndex = info.list.indexOf(key)
      if (existingIndex >= 0) info.list.splice(existingIndex, 1)
      info.latest = key
      info.time = Date.now()
    }
    this.clearOldSnapshots('dislike')
    this.persistState()
    return key
  }

  private updateDeviceListSnapshotKey(clientId: string, snapshotKey: string) {
    this.persisted.listSnapshotInfo.clients[clientId] = {
      snapshotKey,
      lastSyncDate: Date.now(),
    }
    this.persistState()
  }

  private updateDeviceDislikeSnapshotKey(clientId: string, snapshotKey: string) {
    this.persisted.dislikeSnapshotInfo.clients[clientId] = {
      snapshotKey,
      lastSyncDate: Date.now(),
    }
    this.persistState()
  }

  private getDeviceListSnapshot(clientId: string) {
    const snapshotKey = this.persisted.listSnapshotInfo.clients[clientId]?.snapshotKey
    if (!snapshotKey) return null
    const snapshot = this.persisted.listSnapshots[snapshotKey]
    return snapshot ? normalizeListData(snapshot) : null
  }

  private getDeviceDislikeSnapshot(clientId: string) {
    const snapshotKey = this.persisted.dislikeSnapshotInfo.clients[clientId]?.snapshotKey
    if (!snapshotKey) return null
    return typeof this.persisted.dislikeSnapshots[snapshotKey] === 'string'
      ? this.persisted.dislikeSnapshots[snapshotKey]
      : null
  }

  private getClientKeyInfo(clientId?: string | null) {
    if (!clientId) return null
    return this.persisted.clients[clientId] || null
  }

  private saveClientKeyInfo(keyInfo: LxCompatClientKeyInfo) {
    this.persisted.clients[keyInfo.clientId] = keyInfo
    this.persistState()
    this.updateDevices()
  }

  private removePeer(peer: LxCompatPeer) {
    this.peers.delete(peer)
    this.updateDevices()
  }

  removeDevice(clientId: string) {
    const peer = Array.from(this.peers).find((item) => item.keyInfo.clientId === clientId)
    if (peer) {
      try {
        peer.close()
      } catch {}
      this.peers.delete(peer)
    }
    if (this.persisted.clients[clientId]) {
      delete this.persisted.clients[clientId]
    }
    if (this.persisted.listSnapshotInfo.clients[clientId]) {
      delete this.persisted.listSnapshotInfo.clients[clientId]
    }
    if (this.persisted.dislikeSnapshotInfo.clients[clientId]) {
      delete this.persisted.dislikeSnapshotInfo.clients[clientId]
    }
    this.persistState()
    this.updateDevices()
  }

  getTrustedDevices(): DataSyncDeviceInfo[] {
    return Object.values(this.persisted.clients)
      .sort((left, right) => (right.lastConnectDate || 0) - (left.lastConnectDate || 0))
      .map((client) => ({
        deviceId: client.clientId,
        deviceName: client.deviceName,
        platform: client.isMobile ? 'mobile' : 'desktop',
        version: client.isMobile ? 'lx-mobile' : 'lx-desktop',
        connectedAt: client.lastConnectDate || 0,
        lastSeenAt: client.lastConnectDate || 0,
      }))
  }

  private updateDevices() {
    const devices = Array.from(this.peers).map((peer) => ({
      deviceId: peer.keyInfo.clientId,
      deviceName: peer.keyInfo.deviceName,
      platform: peer.keyInfo.isMobile ? 'mobile' : 'desktop',
      version: peer.keyInfo.isMobile ? 'lx-mobile' : 'lx-desktop',
      connectedAt: peer.keyInfo.lastConnectDate || Date.now(),
      lastSeenAt: peer.keyInfo.lastConnectDate || Date.now(),
    }))
    this.options.onDevicesChanged(devices, this.getTrustedDevices())
  }

  private verifyByKey(encryptMsg: string, clientId: string) {
    const keyInfo = this.getClientKeyInfo(clientId)
    if (!keyInfo) return null

    let text: string
    try {
      text = aesDecrypt(encryptMsg, keyInfo.key)
    } catch {
      return null
    }

    if (!text.startsWith(AUTH_MSG)) return null
    const deviceName = text.replace(AUTH_MSG, '') || 'Unknown'
    if (deviceName !== keyInfo.deviceName) {
      keyInfo.deviceName = deviceName
      this.saveClientKeyInfo(keyInfo)
    }
    return aesEncrypt(HELLO_MSG, keyInfo.key)
  }

  private verifyByCode(encryptMsg: string, password: string) {
    let key = toMd5(password).substring(0, 16)
    key = Buffer.from(key).toString('base64')

    let text: string
    try {
      text = aesDecrypt(encryptMsg, key)
    } catch {
      return null
    }

    if (!text.startsWith(AUTH_MSG)) return null
    const parts = text.split('\n')
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${parts[1]}\n-----END PUBLIC KEY-----`
    const deviceName = parts[2] || 'Unknown'
    const isMobile = parts[3] === 'lx_music_mobile'
    const keyInfo = createClientKeyInfo(deviceName, isMobile)
    this.saveClientKeyInfo(keyInfo)
    return rsaEncrypt(Buffer.from(JSON.stringify({
      clientId: keyInfo.clientId,
      key: keyInfo.key,
      serverName: app.name || 'Sollin',
    })), publicKey)
  }

  private verifyConnection(encryptMsg: string, clientId: string) {
    const keyInfo = this.getClientKeyInfo(clientId)
    if (!keyInfo) return false

    let text: string
    try {
      text = aesDecrypt(encryptMsg, keyInfo.key)
    } catch {
      return false
    }

    return text === CONNECT_MSG
  }

  handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)

    switch (requestUrl.pathname) {
      case '/hello':
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(HELLO_MSG)
        return true
      case '/id':
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(`${ID_PREFIX}${this.persisted.serverId}`)
        return true
      case '/ah': {
        let code = 401
        let message = AUTH_FAILED
        const ip = this.getAvailableIp(req)

        if (ip) {
          if (typeof req.headers.m === 'string' && req.headers.m) {
            const response = typeof req.headers.i === 'string' && req.headers.i
              ? this.verifyByKey(req.headers.m, req.headers.i)
              : this.verifyByCode(req.headers.m, this.options.getConnectionCode())
            if (response != null) {
              message = response
              code = 200
            }
          }

          if (code !== 200) {
            this.requestIps.set(ip, (this.requestIps.get(ip) ?? 0) + 1)
          }
        } else {
          code = 403
          message = BLOCKED_IP
        }

        res.writeHead(code)
        res.end(message)
        return true
      }
      default:
        return false
    }
  }

  handleUpgrade(request: http.IncomingMessage, socket: any, head: Buffer) {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
    if (requestUrl.pathname !== SOCKET_PATH) return false
    if (!requestUrl.searchParams.has('i') || !requestUrl.searchParams.has('t')) return false

    const clientId = requestUrl.searchParams.get('i') || ''
    const token = requestUrl.searchParams.get('t') || ''
    const ip = this.getAvailableIp(request)
    if (!ip || !this.verifyConnection(token, clientId)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      if (ip) {
        this.requestIps.set(ip, (this.requestIps.get(ip) ?? 0) + 1)
      }
      return true
    }

    this.ensureServer()
    this.compatWsServer?.handleUpgrade(request, socket, head, (ws) => {
      this.compatWsServer?.emit('connection', ws, request)
    })
    return true
  }

  private async handleIncomingListAction(peer: LxCompatPeer, action: any) {
    const currentSnapshot = this.getCurrentSnapshotOrDefault()
    const currentListData = buildLxListData(currentSnapshot)
    const listData = applyLxListAction(currentListData, action)
    const nextSnapshot = applyLxListDataToSnapshot(currentSnapshot, listData)
    this.options.setCurrentSnapshotData(nextSnapshot, peer.keyInfo.clientId, peer.keyInfo.deviceName)
    this.updateDeviceListSnapshotKey(peer.keyInfo.clientId, this.createListSnapshot(listData))
  }

  private async handleIncomingDislikeAction(peer: LxCompatPeer, action: any) {
    const currentSnapshot = this.getCurrentSnapshotOrDefault()
    const currentRules = normalizeDislikeRules(currentSnapshot.feature.dislikeRules)
    const dislikeRules = applyLxDislikeAction(currentRules, action)
    const nextSnapshot = applyDislikeRulesToSnapshot(currentSnapshot, dislikeRules)
    this.options.setCurrentSnapshotData(nextSnapshot, peer.keyInfo.clientId, peer.keyInfo.deviceName)
    this.updateDeviceDislikeSnapshotKey(peer.keyInfo.clientId, this.createDislikeSnapshot(dislikeRules))
  }

  private async syncList(peer: LxCompatPeer) {
    const localListData = buildLxListData(this.getCurrentSnapshotOrDefault())
    const remoteListData = normalizeListData(await peer.remoteQueueList.list_sync_get_list_data())

    let finalListData = localListData
    let updateLocal = false
    let updateRemote = false

    const deviceSnapshot = peer.feature.list && !peer.feature.list.skipSnapshot
      ? this.getDeviceListSnapshot(peer.keyInfo.clientId)
      : null

    if (deviceSnapshot) {
      const localKey = this.createListSnapshot(localListData)
      const remoteKey = getListDataKey(remoteListData)
      if (localKey === remoteKey) {
        this.updateDeviceListSnapshotKey(peer.keyInfo.clientId, localKey)
        await peer.remoteQueueList.list_sync_finished()
        peer.moduleReadys.list = true
        return
      }
      finalListData = mergeListDataFromSnapshot(localListData, remoteListData, deviceSnapshot)
      updateLocal = !isSameData(finalListData, localListData)
      updateRemote = !isSameData(finalListData, remoteListData)
    } else if (hasListData(localListData) && hasListData(remoteListData)) {
      const mode = await chooseListSyncMode(peer.keyInfo.deviceName, this.options.getDefaultSyncMode())
      switch (mode) {
        case 'merge_local_remote':
          finalListData = mergeListData(localListData, remoteListData)
          updateLocal = !isSameData(finalListData, localListData)
          updateRemote = !isSameData(finalListData, remoteListData)
          break
        case 'merge_remote_local':
          finalListData = mergeListData(remoteListData, localListData)
          updateLocal = !isSameData(finalListData, localListData)
          updateRemote = !isSameData(finalListData, remoteListData)
          break
        case 'overwrite_local_remote':
          finalListData = overwriteListData(localListData, remoteListData)
          updateLocal = !isSameData(finalListData, localListData)
          updateRemote = !isSameData(finalListData, remoteListData)
          break
        case 'overwrite_remote_local':
          finalListData = overwriteListData(remoteListData, localListData)
          updateLocal = !isSameData(finalListData, localListData)
          updateRemote = !isSameData(finalListData, remoteListData)
          break
        case 'overwrite_local_remote_full':
          finalListData = localListData
          updateRemote = !isSameData(finalListData, remoteListData)
          break
        case 'overwrite_remote_local_full':
          finalListData = remoteListData
          updateLocal = !isSameData(finalListData, localListData)
          break
        case 'cancel':
        default:
          throw new Error('cancel')
      }
    } else if (hasListData(remoteListData)) {
      finalListData = remoteListData
      updateLocal = true
    } else if (hasListData(localListData)) {
      updateRemote = true
    }

    if (updateLocal) {
      const nextSnapshot = applyLxListDataToSnapshot(this.getCurrentSnapshotOrDefault(), finalListData)
      this.options.setCurrentSnapshotData(nextSnapshot, peer.keyInfo.clientId, peer.keyInfo.deviceName)
    }

    if (updateRemote) {
      await peer.remoteQueueList.list_sync_set_list_data(finalListData)
    }

    this.updateDeviceListSnapshotKey(peer.keyInfo.clientId, this.createListSnapshot(finalListData))
    await peer.remoteQueueList.list_sync_finished()
    peer.moduleReadys.list = true
  }

  private async syncDislike(peer: LxCompatPeer) {
    const localDislike = normalizeDislikeRules(this.getCurrentSnapshotOrDefault().feature.dislikeRules)
    const remoteDislike = normalizeDislikeRules(await peer.remoteQueueDislike.dislike_sync_get_list_data())

    let finalDislike = localDislike
    let updateLocal = false
    let updateRemote = false

    const deviceSnapshot = peer.feature.dislike && !peer.feature.dislike.skipSnapshot
      ? this.getDeviceDislikeSnapshot(peer.keyInfo.clientId)
      : null

    if (deviceSnapshot != null) {
      const localKey = this.createDislikeSnapshot(localDislike)
      const remoteKey = getDislikeDataKey(remoteDislike)
      if (localKey === remoteKey) {
        this.updateDeviceDislikeSnapshotKey(peer.keyInfo.clientId, localKey)
        await peer.remoteQueueDislike.dislike_sync_finished()
        peer.moduleReadys.dislike = true
        return
      }
      finalDislike = mergeDislikeDataFromSnapshot(localDislike, remoteDislike, deviceSnapshot)
      updateLocal = finalDislike !== localDislike
      updateRemote = finalDislike !== remoteDislike
    } else if (localDislike.trim() && remoteDislike.trim()) {
      const mode = await chooseDislikeSyncMode(peer.keyInfo.deviceName, this.options.getDefaultSyncMode())
      switch (mode) {
        case 'merge_local_remote':
        case 'merge_remote_local':
          finalDislike = mergeDislikeRules(localDislike, remoteDislike)
          updateLocal = finalDislike !== localDislike
          updateRemote = finalDislike !== remoteDislike
          break
        case 'overwrite_local_remote':
          finalDislike = localDislike
          updateRemote = finalDislike !== remoteDislike
          break
        case 'overwrite_remote_local':
          finalDislike = remoteDislike
          updateLocal = finalDislike !== localDislike
          break
        case 'cancel':
        default:
          throw new Error('cancel')
      }
    } else if (remoteDislike.trim()) {
      finalDislike = remoteDislike
      updateLocal = true
    } else if (localDislike.trim()) {
      updateRemote = true
    }

    if (updateLocal) {
      const nextSnapshot = applyDislikeRulesToSnapshot(this.getCurrentSnapshotOrDefault(), finalDislike)
      this.options.setCurrentSnapshotData(nextSnapshot, peer.keyInfo.clientId, peer.keyInfo.deviceName)
    }

    if (updateRemote) {
      await peer.remoteQueueDislike.dislike_sync_set_list_data(finalDislike)
    }

    this.updateDeviceDislikeSnapshotKey(peer.keyInfo.clientId, this.createDislikeSnapshot(finalDislike))
    await peer.remoteQueueDislike.dislike_sync_finished()
    peer.moduleReadys.dislike = true
  }

  private async initializePeer(peer: LxCompatPeer) {
    const enabledFeatures = await peer.remote.getEnabledFeatures('desktop-app', {
      list: 1,
      dislike: 1,
    })

    if (enabledFeatures?.list) {
      peer.feature.list = enabledFeatures.list
      await this.syncList(peer)
    }

    if (enabledFeatures?.dislike) {
      peer.feature.dislike = enabledFeatures.dislike
      await this.syncDislike(peer)
    }

    await peer.remote.finished()
    peer.isReady = true
  }

  private ensureServer() {
    if (this.compatWsServer) return

    this.compatWsServer = new WebSocketServer({ noServer: true })
    this.compatWsServer.on('connection', (socket: WebSocket, request) => {
      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
      const clientId = requestUrl.searchParams.get('i') || ''
      const keyInfo = this.getClientKeyInfo(clientId)
      if (!keyInfo) {
        socket.close(CLOSE_CODE_FAILED, AUTH_FAILED)
        return
      }

      keyInfo.lastConnectDate = Date.now()
      this.saveClientKeyInfo(keyInfo)

      const peer = socket as LxCompatPeer
      peer.keyInfo = keyInfo
      peer.isReady = false
      peer.moduleReadys = {
        list: false,
        dislike: false,
      }
      peer.feature = {
        list: false,
        dislike: false,
      }

      const message2call = createMsg2call<any>({
        funcsObj: {
          onFeatureChanged: async(_socket: LxCompatPeer, _feature: any) => {
            // no-op for now
          },
          onListSyncAction: async(socket: LxCompatPeer, action: any) => {
            if (!socket.moduleReadys.list) return
            await this.handleIncomingListAction(socket, action)
          },
          onDislikeSyncAction: async(socket: LxCompatPeer, action: any) => {
            if (!socket.moduleReadys.dislike) return
            await this.handleIncomingDislikeAction(socket, action)
          },
        },
        timeout: 120000,
        sendMessage: (data: unknown) => {
          void encodeCompatMessage(JSON.stringify(data)).then((payload) => {
            if (peer.readyState === WebSocket.OPEN) {
              peer.send(payload)
            }
          }).catch((error) => {
            console.warn('[data-sync][lx-compat] send message failed:', error)
            peer.close(CLOSE_CODE_FAILED)
          })
        },
        onCallBeforeParams: (rawArgs: any[]) => [peer, ...rawArgs],
        onError: (error: Error, path: string[], groupName: string | null) => {
          console.warn('[data-sync][lx-compat] call error:', groupName, path.join('.'), error.message)
        },
      })

      peer.remote = message2call.remote
      peer.remoteQueueList = message2call.createQueueRemote<any>('list')
      peer.remoteQueueDislike = message2call.createQueueRemote<any>('dislike')
      peer.cleanup = () => {
        message2call.destroy()
      }

      this.peers.add(peer)
      this.updateDevices()

      peer.on('message', (raw) => {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8')
        if (text === 'ping') return
        void decodeCompatMessage(text).then((payload) => {
          const parsed = JSON.parse(payload)
          message2call.message(parsed)
        }).catch((error) => {
          console.warn('[data-sync][lx-compat] decode message failed:', error)
          peer.close(CLOSE_CODE_FAILED)
        })
      })

      peer.on('close', () => {
        peer.cleanup()
        this.removePeer(peer)
      })

      void this.initializePeer(peer).catch((error) => {
        console.warn('[data-sync][lx-compat] initialize peer failed:', error)
        peer.close(CLOSE_CODE_FAILED)
      })
    })

    this.pingTimer = setInterval(() => {
      for (const peer of this.peers) {
        if (peer.readyState === WebSocket.OPEN && peer.keyInfo.isMobile) {
          peer.send('ping')
        }
      }
    }, 30000)
  }

  async stop() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }

    for (const peer of this.peers) {
      try {
        peer.cleanup()
      } catch {}
      try {
        peer.close()
      } catch {}
    }
    this.peers.clear()
    this.updateDevices()

    if (this.compatWsServer) {
      await new Promise<void>((resolve) => {
        this.compatWsServer?.close(() => resolve())
        this.compatWsServer = null
      }).catch(() => {})
    }
  }

  onSnapshotUpdated(snapshotData: DataSyncSnapshotData, sourceId?: string) {
    if (!this.peers.size) return
    const listData = buildLxListData(snapshotData)
    const dislikeRules = normalizeDislikeRules(snapshotData.feature.dislikeRules)
    const listSnapshotKey = this.createListSnapshot(listData)
    const dislikeSnapshotKey = this.createDislikeSnapshot(dislikeRules)

    for (const peer of this.peers) {
      if (peer.readyState !== WebSocket.OPEN || !peer.isReady) continue
      if (sourceId === peer.keyInfo.clientId) continue

      if (peer.moduleReadys.list && peer.feature.list) {
        void peer.remoteQueueList.onListSyncAction({
          action: 'list_data_overwrite',
          data: listData,
        }).then(() => {
          this.updateDeviceListSnapshotKey(peer.keyInfo.clientId, listSnapshotKey)
        }).catch((error: Error) => {
          console.warn('[data-sync][lx-compat] push list overwrite failed:', error)
          peer.close(CLOSE_CODE_FAILED)
        })
      }

      if (peer.moduleReadys.dislike && peer.feature.dislike) {
        void peer.remoteQueueDislike.onDislikeSyncAction({
          action: 'dislike_data_overwrite',
          data: dislikeRules,
        }).then(() => {
          this.updateDeviceDislikeSnapshotKey(peer.keyInfo.clientId, dislikeSnapshotKey)
        }).catch((error: Error) => {
          console.warn('[data-sync][lx-compat] push dislike overwrite failed:', error)
          peer.close(CLOSE_CODE_FAILED)
        })
      }
    }
  }
}
