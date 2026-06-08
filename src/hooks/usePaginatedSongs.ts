import { useState, useCallback, useRef } from 'react'
import type { PaginatedSongsResult, Song } from '@/types'
import { useInfiniteScroll } from './useInfiniteScroll'

const DISPLAY_PAGE_SIZE = 50

interface UsePaginatedSongsOptions {
  fetcher: (apiPage: number) => Promise<PaginatedSongsResult>
  enabled?: boolean
  batchSize?: number
}

export function usePaginatedSongs({ fetcher, enabled = true, batchSize = 500 }: UsePaginatedSongsOptions) {
  const [allApiSongs, setAllApiSongs] = useState<Song[]>([])
  const [apiTotal, setApiTotal] = useState(0)
  const [displayCount, setDisplayCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const fetchingRef = useRef(false)
  const abortRef = useRef(false)
  const loadedCountRef = useRef(0)

  const visibleSongs = allApiSongs.slice(0, displayCount)
  const hasMoreDisplay = displayCount < allApiSongs.length
  const hasMore = hasMoreDisplay

  const loadMore = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setIsLoadingMore(true)
    try {
      setDisplayCount((prev) => Math.min(prev + DISPLAY_PAGE_SIZE, allApiSongs.length))
    } finally {
      fetchingRef.current = false
      setIsLoadingMore(false)
    }
  }, [allApiSongs.length])

  const loadInitial = useCallback(async () => {
    abortRef.current = false
    setIsLoading(true)
    setAllApiSongs([])
    setApiTotal(0)
    setDisplayCount(0)
    loadedCountRef.current = 0

    try {
      const seenIds = new Set<string>()
      let page = 1
      while (!abortRef.current) {
        const result = await fetcher(page)
        if (result.songs.length === 0) break
        const newSongs = result.songs.filter((s) => {
          if (seenIds.has(s.id)) return false
          seenIds.add(s.id)
          return true
        })
        if (newSongs.length === 0) break
        setAllApiSongs((prev) => [...prev, ...newSongs])
        if (result.total) setApiTotal(result.total)
        loadedCountRef.current += newSongs.length
        setDisplayCount((prev) => Math.min(prev + DISPLAY_PAGE_SIZE, loadedCountRef.current))
        if (result.songs.length < batchSize) break
        page++
        await new Promise((r) => setTimeout(r, 0))
      }
    } finally {
      setIsLoading(false)
    }
  }, [fetcher, batchSize])

  const reset = useCallback(async () => {
    await loadInitial()
  }, [loadInitial])

  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: loadMore,
    hasMore,
    enabled: enabled && !isLoading,
  })

  return {
    visibleSongs,
    allApiSongs,
    apiTotal,
    isLoading,
    isLoadingMore,
    hasMore,
    sentinelRef,
    loadInitial,
    loadMore,
    reset,
  }
}
