import { Check, Gauge } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/stores/playerStore'
import { cn } from '@/utils/cn'

const PLAYBACK_RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5] as const

type PlaybackRateMenuProps = {
  className?: string
  triggerClassName?: string
  contentClassName?: string
  itemClassName?: string
  mutedClassName?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  showIcon?: boolean
}

export const formatPlaybackRate = (rate: number) => (
  Number.isInteger(rate) ? `${rate}x` : `${rate.toFixed(2).replace(/0$/, '')}x`
)

export default function PlaybackRateMenu({
  className,
  triggerClassName,
  contentClassName,
  itemClassName,
  mutedClassName,
  side = 'top',
  align = 'center',
  sideOffset = 8,
  showIcon = true,
}: PlaybackRateMenuProps) {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const playbackRate = usePlayerStore((s) => s.audioEffects.playbackRate)
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate)
  const displayRate = formatPlaybackRate(playbackRate)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={!currentSong}
          className={cn(
            'inline-flex h-8 min-w-[3.25rem] items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors',
            'bg-gray-100 text-[var(--text-secondary)] hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/10 dark:text-[var(--text-secondary)] dark:hover:bg-white/15',
            triggerClassName,
            className,
          )}
          title="播放倍速"
        >
          {showIcon && <Gauge className="h-4 w-4" />}
          <span>{displayRate}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            'z-[80] min-w-[148px] rounded-xl border border-gray-200 bg-white p-1.5 text-[var(--text-primary)] shadow-xl dark:border-gray-700 dark:bg-gray-800 dark:text-white',
            contentClassName,
          )}
          side={side}
          align={align}
          sideOffset={sideOffset}
        >
          <div className={cn('px-3 py-1.5 text-[11px] text-[var(--text-muted)]', mutedClassName)}>
            播放倍速
          </div>
          {PLAYBACK_RATE_OPTIONS.map((rate) => {
            const isCurrent = Math.abs(rate - playbackRate) < 0.005

            return (
              <DropdownMenu.Item
                key={rate}
                disabled={isCurrent}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm outline-none transition-colors hover:bg-gray-100 data-[disabled]:cursor-default data-[disabled]:opacity-55 dark:hover:bg-gray-700',
                  itemClassName,
                )}
                onSelect={() => setPlaybackRate(rate)}
              >
                <span>{formatPlaybackRate(rate)}</span>
                {isCurrent && <Check className="h-4 w-4 flex-shrink-0 text-primary-500" />}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
