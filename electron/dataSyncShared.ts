export type DataSyncMode = 'server' | 'client'

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
  serverPort: number
  clientHost: string
  connectionCode: string
}

export const DEFAULT_DATA_SYNC_PORT = 23332

export const createDefaultDataSyncConfig = (): DataSyncConfig => ({
  enabled: false,
  mode: 'server',
  serverPort: DEFAULT_DATA_SYNC_PORT,
  clientHost: `http://127.0.0.1:${DEFAULT_DATA_SYNC_PORT}`,
  connectionCode: '',
})
