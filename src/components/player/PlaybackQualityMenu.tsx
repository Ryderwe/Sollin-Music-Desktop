import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/stores/playerStore'
import { useUIStore } from '@/stores/uiStore'
import type { AudioQuality, Song } from '@/types'
import { AUDIO_QUALITIES_DESC, QUALITY_NAMES, QUALITY_OPTIONS } from '@/constants/audio'
import { cn } from '@/utils/cn'

const QUALITY_OPTION_BY_ID = new Map(QUALITY_OPTIONS.map((option) => [option.id, option]))

type PlaybackQualityMenuProps = {
  className?: string
  triggerClassName?: string
  contentClassName?: string
  itemClassName?: string
  mutedClassName?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}


function getSongQualitySize(song: Song | null, quality: AudioQuality) {
  return song?.lx?._types?.[quality]?.size
    || song?.lx?.types?.find((item) => item.type === quality)?.size
    || ''
}

export default function PlaybackQualityMenu({
  className,
  triggerClassName,
  contentClassName,
  itemClassName,
  mutedClassName,
  side = 'top',
  align = 'center',
  sideOffset = 8,
}: PlaybackQualityMenuProps) {
  const {
    currentSong,
    quality,
    currentQuality,
    isLoading,
    switchQuality,
  } = usePlayerStore()
  const addToast = useUIStore((state) => state.addToast)
  const [pendingQuality, setPendingQuality] = useState<AudioQuality | null>(null)

  if (!currentSong) return null

  const effectiveQuality = currentQuality || quality
  const displayLabel = currentSong.platform === 'local'
    ? '本地'
    : QUALITY_NAMES[effectiveQuality]
  const baseTriggerClass = cn(
    'inline-flex h-6 min-w-[3.75rem] items-center justify-center rounded-full px-2.5 text-[11px] font-medium leading-none transition-colors',
    'bg-gray-100 text-[var(--text-secondary)] hover:bg-gray-200 dark:bg-white/10 dark:text-[var(--text-secondary)] dark:hover:bg-white/15',
    triggerClassName,
  )

  if (currentSong.platform === 'local') {
    return (
      <span className={cn(baseTriggerClass, 'cursor-default opacity-75', className)} title="本地歌曲">
        {displayLabel}
      </span>
    )
  }

  const isSwitching = Boolean(pendingQuality)
  const handleQualitySelect = async(nextQuality: AudioQuality) => {
    if (isSwitching || nextQuality === effectiveQuality) return

    setPendingQuality(nextQuality)
    try {
      const actualQuality = await switchQuality(nextQuality)
      if (actualQuality) {
        addToast({
          type: 'success',
          message: `已临时切换至 ${QUALITY_NAMES[actualQuality]}`,
        })
      }
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : '音质切换失败',
      })
    } finally {
      setPendingQuality(null)
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={isLoading || isSwitching}
          className={cn(baseTriggerClass, 'disabled:cursor-not-allowed disabled:opacity-60', className)}
          title="切换音质"
        >
          {isSwitching ? <Loader2 className="h-3 w-3 animate-spin" /> : displayLabel}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            'z-[80] min-w-[176px] rounded-xl border border-gray-200 bg-white p-1.5 text-[var(--text-primary)] shadow-xl dark:border-gray-700 dark:bg-gray-800 dark:text-white',
            contentClassName,
          )}
          side={side}
          align={align}
          sideOffset={sideOffset}
        >
          {AUDIO_QUALITIES_DESC.map((qualityId) => {
            const option = QUALITY_OPTION_BY_ID.get(qualityId)
            const isCurrent = qualityId === effectiveQuality
            const size = getSongQualitySize(currentSong, qualityId)
            const detail = [option?.desc || QUALITY_NAMES[qualityId], size].filter(Boolean).join(' · ')

            return (
              <DropdownMenu.Item
                key={qualityId}
                disabled={isCurrent || isSwitching}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm outline-none transition-colors hover:bg-gray-100 data-[disabled]:cursor-default data-[disabled]:opacity-55 dark:hover:bg-gray-700',
                  itemClassName,
                )}
                onSelect={() => {
                  void handleQualitySelect(qualityId)
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{QUALITY_NAMES[qualityId]}</span>
                  <span className={cn('block truncate text-[11px] text-[var(--text-muted)]', mutedClassName)}>
                    {detail}
                  </span>
                </span>
                {pendingQuality === qualityId ? (
                  <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
                ) : isCurrent ? (
                  <Check className="h-4 w-4 flex-shrink-0 text-primary-500" />
                ) : null}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
