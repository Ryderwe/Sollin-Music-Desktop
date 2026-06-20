import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, RefreshCw, ChevronRight } from 'lucide-react'
import api from '@/services/api'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/utils/cn'
import { getPlatformColor } from '@/utils/format'
import { ONLINE_MUSIC_PLATFORMS } from '@/constants/platforms'
import type { Song, Toplist, Platform, RecommendPlaylist } from '@/types'
import CoverImage from '@/components/ui/CoverImage'

const formatPlayCount = (count: number) => {
  if (count >= 100000000) return (count / 100000000).toFixed(1) + '亿'
  if (count >= 10000) return (count / 10000).toFixed(1) + '万'
  return String(count)
}

const HOME_TOPLIST_PREVIEW_LIMIT = 9

const getCachedHomeToplistState = (platform: Platform) => {
  const toplists = api.getCachedToplists(platform) || []
  const toplistSongs: Record<string, Song[]> = {}
  const loadingIds = new Set<string>()

  toplists.slice(0, HOME_TOPLIST_PREVIEW_LIMIT).forEach((toplist) => {
    const songs = api.getCachedToplist(platform, toplist.id)
    if (songs) toplistSongs[toplist.id] = songs
    else loadingIds.add(toplist.id)
  })

  return {
    toplists,
    toplistSongs,
    loadingIds,
  }
}

