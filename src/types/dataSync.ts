export type DataSyncMode = 'server' | 'client'

export const DATA_SYNC_CONFLICT_RESOLUTION_MODES = [
  'merge_local_remote',
  'merge_remote_local',
  'overwrite_local_remote',
  'overwrite_remote_local',
] as const

export type DataSyncConflictResolutionMode = typeof DATA_SYNC_CONFLICT_RESOLUTION_MODES[number]

export interface DataSyncDeviceInfo {
  deviceId: string
  deviceName: string
  platform: string
  version: string
  connectedAt: number
  lastSeenAt: number
}

export interface DataSyncSnapshotData {
  user: {
    favorites: unknown[]
    playlists: unknown[]
    onlinePlaylists: unknown[]
    recentlyPlayed: unknown[]
    playHistory: unknown[]
    playlistSectionOrder: string[]
  }
  feature: {
    dislikeRules: string
    searchHistory: string[]
  }
  ui: {
    theme: 'light' | 'dark' | 'system'
    fontFamily: string
    customFontDataUrl: string
    closeBehavior: 'ask' | 'background' | 'quit'
    backgroundSettings: Record<string, unknown>
    lyricsPlayerMode: string
    playerBackdropMode: string
  }
  download: {
    downloadFileNameRuleEnabled: boolean
    downloadFileNameParts: string[]
    downloadFileNameSeparator: string
    saveExternalMetadataFiles: boolean
  }
  sourceSwitch: {
    enabled: boolean
    rememberToggleChoices: boolean
    stages: Array<{ id: string; enabled: boolean }>
    platformOrder: string[]
    platformEnabled: Record<string, boolean>
    scriptOrder: string[]
    scriptEnabled: Record<string, boolean>
  }
}

export interface DataSyncSnapshot {
  revision: number
  sourceId: string
  sourceName: string
  updatedAt: number
  data: DataSyncSnapshotData
}

export interface DataSyncStatus {
  available: boolean
  enabled: boolean
  mode: DataSyncMode
  autoResolveSyncConflicts: boolean
  conflictResolutionMode: DataSyncConflictResolutionMode
  serverRunning: boolean
  clientConnected: boolean
  serverPort: number
  serverAddresses: string[]
  clientHost: string
  connectionCode: string
  revision: number
  deviceId: string
  deviceName: string
  connectedDevices: DataSyncDeviceInfo[]
  trustedDevices: DataSyncDeviceInfo[]
  lastError: string | null
}

export interface DataSyncConfig {
  enabled: boolean
  mode: DataSyncMode
  autoResolveSyncConflicts: boolean
  conflictResolutionMode: DataSyncConflictResolutionMode
  serverPort: number
  clientHost: string
  connectionCode: string
}

export const DEFAULT_DATA_SYNC_PORT = 9527

export const createDefaultDataSyncConfig = (): DataSyncConfig => ({
  enabled: false,
  mode: 'server',
  autoResolveSyncConflicts: false,
  conflictResolutionMode: 'merge_local_remote',
  serverPort: DEFAULT_DATA_SYNC_PORT,
  clientHost: `http://127.0.0.1:${DEFAULT_DATA_SYNC_PORT}`,
  connectionCode: '',
})
