import { memo } from 'react'
import { BackgroundRender } from '@applemusic-like-lyrics/react'
import type { PlayerBackdropMode } from '@/stores/uiStore'
import { cn } from '@/utils/cn'
import FluidBackdrop from '@/components/player/FluidBackdrop'

type PlayerBackdropProps = {
  cover?: string | null
  isPlaying?: boolean
  mode: PlayerBackdropMode
  className?: string
}

export default memo(function PlayerBackdrop({
  cover,
  isPlaying = false,
  mode,
  className,
}: PlayerBackdropProps) {
  if (mode === 'amll') {
    return (
      <div
        className={cn('amll-package-backdrop absolute inset-0 z-0 overflow-hidden pointer-events-none bg-black', className)}
        style={{ isolation: 'isolate' }}
      >
        <style>{`
          .amll-package-backdrop canvas {
            position: absolute !important;
            inset: 0 !important;
            z-index: 0 !important;
            width: 100% !important;
            height: 100% !important;
            display: block !important;
          }
        `}</style>
        <BackgroundRender
          album={cover?.trim() || undefined}
          playing={isPlaying}
          fps={18}
          flowSpeed={0.72}
          renderScale={0.36}
          lowFreqVolume={0.001}
          hasLyric={false}
          staticMode={false}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04),rgba(3,7,12,0.64)_72%,rgba(0,0,0,0.82)_100%)]" />
        <div className="absolute inset-0 bg-black/18" />
      </div>
    )
  }

  return (
    <FluidBackdrop
      cover={cover}
      animated={mode === 'dynamic'}
      className={className}
    />
  )
})
