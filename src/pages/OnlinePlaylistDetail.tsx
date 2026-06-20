import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Play, ArrowLeft, Music, RefreshCw, Search, Heart } from 'lucide-react'
import ExpandableSearch from '@/components/ui/ExpandableSearch'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import { useUserStore } from '@/stores/userStore'
import { usePaginatedSongs } from '@/hooks/usePaginatedSongs'
import VirtualSongList from '@/components/VirtualSongList'
import CoverImage from '@/components/ui/CoverImage'
import api from '@/services/api'
import {
  buildImportedOnlinePlaylist,
  importSharedOnlinePlaylist,
} from '@/services/sharedOnlinePlaylistImport'
import type { OnlinePlaylist, Platform, PlaylistDetail } from '@/types'

const formatPlayCount = (count: number) => {
  if (count >= 100000000) return (count / 100000000).toFixed(1) + '亿'
  if (count >= 10000) return (count / 10000).toFixed(1) + '万'
  return String(count)
}

export default function OnlinePlaylistDetail() {
  const { platform, id } = useParams<{ platform: Platform; id: string }>()
  const navigate = useNavigate()
  const { playSong, setPlaylist } = usePlayerStore()
  const { addToast } = useUIStore()
  const onlinePlaylists = useUserStore((state) => state.onlinePlaylists)
  const removeOnlinePlaylist = useUserStore((state) => state.removeOnlinePlaylist)

  const [playlistInfo, setPlaylistInfo] = useState<PlaylistDetail | null>(null)
  const [showFullDesc, setShowFullDesc] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isFavoriting, setIsFavoriting] = useState(false)

  const importedPlaylist = useMemo(() => {
    if (!platform || !id) return null

    return onlinePlaylists.find((item: OnlinePlaylist) => (
      item.source === platform && (item.sourceId === id || encodeURIComponent(item.sourceId) === id)
    )) || null
  }, [onlinePlaylists, platform, id])

  const fetcher = useCallback(async (page: number) => {
    const result = await api.getPlaylistDetailPage(platform!, id!, page)
    if (page === 1 && result.info) {
      setPlaylistInfo(result.info)
    }
    return result
  }, [platform, id])

  const {
    visibleSongs: songs,
    allApiSongs,
    isLoading,
    hasMore,
    sentinelRef,
    loadInitial,
    reset,
  } = usePaginatedSongs({ fetcher, enabled: !!platform && !!id })

  useEffect(() => {
    if (!platform || !id) return
    loadInitial()
  }, [platform, id, loadInitial])

  const handleRefresh = async () => {
    if (!platform || !id) return

    try {
      if (importedPlaylist) {
        const result = await importSharedOnlinePlaylist(platform, id, {
          force: true,
          playlistId: importedPlaylist.id,
          externalType: importedPlaylist.externalType ?? 'playlist',
        })
        if (!result) throw new Error('refresh failed')
        setPlaylistInfo(result.detail)
        addToast({ type: 'success', message: `已刷新在线歌单「${result.playlist.name}」` })
      } else {
        await reset()
        addToast({ type: 'success', message: '歌单已刷新' })
      }
    } catch (error) {
      console.error('Refresh playlist error:', error)
      addToast({ type: 'error', message: '刷新失败' })
    }
  }

  const filteredSongs = useMemo(() => {
    if (!searchQuery.trim()) return songs

    const query = searchQuery.toLowerCase().trim()
    return songs.filter((song) => (
      song.name.toLowerCase().includes(query)
      || song.artist.toLowerCase().includes(query)
    ))
  }, [songs, searchQuery])

  const handlePlayAll = () => {
    if (allApiSongs.length > 0) {
      setPlaylist(allApiSongs, `online-playlist-${platform}-${id}`)
      playSong(allApiSongs[0], allApiSongs, `online-playlist-${platform}-${id}`)
    }
  }

  const handleToggleFavorite = async () => {
    if (!platform || !id) return

    // Already favorited: remove from collection
    if (importedPlaylist) {
      removeOnlinePlaylist(importedPlaylist.id)
      addToast({
        type: 'success',
        message: `已取消收藏「${importedPlaylist.name}」`,
      })
      return
    }

    // Still loading songs from API or playlist info missing - cannot favorite yet
    if (isLoading || !playlistInfo) {
      addToast({ type: 'warning', message: '歌单还在加载中，请稍后再试' })
      return
    }

    if (allApiSongs.length === 0) {
      addToast({ type: 'warning', message: '歌单为空，无法收藏' })
      return
    }

    setIsFavoriting(true)
    try {
      // Build the playlist from already-loaded data, no extra network call needed
      const detail: PlaylistDetail = {
        ...playlistInfo,
        songs: allApiSongs,
      }
      const newPlaylist = buildImportedOnlinePlaylist(platform, id, detail)
      useUserStore.getState().upsertOnlinePlaylist(newPlaylist)

      addToast({
        type: 'success',
        message: `已收藏歌单「${newPlaylist.name}」`,
      })
    } catch (err: any) {
      console.error('Favorite shared playlist error:', err)
      // Fall back to network-based import if local build fails for some reason
      try {
        const result = await importSharedOnlinePlaylist(platform, id, { force: false })
        if (result) {
          addToast({
            type: 'success',
            message: result.action === 'updated'
              ? `已更新收藏歌单「${result.playlist.name}」`
              : `已收藏歌单「${result.playlist.name}」`,
          })
        } else {
          addToast({ type: 'error', message: '收藏失败，请稍后重试' })
        }
      } catch (fallbackErr: any) {
        addToast({ type: 'error', message: fallbackErr?.message || '收藏失败，请稍后重试' })
      }
    } finally {
      setIsFavoriting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!playlistInfo && allApiSongs.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-[var(--text-muted)]">歌单不存在或加载失败</p>
      </div>
    )
  }

  const headerCover = playlistInfo?.cover || allApiSongs[0]?.cover || ''
  const headerFallback = allApiSongs.find((song) => song.cover && song.cover !== headerCover)?.cover || undefined

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>

        <div className="flex items-start gap-6">
          <div className="w-40 h-40 rounded-2xl overflow-hidden bg-gradient-to-br from-primary-500 to-pink-500 flex-shrink-0 shadow-lg">
            {headerCover ? (
              <CoverImage
                src={headerCover}
                fallback={headerFallback}
                alt={playlistInfo?.name || ''}
                className="w-full h-full"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Music className="w-16 h-16 text-white" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h1 className="text-3xl font-bold min-w-0 truncate">{playlistInfo?.name || '歌单'}</h1>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={handlePlayAll}
                  disabled={allApiSongs.length === 0}
                  className="btn-primary gap-1.5"
                >
                  <Play className="w-4 h-4" />
                  播放
                </button>
                <button
                  onClick={handleToggleFavorite}
                  disabled={isFavoriting || isLoading || (!importedPlaylist && allApiSongs.length === 0)}
                  className="btn-icon disabled:opacity-50"
                  title={importedPlaylist ? '取消收藏' : '收藏歌单'}
                  aria-label={importedPlaylist ? '取消收藏' : '收藏歌单'}
                  aria-pressed={Boolean(importedPlaylist)}
                >
                  <Heart
                    className={`w-4 h-4 transition-colors ${importedPlaylist ? 'fill-red-500 text-red-500' : ''} ${isFavoriting ? 'animate-pulse' : ''}`}
                  />
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={isLoading}
                  className="btn-icon"
                  title={importedPlaylist ? '重新导入歌单' : '刷新歌单'}
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
                {allApiSongs.length > 0 && (
                  <ExpandableSearch value={searchQuery} onChange={setSearchQuery} />
                )}
              </div>
            </div>
            <p className="text-[var(--text-muted)] mb-2">
              {allApiSongs.length} 首歌曲
              {playlistInfo?.author && <span> · 创建者: {playlistInfo.author}</span>}
              {playlistInfo?.playCount && playlistInfo.playCount > 0 && (
                <span> · 播放: {formatPlayCount(playlistInfo.playCount)}</span>
              )}
            </p>
            {playlistInfo?.description && (
              <div className="mt-2">
                <p
                  className={`text-sm text-[var(--text-muted)] ${showFullDesc ? '' : 'line-clamp-2'}`}
                  onClick={() => setShowFullDesc(!showFullDesc)}
                >
                  {playlistInfo.description}
                </p>
                {playlistInfo.description.length > 100 && (
                  <button
                    onClick={() => setShowFullDesc(!showFullDesc)}
                    className="text-xs text-primary-500 mt-1"
                  >
                    {showFullDesc ? '收起' : '展开'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {allApiSongs.length > 0 ? (
        filteredSongs.length > 0 ? (
          <div>
            {searchQuery && (
              <div className="text-sm text-[var(--text-muted)] mb-2 px-1">
                找到 {filteredSongs.length} 首歌曲
              </div>
            )}
            <VirtualSongList
              songs={filteredSongs}
              playlist={allApiSongs}
              playlistId={`online-playlist-${platform}-${id}`}
              showPlatform={false}
              scrollable={false}
              footer={hasMore && !searchQuery ? (
                <div ref={sentinelRef} className="min-h-16 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : undefined}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Search className="w-16 h-16 mx-auto mb-4 text-[var(--text-muted)]" />
              <p className="text-[var(--text-muted)]">未找到匹配的歌曲</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">试试其他关键词</p>
            </div>
          </div>
        )
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Music className="w-16 h-16 mx-auto mb-4 text-[var(--text-muted)]" />
            <p className="text-[var(--text-muted)]">歌单为空</p>
          </div>
        </div>
      )}
    </div>
  )
}
