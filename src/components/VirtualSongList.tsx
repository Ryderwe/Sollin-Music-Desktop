import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import SongRow from './SongRow'
import type { Song } from '@/types'

const ROW_HEIGHT = 64 // py-3 (24px) + h-10 (40px) = 64px

interface VirtualSongListProps {
  songs: Song[]
  playlistId: string
  showPlatform?: boolean
  showAlbum?: boolean
  overscan?: number
}

export default function VirtualSongList({
  songs,
  playlistId,
  showPlatform = true,
  showAlbum = true,
  overscan = 10,
}: VirtualSongListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: songs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan,
  })

  const totalSize = virtualizer.getTotalSize()
  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div
      ref={parentRef}
      className="h-full overflow-y-auto"
      style={{ contain: 'strict' }}
    >
      <div
        style={{
          height: totalSize,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const song = songs[virtualRow.index]
          return (
            <div
              key={`${song.id}-${song.platform}`}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <SongRow
                song={song}
                index={virtualRow.index}
                playlist={songs}
                playlistId={playlistId}
                showPlatform={showPlatform}
                showAlbum={showAlbum}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
