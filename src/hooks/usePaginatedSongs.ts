import { useState, useCallback, useRef } from 'react'
import type { PaginatedSongsResult, Song } from '@/types'

interface UsePaginatedSongsOptions {
  fetcher: (apiPage: number) => Promise<PaginatedSongsResult>
  enabled?: boolean
  batchSize?: number
}

export function usePaginatedSongs({ fetcher, enabled = true, batchSize = 500 }: UsePaginatedSongsOptions) {
  const [allApiSongs, setAllApiSongs] = useState<Song[]>([])
  const [apiTotal, setApiTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const fetchingRef = useRef(false)
  const abortRef = useRef(false)
  const loadedCountRef = useRef(0)

  const visibleSongs = allApiSongs
  const hasMore = false

  const loadMore = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setIsLoadingMore(true)
    try {
      // API pages are fetched eagerly in loadInitial. Kept for call-site compatibility.
    } finally {
      fetchingRef.current = false
      setIsLoadingMore(false)
    }
  }, [])

  const loadInitial = useCallback(async () => {
    if (!enabled) return

    abortRef.current = false
    setIsLoading(true)
    setAllApiSongs([])
    setApiTotal(0)
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
        if (result.songs.length < batchSize) break
        page++
        await new Promise((r) => setTimeout(r, 0))
      }
    } finally {
      setIsLoading(false)
    }
  }, [enabled, fetcher, batchSize])

  const reset = useCallback(async () => {
    await loadInitial()
  }, [loadInitial])

  const sentinelRef = useRef<HTMLDivElement>(null)

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
