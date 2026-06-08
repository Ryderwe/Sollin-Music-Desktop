import { backupBridge } from '@/services/backupBridge'
import { useDownloadStore } from '@/stores/downloadStore'
import { useFeatureStore } from '@/stores/featureStore'
import type { SourceSwitchStage, SourceSwitchStageId } from '@/stores/sourceSwitchSettingsStore'
import { useSourceSwitchSettingsStore } from '@/stores/sourceSwitchSettingsStore'
import type { BackgroundSettings } from '@/stores/uiStore'
import { useUIStore, DEFAULT_BACKGROUND_SETTINGS } from '@/stores/uiStore'
import { useUserStore } from '@/stores/userStore'
import type { DataSyncSnapshotData } from '@/types/dataSync'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const toBackupSource = (platform: string) => {
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
    default:
      return platform
  }
}

const mapSongsToBackupFavorites = (songs: Array<{ platform: string; id: string; name: string; artist: string; album: string; cover?: string; duration: number }>) => songs.map((item) => ({
  source: toBackupSource(item.platform),
  songId: item.id,
  addedAtMs: Date.now(),
  name: item.name,
  artist: item.artist,
  album: item.album,
  cover: item.cover || null,
  durationMs: item.duration > 0 ? item.duration * 1000 : null,
}))

const mapOnlinePlaylistsToBackupPlaylists = (playlists: Array<any>) => playlists.map((playlist) => ({
  id: playlist.id,
  name: playlist.name,
  description: playlist.description || null,
  songs: Array.isArray(playlist.songs) ? mapSongsToBackupFavorites(playlist.songs) : [],
  externalSource: playlist.source ? toBackupSource(playlist.source) : null,
  externalType: playlist.externalType || null,
  externalId: playlist.sourceId || null,
  createdAtMs: Date.parse(playlist.importedAt || '') || Date.now(),
  updatedAtMs: Date.parse(playlist.lastSyncedAt || playlist.importedAt || '') || Date.now(),
}))

const applyCustomFontFace = (dataUrl: string) => {
  const existing = document.getElementById('custom-font-face')
  if (existing) existing.remove()

  if (!dataUrl) return

  const style = document.createElement('style')
  style.id = 'custom-font-face'
  style.textContent = `
    @font-face {
      font-family: 'CustomImportedFont';
      src: url('${dataUrl}');
      font-weight: normal;
      font-style: normal;
    }
  `
  document.head.appendChild(style)
}

export const buildDataSyncSnapshotData = (): DataSyncSnapshotData => {
  const userState = useUserStore.getState()
  const featureState = useFeatureStore.getState()
  const uiState = useUIStore.getState()
  const downloadState = useDownloadStore.getState()
  const sourceSwitchState = useSourceSwitchSettingsStore.getState()

  return {
    user: {
      favorites: clone(userState.favorites),
      playlists: clone(userState.playlists),
      onlinePlaylists: clone(userState.onlinePlaylists),
      recentlyPlayed: clone(userState.recentlyPlayed),
      playHistory: clone(userState.playHistory),
      playlistSectionOrder: [...userState.playlistSectionOrder],
    },
    feature: {
      dislikeRules: featureState.dislikeRules,
      searchHistory: [...featureState.searchHistory],
    },
    ui: {
      theme: uiState.theme,
      fontFamily: uiState.fontFamily,
      customFontDataUrl: uiState.customFontDataUrl,
      closeBehavior: uiState.closeBehavior,
      backgroundSettings: clone(uiState.backgroundSettings) as unknown as Record<string, unknown>,
      lyricsPlayerMode: uiState.lyricsPlayerMode,
      playerBackdropMode: uiState.playerBackdropMode,
    },
    download: {
      downloadFileNameRuleEnabled: downloadState.downloadFileNameRuleEnabled,
      downloadFileNameParts: [...downloadState.downloadFileNameParts],
      downloadFileNameSeparator: downloadState.downloadFileNameSeparator,
      saveExternalMetadataFiles: downloadState.saveExternalMetadataFiles,
    },
    sourceSwitch: {
      enabled: sourceSwitchState.enabled,
      rememberToggleChoices: sourceSwitchState.rememberToggleChoices,
      stages: sourceSwitchState.stages.map((stage) => ({ ...stage })),
      platformOrder: [...sourceSwitchState.platformOrder],
      platformEnabled: { ...sourceSwitchState.platformEnabled },
      scriptOrder: [...sourceSwitchState.scriptOrder],
      scriptEnabled: { ...sourceSwitchState.scriptEnabled },
    },
  }
}

