import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Trophy, Play, Loader2, ArrowLeft } from 'lucide-react'
import { motion } from 'framer-motion'
import api from '@/services/api'
import CoverImage from '@/components/ui/CoverImage'
import { cn } from '@/utils/cn'
import { getPlatformColor } from '@/utils/format'
import { ONLINE_MUSIC_PLATFORMS } from '@/constants/platforms'
import type { Toplist as ToplistType, Song, Platform } from '@/types'

const TOPLIST_PREVIEW_LIMIT = 4

const getCachedToplistPageState = (platform: Platform) => {
  const toplists = api.getCachedToplists(platform) || []
  const toplistSongs: Record<string, Song[]> = {}

  toplists.slice(0, TOPLIST_PREVIEW_LIMIT).forEach((toplist) => {
    const songs = api.getCachedToplist(platform, toplist.id)
    if (songs) toplistSongs[toplist.id] = songs
  })

  return {
    toplists,
    toplistSongs,
  }
}

export default function Toplist() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialPlatform = (searchParams.get('platform') as Platform) || 'netease'
  const initialCacheState = getCachedToplistPageState(initialPlatform)

  const [activePlatform, setActivePlatform] = useState<Platform>(initialPlatform)
  const [toplists, setToplists] = useState<ToplistType[]>(initialCacheState.toplists)
  const [toplistSongs, setToplistSongs] = useState<Record<string, Song[]>>(initialCacheState.toplistSongs)
  const [isLoading, setIsLoading] = useState(initialCacheState.toplists.length === 0)

  useEffect(() => {
    let cancelled = false

    const loadToplists = async () => {
      const cachedState = getCachedToplistPageState(activePlatform)
      setToplists(cachedState.toplists)
      setToplistSongs(cachedState.toplistSongs)
      setIsLoading(cachedState.toplists.length === 0)

      try {
        const lists = await api.getToplists(activePlatform)
        if (cancelled) return
        setToplists(lists)

        const toplistsToLoad = lists.slice(0, TOPLIST_PREVIEW_LIMIT)
        const songsPromises = toplistsToLoad.map(async(toplist) => {
          try {
            const songs = await api.getToplist(activePlatform, toplist.id)
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
      } catch (error) {
        console.error('Load toplists error:', error)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadToplists()

    return () => {
      cancelled = true
    }
  }, [activePlatform])

  const handleToplistClick = (toplist: ToplistType) => {
    navigate(`/toplist-detail/${toplist.platform}/${toplist.id}`)
  }

  const officialLists = toplists.slice(0, 4)
  const moreLists = toplists.slice(4)

  if (isLoading && toplists.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-hide pb-8">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors mb-6"
      >
        <ArrowLeft className="w-5 h-5" />
        <span>返回</span>
      </button>

      <div className="flex items-center gap-3 mb-6">
        <Trophy className="w-7 h-7 text-yellow-500" />
        <h1 className="text-2xl font-bold">排行榜</h1>
      </div>

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
      </div>

      {officialLists.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-bold mb-4">官方榜</h2>
          <div className="space-y-3">
            {officialLists.map((list, index) => (
              <motion.div
                key={list.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                onClick={() => handleToplistClick(list)}
                className="flex gap-4 p-3 rounded-xl bg-white/60 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-800 cursor-pointer transition-colors group border border-white/20 dark:border-gray-700/30"
              >
                <div className="relative w-24 h-24 rounded-lg overflow-hidden flex-shrink-0">
                  {list.cover ? (
                    <CoverImage
                      src={list.cover}
                      alt={list.name}
                      className="w-full h-full group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-primary-400 to-pink-400" />
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <Play className="w-8 h-8 text-white" fill="white" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold mb-2">{list.name}</h3>
                  <div className="space-y-1">
                    {(toplistSongs[list.id] || []).slice(0, 3).map((song, i) => (
                      <p key={`${song.id}-${i}`} className="text-sm text-[var(--text-secondary)] truncate">
                        {i + 1}. {song.name} - {song.artist}
                      </p>
                    ))}
                    {!toplistSongs[list.id]?.length && (
                      <div className="space-y-1">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="h-4 bg-gray-200/60 dark:bg-gray-700/60 rounded animate-pulse" />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {moreLists.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-4">更多榜单</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {moreLists.map((list, index) => (
              <motion.div
                key={list.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => handleToplistClick(list)}
                className="group cursor-pointer"
              >
                <div className="relative aspect-square rounded-xl overflow-hidden mb-2 bg-white/60 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700/30">
                  {list.cover ? (
                    <CoverImage src={list.cover} alt={list.name} className="w-full h-full group-hover:scale-105 transition-transform" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-primary-400 to-pink-400" />
                  )}
                </div>
                <p className="text-sm font-medium line-clamp-2">{list.name}</p>
              </motion.div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
