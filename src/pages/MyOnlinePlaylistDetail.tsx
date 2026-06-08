import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Globe, Play, RefreshCw, Repeat, Trash2 } from 'lucide-react'
import ExpandableSearch from '@/components/ui/ExpandableSearch'
import SongRow from '@/components/SongRow'
import CoverImage from '@/components/ui/CoverImage'
import { usePlayerStore } from '@/stores/playerStore'
import { useUserStore } from '@/stores/userStore'
import { useUIStore } from '@/stores/uiStore'
import { importSharedOnlinePlaylist } from '@/services/sharedOnlinePlaylistImport'
import { getOnlinePlaylistBrowsePath } from '@/utils/onlinePlaylistRoute'
import { formatDate } from '@/utils/format'
import type { Platform } from '@/types'

const DISPLAY_PAGE_SIZE = 50

const PLATFORM_NAMES: Record<Platform, string> = {
  netease: '小芸音乐',
  qq: '小秋音乐',
  kugou: '小枸音乐',
  kuwo: '小蜗音乐',
  migu: '小蜜音乐',
}

const getOnlinePlaylistLabel = (playlist: { source: Platform; sourceId: string; externalType?: string | null }) => {
  return !playlist.sourceId.trim() || !(playlist.externalType?.trim())
    ? '自建歌单'
    : PLATFORM_NAMES[playlist.source]
}