export const applyDataSyncSnapshotData = (snapshot: DataSyncSnapshotData) => {
  const uiState = useUIStore.getState()
  const userState = useUserStore.getState()
  const featureState = useFeatureStore.getState()
  const downloadState = useDownloadStore.getState()
  const sourceSwitchState = useSourceSwitchSettingsStore.getState()

  useUserStore.setState({
    favorites: clone(snapshot.user.favorites as typeof userState.favorites),
    playlists: clone(snapshot.user.playlists as typeof userState.playlists),
    onlinePlaylists: clone(snapshot.user.onlinePlaylists as typeof userState.onlinePlaylists),
    recentlyPlayed: clone(snapshot.user.recentlyPlayed as typeof userState.recentlyPlayed),
    playHistory: clone(snapshot.user.playHistory as typeof userState.playHistory),
    playlistSectionOrder: [...snapshot.user.playlistSectionOrder] as typeof userState.playlistSectionOrder,
  })

  featureState.setDislikeRules(snapshot.feature.dislikeRules)
  useFeatureStore.setState({
    searchHistory: [...snapshot.feature.searchHistory],
  })

  uiState.setTheme(snapshot.ui.theme)
  uiState.setFontFamily(snapshot.ui.fontFamily)
  uiState.setCustomFontDataUrl(snapshot.ui.customFontDataUrl)
  if (snapshot.ui.customFontDataUrl && snapshot.ui.fontFamily === 'CustomImportedFont, sans-serif') {
    applyCustomFontFace(snapshot.ui.customFontDataUrl)
  } else if (!snapshot.ui.customFontDataUrl) {
    const existing = document.getElementById('custom-font-face')
    if (existing) existing.remove()
  }
  uiState.setCloseBehavior(snapshot.ui.closeBehavior)
  uiState.setBackgroundSettings({
    ...DEFAULT_BACKGROUND_SETTINGS,
    ...snapshot.ui.backgroundSettings,
  } as Partial<BackgroundSettings>)
  uiState.setLyricsPlayerMode(snapshot.ui.lyricsPlayerMode as any)
  uiState.setPlayerBackdropMode(snapshot.ui.playerBackdropMode as any)

  downloadState.setDownloadFileNameRuleEnabled(snapshot.download.downloadFileNameRuleEnabled)
  downloadState.setDownloadFileNameParts(snapshot.download.downloadFileNameParts as any)
  downloadState.setDownloadFileNameSeparator(snapshot.download.downloadFileNameSeparator)
  downloadState.setSaveExternalMetadataFiles(snapshot.download.saveExternalMetadataFiles)

  const nextPlatformEnabled = { ...sourceSwitchState.platformEnabled, ...snapshot.sourceSwitch.platformEnabled }
  const nextScriptEnabled = { ...sourceSwitchState.scriptEnabled, ...snapshot.sourceSwitch.scriptEnabled }

  useSourceSwitchSettingsStore.setState({
    enabled: snapshot.sourceSwitch.enabled,
    rememberToggleChoices: snapshot.sourceSwitch.rememberToggleChoices,
    stages: snapshot.sourceSwitch.stages.map((stage: { id: string; enabled: boolean }) => ({
      id: stage.id as SourceSwitchStageId,
      enabled: stage.enabled,
    })) as SourceSwitchStage[],
    platformOrder: [...snapshot.sourceSwitch.platformOrder] as typeof sourceSwitchState.platformOrder,
    platformEnabled: nextPlatformEnabled,
    scriptOrder: [...snapshot.sourceSwitch.scriptOrder],
    scriptEnabled: nextScriptEnabled,
  })

  backupBridge.setOnlineFavorites(mapSongsToBackupFavorites(snapshot.user.favorites as any))
  backupBridge.setOnlinePlaylists(mapOnlinePlaylistsToBackupPlaylists(snapshot.user.onlinePlaylists as any))
}

export const isDataSyncSnapshotEmpty = (snapshot: DataSyncSnapshotData) => (
  snapshot.user.favorites.length === 0 &&
  snapshot.user.playlists.length === 0 &&
  snapshot.user.onlinePlaylists.length === 0 &&
  snapshot.user.recentlyPlayed.length === 0 &&
  snapshot.user.playHistory.length === 0 &&
  snapshot.feature.dislikeRules.trim() === '' &&
  snapshot.feature.searchHistory.length === 0
)
