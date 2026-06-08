import { APP_VERSION } from '@/config'
import { BACKUP_ITEM_ORDER, createBackupSelection } from '@/constants/backup'
import type { OnlinePlaylist, OnlinePlaylistSong, Platform, Song, SongPlatform } from '@/types'
import { useAuthStore, type NeteaseUserData } from '@/stores/authStore'
import { useUserStore } from '@/stores/userStore'
import neteaseAuthApi from '@/services/neteaseAuth'
import backupBridge from '@/services/backupBridge'
import { lxSourceApi } from '@/services/lxSource'
import type {
  BackupItemKey,
  BackupLxSource,
  BackupOnlinePlaylist,
  BackupSelection,
  BackupPreferenceEntry,
  BackupSongRef,
  LegacyLocalBackupData,
  LxBackupState,
  WebDavBackupData,
  WebDavBackupSummary,
} from '@/types/backup'

export interface BackupRestoreResult {
  onlineFavoritesCount: number
  onlinePlaylistsCount: number
  lxSourceCount: number
  restoredCookie: boolean
  warnings: string[]
}

export interface BackupBuildOptions {
  selection?: Partial<BackupSelection> | null
}

export interface BackupRestoreOptions {
  selection?: Partial<BackupSelection> | null
}

const NETEASE_BACKUP_SOURCE = 'wy'
const BACKUP_SCHEMA_VERSION = 1

const isRecord = (value: unknown): value is Record<string, any> => {
  return Object.prototype.toString.call(value) === '[object Object]'
}

const asString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback
}

const asOptionalString = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim() ? value : null
}

const resolveBackupTimestamp = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value

    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) continue

      const dateTimestamp = Date.parse(trimmed)
      if (Number.isFinite(dateTimestamp)) return dateTimestamp

      const numericTimestamp = Number.parseInt(trimmed, 10)
      if (Number.isFinite(numericTimestamp)) return numericTimestamp
    }
  }

  return Date.now()
}

const unique = <T>(items: T[]) => Array.from(new Set(items))

const isBackupItemKey = (value: unknown): value is BackupItemKey => {
  return typeof value === 'string' && BACKUP_ITEM_ORDER.includes(value as BackupItemKey)
}

const normalizeBackupSelection = (selection?: Partial<BackupSelection> | null, defaultValue = true): BackupSelection => {
  const fallback = createBackupSelection(defaultValue)
  if (!selection) return fallback

  return BACKUP_ITEM_ORDER.reduce((result, key) => {
    result[key] = typeof selection[key] === 'boolean' ? selection[key] as boolean : fallback[key]
    return result
  }, { ...fallback })
}

const getSelectedBackupItems = (selection: BackupSelection) => {
  return BACKUP_ITEM_ORDER.filter((key) => selection[key])
}

const resolveIncludedItems = (value: unknown, treatMissingAsAll: boolean): BackupItemKey[] => {
  if (!Array.isArray(value)) return treatMissingAsAll ? [...BACKUP_ITEM_ORDER] : []
  return unique(value.filter((item): item is BackupItemKey => isBackupItemKey(item)))
}

const mapPlatformToBackupSource = (platform: SongPlatform): string | null => {
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
      return null
  }
}

const mapBackupSourceToPlatform = (source: string): Platform | null => {
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
    default:
      return null
  }
}

const mapSourceLikeToBackupSource = (value: unknown): string | null => {
  const source = asString(value).trim()
  if (!source) return null

  if (mapBackupSourceToPlatform(source)) {
    return source
  }

  return mapPlatformToBackupSource(source as SongPlatform)
}

