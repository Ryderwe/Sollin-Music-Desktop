import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Play, Shuffle, ArrowLeft, RefreshCw } from 'lucide-react'
import ExpandableSearch from '@/components/ui/ExpandableSearch'
import api from '@/services/api'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import { usePaginatedSongs } from '@/hooks/usePaginatedSongs'
import VirtualSongList from '@/components/VirtualSongList'
import CoverImage from '@/components/ui/CoverImage'
import { cn } from '@/utils/cn'
import type { Toplist, Platform } from '@/types'

export default function ToplistDetail() {
  const { platform, id } = useParams<{ platform: string; id: string }>()
  const navigate = useNavigate()
  const [toplist, setToplist] = useState<Toplist | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const { playSong, setPlaylist } = usePlayerStore()
  const { addToast } = useUIStore()

  const fetcher = useCallback(async (page: number) => {
    return api.getToplistPage(platform as Platform, id!, page)
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

    const loadToplistInfo = async () => {
      try {
        const toplists = await api.getToplists(platform as Platform)
        const currentToplist = toplists.find((t) => t.id === id)
        if (currentToplist) setToplist(currentToplist)
      } catch {
        // ignore
      }
    }

    loadToplistInfo()
    loadInitial()
  }, [platform, id, loadInitial])

  const handleRefresh = async () => {
    if (!platform || !id || isRefreshing) return
    setIsRefreshing(true)
    try {
      await reset()
      addToast({ type: 'success', message: '刷新成功' })
    } catch {
      addToast({ type: 'error', message: '刷新失败' })
    } finally {
      setIsRefreshing(false)
    }
  }

  const handlePlayAll = () => {
    if (allApiSongs.length > 0) {
      const name = toplist?.name || '排行榜'
      setPlaylist(allApiSongs, `toplist-${id}`, name)
      playSong(allApiSongs[0], allApiSongs, `toplist-${id}`, undefined, name)
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

  const handleShuffle = () => {
    if (allApiSongs.length > 0) {
      const shuffled = [...allApiSongs].sort(() => Math.random() - 0.5)
      const name = toplist?.name || '排行榜'
      setPlaylist(shuffled, `toplist-${id}-shuffle`, name)
      playSong(shuffled[0], shuffled, `toplist-${id}-shuffle`, undefined, name)
    }
  }

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-180px)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const coverSrc = toplist?.cover || allApiSongs[0]?.cover || ''
  const coverFallback = allApiSongs.find((song) => song.cover && song.cover !== coverSrc)?.cover || undefined

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-4 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>返回</span>
        </button>

        <div className="flex items-start gap-6">
          <div className="flex-shrink-0">
            {coverSrc ? (
              <CoverImage
                src={coverSrc}
                fallback={coverFallback}
                alt={toplist?.name || '榜单封面'}
                className="w-48 h-48 rounded-2xl shadow-xl"
              />
            ) : (
              <div className="w-48 h-48 rounded-2xl bg-gradient-to-br from-primary-400 to-pink-400 shadow-xl" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h1 className="text-3xl font-bold min-w-0 truncate">
                {toplist?.name || '排行榜'}
              </h1>
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
                  onClick={handleShuffle}
                  disabled={allApiSongs.length === 0}
                  className="btn-icon"
                  title="随机播放"
                  aria-label="随机播放"
                >
                  <Shuffle className="w-4 h-4" />
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="btn-icon"
                  title="刷新"
                >
                  <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
                </button>
                <ExpandableSearch value={searchQuery} onChange={setSearchQuery} />
              </div>
            </div>
            <p className="text-[var(--text-muted)] mb-3">
              {allApiSongs.length} 首歌曲
            </p>
          </div>
        </div>
      </div>

      {/* Song list */}
      <div>
        {filteredSongs.length > 0 ? (
          <VirtualSongList
            songs={filteredSongs}
            playlist={allApiSongs}
            playlistId={`toplist-${id}`}
            playlistName={toplist?.name || undefined}
            showPlatform={false}
            scrollable={false}
            footer={hasMore ? (
              <div ref={sentinelRef} className="min-h-16 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : undefined}
          />
        ) : (
          <div className="text-center py-20 text-[var(--text-muted)]">
            {searchQuery ? '没有找到匹配歌曲' : '暂无歌曲'}
          </div>
        )}
      </div>
    </div>
  )
}
