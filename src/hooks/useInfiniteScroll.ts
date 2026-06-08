import { useEffect, useRef, useCallback, useState } from 'react'

interface UseInfiniteScrollOptions {
  onLoadMore: () => Promise<void>
  hasMore: boolean
  enabled?: boolean
  rootMargin?: string
}

export function useInfiniteScroll({ onLoadMore, hasMore, enabled = true, rootMargin = '400px' }: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const loadingRef = useRef(false)

  const handleLoadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return
    loadingRef.current = true
    setIsLoadingMore(true)
    try {
      await onLoadMore()
    } finally {
      loadingRef.current = false
      setIsLoadingMore(false)
    }
  }, [onLoadMore, hasMore])

  useEffect(() => {
    if (!enabled || !hasMore) return

    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          handleLoadMore()
        }
      },
      { rootMargin }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [enabled, hasMore, handleLoadMore, rootMargin])

  return { sentinelRef, isLoadingMore }
}