const normalizeSongRef = (value: unknown): BackupSongRef | null => {
  if (!isRecord(value)) return null
  const source = mapSourceLikeToBackupSource(value.source) || mapSourceLikeToBackupSource(value.platform)
  const songId = asString(value.songId).trim() || asString(value.id).trim()
  if (!source || !songId) return null

  const durationMs = typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)
    ? value.durationMs
    : typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration > 0
      ? Math.round(value.duration * 1000)
      : null

  return {
    source,
    songId,
    addedAtMs: resolveBackupTimestamp(value.addedAtMs, value.importedAt, value.updatedAt, value.createdAt),
    name: asOptionalString(value.name),
    artist: asOptionalString(value.artist),
    album: asOptionalString(value.album),
    cover: asOptionalString(value.cover),
    durationMs,
  }
}

const normalizeOnlinePlaylist = (value: unknown): BackupOnlinePlaylist | null => {
  if (!isRecord(value)) return null
  const id = asString(value.id).trim()
  const name = asString(value.name).trim()
  if (!id || !name) return null

  const songs = Array.isArray(value.songs)
    ? value.songs.map((item) => normalizeSongRef(item)).filter((item): item is BackupSongRef => Boolean(item))
    : []

  const externalSource = mapSourceLikeToBackupSource(value.externalSource) || mapSourceLikeToBackupSource(value.source)
  const externalId = asOptionalString(value.externalId) || asOptionalString(value.sourceId)
  const externalType = asOptionalString(value.externalType) || asOptionalString(value.type) || (externalSource && externalId ? 'playlist' : null)
  const createdAtMs = resolveBackupTimestamp(value.createdAtMs, value.importedAt, value.createdAt)
  const updatedAtMs = resolveBackupTimestamp(value.updatedAtMs, value.importedAt, value.updatedAt, value.createdAt)

  return {
    id,
    name,
    description: asOptionalString(value.description),
    songs,
    externalSource,
    externalType,
    externalId,
    createdAtMs,
    updatedAtMs,
  }
}

const normalizePreferenceEntry = (value: unknown): BackupPreferenceEntry | null => {
  if (!isRecord(value)) return null
  const key = asString(value.key).trim()
  if (!key) return null

  const type = asString(value.type, 'string') as BackupPreferenceEntry['type']
  if (type === 'stringList') {
    return {
      key,
      type,
      value: Array.isArray(value.value) ? value.value.map((item) => String(item)) : [],
    }
  }

  if (type === 'bool') {
    return { key, type, value: value.value === true || String(value.value) === 'true' }
  }

  if (type === 'int' || type === 'double') {
    const numberValue = Number(value.value)
    return { key, type, value: Number.isFinite(numberValue) ? numberValue : 0 }
  }

  return { key, type: 'string', value: String(value.value ?? '') }
}

const normalizeLxSource = (value: unknown): BackupLxSource | null => {
  if (!isRecord(value) || !isRecord(value.info)) return null
  const id = asString(value.id).trim()
  const name = asString(value.info.name).trim()
  const rawScript = asString(value.info.rawScript)
  if (!id || !name || !rawScript.trim()) return null

  return {
    id,
    info: {
      name,
      description: asOptionalString(value.info.description),
      version: asOptionalString(value.info.version),
      author: asOptionalString(value.info.author),
      homepage: asOptionalString(value.info.homepage),
      rawScript,
    },
    addedAt: asString(value.addedAt, new Date().toISOString()),
    isActive: Boolean(value.isActive),
    allowShowUpdateAlert: typeof value.allowShowUpdateAlert === 'boolean' ? value.allowShowUpdateAlert : true,
  }
}

const toLikeSongIds = (favorites: BackupSongRef[]) => {
  return unique(
    favorites
      .filter((item) => item.source === NETEASE_BACKUP_SOURCE)
      .map((item) => Number.parseInt(item.songId, 10))
      .filter((item) => Number.isFinite(item))
  )
}