export default function MyOnlinePlaylistDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [displayCount, setDisplayCount] = useState(DISPLAY_PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const onlinePlaylists = useUserStore((state) => state.onlinePlaylists)
  const setOnlinePlaylistAutoUpdate = useUserStore((state) => state.setOnlinePlaylistAutoUpdate)
  const removeOnlinePlaylist = useUserStore((state) => state.removeOnlinePlaylist)
  const { playSong, setPlaylist } = usePlayerStore()
  const { addToast } = useUIStore()

  const playlist = useMemo(
    () => onlinePlaylists.find((item) => item.id === id),
    [onlinePlaylists, id],
  )

  const filteredSongs = useMemo(() => {
    if (!playlist) return []
    const query = searchQuery.trim().toLowerCase()
    if (!query) return playlist.songs

    return playlist.songs.filter((song) => (
      song.name.toLowerCase().includes(query) ||
      song.artist.toLowerCase().includes(query) ||
      song.album.toLowerCase().includes(query)
    ))
  }, [playlist, searchQuery])

  // Reset display count when search changes
  useEffect(() => {
    setDisplayCount(DISPLAY_PAGE_SIZE)
  }, [searchQuery])

  const visibleSongs = filteredSongs.slice(0, displayCount)
  const hasMore = displayCount < filteredSongs.length

  const loadMore = useCallback(() => {
    setDisplayCount((prev) => Math.min(prev + DISPLAY_PAGE_SIZE, filteredSongs.length))
  }, [filteredSongs.length])

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (!hasMore) return

    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore()
        }
      },
      { rootMargin: '200px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  const handlePlayAll = () => {
    if (!playlist || filteredSongs.length === 0) return
    const playlistId = `my-online-playlist-${playlist.id}`
    setPlaylist(filteredSongs, playlistId)
    playSong(filteredSongs[0], filteredSongs, playlistId)
  }

  const canRefresh = Boolean(playlist?.sourceId?.trim())
  const isAutoUpdateEnabled = Boolean(playlist?.autoUpdate)

  const handleRefresh = async() => {
    if (!playlist) return

    if (!canRefresh) {
      addToast({ type: 'warning', message: '当前歌单缺少外部来源信息，暂时无法刷新' })
      return
    }

    setIsRefreshing(true)
    try {
      const result = await importSharedOnlinePlaylist(playlist.source, playlist.sourceId, {
        force: true,
        playlistId: playlist.id,
        externalType: playlist.externalType ?? 'playlist',
      })

      if (!result) {
        addToast({ type: 'error', message: '刷新失败，请检查歌单来源是否有效' })
        return
      }

      addToast({ type: 'success', message: `已刷新歌单「${result.playlist.name}」` })
      navigate(getOnlinePlaylistBrowsePath(result.playlist), { replace: true })
    } catch (error) {
      console.error('Refresh my online playlist error:', error)
      addToast({ type: 'error', message: '刷新失败，请稍后重试' })
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleDelete = () => {
    if (!playlist) return
    if (!confirm(`确定要删除歌单「${playlist.name}」吗？此操作仅会从本地收藏中移除。`)) return

    const playlistName = playlist.name
    removeOnlinePlaylist(playlist.id)
    addToast({ type: 'success', message: `已删除歌单「${playlistName}」` })
    navigate(-1)
  }

  if (!playlist) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-[var(--text-muted)]">歌单不存在或已被移除</p>
      </div>
    )
  }

  const cover = playlist.cover || playlist.songs[0]?.cover || ''
  const importedAtText = playlist.importedAt ? formatDate(playlist.importedAt) : ''
  const lastSyncedText = playlist.lastSyncedAt ? formatDate(playlist.lastSyncedAt) : ''
  const sourceLabel = getOnlinePlaylistLabel(playlist)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>

        <div className="flex items-start gap-6">
          <div className="w-40 h-40 rounded-2xl overflow-hidden bg-gradient-to-br from-blue-500 to-cyan-500 flex-shrink-0 shadow-lg">
            {cover ? (
              <CoverImage
                src={cover}
                alt={playlist.name}
                className="w-full h-full"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white">
                <Globe className="w-16 h-16" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h1 className="text-3xl font-bold min-w-0 truncate">{playlist.name}</h1>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={handlePlayAll}
                  disabled={filteredSongs.length === 0}
                  className="btn-primary gap-1.5 disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  播放
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isAutoUpdateEnabled}
                  disabled={!canRefresh}
                  onClick={() => {
                    const nextValue = !isAutoUpdateEnabled
                    setOnlinePlaylistAutoUpdate(playlist.id, nextValue)
                    addToast({
                      type: 'success',
                      message: nextValue ? '已开启自动更新' : '已关闭自动更新',
                    })
                  }}
                  className="btn-icon relative disabled:opacity-50"
                  title={canRefresh ? (isAutoUpdateEnabled ? '自动更新已开启' : '自动更新已关闭') : '当前歌单缺少外部来源信息'}
                  aria-label="自动更新"
                >
                  <Repeat className="w-4 h-4" />
                  <span
                    className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${isAutoUpdateEnabled ? 'bg-primary-500' : 'bg-gray-400/60'}`}
                  />
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={!canRefresh || isRefreshing}
                  className="btn-icon"
                  title={canRefresh ? '重新导入歌单' : '当前歌单缺少外部来源信息'}
                  aria-label="重新导入歌单"
                >
                  <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={handleDelete}
                  className="btn-icon hover:text-red-500"
                  title="删除歌单"
                  aria-label="删除歌单"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <ExpandableSearch value={searchQuery} onChange={setSearchQuery} />
              </div>
            </div>
            <p className="text-[var(--text-muted)] mb-2">
              {playlist.songCount || playlist.songs.length} 首歌曲 · {sourceLabel}
              {importedAtText && <span> · 导入于 {importedAtText}</span>}
              {lastSyncedText && <span> · 更新于 {lastSyncedText}</span>}
            </p>
            {playlist.lastSyncError && (
              <p className="mb-2 text-xs text-red-500">自动更新失败：{playlist.lastSyncError}</p>
            )}
            {playlist.description && (
              <p className="text-sm text-[var(--text-muted)] leading-6 line-clamp-4">{playlist.description}</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">

        <div className="flex-1 overflow-y-auto space-y-1">
          {visibleSongs.length > 0 ? (
            <>
              {visibleSongs.map((song, index) => (
                <SongRow
                  key={`${song.id}-${song.platform}-${index}`}
                  song={song}
                  index={index}
                  playlist={filteredSongs}
                  playlistId={`my-online-playlist-${playlist.id}`}
                  showPlatform={false}
                />
              ))}
              {hasMore && (
                <div ref={sentinelRef} className="min-h-16 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-16 text-[var(--text-muted)]">
              <p>{searchQuery ? '没有找到匹配歌曲' : '暂无歌曲'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
