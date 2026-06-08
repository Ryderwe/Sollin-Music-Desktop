import { importSharedOnlinePlaylist } from '@/services/sharedOnlinePlaylistImport'
import { useUserStore } from '@/stores/userStore'

const AUTO_UPDATE_INTERVAL_MS = 12 * 60 * 60 * 1000

export interface OnlinePlaylistAutoUpdateSummary {
  checked: number
  updated: number
  failed: number
}

const shouldRefreshPlaylist = (lastSyncedAt?: string | null, force?: boolean) => {
  if (force) return true
  if (!lastSyncedAt) return true

  const lastSyncedTime = Date.parse(lastSyncedAt)
  if (!Number.isFinite(lastSyncedTime)) return true

  return Date.now() - lastSyncedTime >= AUTO_UPDATE_INTERVAL_MS
}

export const refreshAutoUpdateOnlinePlaylists = async(options?: { force?: boolean }): Promise<OnlinePlaylistAutoUpdateSummary> => {
  const playlists = useUserStore.getState().onlinePlaylists.filter((playlist) => (
    playlist.autoUpdate === true &&
    Boolean(playlist.sourceId?.trim()) &&
    shouldRefreshPlaylist(playlist.lastSyncedAt, options?.force)
  ))

  const summary: OnlinePlaylistAutoUpdateSummary = {
    checked: playlists.length,
    updated: 0,
    failed: 0,
  }

  for (const playlist of playlists) {
    try {
      const result = await importSharedOnlinePlaylist(playlist.source, playlist.sourceId, {
        force: true,
        playlistId: playlist.id,
        externalType: playlist.externalType ?? 'playlist',
      })

      if (!result) {
        summary.failed += 1
        useUserStore.getState().markOnlinePlaylistSyncStatus(playlist.id, {
          lastSyncedAt: playlist.lastSyncedAt ?? null,
          lastSyncError: '刷新失败，请检查歌单来源是否有效',
        })
        continue
      }

      summary.updated += 1
    } catch (error) {
      summary.failed += 1
      useUserStore.getState().markOnlinePlaylistSyncStatus(playlist.id, {
        lastSyncedAt: playlist.lastSyncedAt ?? null,
        lastSyncError: error instanceof Error ? error.message : '刷新失败',
      })
    }
  }

  return summary
}