const deriveOnlineFavoritesForBackup = (likeSongIds: number[], rawFavorites: BackupSongRef[]) => {
  const normalizedRaw = rawFavorites.map((item) => normalizeSongRef(item)).filter((item): item is BackupSongRef => Boolean(item))
  if (!likeSongIds.length) {
    return normalizedRaw.sort((left, right) => right.addedAtMs - left.addedAtMs)
  }

  const rawMap = new Map(normalizedRaw.map((item) => [`${item.source}:${item.songId}`, item]))
  const nonNetease = normalizedRaw.filter((item) => item.source !== NETEASE_BACKUP_SOURCE)
  const derivedNetease = unique(likeSongIds)
    .map((songId) => {
      const key = `${NETEASE_BACKUP_SOURCE}:${songId}`
      return rawMap.get(key) || {
        source: NETEASE_BACKUP_SOURCE,
        songId: String(songId),
        addedAtMs: Date.now(),
        name: null,
        artist: null,
        album: null,
        cover: null,
        durationMs: null,
      }
    })

  return [...nonNetease, ...derivedNetease].sort((left, right) => right.addedAtMs - left.addedAtMs)
}

const buildPlaylistIdentity = (playlist: BackupOnlinePlaylist) => {
  return `${playlist.externalSource || ''}:${playlist.externalId || ''}:${playlist.id}`
}

const looksLikeOnlinePlaylistRecord = (value: unknown) => {
  return isRecord(value) && (
    typeof value.externalSource === 'string' ||
    typeof value.externalId === 'string' ||
    typeof value.externalType === 'string' ||
    typeof value.sourceId === 'string' ||
    typeof value.importedAt === 'string'
  )
}

const mapOnlinePlaylistSongToBackupSong = (song: OnlinePlaylistSong): BackupSongRef => {
  const source = mapPlatformToBackupSource(song.platform)

  return {
    source: source || NETEASE_BACKUP_SOURCE,
    songId: song.id,
    addedAtMs: Date.now(),
    name: song.name || null,
    artist: song.artist || null,
    album: song.album || null,
    cover: song.cover || null,
    durationMs: song.duration > 0 ? song.duration * 1000 : null,
  }
}

const mapLibrarySongToBackupSong = (song: Song): BackupSongRef | null => {
  const source = mapPlatformToBackupSource(song.platform)
  if (!source) return null

  return {
    source,
    songId: song.id,
    addedAtMs: Date.now(),
    name: song.name || null,
    artist: song.artist || null,
    album: song.album || null,
    cover: song.cover || null,
    durationMs: song.duration > 0 ? song.duration * 1000 : null,
  }
}

const mapBackupSongToOnlinePlaylistSong = (song: BackupSongRef): OnlinePlaylistSong | null => {
  const platform = mapBackupSourceToPlatform(song.source)
  if (!platform) return null

  return {
    id: song.songId,
    name: song.name || '未知歌曲',
    artist: song.artist || '未知歌手',
    album: song.album || '',
    duration: song.durationMs && song.durationMs > 0 ? Math.round(song.durationMs / 1000) : 0,
    cover: song.cover || undefined,
    url: undefined,
    platform,
    types: [],
  }
}

const mapBackupSongToLibrarySong = (song: BackupSongRef): Song | null => {
  const platform = mapBackupSourceToPlatform(song.source)
  if (!platform) return null

  return {
    id: song.songId,
    name: song.name || '未知歌曲',
    artist: song.artist || '未知歌手',
    album: song.album || '',
    duration: song.durationMs && song.durationMs > 0 ? Math.round(song.durationMs / 1000) : 0,
    cover: song.cover || undefined,
    platform,
  }
}

const mergeLibrarySong = (primary: Song, fallback?: Song): Song => {
  if (!fallback) return primary
  return {
    ...fallback,
    ...primary,
    name: primary.name || fallback.name,
    artist: primary.artist || fallback.artist,
    album: primary.album || fallback.album,
    cover: primary.cover || fallback.cover,
    duration: primary.duration || fallback.duration,
    albumId: primary.albumId || fallback.albumId,
    url: primary.url || fallback.url,
    lx: primary.lx || fallback.lx,
  }
}

