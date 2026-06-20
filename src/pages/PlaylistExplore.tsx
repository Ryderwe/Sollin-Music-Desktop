import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Loader2, Play } from 'lucide-react'
import api from '@/services/api'
import CoverImage from '@/components/ui/CoverImage'
import { cn } from '@/utils/cn'
import { getPlatformColor } from '@/utils/format'
import { ONLINE_MUSIC_PLATFORMS } from '@/constants/platforms'
import type {
  Platform,
  PlaylistSortOption,
  PlaylistTagGroup,
  PlaylistTagInfo,
  RecommendPlaylist,
  RecommendPlaylistPage,
} from '@/types'

const createEmptyTagInfo = (platform: Platform): PlaylistTagInfo => ({
  hotTag: [],
  tags: [],
  platform,
})

const createEmptyPage = (page = 1): RecommendPlaylistPage => ({
  playlists: [],
  total: 0,
  page,
  limit: 0,
  hasMore: false,
})

const isSupportedPlatform = (value: string | null): value is Platform => (
  ONLINE_MUSIC_PLATFORMS.some((platform) => platform.id === value)
)

const getPlatformFromParams = (searchParams: URLSearchParams): Platform => {
  const platform = searchParams.get('platform')
  return isSupportedPlatform(platform) ? platform : 'netease'
}

const parsePage = (value: string | null): number => {
  const page = Number(value)
  return Number.isInteger(page) && page > 0 ? page : 1
}

const buildParams = (
  platform: Platform,
  tagId: string,
  sortId: string,
  page: number,
) => {
  const params = new URLSearchParams()
  params.set('platform', platform)
  if (tagId) params.set('tagId', tagId)
  if (sortId) params.set('sortId', sortId)
  if (page > 1) params.set('page', String(page))
  return params
}

const formatPlayCount = (count: number) => {
  if (count >= 100000000) return (count / 100000000).toFixed(1) + '亿'
  if (count >= 10000) return (count / 10000).toFixed(1) + '万'
  return String(count)
}

