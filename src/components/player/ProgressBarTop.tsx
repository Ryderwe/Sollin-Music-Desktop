import { memo, useEffect, useRef, useState } from 'react'
import { usePlaybackProgressStore } from '@/stores/playbackProgressStore'
import { usePlayerStore } from '@/stores/playerStore'
import { formatTime } from '@/utils/format'
import { useCoverBackdrop } from '@/hooks/useCoverBackdrop'
import neteaseAuthApi from '@/services/neteaseAuth'

type ProgressBarTopProps = {
  songId?: string
  songPlatform?: string
  songCover?: string
  disabled?: boolean
}

/**
 * Thin progress bar that sits at the top of the player bar, acting as the top border.
 * Uses cover art color for the filled portion.
 */
export default memo(function ProgressBarTop({ songId, songPlatform, songCover, disabled }: ProgressBarTopProps) {
  const currentTime = usePlaybackProgressStore((s) => s.currentTime)
  const duration = usePlaybackProgressStore((s) => s.duration)
  const [chorusMarkers, setChorusMarkers] = useState<{ startTime: number; endTime: number }[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const [hoverPercent, setHoverPercent] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)
  const coverBackdrop = useCoverBackdrop(songCover)

  // Derive color from cover palette
  const barColor = coverBackdrop.palette
    ? `rgb(${coverBackdrop.palette.primary.r}, ${coverBackdrop.palette.primary.g}, ${coverBackdrop.palette.primary.b})`
    : 'rgb(var(--color-primary))'
  const barColorRgba = (alpha: number) => coverBackdrop.palette
    ? `rgba(${coverBackdrop.palette.primary.r}, ${coverBackdrop.palette.primary.g}, ${coverBackdrop.palette.primary.b}, ${alpha})`
    : `rgba(var(--color-primary), ${alpha})`

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

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  const getPercentFromEvent = (e: React.MouseEvent | MouseEvent) => {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    return x / rect.width
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled || !duration) return
    e.preventDefault()
    setIsDragging(true)
    const percent = getPercentFromEvent(e)
    usePlayerStore.getState().seek(percent * duration)
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const percent = getPercentFromEvent(e)
      setHoverPercent(percent)
      if (duration) {
        usePlayerStore.getState().seek(percent * duration)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, duration])

  const handleMouseMove = (e: React.MouseEvent) => {
    const percent = getPercentFromEvent(e)
    setHoverPercent(percent)
  }

  const expanded = isHovering || isDragging

  return (
    <div
      ref={trackRef}
      className="absolute top-0 left-0 right-0 z-20 cursor-pointer"
      style={{ height: expanded ? '6px' : '3px', transition: 'height 0.15s ease' }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
    >
      {/* Background track */}
      <div className="absolute inset-0 bg-gray-200/50 dark:bg-gray-700/50" />

      {/* Chorus markers */}
      {duration > 0 && chorusMarkers.length > 0 && chorusMarkers.map((marker, index) => {
        const startPercent = (marker.startTime / 1000 / duration) * 100
        const endPercent = (marker.endTime / 1000 / duration) * 100
        const width = endPercent - startPercent
        return (
          <div
            key={index}
            className="absolute top-0 bottom-0 bg-pink-400/30"
            style={{ left: `${startPercent}%`, width: `${width}%` }}
          />
        )
      })}

      {/* Filled progress */}
      <div
        className="absolute top-0 bottom-0 left-0 transition-none"
        style={{
          width: `${progress}%`,
          background: barColor,
          boxShadow: `0 0 6px 1px ${barColorRgba(0.4)}`,
        }}
      />

      {/* Hover time tooltip */}
      {expanded && duration > 0 && (
        <div
          className="absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/75 text-white text-[10px] leading-tight pointer-events-none whitespace-nowrap"
          style={{ left: `${hoverPercent * 100}%` }}
        >
          {formatTime(hoverPercent * duration)}
        </div>
      )}
    </div>
  )
})
