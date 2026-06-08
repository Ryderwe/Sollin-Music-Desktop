import { useState, memo } from 'react'
import {
  Play,
  Pause,
  Heart,
  MoreHorizontal,
  Plus,
  ListPlus,
  Trash2,
  Download,
  Tags,
  Ban,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/stores/playerStore'
import { useUserStore } from '@/stores/userStore'
import { useUIStore } from '@/stores/uiStore'
import { useFeatureStore } from '@/stores/featureStore'
import { cn } from '@/utils/cn'
import { getPlatformName, getPlatformColor } from '@/utils/format'
import { formatDislikeRule, isDislikedSong } from '@/services/dislikeRules'
import type { Song } from '@/types'
import CoverImage from '@/components/ui/CoverImage'
import { downloadManager } from '@/services/downloadManager'
import { isSamePlayableSong } from '@/utils/songIdentity'

interface SongRowProps {
  song: Song
  index?: number
  showIndex?: number
  showCover?: boolean
  showAlbum?: boolean
  showPlatform?: boolean
  compact?: boolean
  playlist?: Song[]
  playlistId?: string
  isPlaying?: boolean
  onPlay?: () => void
}

export default memo(function SongRow({
  song,
  index,
  showIndex,
  showCover = true,
  showAlbum = true,
  showPlatform = true,
  compact = false,
  playlist,
  playlistId,
  isPlaying: isPlayingProp,
  onPlay,
}: SongRowProps) {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isFavorite = useUserStore((s) => s.isFavorite)
  const addToFavorites = useUserStore((s) => s.addToFavorites)
  const removeFromFavorites = useUserStore((s) => s.removeFromFavorites)
  const playlists = useUserStore((s) => s.playlists)
  const localPlaylists = useUserStore((s) => s.localPlaylists)
  const addToPlaylist = useUserStore((s) => s.addToPlaylist)
  const addToLocalPlaylist = useUserStore((s) => s.addToLocalPlaylist)
  const removeFromPlaylist = useUserStore((s) => s.removeFromPlaylist)
  const removeFromLocalPlaylist = useUserStore((s) => s.removeFromLocalPlaylist)
  const addToast = useUIStore((s) => s.addToast)
  const openLocalSongTagEditor = useUIStore((s) => s.openLocalSongTagEditor)
  const dislikeRules = useFeatureStore((s) => s.dislikeRules)
  const addDislikeRules = useFeatureStore((s) => s.addDislikeRules)

  const [isHovered, setIsHovered] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const isCurrentSong = isSamePlayableSong(currentSong, song)
  const isCurrentlyPlaying = isPlayingProp ?? (isCurrentSong && isPlaying)
  const isFavorited = isFavorite(song.id, song.platform)
  const isDisliked = isDislikedSong(song, dislikeRules)
  const selectablePlaylists = song.platform === 'local' ? localPlaylists : playlists
  const isCurrentPlaylistLocal = playlistId?.startsWith('local_playlist_')

  const handlePlay = () => {
    if (onPlay) {
      onPlay()
      return
    }

    if (isCurrentSong) {
      usePlayerStore.getState().togglePlay()
    } else {
      usePlayerStore.getState().playSong(song, playlist || [song], playlistId)
    }
  }

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isFavorited) {
      removeFromFavorites(song.id, song.platform)
      addToast({ type: 'success', message: '已从喜欢中移除' })
    } else {
      addToFavorites(song)
      addToast({ type: 'success', message: '已添加到喜欢' })
    }
  }

  const handleAddToPlaylist = (playlistId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (song.platform === 'local') {
      addToLocalPlaylist(playlistId, song)
      addToast({ type: 'success', message: '已添加到本地歌单' })
      return
    }
    addToPlaylist(playlistId, song)
    addToast({ type: 'success', message: '已添加到歌单' })
  }

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isDisliked) {
      addToast({ type: 'warning', message: '已匹配屏蔽规则，未加入播放队列' })
      return
    }
    usePlayerStore.getState().addToQueue(song)
    addToast({ type: 'success', message: '已添加到播放队列' })
  }

  const handleAddDislikeRule = (rule: string, e?: Event) => {
    e?.stopPropagation()
    if (!rule) return
    addDislikeRules(rule)
    addToast({ type: 'success', message: '已添加到屏蔽规则' })
  }

  const handleDownload = async(e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isDownloading) return

    try {
      setIsDownloading(true)
      addToast({
        type: 'info',
        message: '开始下载，已加入下载队列',
      })

      const result = await downloadManager.downloadSong(song)
      addToast({
        type: result.warning ? 'warning' : 'success',
        message: result.warning || '下载完成并写入元数据',
      })
    } catch (error) {
      console.error('Download song failed:', error)
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : '下载失败',
      })
    } finally {
      setIsDownloading(false)
    }
  }

  // Compact mode for queue panel
  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group',
          isCurrentSong && 'bg-primary-500/10',
          isDisliked && 'opacity-55'
        )}
        onClick={handlePlay}
      >
        <span className={cn(
          'w-5 text-xs text-center flex-shrink-0',
          isCurrentSong ? 'text-primary-500 font-medium' : 'text-[var(--text-muted)]'
        )}>
          {showIndex ?? (index !== undefined ? index + 1 : '')}
        </span>
        {showCover && (
          <CoverImage
            src={song.cover}
            alt={song.name}
            className="w-8 h-8 rounded flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <h4 className={cn(
            'text-sm font-medium truncate',
            isCurrentSong && 'text-primary-500'
          )}>
            {song.name}
          </h4>
          <p className="text-xs text-[var(--text-secondary)] truncate">{song.artist}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'song-row group',
        isCurrentSong && 'playing bg-primary-500/10',
        isDisliked && 'opacity-60'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handlePlay}
    >
      {/* Index or play button */}
      <div className="w-8 flex items-center justify-center">
        {isHovered || isCurrentlyPlaying ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handlePlay()
            }}
            className="text-primary-500"
          >
            {isCurrentlyPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>
        ) : (
          <span className={cn(
            'text-sm',
            isCurrentSong ? 'text-primary-500 font-medium' : 'text-[var(--text-muted)]'
          )}>
            {showIndex ?? (index !== undefined ? index + 1 : '')}
          </span>
        )}
      </div>

      {/* Cover */}
      {showCover && (
        <CoverImage
          src={song.cover}
          alt={song.name}
          className="w-10 h-10 rounded"
        />
      )}

      {/* Song info */}
      <div className="flex-1 min-w-0">
        <h4 className={cn(
          'text-sm font-medium truncate',
          isCurrentSong && 'text-primary-500'
        )}>
          {song.name}
        </h4>
        <p className="text-xs text-[var(--text-secondary)] truncate">{song.artist}</p>
      </div>

      {/* Album */}
      {showAlbum && (
        <div className="w-40 hidden md:block">
          <p className="text-sm text-[var(--text-secondary)] truncate">{song.album}</p>
        </div>
      )}

      {/* Platform badge */}
      {showPlatform && (
        <div className="w-20 hidden lg:flex items-center gap-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: getPlatformColor(song.platform) }}
          />
          <span className="text-xs text-[var(--text-muted)]">
            {getPlatformName(song.platform)}
          </span>
        </div>
      )}


      {/* Actions */}
      <div className={cn(
        'flex items-center gap-1 transition-opacity',
        isHovered ? 'opacity-100' : 'opacity-0'
      )}>
        <button
          onClick={handleFavorite}
          className="btn-icon"
        >
          <Heart
            className={cn(
              'w-4 h-4',
              isFavorited && 'fill-primary-500 text-primary-500'
            )}
          />
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="btn-icon"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="min-w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-1 z-50"
              sideOffset={5}
            >
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none">
                  <ListPlus className="w-4 h-4" />
                  添加到歌单
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    className="min-w-40 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-1 z-50"
                    sideOffset={2}
                    alignOffset={-5}
                  >
                    {selectablePlaylists.map((p) => (
                      <DropdownMenu.Item
                        key={p.id}
                        className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                        onClick={(e) => handleAddToPlaylist(p.id, e)}
                      >
                        {p.name}
                      </DropdownMenu.Item>
                    ))}
                    {selectablePlaylists.length === 0 && (
                      <div className="px-3 py-2 text-sm text-[var(--text-muted)]">{song.platform === 'local' ? '暂无本地歌单' : '暂无歌单'}</div>
                    )}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>

              <DropdownMenu.Item
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                onClick={handleAddToQueue}
              >
                <Plus className="w-4 h-4" />
                添加到播放队列
              </DropdownMenu.Item>

              {song.platform === 'local' && song.localPath && (
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                  onClick={(e) => {
                    e.stopPropagation()
                    openLocalSongTagEditor(song)
                  }}
                >
                  <Tags className="w-4 h-4" />
                  查看 / 编辑内嵌标签
                </DropdownMenu.Item>
              )}

              {song.platform !== 'local' && (
                <DropdownMenu.Item
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-sm rounded-md outline-none',
                    isDownloading
                      ? 'cursor-not-allowed opacity-50'
                      : 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700'
                  )}
                  onClick={handleDownload}
                  disabled={isDownloading}
                >
                  <Download className="w-4 h-4" />
                  {isDownloading ? '下载中...' : '下载'}
                </DropdownMenu.Item>
              )}

              <DropdownMenu.Separator className="h-px bg-gray-200 dark:bg-gray-700 my-1" />

              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none">
                  <Ban className="w-4 h-4" />
                  添加到屏蔽规则
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    className="min-w-44 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-1 z-50"
                    sideOffset={2}
                    alignOffset={-5}
                  >
                    <DropdownMenu.Item
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                      onSelect={(event) => handleAddDislikeRule(formatDislikeRule(song.name), event)}
                    >
                      屏蔽歌曲
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                      onSelect={(event) => handleAddDislikeRule(formatDislikeRule(null, song.artist), event)}
                    >
                      屏蔽歌手
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none"
                      onSelect={(event) => handleAddDislikeRule(formatDislikeRule(song.name, song.artist), event)}
                    >
                      屏蔽歌曲和歌手
                    </DropdownMenu.Item>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>

              <DropdownMenu.Separator className="h-px bg-gray-200 dark:bg-gray-700 my-1" />

              {playlistId && ((isCurrentPlaylistLocal && localPlaylists.some((p) => p.id === playlistId)) || (!isCurrentPlaylistLocal && playlists.some((p) => p.id === playlistId))) && (
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none text-red-500"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isCurrentPlaylistLocal) {
                      removeFromLocalPlaylist(playlistId, song.id, song.platform)
                      addToast({ type: 'success', message: '已从本地歌单中移除' })
                    } else {
                      removeFromPlaylist(playlistId, song.id, song.platform)
                      addToast({ type: 'success', message: '已从歌单中移除' })
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                  {isCurrentPlaylistLocal ? '从本地歌单中删除' : '从歌单中删除'}
                </DropdownMenu.Item>
              )}

              {(playlistId === 'favorites' || playlistId === 'local-favorites') && (
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 outline-none text-red-500"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeFromFavorites(song.id, song.platform)
                    addToast({ type: 'success', message: '已从喜欢中移除' })
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                  {playlistId === 'local-favorites' ? '从本地收藏中删除' : '从喜欢的音乐中删除'}
                </DropdownMenu.Item>
              )}

            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  )
})
