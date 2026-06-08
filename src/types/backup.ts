export interface WebDavBackupConfig {
  serverUrl: string
  username: string
  password: string
  remoteDirectory: string
}

export interface WebDavRemoteFile {
  name: string
  href: string
  size: number
  modifiedAt: string | null
  etag?: string | null
  isDirectory: boolean
  url: string
}

export type BackupItemKey = 'onlineFavorites' | 'onlinePlaylists' | 'neteaseCookie' | 'lxSources'

export type BackupSelection = Record<BackupItemKey, boolean>

export type BackupPreferenceValueType = 'string' | 'bool' | 'int' | 'double' | 'stringList'

export interface BackupPreferenceEntry {
  key: string
  type: BackupPreferenceValueType
  value: string | boolean | number | string[]
}

export interface BackupSongRef {
  source: string
  songId: string
  addedAtMs: number
  name?: string | null
  artist?: string | null
  album?: string | null
  cover?: string | null
  durationMs?: number | null
}

export interface BackupOnlinePlaylist {
  id: string
  name: string
  description?: string | null
  songs: BackupSongRef[]
  externalSource?: string | null
  externalType?: string | null
  externalId?: string | null
  createdAtMs: number
  updatedAtMs: number
}

export interface BackupLxScriptInfo {
  name: string
  description?: string | null
  version?: string | null
  author?: string | null
  homepage?: string | null
  rawScript: string
}

export interface BackupLxSource {
  id: string
  info: BackupLxScriptInfo
  addedAt: string
  isActive: boolean
  allowShowUpdateAlert: boolean
}

export interface WebDavBackupSummary {
  localFavoritesCount: number
  localPlaylistsCount: number
  onlineFavoritesCount: number
  onlinePlaylistsCount: number
  collectedOnlinePlaylistsCount: number
  customOnlinePlaylistsCount: number
  settingsCount: number
  lxSourceCount: number
  hasNeteaseCookie: boolean
}

export interface WebDavBackupData {
  schemaVersion: number
  createdAt: string
  appVersion: string
  platform: string
  includedItems?: BackupItemKey[]
  summary?: WebDavBackupSummary
  data: {
    localFavoriteSongIds: number[]
    localPlaylists: unknown[]
    onlineFavorites: BackupSongRef[]
    onlinePlaylists: BackupOnlinePlaylist[]
    settings: BackupPreferenceEntry[]
    neteaseCookie: string | null
    lxSources: BackupLxSource[]
    activeLxSourceId: string | null
  }
}

export interface LegacyLocalBackupData {
  version: string | number
  exportDate: string
  playlists?: any[]
  favorites?: any[]
  playHistory?: any[]
  currentQueue?: any[]
  settings?: {
    theme?: string
    quality?: string
    autoTemporarySourceSwitch?: boolean
  }
}

export interface LxBackupState {
  sources: BackupLxSource[]
  activeSourceId: string | null
}
