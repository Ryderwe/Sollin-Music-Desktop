import { memo, useEffect, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { usePlaybackProgressStore } from '@/stores/playbackProgressStore'
import { usePlayerStore } from '@/stores/playerStore'
import { formatTime } from '@/utils/format'
import neteaseAuthApi from '@/services/neteaseAuth'

type ProgressBarProps = {
  songId?: string
  songPlatform?: string
  disabled?: boolean
}

/**
 * Isolated progress bar component that subscribes to currentTime/duration independently.
 * This prevents the entire Player component from re-rendering on every time update.
 */
export default memo(function ProgressBar({ songId, songPlatform, disabled }: ProgressBarProps) {
  const currentTime = usePlaybackProgressStore((s) => s.currentTime)
  const duration = usePlaybackProgressStore((s) => s.duration)
  const [chorusMarkers, setChorusMarkers] = useState<{ startTime: number; endTime: number }[]>([])

  // Fetch chorus markers for netease songs
  useEffect(() => {
    const fetchChorus = async () => {
      if (songPlatform === 'netease' && songId) {
        try {
          const chorus = await neteaseAuthApi.getSongChorus(songId)
          setChorusMarkers(chorus)
        } catch (error) {
          console.error('Fetch chorus error:', error)
          setChorusMarkers([])
        }
      } else {
        setChorusMarkers([])
      }
    }
    fetchChorus()
  }, [songId, songPlatform])

  return (
    <div className="w-full flex items-center gap-2">
      <span className="text-xs text-[var(--text-muted)] w-10 text-right">
        {formatTime(currentTime)}
      </span>
      <div className="relative flex-1">
        <Slider.Root
          className="relative flex items-center select-none touch-none w-full h-4 group"
          value={[currentTime]}
          max={duration || 100}
          step={1}
          onValueChange={([value]) => usePlayerStore.getState().seek(value)}
          disabled={disabled}
        >
          <Slider.Track className="bg-gray-200 dark:bg-gray-700 relative grow rounded-full h-1 group-hover:h-1.5 transition-all">
            <Slider.Range className="absolute bg-primary-500 rounded-full h-full" />
          </Slider.Track>
          <Slider.Thumb className="block w-3 h-3 bg-white shadow-md rounded-full opacity-0 group-hover:opacity-100 focus:outline-none transition-opacity" />
        </Slider.Root>

        {/* Chorus markers */}
        {duration > 0 && chorusMarkers.length > 0 && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-4 pointer-events-none">
            {chorusMarkers.map((marker, index) => {
              const startPercent = (marker.startTime / 1000 / duration) * 100
              const endPercent = (marker.endTime / 1000 / duration) * 100
              const width = endPercent - startPercent

              return (
                <div
                  key={index}
                  className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-pink-400/50 rounded-full group-hover:h-2 transition-all"
                  style={{
                    left: `${startPercent}%`,
                    width: `${width}%`,
                  }}
                  title={`副歌 ${formatTime(marker.startTime / 1000)} - ${formatTime(marker.endTime / 1000)}`}
                />
              )
            })}
          </div>
        )}
      </div>
      <span className="text-xs text-[var(--text-muted)] w-10">
        {formatTime(duration)}
      </span>
    </div>
  )
})
