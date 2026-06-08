import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search as SearchIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '@/services/api'
import { useUIStore } from '@/stores/uiStore'
import { useFeatureStore } from '@/stores/featureStore'
import SongRow from '@/components/SongRow'
import CoverImage from '@/components/ui/CoverImage'
import { getPlatformName } from '@/utils/format'
import { interleavePlatformBuckets } from '@/utils/search'
import { filterDislikedSongs } from '@/services/dislikeRules'
import { cn } from '@/utils/cn'
import type { Song, Platform, Album, PlaylistSummary } from '@/types'

type SearchCategory = 'songs' | 'albums' | 'playlists'

const CATEGORY_OPTIONS: { id: SearchCategory; label: string }[] = [
  { id: 'songs', label: '歌曲' },
  { id: 'playlists', label: '歌单' },
  { id: 'albums', label: '专辑' },
]

const ALL_PLATFORMS: Platform[] = ['netease', 'qq', 'kuwo', 'kugou', 'migu']
const ALL_PLATFORM_LIMIT = 8
const SINGLE_PLATFORM_LIMIT = 20

export default function Search() {
  const navigate = useNavigate()
  const {
    searchQuery,
    searchPlatform, searchCategory, setSearchCategory,
    isSearching, setIsSearching, addToast,
  } = useUIStore()
  const { addSearchHistory, dislikeRules } = useFeatureStore()

  const [songs, setSongs] = useState<Song[]>([])
  const [albums, setAlbums] = useState<Album[]>([])
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const resetResults = () => {
    setSongs([])
    setAlbums([])
    setPlaylists([])
    setHasMore(false)
  }

  const doSearch = useCallback(
    async(
      query: string,
      platform: Platform | 'all',
      category: SearchCategory,
      pageNum: number,
    ) => {
      const trimmedQuery = query.trim()
      if (!trimmedQuery) {
        resetResults()
        setIsSearching(false)
        return
      }

      setIsSearching(true)
      if (pageNum === 1) {
        addSearchHistory(trimmedQuery)
      }

      try {
        const effectiveLimit = platform === 'all' ? ALL_PLATFORM_LIMIT : SINGLE_PLATFORM_LIMIT

        if (platform === 'all') {
          if (category === 'songs') {
            const results = await Promise.all(
              ALL_PLATFORMS.map(async(item) => ({
                platform: item,
                result: await api.search(item, trimmedQuery, effectiveLimit, pageNum),
              }))
            )
            const mergedSongs = interleavePlatformBuckets(
              results.map((item) => ({ platform: item.platform, items: item.result.songs })),
              ALL_PLATFORMS,
            )
            const visibleSongs = filterDislikedSongs(mergedSongs, useFeatureStore.getState().dislikeRules)
            if (pageNum === 1) {
              setSongs(visibleSongs)
            } else {
              setSongs((prev) => [...prev, ...visibleSongs])
            }
            setAlbums([])
            setPlaylists([])
            setHasMore(results.some((item) => item.result.hasMore))
            return
          }

          if (category === 'albums') {
            const results = await Promise.all(
              ALL_PLATFORMS.map(async(item) => ({
                platform: item,
                result: await api.searchAlbum(item, trimmedQuery, effectiveLimit, pageNum),
              }))
            )
            const mergedAlbums = interleavePlatformBuckets(
              results.map((item) => ({ platform: item.platform, items: item.result.albums })),
              ALL_PLATFORMS,
            )
            if (pageNum === 1) {
              setAlbums(mergedAlbums)
            } else {
              setAlbums((prev) => [...prev, ...mergedAlbums])
            }
            setSongs([])
            setPlaylists([])
            setHasMore(results.some((item) => item.result.hasMore))
            return
          }

          const results = await Promise.all(
            ALL_PLATFORMS.map(async(item) => ({
              platform: item,
              result: await api.searchPlaylist(item, trimmedQuery, effectiveLimit, pageNum),
            }))
          )
          const mergedPlaylists = interleavePlatformBuckets(
            results.map((item) => ({ platform: item.platform, items: item.result.playlists })),
            ALL_PLATFORMS,
          )
          if (pageNum === 1) {
            setPlaylists(mergedPlaylists)
          } else {
            setPlaylists((prev) => [...prev, ...mergedPlaylists])
          }
          setSongs([])
          setAlbums([])
          setHasMore(results.some((item) => item.result.hasMore))
          return
        }

        if (category === 'songs') {
          const result = await api.search(platform, trimmedQuery, effectiveLimit, pageNum)
          const visibleSongs = filterDislikedSongs(result.songs, useFeatureStore.getState().dislikeRules)
          if (pageNum === 1) {
            setSongs(visibleSongs)
          } else {
            setSongs((prev) => [...prev, ...visibleSongs])
          }
          setAlbums([])
          setPlaylists([])
          setHasMore(result.hasMore)
          return
        }

        if (category === 'albums') {
          const result = await api.searchAlbum(platform, trimmedQuery, effectiveLimit, pageNum)
          if (pageNum === 1) {
            setAlbums(result.albums)
          } else {
            setAlbums((prev) => [...prev, ...result.albums])
          }
          setSongs([])
          setPlaylists([])
          setHasMore(result.hasMore)
          return
        }

        const result = await api.searchPlaylist(platform, trimmedQuery, effectiveLimit, pageNum)
        if (pageNum === 1) {
          setPlaylists(result.playlists)
        } else {
          setPlaylists((prev) => [...prev, ...result.playlists])
        }
        setSongs([])
        setAlbums([])
        setHasMore(result.hasMore)
      } catch (error) {
        console.error('Search error:', error)
        addToast({ type: 'error', message: '搜索失败，请稍后重试' })
      } finally {
        setIsSearching(false)
      }
    },
    [addSearchHistory, addToast, setIsSearching]
  )

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }
    searchTimerRef.current = setTimeout(() => {
      setPage(1)
      doSearch(searchQuery, searchPlatform, searchCategory, 1)
    }, 300)
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
      }
    }
  }, [searchQuery, searchPlatform, searchCategory, doSearch])

  useEffect(() => {
    if (searchCategory !== 'songs') return
    setSongs((prev) => filterDislikedSongs(prev, dislikeRules))
  }, [searchCategory, dislikeRules])

  const handleLoadMore = () => {
    const nextPage = page + 1
    setPage(nextPage)
    doSearch(searchQuery, searchPlatform, searchCategory, nextPage)
  }

  const handleOpenPlaylist = (playlist: PlaylistSummary) => {
    navigate(`/online-playlist/${playlist.platform}/${encodeURIComponent(playlist.id)}`)
  }

  const handleOpenAlbum = (album: Album) => {
    navigate(`/online-album/${album.platform}/${encodeURIComponent(album.id)}`)
  }

  const hasResultsForView = searchCategory === 'songs'
    ? songs.length > 0
    : searchCategory === 'albums'
      ? albums.length > 0
      : playlists.length > 0

  return (
    <div className="space-y-6">
      {/* Category tabs */}
      <div className="flex items-center gap-2">
        {CATEGORY_OPTIONS.map((category) => (
          <button
            key={category.id}
            onClick={() => setSearchCategory(category.id)}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
              searchCategory === category.id
                ? 'bg-primary-500 text-white'
                : 'bg-gray-100/80 dark:bg-gray-800/60 text-[var(--text-secondary)] hover:bg-gray-200/80 dark:hover:bg-gray-700/60',
            )}
          >
            {category.label}
          </button>
        ))}
      </div>

      {/* Results */}
      <div>
        {isSearching && !hasResultsForView ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : hasResultsForView ? (
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              {searchCategory === 'songs' && songs.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">歌曲</h2>
                    <span className="text-xs text-[var(--text-muted)]">{songs.length} 首</span>
                  </div>
                  <div className="space-y-1">
                    {songs.map((song, index) => (
                      <SongRow
                        key={`${song.id}-${song.platform}-${index}`}
                        song={song}
                        index={index}
                        playlist={songs}
                        playlistId={`search-${searchPlatform}-${searchCategory}-${searchQuery}`}
                        showPlatform={searchPlatform === 'all'}
                      />
                    ))}
                  </div>
                </div>
              )}

              {searchCategory === 'albums' && albums.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">专辑</h2>
                    <span className="text-xs text-[var(--text-muted)]">{albums.length} 张</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {albums.map((album) => (
                      <motion.div
                        key={`${album.platform}-${album.id}`}
                        whileHover={{ scale: 1.03 }}
                        className="cursor-pointer group"
                        onClick={() => handleOpenAlbum(album)}
                      >
                        <div className="aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 mb-2 relative">
                          <CoverImage
                            src={album.cover}
                            alt={album.name}
                            className="w-full h-full group-hover:scale-105 transition-transform"
                          />
                          {searchPlatform === 'all' && (
                            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px]">
                              {getPlatformName(album.platform)}
                            </span>
                          )}
                        </div>
                        <p className="font-medium truncate text-sm">{album.name}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">{album.artist || '未知歌手'}</p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {searchCategory === 'playlists' && playlists.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">歌单</h2>
                    <span className="text-xs text-[var(--text-muted)]">{playlists.length} 个</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {playlists.map((playlist) => (
                      <motion.div
                        key={`${playlist.platform}-${playlist.id}`}
                        whileHover={{ scale: 1.03 }}
                        className="cursor-pointer group"
                        onClick={() => handleOpenPlaylist(playlist)}
                      >
                        <div className="aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 mb-2 relative">
                          <CoverImage
                            src={playlist.cover}
                            alt={playlist.name}
                            className="w-full h-full group-hover:scale-105 transition-transform"
                          />
                          {playlist.playCount != null && (
                            <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                              {formatPlayCount(playlist.playCount)}
                            </div>
                          )}
                          {searchPlatform === 'all' && (
                            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px]">
                              {getPlatformName(playlist.platform)}
                            </span>
                          )}
                        </div>
                        <p className="font-medium truncate text-sm">{playlist.name}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">
                          by {playlist.creator || '未知用户'}
                        </p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        ) : searchQuery ? (
          <div className="text-center py-20 text-[var(--text-muted)]">
            <SearchIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>没有找到相关结果</p>
          </div>
        ) : (
          <div className="text-center py-20 text-[var(--text-muted)]">
            <SearchIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>在顶栏输入关键词开始搜索</p>
          </div>
        )}

        {hasMore && hasResultsForView && (
          <div className="flex justify-center pt-6">
            <button
              onClick={handleLoadMore}
              disabled={isSearching}
              className="btn-secondary"
            >
              {isSearching ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function formatPlayCount(count: number): string {
  if (count >= 100000000) {
    return `${(count / 100000000).toFixed(1)}亿`
  }
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`
  }
  return String(count)
}
