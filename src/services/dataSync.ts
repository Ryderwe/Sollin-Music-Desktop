import type {
  DataSyncConfig,
  DataSyncSnapshot,
  DataSyncSnapshotData,
  DataSyncStatus,
} from '@/types/dataSync'
import { createDefaultDataSyncConfig } from '@/types/dataSync'

type DataSyncEventListener = (status: DataSyncStatus) => void
type SnapshotListener = (snapshot: DataSyncSnapshot | null) => void

const isElectronAvailable = () => typeof window !== 'undefined' && !!window.electronAPI

const defaultSnapshot: DataSyncSnapshotData = {
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
}

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

class DataSyncService {
  private status: DataSyncStatus = {
    available: false,
    enabled: false,
    mode: 'server',
    autoResolveSyncConflicts: false,
    conflictResolutionMode: 'merge_local_remote',
    serverRunning: false,
    clientConnected: false,
    serverPort: createDefaultDataSyncConfig().serverPort,
    serverAddresses: [],
    clientHost: '',
    connectionCode: '',
    revision: 0,
    deviceId: '',
    deviceName: '',
    connectedDevices: [],
    trustedDevices: [],
    lastError: null,
  }

  private snapshot: DataSyncSnapshot | null = null
  private statusListeners = new Set<DataSyncEventListener>()
  private snapshotListeners = new Set<SnapshotListener>()

  async initialize() {
    if (!isElectronAvailable()) return
    await this.refreshStatus()

    window.electronAPI?.onDataSyncStatus?.((nextStatus) => {
      this.status = nextStatus
      this.emitStatus()
    })

    window.electronAPI?.onDataSyncSnapshot?.((snapshot) => {
      this.snapshot = snapshot
      this.emitSnapshot()
    })
  }

  onStatus(listener: DataSyncEventListener) {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  onSnapshot(listener: SnapshotListener) {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  getStatus() {
    return this.status
  }

  getSnapshot() {
    return this.snapshot
  }

  async refreshStatus() {
    if (!window.electronAPI?.getDataSyncStatus) return this.status
    this.status = await window.electronAPI.getDataSyncStatus()
    this.emitStatus()
    return this.status
  }

  async updateConfig(patch: Partial<DataSyncConfig>) {
    if (!window.electronAPI?.updateDataSyncConfig) return this.status
    this.status = await window.electronAPI.updateDataSyncConfig(patch)
    this.emitStatus()
    return this.status
  }

  async connectClient(code: string) {
    if (!window.electronAPI?.connectDataSyncClient) return this.status
    this.status = await window.electronAPI.connectDataSyncClient(code)
    this.emitStatus()
    return this.status
  }

  async disconnect() {
    if (!window.electronAPI?.disconnectDataSync) return this.status
    this.status = await window.electronAPI.disconnectDataSync()
    this.emitStatus()
    return this.status
  }

  async removeDevice(deviceId: string) {
    if (!window.electronAPI?.removeDataSyncDevice) return this.status
    this.status = await window.electronAPI.removeDataSyncDevice(deviceId)
    this.emitStatus()
    return this.status
  }

  async refreshCode() {
    if (!window.electronAPI?.refreshDataSyncCode) return this.status
    this.status = await window.electronAPI.refreshDataSyncCode()
    this.emitStatus()
    return this.status
  }

  async pushSnapshot(snapshot: DataSyncSnapshotData = defaultSnapshot) {
    if (!window.electronAPI?.pushDataSyncSnapshot) return null
    const next = cloneSnapshot(snapshot)
    this.snapshot = {
      revision: this.status.revision,
      sourceId: this.status.deviceId,
      sourceName: this.status.deviceName,
      updatedAt: Date.now(),
      data: next,
    }
    await window.electronAPI.pushDataSyncSnapshot(next)
    this.emitSnapshot()
    return this.snapshot
  }

  createDefaultSnapshot() {
    return cloneSnapshot(defaultSnapshot)
  }

  getDefaultConfig() {
    return createDefaultDataSyncConfig()
  }

  private emitStatus() {
    for (const listener of this.statusListeners) {
      listener(this.status)
    }
  }

  private emitSnapshot() {
    for (const listener of this.snapshotListeners) {
      listener(this.snapshot)
    }
  }
}

export const dataSyncService = new DataSyncService()
export default dataSyncService

export const getDataSyncStatus = () => dataSyncService.getStatus()
export const getDataSyncSnapshot = () => dataSyncService.getSnapshot()
export const updateDataSyncConfig = (patch: Partial<DataSyncConfig>) => dataSyncService.updateConfig(patch)
export const connectDataSyncClient = (code: string) => dataSyncService.connectClient(code)
export const disconnectDataSync = () => dataSyncService.disconnect()
export const refreshDataSyncCode = () => dataSyncService.refreshCode()
export const removeDataSyncDevice = (deviceId: string) => dataSyncService.removeDevice(deviceId)
export const pushDataSyncSnapshot = (snapshot: DataSyncSnapshotData) => dataSyncService.pushSnapshot(snapshot)
