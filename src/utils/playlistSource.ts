/** Built-in queue source ids that map to fixed Chinese labels. */
const BUILTIN_PLAYLIST_SOURCE_LABELS: Record<string, string> = {
  favorites: '我喜欢的音乐',
  'local-favorites': '本地收藏',
  'daily-recommend': '每日推荐',
  recent: '最近播放',
  'local-library': '本地音乐',
  'personal-fm': '私人 FM',
  'netease-new-songs': '新歌速递',
  'netease-search': '搜索结果',
  queue: '播放队列',
}

/**
 * Resolve a human-readable label for the current play-queue origin.
 * Prefers an explicit display name; falls back to known fixed ids / common prefixes.
 */
export function resolvePlaylistSourceLabel(
  playlistId: string | null | undefined,
  playlistName: string | null | undefined,
): string | null {
  const name = playlistName?.trim()
  if (name) return name

  if (!playlistId) return null

  const builtin = BUILTIN_PLAYLIST_SOURCE_LABELS[playlistId]
  if (builtin) return builtin

  if (playlistId.startsWith('search-')) return '搜索结果'
  if (playlistId.startsWith('netease-intelligence-')) return '心动模式'
  if (playlistId.startsWith('netease-playlist-')) return '网易云歌单'
  if (playlistId.startsWith('online-playlist-')) return '在线歌单'
  if (playlistId.startsWith('my-online-playlist-')) return '在线歌单'
  if (playlistId.startsWith('online-album-')) return '专辑'
  if (playlistId.startsWith('album-')) return '专辑'
  if (playlistId.startsWith('artist-')) return '歌手'
  if (playlistId.startsWith('toplist-')) return '排行榜'
  if (playlistId.startsWith('local-album-')) return '本地专辑'
  if (playlistId.startsWith('local-artist-')) return '本地歌手'
  if (playlistId.startsWith('local_playlist_')) return '本地歌单'

  return null
}
