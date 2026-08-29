import { backupBridge } from '@/services/backupBridge'
import { useDownloadStore } from '@/stores/downloadStore'
import { useFeatureStore } from '@/stores/featureStore'
import type { SourceSwitchStage, SourceSwitchStageId } from '@/stores/sourceSwitchSettingsStore'
import { useSourceSwitchSettingsStore } from '@/stores/sourceSwitchSettingsStore'
import type { BackgroundSettings } from '@/stores/uiStore'
import { useUIStore, DEFAULT_BACKGROUND_SETTINGS, GLOBAL_FONT_SIZE_DEFAULT } from '@/stores/uiStore'
import { useUserStore, type FavoriteSyncChange } from '@/stores/userStore'
import type { DataSyncSnapshotData } from '@/types/dataSync'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}

const isSameValue = (left: unknown, right: unknown) => (
  stableSerialize(left) === stableSerialize(right)
)

const isSameSnapshotData = (left: DataSyncSnapshotData, right: DataSyncSnapshotData) => (
  isSameValue(left, right)
)

const getSongKey = (song: unknown): string => {
  if (!song || typeof song !== 'object') return ''
  const value = song as { id?: unknown; platform?: unknown }
  if (value.id == null || value.platform == null) return ''
  return `${String(value.platform)}:${String(value.id)}`
}

const mergeOnlineFavorites = <T,>(
  localFavorites: T[],
  remoteFavorites: T[],
  changes: Record<string, FavoriteSyncChange>,
): T[] => {
  const merged: T[] = []
  const seen = new Set<string>()

  // Keep the local order stable, then append remote-only additions. A stale
  // remote snapshot must not reorder or erase a favorite that was saved here
  // while the sync peer was offline or reconnecting.
  for (const song of [...localFavorites, ...remoteFavorites]) {
    const key = getSongKey(song)
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    merged.push(song)
  }

  const localByKey = new Map(localFavorites.map((song) => [getSongKey(song), song]))
  for (const [key, change] of Object.entries(changes)) {
    if (change.action === 'remove') {
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        if (getSongKey(merged[index]) === key) merged.splice(index, 1)
      }
      continue
    }

    const preferredSong = localByKey.get(key) || (change.action === 'add' ? change.song as unknown as T : undefined)
    if (!preferredSong) continue
    const existingIndex = merged.findIndex((song) => getSongKey(song) === key)
    if (existingIndex >= 0) {
      merged[existingIndex] = preferredSong
    } else {
      merged.unshift(preferredSong)
    }
  }

  return merged
}