const mergeLibrarySongs = (preferredSongs: Song[], fallbackSongs: Song[]) => {
  const fallbackMap = new Map<string, Song>(
    fallbackSongs.map((song) => [`${song.platform}:${song.id}`, song] as const),
  )

  return preferredSongs.map((song) => {
    const key = `${song.platform}:${song.id}`
    return mergeLibrarySong(song, fallbackMap.get(key))
  })
}

const mergeBackupFavorites = (preferredSongs: BackupSongRef[], fallbackSongs: BackupSongRef[]) => {
  const merged = new Map<string, BackupSongRef>()
  const order: string[] = []

  const append = (song: BackupSongRef) => {
    const key = `${song.source}:${song.songId}`
    if (!song.songId) return

    const current = merged.get(key)
    if (!current) {
      merged.set(key, song)
      order.push(key)
      return
    }

    merged.set(key, {
      ...current,
      ...song,
      addedAtMs: current.addedAtMs || song.addedAtMs || Date.now(),
      name: current.name || song.name || null,
      artist: current.artist || song.artist || null,
      album: current.album || song.album || null,
      cover: current.cover || song.cover || null,
      durationMs: current.durationMs || song.durationMs || null,
    })
  }

  preferredSongs.forEach(append)
  fallbackSongs.forEach(append)

  return order.map((key) => merged.get(key)!).filter(Boolean)
}

const mergeBackupPlaylistSong = (primary: BackupSongRef, fallback?: BackupSongRef): BackupSongRef => {
  if (!fallback) return primary

  return {
    ...fallback,
    ...primary,
    addedAtMs: primary.addedAtMs || fallback.addedAtMs || Date.now(),
    name: primary.name || fallback.name || null,
    artist: primary.artist || fallback.artist || null,
    album: primary.album || fallback.album || null,
    cover: primary.cover || fallback.cover || null,
    durationMs: primary.durationMs || fallback.durationMs || null,
  }
}

const mergeBackupPlaylistSongs = (preferredSongs: BackupSongRef[], fallbackSongs: BackupSongRef[]) => {
  const fallbackMap = new Map<string, BackupSongRef>(
    fallbackSongs.map((song) => [`${song.source}:${song.songId}`, song] as const),
  )
  const appendedKeys = new Set<string>()
  const merged = preferredSongs.map((song) => {
    const key = `${song.source}:${song.songId}`
    appendedKeys.add(key)
    return mergeBackupPlaylistSong(song, fallbackMap.get(key))
  })

  fallbackSongs.forEach((song) => {
    const key = `${song.source}:${song.songId}`
    if (appendedKeys.has(key)) return
    merged.push(song)
  })

  return merged
}

const deriveOnlinePlaylistsForBackup = (onlinePlaylists: OnlinePlaylist[], rawPlaylists: BackupOnlinePlaylist[]) => {
  const normalizedRaw = rawPlaylists.map((item) => normalizeOnlinePlaylist(item)).filter((item): item is BackupOnlinePlaylist => Boolean(item))
  if (!onlinePlaylists.length) {
    return normalizedRaw
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
  }

  const rawMap = new Map(normalizedRaw.map((item) => [buildPlaylistIdentity(item), item]))

  return onlinePlaylists.map((playlist) => {
    const externalType = playlist.externalType?.trim() || null
    const externalId = playlist.sourceId.trim() || null
    const externalSource = externalType && externalId
      ? (mapPlatformToBackupSource(playlist.source) || null)
      : null
    const fallbackTimestamp = Date.parse(playlist.importedAt) || Date.now()
    const seed: BackupOnlinePlaylist = {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description || null,
      songs: playlist.songs.map((song) => mapOnlinePlaylistSongToBackupSong(song)),
      externalSource,
      externalType,
      externalId,
      createdAtMs: fallbackTimestamp,
      updatedAtMs: fallbackTimestamp,
    }
    const raw = rawMap.get(buildPlaylistIdentity(seed))
    return {
      ...seed,
      description: raw?.description ?? seed.description,
      songs: raw?.songs?.length ? mergeBackupPlaylistSongs(raw.songs, seed.songs) : seed.songs,
      externalType: raw?.externalType ?? seed.externalType,
      createdAtMs: raw?.createdAtMs ?? seed.createdAtMs,
      updatedAtMs: raw?.updatedAtMs ?? seed.updatedAtMs,
    }
  }).sort((left, right) => right.updatedAtMs - left.updatedAtMs)
}

