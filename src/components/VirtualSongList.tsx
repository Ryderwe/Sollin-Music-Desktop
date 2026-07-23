import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react'
import SongRow from './SongRow'
import { cn } from '@/utils/cn'
import type { Song } from '@/types'

const ROW_HEIGHT = 64 // py-3 (24px) + h-10 (40px) = 64px
const DEFAULT_OVERSCAN = 16
const DEFAULT_VIRTUALIZE_THRESHOLD = 1000

interface VirtualSongListProps {
  songs: Song[]
  playlistId: string
  playlistName?: string
  showPlatform?: boolean
  showAlbum?: boolean
  overscan?: number
  playlist?: Song[]
  className?: string
  footer?: ReactNode
  footerHeight?: number
  renderRow?: (song: Song, index: number) => ReactNode
  virtualizeThreshold?: number
  scrollable?: boolean
}

export default function VirtualSongList({
  songs,
  playlistId,
  playlistName,
  showPlatform = true,
  showAlbum = true,
  overscan = DEFAULT_OVERSCAN,
  playlist,
  className,
  footer,
  footerHeight = 64,
  renderRow,
  virtualizeThreshold = DEFAULT_VIRTUALIZE_THRESHOLD,
  scrollable = true,
}: VirtualSongListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const hasFooter = Boolean(footer)
  const listSize = songs.length * ROW_HEIGHT
  const totalSize = listSize + (hasFooter ? footerHeight : 0)
  const shouldVirtualize = scrollable && songs.length > virtualizeThreshold

  useLayoutEffect(() => {
    if (!shouldVirtualize) return

    const scrollElement = parentRef.current
    if (!scrollElement) return

    const syncViewportHeight = () => {
      setViewportHeight(scrollElement.clientHeight)
    }

    syncViewportHeight()

    const resizeObserver = new ResizeObserver(syncViewportHeight)
    resizeObserver.observe(scrollElement)

    return () => {
      resizeObserver.disconnect()
    }
  }, [shouldVirtualize])

  useLayoutEffect(() => {
    if (!shouldVirtualize) return

    const scrollElement = parentRef.current
    if (!scrollElement || viewportHeight === 0) return

    const maxScrollTop = Math.max(totalSize - viewportHeight, 0)
    if (scrollElement.scrollTop > maxScrollTop) {
      scrollElement.scrollTop = maxScrollTop
      setScrollTop(maxScrollTop)
    }
  }, [shouldVirtualize, songs.length, totalSize, viewportHeight])

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  const visibleRange = useMemo(() => {
    if (songs.length === 0) {
      return { startIndex: 0, endIndex: 0 }
    }

    const visibleHeight = viewportHeight || ROW_HEIGHT
    const startIndex = Math.max(Math.floor(scrollTop / ROW_HEIGHT) - overscan, 0)
    const endIndex = Math.min(
      Math.ceil((scrollTop + visibleHeight) / ROW_HEIGHT) + overscan,
      songs.length
    )

    return { startIndex, endIndex }
  }, [overscan, scrollTop, songs.length, viewportHeight])

  const visibleSongs = songs.slice(visibleRange.startIndex, visibleRange.endIndex)

  if (!shouldVirtualize) {
    return (
      <div className={cn(scrollable ? 'h-full overflow-y-auto overflow-x-hidden' : 'overflow-visible', className)}>
        <div className="space-y-1" style={{ overflowAnchor: 'none' }}>
          {songs.map((song, index) => (
            <div key={`${song.platform}-${song.id}-${index}`}>
              {renderRow ? (
                renderRow(song, index)
              ) : (
                <SongRow
                  song={song}
                  index={index}
                  playlist={playlist || songs}
                  playlistId={playlistId}
                  playlistName={playlistName}
                  showPlatform={showPlatform}
                  showAlbum={showAlbum}
                />
              )}
            </div>
          ))}
          {footer}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      className={cn('h-full overflow-y-auto overflow-x-hidden', className)}
      onScroll={handleScroll}
    >
      <div
        style={{
          height: totalSize,
          width: '100%',
          position: 'relative',
          overflowAnchor: 'none',
        }}
      >
        {visibleSongs.map((song, offset) => {
          const index = visibleRange.startIndex + offset

          return (
            <div
              key={`${song.platform}-${song.id}-${index}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: ROW_HEIGHT,
                transform: `translateY(${index * ROW_HEIGHT}px)`,
              }}
            >
              {renderRow ? (
                renderRow(song, index)
              ) : (
                <SongRow
                  song={song}
                  index={index}
                  playlist={playlist || songs}
                  playlistId={playlistId}
                  playlistName={playlistName}
                  showPlatform={showPlatform}
                  showAlbum={showAlbum}
                />
              )}
            </div>
          )
        })}
        {hasFooter && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: footerHeight,
              transform: `translateY(${listSize}px)`,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