const pruneAcknowledgedFavoriteChanges = (
  changes: Record<string, FavoriteSyncChange>,
  remoteFavorites: unknown[],
) => {
  const remoteKeys = new Set(remoteFavorites.map(getSongKey).filter(Boolean))
  return Object.fromEntries(
    Object.entries(changes).filter(([key, change]) => (
      change.action === 'add' ? !remoteKeys.has(key) : remoteKeys.has(key)
    )),
  ) as Record<string, FavoriteSyncChange>
}

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
      globalFontSize: uiState.globalFontSize,
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
  const favoriteSyncChanges = userState.favoriteSyncChanges || {}
  const remoteFavorites = clone(snapshot.user.favorites as typeof userState.favorites)
  const mergedFavorites = mergeOnlineFavorites(
    userState.favorites,
    remoteFavorites,
    favoriteSyncChanges,
  )
  const nextFavoriteSyncChanges = pruneAcknowledgedFavoriteChanges(favoriteSyncChanges, remoteFavorites)
  const nextSnapshot: DataSyncSnapshotData = {
    user: {
      favorites: clone(mergedFavorites),
      playlists: clone(snapshot.user.playlists as typeof userState.playlists),
      onlinePlaylists: clone(snapshot.user.onlinePlaylists as typeof userState.onlinePlaylists),
      recentlyPlayed: clone(snapshot.user.recentlyPlayed as typeof userState.recentlyPlayed),
      playHistory: clone(snapshot.user.playHistory as typeof userState.playHistory),
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
      globalFontSize: snapshot.ui.globalFontSize ?? GLOBAL_FONT_SIZE_DEFAULT,
      closeBehavior: snapshot.ui.closeBehavior,
      backgroundSettings: clone(snapshot.ui.backgroundSettings),
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
      stages: snapshot.sourceSwitch.stages.map((stage) => ({ ...stage })),
      platformOrder: [...snapshot.sourceSwitch.platformOrder],
      platformEnabled: { ...snapshot.sourceSwitch.platformEnabled },
      scriptOrder: [...snapshot.sourceSwitch.scriptOrder],
      scriptEnabled: { ...snapshot.sourceSwitch.scriptEnabled },
    },
  }

  const currentSnapshot = buildDataSyncSnapshotData()
  const snapshotChanged = !isSameSnapshotData(currentSnapshot, nextSnapshot)
  const favoriteChangesChanged = !isSameValue(
    { favoriteSyncChanges },
    { favoriteSyncChanges: nextFavoriteSyncChanges },
  )

  // A peer may resend the same snapshot while reconnecting. Avoid touching
  // any Zustand store in that case: persist middleware and subscribers would
  // otherwise schedule another outbound snapshot forever.
  if (!snapshotChanged && !favoriteChangesChanged) return false

  if (snapshotChanged || favoriteChangesChanged) {
    useUserStore.setState({
      favorites: mergedFavorites,
      favoriteSyncChanges: nextFavoriteSyncChanges,
      playlists: nextSnapshot.user.playlists as typeof userState.playlists,
      onlinePlaylists: nextSnapshot.user.onlinePlaylists as typeof userState.onlinePlaylists,
      recentlyPlayed: nextSnapshot.user.recentlyPlayed as typeof userState.recentlyPlayed,
      playHistory: nextSnapshot.user.playHistory as typeof userState.playHistory,
      playlistSectionOrder: [...nextSnapshot.user.playlistSectionOrder] as typeof userState.playlistSectionOrder,
    })
  }

  if (!snapshotChanged) return favoriteChangesChanged

  featureState.setDislikeRules(nextSnapshot.feature.dislikeRules)
  useFeatureStore.setState({
    searchHistory: [...nextSnapshot.feature.searchHistory],
  })

  uiState.setTheme(nextSnapshot.ui.theme)
  uiState.setFontFamily(nextSnapshot.ui.fontFamily)
  uiState.setCustomFontDataUrl(nextSnapshot.ui.customFontDataUrl)
  uiState.setGlobalFontSize(nextSnapshot.ui.globalFontSize ?? GLOBAL_FONT_SIZE_DEFAULT)
  if (nextSnapshot.ui.customFontDataUrl && nextSnapshot.ui.fontFamily === 'CustomImportedFont, sans-serif') {
    applyCustomFontFace(nextSnapshot.ui.customFontDataUrl)
  } else if (!nextSnapshot.ui.customFontDataUrl) {
    const existing = document.getElementById('custom-font-face')
    if (existing) existing.remove()
  }
  uiState.setCloseBehavior(nextSnapshot.ui.closeBehavior)
  uiState.setBackgroundSettings({
    ...DEFAULT_BACKGROUND_SETTINGS,
    ...nextSnapshot.ui.backgroundSettings,
  } as Partial<BackgroundSettings>)
  uiState.setLyricsPlayerMode(nextSnapshot.ui.lyricsPlayerMode as any)
  uiState.setPlayerBackdropMode(nextSnapshot.ui.playerBackdropMode as any)

  downloadState.setDownloadFileNameRuleEnabled(nextSnapshot.download.downloadFileNameRuleEnabled)
  downloadState.setDownloadFileNameParts(nextSnapshot.download.downloadFileNameParts as any)
  downloadState.setDownloadFileNameSeparator(nextSnapshot.download.downloadFileNameSeparator)
  downloadState.setSaveExternalMetadataFiles(nextSnapshot.download.saveExternalMetadataFiles)

  const nextPlatformEnabled = { ...sourceSwitchState.platformEnabled, ...nextSnapshot.sourceSwitch.platformEnabled }
  const nextScriptEnabled = { ...sourceSwitchState.scriptEnabled, ...nextSnapshot.sourceSwitch.scriptEnabled }

  useSourceSwitchSettingsStore.setState({
    enabled: nextSnapshot.sourceSwitch.enabled,
    rememberToggleChoices: nextSnapshot.sourceSwitch.rememberToggleChoices,
    stages: nextSnapshot.sourceSwitch.stages.map((stage: { id: string; enabled: boolean }) => ({
      id: stage.id as SourceSwitchStageId,
      enabled: stage.enabled,
    })) as SourceSwitchStage[],
    platformOrder: [...nextSnapshot.sourceSwitch.platformOrder] as typeof sourceSwitchState.platformOrder,
    platformEnabled: nextPlatformEnabled,
    scriptOrder: [...nextSnapshot.sourceSwitch.scriptOrder],
    scriptEnabled: nextScriptEnabled,
  })

  backupBridge.setOnlineFavorites(mapSongsToBackupFavorites(nextSnapshot.user.favorites as any))
  backupBridge.setOnlinePlaylists(mapOnlinePlaylistsToBackupPlaylists(nextSnapshot.user.onlinePlaylists as any))
  return true
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
