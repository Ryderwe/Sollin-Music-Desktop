import api from '@/services/api'
import { useUserStore } from '@/stores/userStore'
import type { OnlinePlaylist, OnlinePlaylistSong, Platform, PlaylistDetail } from '@/types'

export type ImportedOnlinePlaylistAction = 'created' | 'updated'

const toOnlinePlaylistSongs = (platform: Platform, detail: PlaylistDetail): OnlinePlaylistSong[] => {
  return detail.songs.map((item) => ({
    id: item.id,
    name: item.name,
    artist: item.artist,
    album: item.album,
    duration: item.duration,
    cover: item.cover,
    url: item.url,
    platform,
    types: item.lx?.types?.map((quality) => quality.type) || [],
  }))
}

export const buildImportedOnlinePlaylist = (
  platform: Platform,
  sourceId: string,
  detail: PlaylistDetail,
  options?: {
    playlistId?: string
    externalType?: string | null
    importedAt?: string
    autoUpdate?: boolean
    lastSyncedAt?: string | null
  },
): OnlinePlaylist => {
  const songs = toOnlinePlaylistSongs(platform, detail)
  const importedAt = options?.importedAt || new Date().toISOString()

  return {
    id: options?.playlistId || `online_${platform}_${sourceId}`,
    sourceId,
    source: platform,
    name: detail.name,
    description: detail.description,
    author: detail.author,
    cover: detail.cover,
    songs,
    songCount: songs.length,
    importedAt,
    externalType: options?.externalType ?? 'playlist',
    autoUpdate: options?.autoUpdate ?? true,
    lastSyncedAt: options?.lastSyncedAt ?? importedAt,
    lastSyncError: null,
  }
}

export const fetchImportedOnlinePlaylist = async(
  platform: Platform,
  rawInput: string,
  options?: {
    force?: boolean
    playlistId?: string
    externalType?: string | null
  },
) => {
  const sourceId = rawInput.trim()
  if (!sourceId) return null

  const detail = await api.getPlaylistDetail(platform, sourceId, { force: options?.force })
  if (!detail) return null

  return {
    detail,
    playlist: buildImportedOnlinePlaylist(platform, sourceId, detail, {
      playlistId: options?.playlistId,
      externalType: options?.externalType,
    }),
  }
}

export const importSharedOnlinePlaylist = async(
  platform: Platform,
  rawInput: string,
  options?: {
    force?: boolean
    playlistId?: string
    externalType?: string | null
  },
) => {
  const result = await fetchImportedOnlinePlaylist(platform, rawInput, options)
  if (!result) return null

  const action = useUserStore.getState().upsertOnlinePlaylist(result.playlist)
  return {
    ...result,
    action,
  } satisfies {
    detail: PlaylistDetail
    playlist: OnlinePlaylist
    action: ImportedOnlinePlaylistAction
  }
}