// 排行榜卡片组件
function ToplistCard({
  toplist,
  songs,
  isLoading,
  onPlay,
  onClick,
}: {
  toplist: Toplist
  songs: Song[]
  isLoading: boolean
  onPlay: (e: React.MouseEvent) => void
  onClick: () => void
}) {
  const coverImage = toplist.cover || songs[0]?.cover || ''
  const coverFallback = songs.find((song) => song.cover && song.cover !== coverImage)?.cover || undefined

  return (
    <div
      onClick={onClick}
      className="cursor-pointer group bg-white dark:bg-gray-800 rounded-xl overflow-hidden border border-gray-200/70 dark:border-gray-700/70 shadow-sm hover:shadow-md transition-all"
    >
      <div className="flex">
        {/* 左侧封面 */}
        <div className="relative w-32 h-32 flex-shrink-0 overflow-hidden">
          {coverImage ? (
            <CoverImage
              src={coverImage}
              fallback={coverFallback}
              alt={toplist.name}
              className="w-full h-full group-hover:scale-105 transition-transform duration-300"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary-400 to-pink-400" />
          )}
          {/* 悬停播放按钮 */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 opacity-0 group-hover:opacity-100 transition-all">
            <button
              onClick={onPlay}
              className="w-10 h-10 rounded-full bg-primary-500 text-white flex items-center justify-center shadow-lg hover:bg-primary-600 transition-colors"
            >
              <Play className="w-5 h-5 ml-0.5" fill="white" />
            </button>
          </div>
        </div>

        {/* 右侧内容 */}
        <div className="flex-1 p-3 min-w-0 flex flex-col">
          {/* 榜单名称 */}
          <h3 className="font-semibold text-sm truncate mb-2">{toplist.name}</h3>

          {/* 歌曲预览 */}
          {isLoading ? (
            <div className="space-y-1.5 flex-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2 animate-pulse">
                  <div className="w-3 h-3 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div className="flex-1 h-3 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1 flex-1">
              {songs.slice(0, 3).map((song, index) => (
                <div key={song.id} className="flex items-center gap-1.5 text-xs">
                  <span
                    className={cn(
                      'w-3 text-center font-medium flex-shrink-0',
                      index === 0 && 'text-red-500',
                      index === 1 && 'text-orange-500',
                      index === 2 && 'text-yellow-500'
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="truncate text-[var(--text-secondary)]">
                    {song.name}
                  </span>
                  <span className="text-[var(--text-muted)] truncate flex-shrink-0 max-w-[60px]">
                    - {song.artist}
                  </span>
                </div>
              ))}
              {songs.length === 0 && !isLoading && (
                <div className="text-xs text-[var(--text-muted)]">暂无歌曲</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const initialHomeState = useUIStore.getState()
  const initialPlatform: Platform = initialHomeState.homePlatform || 'netease'
  const initialToplistCache = getCachedHomeToplistState(initialPlatform)
  const [activePlatform, setActivePlatform] = useState<Platform>(initialPlatform)
  const [toplists, setToplists] = useState<Toplist[]>(initialToplistCache.toplists)
  const [toplistSongs, setToplistSongs] = useState<Record<string, Song[]>>(initialToplistCache.toplistSongs)
  const [loadingToplists, setLoadingToplists] = useState<Set<string>>(new Set(initialToplistCache.loadingIds))
  const [isLoading, setIsLoading] = useState(initialToplistCache.toplists.length === 0)
  const [recommendPlaylists, setRecommendPlaylists] = useState<RecommendPlaylist[]>([])
  const [isLoadingRecommend, setIsLoadingRecommend] = useState(false)
  const [forceRefresh, setForceRefresh] = useState(0) // 用于触发强制刷新
  const { playSong, setPlaylist } = usePlayerStore()
  const addToast = useUIStore((state) => state.addToast)
  const setHomePlatform = useUIStore((state) => state.setHomePlatform)

  // Load recommended playlists when platform changes
  useEffect(() => {
    let cancelled = false
    const isForce = forceRefresh > 0

    const loadRecommendPlaylists = async () => {
      setIsLoadingRecommend(true)
      try {
        const playlists = await api.getRecommendPlaylists(activePlatform, 1, { force: isForce })
        if (cancelled) return
        setRecommendPlaylists(playlists)
      } catch (e) {
        if (cancelled) return
        console.error('Load recommend playlists error:', e)
      } finally {
        if (!cancelled) setIsLoadingRecommend(false)
      }
    }

    loadRecommendPlaylists()

    return () => {
      cancelled = true
    }
  }, [activePlatform, forceRefresh])

  useEffect(() => {
    setHomePlatform(activePlatform)
  }, [activePlatform, setHomePlatform])

  // Load toplists when platform changes
  useEffect(() => {
    let cancelled = false
    const isForce = forceRefresh > 0

    const loadToplists = async () => {
      const cachedState = isForce
        ? { toplists: [] as Toplist[], toplistSongs: {} as Record<string, Song[]>, loadingIds: new Set<string>() }
        : getCachedHomeToplistState(activePlatform)

      setToplists(cachedState.toplists)
      setToplistSongs(cachedState.toplistSongs)
      setLoadingToplists(new Set(cachedState.loadingIds))
      setIsLoading(cachedState.toplists.length === 0)

      try {
        const lists = await api.getToplists(activePlatform, { force: isForce })
        if (cancelled) return
        setToplists(lists)

        const toplistsToLoad = lists.slice(0, HOME_TOPLIST_PREVIEW_LIMIT)
        const loadingIds = new Set(
          toplistsToLoad
            .map((toplist) => toplist.id)
            .filter((id) => !cachedState.toplistSongs[id])
        )
        setLoadingToplists(loadingIds)

        const songsPromises = toplistsToLoad.map(async (toplist) => {
          try {
            const songs = await api.getToplist(activePlatform, toplist.id, { force: isForce })
            return { id: toplist.id, songs, success: true }
          } catch {
            return { id: toplist.id, songs: [] as Song[], success: false }
          }
        })

        const results = await Promise.all(songsPromises)
        if (cancelled) return

        const songsMap: Record<string, Song[]> = { ...cachedState.toplistSongs }
        results.forEach(({ id, songs, success }) => {
          if (success || !songsMap[id]) songsMap[id] = songs
        })
        setToplistSongs(songsMap)
        setLoadingToplists(new Set())
      } catch (e) {
        if (cancelled) return
        addToast({ type: 'error', message: '排行榜加载失败，请稍后重试' })
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadToplists()

    return () => {
      cancelled = true
    }
  }, [activePlatform, addToast, forceRefresh])

  const handleRefresh = () => {
    // 强制刷新缓存
    setToplists([])
    setToplistSongs({})
    setRecommendPlaylists([])
    setForceRefresh((prev) => prev + 1)
  }

  const handlePlayToplist = (toplistId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const songs = toplistSongs[toplistId]
    if (songs && songs.length > 0) {
      setPlaylist(songs, `toplist-${toplistId}`)
      playSong(songs[0], songs, `toplist-${toplistId}`)
    }
  }

  const handleToplistClick = (toplist: Toplist) => {
    navigate(`/toplist-detail/${toplist.platform}/${toplist.id}`)
  }

  return (
    <div className="pb-6">
      {/* Platform tabs */}
      <div className="flex items-center gap-2 mb-6">
        {ONLINE_MUSIC_PLATFORMS.map((platform) => (
          <button
            key={platform.id}
            onClick={() => setActivePlatform(platform.id)}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium transition-all',
              activePlatform === platform.id
                ? 'text-white shadow-md'
                : 'bg-white/60 dark:bg-gray-800/60 text-[var(--text-secondary)] hover:bg-white dark:hover:bg-gray-700 border border-gray-200/50 dark:border-gray-700/50'
            )}
            style={
              activePlatform === platform.id
                ? { backgroundColor: getPlatformColor(platform.id) }
                : {}
            }
          >
            {platform.name}
          </button>
        ))}

        <div className="flex-1" />

        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className={cn(
            'px-4 py-2 rounded-full text-sm font-medium transition-all inline-flex items-center gap-2',
            'bg-white/60 dark:bg-gray-800/60 text-[var(--text-secondary)] hover:bg-white dark:hover:bg-gray-700 border border-gray-200/50 dark:border-gray-700/50',
            isLoading && 'opacity-60 cursor-not-allowed'
          )}
        >
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          刷新
        </button>
      </div>

      {/* Recommended Playlists */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">推荐歌单</h2>
          <button
            onClick={() => navigate(`/playlist-explore?platform=${activePlatform}`)}
            className="text-sm text-[var(--text-muted)] hover:text-primary-500 flex items-center gap-1 transition-colors"
          >
            更多
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        {isLoadingRecommend ? (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-square rounded-xl bg-gray-200 dark:bg-gray-700 mb-2" />
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
              </div>
            ))}
          </div>
        ) : recommendPlaylists.length > 0 ? (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {recommendPlaylists.slice(0, 6).map((playlist) => (
              <div
                key={playlist.id}
                onClick={() => navigate(`/online-playlist/${playlist.platform}/${playlist.id}`)}
                className="cursor-pointer group"
              >
                <div className="relative aspect-square rounded-xl overflow-hidden mb-2 shadow-sm">
                  <CoverImage
                    src={playlist.cover}
                    alt={playlist.name}
                    className="w-full h-full group-hover:scale-105 transition-transform duration-300"
                    loading="eager"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <Play className="w-10 h-10 text-white" fill="white" />
                  </div>
                  {playlist.playCount && playlist.playCount > 0 && (
                    <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Play className="w-3 h-3" fill="white" />
                      {formatPlayCount(playlist.playCount)}
                    </div>
                  )}
                </div>
                <p className="font-medium text-sm truncate">{playlist.name}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-[var(--text-muted)]">暂无推荐歌单</div>
        )}
      </section>

      {/* Toplists */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">热门排行榜</h2>
          <button
            onClick={() => navigate(`/toplist?platform=${activePlatform}`)}
            className="text-sm text-[var(--text-muted)] hover:text-primary-500 flex items-center gap-1 transition-colors"
          >
            更多
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        {isLoading && toplists.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="animate-pulse bg-white/60 dark:bg-gray-800/60 rounded-xl overflow-hidden">
                <div className="flex">
                  <div className="w-32 h-32 bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                  <div className="flex-1 p-3 space-y-2">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-4/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {toplists.slice(0, 9).map((toplist) => (
              <ToplistCard
                key={toplist.id}
                toplist={toplist}
                songs={toplistSongs[toplist.id] || []}
                isLoading={loadingToplists.has(toplist.id)}
                onPlay={(e) => handlePlayToplist(toplist.id, e)}
                onClick={() => handleToplistClick(toplist)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