const extractRawOnlineFavorites = (rawData: Record<string, any>) => {
  const rawFavorites = Array.isArray(rawData.onlineFavorites)
    ? rawData.onlineFavorites
    : Array.isArray(rawData.favorites)
      ? rawData.favorites
      : []

  return rawFavorites
    .map((item) => normalizeSongRef(item))
    .filter((item): item is BackupSongRef => Boolean(item))
}

const extractRawOnlinePlaylists = (rawData: Record<string, any>) => {
  const fallbackCandidates = Array.isArray(rawData.playlists)
    ? rawData.playlists.filter((item) => looksLikeOnlinePlaylistRecord(item))
    : []
  const primaryCandidates = Array.isArray(rawData.onlinePlaylists)
    ? rawData.onlinePlaylists
    : []

  const normalized = [...fallbackCandidates, ...primaryCandidates]
    .map((item) => normalizeOnlinePlaylist(item))
    .filter((item): item is BackupOnlinePlaylist => Boolean(item))

  const playlistMap = new Map<string, BackupOnlinePlaylist>()
  normalized.forEach((playlist) => {
    playlistMap.set(buildPlaylistIdentity(playlist), playlist)
  })

  return Array.from(playlistMap.values())
}

const buildSummary = (data: WebDavBackupData['data']): WebDavBackupSummary => {
  const collectedOnlinePlaylistsCount = data.onlinePlaylists.filter((item) => item.externalSource && item.externalId).length
  return {
    localFavoritesCount: 0,
    localPlaylistsCount: 0,
    onlineFavoritesCount: data.onlineFavorites.length,
    onlinePlaylistsCount: data.onlinePlaylists.length,
    collectedOnlinePlaylistsCount,
    customOnlinePlaylistsCount: data.onlinePlaylists.length - collectedOnlinePlaylistsCount,
    settingsCount: data.settings.length,
    lxSourceCount: data.lxSources.length,
    hasNeteaseCookie: Boolean(data.neteaseCookie?.trim()),
  }
}

export const getWebDavBackupIncludedSelection = (backup: Pick<WebDavBackupData, 'includedItems'>): BackupSelection => {
  const hasIncludedItems = Object.prototype.hasOwnProperty.call(backup, 'includedItems')
  const includedItems = resolveIncludedItems(backup.includedItems, !hasIncludedItems)
  const includedItemSet = new Set(includedItems)
  return BACKUP_ITEM_ORDER.reduce((result, key) => {
    result[key] = includedItemSet.has(key)
    return result
  }, createBackupSelection(false))
}

export const countWebDavBackupEntries = (backup: WebDavBackupData) => {
  const summary = backup.summary || buildSummary(backup.data)
  return summary.onlineFavoritesCount +
    summary.onlinePlaylistsCount +
    summary.lxSourceCount +
    (summary.hasNeteaseCookie ? 1 : 0)
}