const getPageNumbers = (page: number, totalPages: number) => {
  if (totalPages <= 1) return []

  const maxVisible = 5
  const start = Math.max(1, Math.min(page - 2, Math.max(1, totalPages - maxVisible + 1)))
  const end = Math.min(totalPages, start + maxVisible - 1)

  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

export default function PlaylistExplore() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activePlatform = getPlatformFromParams(searchParams)
  const activeTagId = searchParams.get('tagId') || ''
  const page = parsePage(searchParams.get('page'))

  const sortOptions = useMemo<PlaylistSortOption[]>(() => api.getPlaylistSorts(activePlatform), [activePlatform])
  const activeSortId = useMemo(() => {
    const sortId = searchParams.get('sortId') || ''
    if (sortId && sortOptions.some((option) => option.id === sortId)) return sortId
    return sortOptions[0]?.id || ''
  }, [searchParams, sortOptions])

  const [tagInfo, setTagInfo] = useState<PlaylistTagInfo>(() => createEmptyTagInfo(activePlatform))
  const [playlists, setPlaylists] = useState<RecommendPlaylist[]>([])
  const [pageInfo, setPageInfo] = useState<RecommendPlaylistPage>(() => createEmptyPage(page))
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingTags, setIsLoadingTags] = useState(false)
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false)
  const tagMenuRef = useRef<HTMLDivElement>(null)

  const tagGroups = useMemo<PlaylistTagGroup[]>(() => {
    const groups: PlaylistTagGroup[] = []
    if (tagInfo.hotTag.length > 0) {
      groups.push({ name: '热门标签', list: tagInfo.hotTag })
    }
    groups.push(...tagInfo.tags)
    return groups
  }, [tagInfo])

  const activeTagName = useMemo(() => {
    if (!activeTagId) return '全部'
    for (const group of tagGroups) {
      const tag = group.list.find((item) => item.id === activeTagId)
      if (tag) return tag.name
    }
    return activeTagId
  }, [activeTagId, tagGroups])

  const totalPages = useMemo(() => {
    if (!pageInfo.total || !pageInfo.limit) return 0
    return Math.max(1, Math.ceil(pageInfo.total / pageInfo.limit))
  }, [pageInfo.limit, pageInfo.total])

  const pageNumbers = useMemo(() => getPageNumbers(page, totalPages), [page, totalPages])

  const updateRoute = useCallback((next: {
    platform?: Platform
    tagId?: string
    sortId?: string
    page?: number
  }) => {
    const platform = next.platform || activePlatform
    const nextSortOptions = platform === activePlatform ? sortOptions : api.getPlaylistSorts(platform)
    const sortId = next.sortId ?? (next.platform ? nextSortOptions[0]?.id || '' : activeSortId)
    const tagId = next.tagId ?? (next.platform ? '' : activeTagId)
    const nextPage = next.page ?? 1

    setSearchParams(buildParams(platform, tagId, sortId, nextPage))
  }, [activePlatform, activeSortId, activeTagId, setSearchParams, sortOptions])

  useEffect(() => {
    setIsTagMenuOpen(false)
  }, [activePlatform])

  useEffect(() => {
    let cancelled = false

    const loadTags = async() => {
      setIsLoadingTags(true)
      setTagInfo(createEmptyTagInfo(activePlatform))
      try {
        const nextTagInfo = await api.getPlaylistTags(activePlatform)
        if (!cancelled) setTagInfo(nextTagInfo)
      } finally {
        if (!cancelled) setIsLoadingTags(false)
      }
    }

    loadTags()

    return () => {
      cancelled = true
    }
  }, [activePlatform])

  useEffect(() => {
    if (!activeSortId) {
      setIsLoading(false)
      setPlaylists([])
      setPageInfo(createEmptyPage(page))
      return
    }

    let cancelled = false

    const loadPlaylists = async() => {
      setIsLoading(true)
      try {
        const data = await api.getRecommendPlaylistPage(activePlatform, page, {
          sortId: activeSortId,
          tagId: activeTagId,
        })

        if (cancelled) return
        setPlaylists(data.playlists)
        setPageInfo(data)
      } catch (error) {
        if (!cancelled) {
          console.error('Load playlists error:', error)
          setPlaylists([])
          setPageInfo(createEmptyPage(page))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadPlaylists()

    return () => {
      cancelled = true
    }
  }, [activePlatform, activeSortId, activeTagId, page])

  useEffect(() => {
    if (!isTagMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (tagMenuRef.current?.contains(event.target as Node)) return
      setIsTagMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isTagMenuOpen])

  const handlePlaylistClick = (playlist: RecommendPlaylist) => {
    navigate(`/online-playlist/${playlist.platform}/${playlist.id}`)
  }

  return (
    <div className="pb-8">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-6 transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
        <span>返回</span>
      </button>

      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">歌单广场</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {ONLINE_MUSIC_PLATFORMS.map((platform) => (
          <button
            key={platform.id}
            onClick={() => updateRoute({ platform: platform.id })}
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

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div ref={tagMenuRef} className="relative">
          <button
            onClick={() => setIsTagMenuOpen((visible) => !visible)}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium transition-all inline-flex items-center gap-2',
              'bg-white/70 dark:bg-gray-800/70 text-[var(--text-secondary)] hover:bg-white dark:hover:bg-gray-700 border border-gray-200/60 dark:border-gray-700/60',
              isTagMenuOpen && 'text-primary-500 border-primary-300 dark:border-primary-500/60'
            )}
          >
            <span>{activeTagName}</span>
            <ChevronDown className={cn('w-4 h-4 transition-transform', isTagMenuOpen && 'rotate-180')} />
          </button>

          {isTagMenuOpen && (
            <div className="absolute left-0 top-full z-30 mt-2 w-[min(760px,calc(100vw-2rem))] max-h-[min(520px,65vh)] overflow-y-auto rounded-xl border border-gray-200/70 dark:border-gray-700/70 bg-white/95 dark:bg-gray-900/95 shadow-xl p-4">
              <button
                onClick={() => {
                  updateRoute({ tagId: '', page: 1 })
                  setIsTagMenuOpen(false)
                }}
                className={cn(
                  'inline-flex items-center px-3 py-1.5 rounded-full text-sm transition-colors mr-2 mb-3',
                  !activeTagId
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-[var(--text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-700'
                )}
              >
                全部
              </button>

              {isLoadingTags ? (
                <div className="flex items-center justify-center py-10 text-[var(--text-muted)]">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : tagGroups.length > 0 ? (
                tagGroups.map((group) => (
                  <div key={group.name} className="mb-4 last:mb-0">
                    <div className="text-xs text-[var(--text-muted)] mb-2">{group.name}</div>
                    <div className="flex flex-wrap gap-2">
                      {group.list.map((tag) => (
                        <button
                          key={`${group.name}-${tag.id}`}
                          onClick={() => {
                            updateRoute({ tagId: tag.id, page: 1 })
                            setIsTagMenuOpen(false)
                          }}
                          className={cn(
                            'px-3 py-1.5 rounded-full text-sm transition-colors',
                            activeTagId === tag.id
                              ? 'bg-primary-500 text-white'
                              : 'bg-gray-100 dark:bg-gray-800 text-[var(--text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-700'
                          )}
                        >
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-sm text-[var(--text-muted)]">暂无分类</div>
              )}
            </div>
          )}
        </div>

        {sortOptions.map((sort) => (
          <button
            key={sort.id}
            onClick={() => updateRoute({ sortId: sort.id, page: 1 })}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium transition-all',
              activeSortId === sort.id
                ? 'text-white shadow-md'
                : 'bg-white/60 dark:bg-gray-800/60 text-[var(--text-secondary)] hover:bg-white dark:hover:bg-gray-700 border border-gray-200/50 dark:border-gray-700/50'
            )}
            style={
              activeSortId === sort.id
                ? { backgroundColor: getPlatformColor(activePlatform) }
                : {}
            }
          >
            {sort.name}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {playlists.map((playlist) => (
              <div
                key={`${playlist.platform}-${playlist.id}`}
                onClick={() => handlePlaylistClick(playlist)}
                className="cursor-pointer group"
              >
                <div className="relative aspect-square rounded-xl overflow-hidden mb-2 shadow-sm">
                  <CoverImage
                    src={playlist.cover}
                    alt={playlist.name}
                    className="w-full h-full group-hover:scale-105 transition-transform"
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

          {playlists.length > 0 && (page > 1 || pageInfo.hasMore || totalPages > 1) && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => updateRoute({ page: page - 1 })}
                disabled={page <= 1}
                className="w-9 h-9 rounded-full inline-flex items-center justify-center bg-white/60 dark:bg-gray-800/60 hover:bg-white dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-gray-200/50 dark:border-gray-700/50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {pageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  onClick={() => updateRoute({ page: pageNumber })}
                  className={cn(
                    'min-w-9 h-9 px-3 rounded-full text-sm font-medium transition-colors border',
                    page === pageNumber
                      ? 'text-white border-transparent'
                      : 'bg-white/60 dark:bg-gray-800/60 text-[var(--text-secondary)] hover:bg-white dark:hover:bg-gray-700 border-gray-200/50 dark:border-gray-700/50'
                  )}
                  style={
                    page === pageNumber
                      ? { backgroundColor: getPlatformColor(activePlatform) }
                      : {}
                  }
                >
                  {pageNumber}
                </button>
              ))}

              <button
                onClick={() => updateRoute({ page: page + 1 })}
                disabled={!pageInfo.hasMore && (totalPages === 0 || page >= totalPages)}
                className="w-9 h-9 rounded-full inline-flex items-center justify-center bg-white/60 dark:bg-gray-800/60 hover:bg-white dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-gray-200/50 dark:border-gray-700/50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {playlists.length === 0 && (
            <div className="text-center py-20 text-[var(--text-muted)]">暂无歌单数据</div>
          )}
        </>
      )}
    </div>
  )
}
