import type { OnlinePlaylist } from '@/types'

const LOCAL_ONLINE_PLAYLIST_ROUTE = '/my-online-playlist'

export const getOnlinePlaylistBrowsePath = (
  playlist: Pick<OnlinePlaylist, 'id' | 'source' | 'sourceId'> & { externalType?: string | null },
) => {
  return `${LOCAL_ONLINE_PLAYLIST_ROUTE}/${encodeURIComponent(playlist.id)}`
}