const resolveBackupFallbackPlatform = (backup: WebDavBackupData): Platform => {
  const configuredPlatform = backup.data.settings.find((item) => item.key === 'discovery_last_platform_v1')?.value
  if (typeof configuredPlatform === 'string') {
    const mapped = mapBackupSourceToPlatform(configuredPlatform.trim())
    if (mapped) return mapped
  }

  const favoritePlatform = mapBackupSourceToPlatform(backup.data.onlineFavorites[0]?.source || '')
  if (favoritePlatform) return favoritePlatform

  const playlistPlatform = mapBackupSourceToPlatform(
    backup.data.onlinePlaylists.find((item) => item.externalSource)?.externalSource || '',
  )
  if (playlistPlatform) return playlistPlatform

  return 'netease'
}

const resolvePlatformName = async() => {
  const electronApi = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (electronApi?.getPlatform) {
    try {
      return await electronApi.getPlatform()
    } catch {
      // ignore platform detection failures
    }
  }

  if (typeof navigator !== 'undefined') {
    return navigator.userAgent.includes('Mac') ? 'darwin' : navigator.platform || 'web'
  }

  return 'unknown'
}

const mapBackupPlaylistToUserPlaylist = (
  playlist: BackupOnlinePlaylist,
  fallbackPlatform: Platform,
): OnlinePlaylist | null => {
  const songs = playlist.songs
    .map((item) => mapBackupSongToOnlinePlaylistSong(item))
    .filter((item): item is OnlinePlaylistSong => Boolean(item))
  const platform = mapBackupSourceToPlatform(playlist.externalSource || '') || songs[0]?.platform || fallbackPlatform

  return {
    id: playlist.id,
    sourceId: playlist.externalId || '',
    source: platform,
    name: playlist.name,
    description: playlist.description || undefined,
    author: undefined,
    cover: playlist.songs[0]?.cover || undefined,
    songs,
    songCount: playlist.songs.length || songs.length,
    importedAt: new Date(playlist.updatedAtMs || playlist.createdAtMs || Date.now()).toISOString(),
    externalType: playlist.externalType,
  }
}

const buildAuthStatePatch = (
  cookie: string | null,
  likeSongIds: number[],
  userData: NeteaseUserData | null,
  isLoggedIn: boolean,
) => ({
  isLoggedIn,
  loginType: cookie ? 'cookie' as const : null,
  userData,
  cookie,
  loginExpireTime: null,
  lastLoginTime: Date.now(),
  dailyRecommend: { timestamp: null, songs: [] },
  userPlaylists: { userId: userData?.userId || 0, playlists: [], lastUpdated: null },
  likeSongIds,
})

const restoreNeteaseState = async(cookie: string | null, likeSongIds: number[]) => {
  const normalizedCookie = cookie?.trim() || null
  if (!normalizedCookie) {
    useAuthStore.setState(buildAuthStatePatch(null, likeSongIds, null, false))
    return false
  }

  try {
    const account = await neteaseAuthApi.getUserAccount(normalizedCookie)
    const userData: NeteaseUserData | null = account
      ? {
          userId: account.userId,
          nickname: account.nickname,
          avatarUrl: account.avatarUrl,
          signature: account.signature,
          vipType: account.vipType,
        }
      : null

    useAuthStore.setState(buildAuthStatePatch(normalizedCookie, likeSongIds, userData, Boolean(userData)))
    return Boolean(userData)
  } catch {
    useAuthStore.setState(buildAuthStatePatch(normalizedCookie, likeSongIds, null, false))
    return false
  }
}

const restoreLikeSongIdsOnly = (likeSongIds: number[]) => {
  useAuthStore.getState().setLikeSongIds(likeSongIds)
}

export const createWebDavBackupFileName = (date = new Date()) => {
  const local = new Date(date)
  const yyyy = String(local.getFullYear()).padStart(4, '0')
  const mm = String(local.getMonth() + 1).padStart(2, '0')
  const dd = String(local.getDate()).padStart(2, '0')
  const hh = String(local.getHours()).padStart(2, '0')
  const min = String(local.getMinutes()).padStart(2, '0')
  const sec = String(local.getSeconds()).padStart(2, '0')
  return `sollin_backup_${yyyy}${mm}${dd}_${hh}${min}${sec}.json`
}

export const parseLegacyBackupData = (value: unknown): LegacyLocalBackupData | null => {
  if (!isRecord(value) || (!value.version && !value.exportDate)) return null
  return value as LegacyLocalBackupData
}

export const parseWebDavBackupData = (value: unknown): WebDavBackupData => {
  if (!isRecord(value)) {
    throw new Error('备份文件不是合法 JSON 对象')
  }

  const hasIncludedItems = Object.prototype.hasOwnProperty.call(value, 'includedItems')
  const rawData = isRecord(value.data) ? value.data : value
  const data = {
    localFavoriteSongIds: Array.isArray(rawData.localFavoriteSongIds)
      ? rawData.localFavoriteSongIds.map((item) => Number.parseInt(String(item), 10)).filter((item) => Number.isFinite(item))
      : [],
    localPlaylists: Array.isArray(rawData.localPlaylists) ? rawData.localPlaylists : [],
    onlineFavorites: extractRawOnlineFavorites(rawData),
    onlinePlaylists: extractRawOnlinePlaylists(rawData),
    settings: Array.isArray(rawData.settings)
      ? rawData.settings.map((item) => normalizePreferenceEntry(item)).filter((item): item is BackupPreferenceEntry => Boolean(item))
      : [],
    neteaseCookie: asOptionalString(rawData.neteaseCookie),
    lxSources: Array.isArray(rawData.lxSources)
      ? rawData.lxSources.map((item) => normalizeLxSource(item)).filter((item): item is BackupLxSource => Boolean(item))
      : [],
    activeLxSourceId: asOptionalString(rawData.activeLxSourceId),
  }

  return {
    schemaVersion: Number.parseInt(String(value.schemaVersion ?? BACKUP_SCHEMA_VERSION), 10) || BACKUP_SCHEMA_VERSION,
    createdAt: asString(value.createdAt, new Date().toISOString()),
    appVersion: asString(value.appVersion, ''),
    platform: asString(value.platform, 'unknown'),
    includedItems: resolveIncludedItems(value.includedItems, !hasIncludedItems),
    summary: buildSummary(data),
    data,
  }
}

export const buildWebDavBackupData = async(options: BackupBuildOptions = {}): Promise<WebDavBackupData> => {
  const selection = normalizeBackupSelection(options.selection, true)
  const includedItems = getSelectedBackupItems(selection)
  if (!includedItems.length) {
    throw new Error('请至少选择一个备份项目')
  }

  const authState = useAuthStore.getState()
  const userState = useUserStore.getState()
  const bridgeFavorites = backupBridge.getOnlineFavorites()
  const bridgePlaylists = backupBridge.getOnlinePlaylists()
  const lxBackupState: LxBackupState = await lxSourceApi.exportBackupState()
  const platform = await resolvePlatformName()
  const onlineFavorites = deriveOnlineFavoritesForBackup(
    authState.likeSongIds,
    mergeBackupFavorites(
      userState.favorites
        .map((song) => mapLibrarySongToBackupSong(song))
        .filter((item): item is BackupSongRef => Boolean(item)),
      bridgeFavorites,
    ),
  )
  const onlinePlaylists = deriveOnlinePlaylistsForBackup(userState.onlinePlaylists, bridgePlaylists)

  const data: WebDavBackupData['data'] = {
    localFavoriteSongIds: [],
    localPlaylists: [],
    onlineFavorites: selection.onlineFavorites ? onlineFavorites : [],
    onlinePlaylists: selection.onlinePlaylists ? onlinePlaylists : [],
    settings: [],
    neteaseCookie: selection.neteaseCookie && authState.cookie?.trim() ? authState.cookie : null,
    lxSources: selection.lxSources ? lxBackupState.sources : [],
    activeLxSourceId: selection.lxSources ? lxBackupState.activeSourceId : null,
  }

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    platform,
    includedItems,
    summary: buildSummary(data),
    data,
  }
}

export const stringifyWebDavBackupData = (data: WebDavBackupData) => {
  const includedItems = getSelectedBackupItems(getWebDavBackupIncludedSelection(data))
  return JSON.stringify({ ...data, includedItems, summary: buildSummary(data.data) }, null, 2)
}

export const restoreWebDavBackupData = async(
  backup: WebDavBackupData,
  options: BackupRestoreOptions = {},
): Promise<BackupRestoreResult> => {
  const availableSelection = getWebDavBackupIncludedSelection(backup)
  const availableItems = getSelectedBackupItems(availableSelection)
  if (!availableItems.length) {
    throw new Error('该备份不包含桌面端可恢复的数据')
  }

  const requestedSelection = normalizeBackupSelection(options.selection, true)
  const effectiveSelection = BACKUP_ITEM_ORDER.reduce((result, key) => {
    result[key] = availableSelection[key] && requestedSelection[key]
    return result
  }, createBackupSelection(false))
  const selectedItems = getSelectedBackupItems(effectiveSelection)
  if (!selectedItems.length) {
    throw new Error('请至少选择一个恢复项目')
  }

  const onlineFavorites = backup.data.onlineFavorites
  const onlinePlaylists = backup.data.onlinePlaylists
  const warnings: string[] = []
  const fallbackPlatform = resolveBackupFallbackPlatform(backup)
  const currentFavorites = useUserStore.getState().favorites
  const mappedOnlinePlaylists = onlinePlaylists
    .map((item) => mapBackupPlaylistToUserPlaylist(item, fallbackPlatform))
    .filter((item): item is OnlinePlaylist => Boolean(item))
  const mappedFavorites = mergeLibrarySongs(
    onlineFavorites
      .map((item) => mapBackupSongToLibrarySong(item))
      .filter((item): item is Song => Boolean(item)),
    currentFavorites,
  )
  const nextUserState: {
    favorites?: Song[]
    onlinePlaylists?: OnlinePlaylist[]
  } = {}

  if (effectiveSelection.onlineFavorites) {
    backupBridge.setOnlineFavorites(onlineFavorites)
    nextUserState.favorites = mappedFavorites
  }

  if (effectiveSelection.onlinePlaylists) {
    backupBridge.setOnlinePlaylists(onlinePlaylists)
    nextUserState.onlinePlaylists = mappedOnlinePlaylists
  }

  if (Object.keys(nextUserState).length > 0) {
    useUserStore.setState(nextUserState)
    void useUserStore.getState().refreshLibraryCovers()
  }

  const nextLikeSongIds = effectiveSelection.onlineFavorites
    ? toLikeSongIds(onlineFavorites)
    : useAuthStore.getState().likeSongIds

  let restoredCookie = false
  if (effectiveSelection.neteaseCookie) {
    restoredCookie = await restoreNeteaseState(backup.data.neteaseCookie, nextLikeSongIds)
  } else if (effectiveSelection.onlineFavorites) {
    restoreLikeSongIdsOnly(nextLikeSongIds)
  }

  if (effectiveSelection.lxSources) {
    try {
      await lxSourceApi.restoreBackupState({
        sources: backup.data.lxSources,
        activeSourceId: backup.data.activeLxSourceId,
      })
    } catch (error) {
      console.error('Restore LX backup state failed:', error)
      warnings.push('LX 音源恢复失败，请在设置页检查音源状态')
    }
  }

  return {
    onlineFavoritesCount: effectiveSelection.onlineFavorites ? onlineFavorites.length : 0,
    onlinePlaylistsCount: effectiveSelection.onlinePlaylists ? mappedOnlinePlaylists.length : 0,
    lxSourceCount: effectiveSelection.lxSources ? backup.data.lxSources.length : 0,
    restoredCookie,
    warnings,
  }
}
