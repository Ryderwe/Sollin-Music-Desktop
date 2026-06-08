import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, RefreshCw, XCircle } from 'lucide-react'
import { useState } from 'react'
import { usePlayerStore, type SourceSwitchAlternative, type SourceSwitchInfo } from '@/stores/playerStore'
import { getPlatformName } from '@/constants/platform'
import { cn } from '@/utils/cn'

interface SourceSwitchPopoverProps {
  info: SourceSwitchInfo
  fallbackLabel: string
  alternatives: SourceSwitchAlternative[]
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return ''
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const remaining = total % 60
  return `${minutes}:${String(remaining).padStart(2, '0')}`
}

export default function SourceSwitchPopover({ info, fallbackLabel, alternatives }: SourceSwitchPopoverProps) {
  const rejectSourceSwitch = usePlayerStore((state) => state.rejectSourceSwitch)
  const pickSourceSwitchAlternative = usePlayerStore((state) => state.pickSourceSwitchAlternative)
  const [pendingAction, setPendingAction] = useState<null | 'reject' | string>(null)
  const [open, setOpen] = useState(false)

  const handleReject = async () => {
    if (pendingAction) return
    setPendingAction('reject')
    try {
      await rejectSourceSwitch()
      setOpen(false)
    } finally {
      setPendingAction(null)
    }
  }

  const handlePick = async (alternative: SourceSwitchAlternative) => {
    if (pendingAction) return
    const key = `${alternative.platform}:${alternative.id}`
    setPendingAction(key)
    try {
      await pickSourceSwitchAlternative(alternative)
      setOpen(false)
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'px-2 py-0.5 text-[10px] rounded-full bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 truncate transition-colors',
            'hover:bg-blue-100 dark:hover:bg-blue-500/25 focus:outline-none focus:ring-1 focus:ring-blue-400/40',
          )}
          aria-label="临时换源详情"
        >
          临时换源
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          className={cn(
            'z-[120] min-w-[280px] max-w-[340px] rounded-xl border border-gray-200/80 bg-white/95 p-3 shadow-xl backdrop-blur',
            'dark:border-gray-700/80 dark:bg-gray-800/95',
            'animate-in fade-in-0 zoom-in-95',
          )}
        >
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
            <span>{getPlatformName(info.fromPlatform)}</span>
            <span className="text-[var(--text-muted)]">→</span>
            <span className="text-blue-600 dark:text-blue-300">{getPlatformName(info.toPlatform)}</span>
          </div>
          <div className="mt-2 rounded-lg bg-gray-50 dark:bg-gray-900/40 px-2.5 py-2">
            <div className="text-[12px] font-medium text-[var(--text-primary)] truncate">
              《{info.toSongName}》
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--text-muted)] truncate">
              {info.toSongArtist}
              {info.toSongAlbum ? ` · ${info.toSongAlbum}` : ''}
            </div>
          </div>

          <button
            type="button"
            disabled={pendingAction === 'reject'}
            onClick={handleReject}
            className={cn(
              'mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium transition-colors',
              'bg-red-50 text-red-600 hover:bg-red-100',
              'dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            {pendingAction === 'reject' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <XCircle className="w-3.5 h-3.5" />
            )}
            {pendingAction === 'reject' ? '重新寻找中' : '这不是这首歌'}
          </button>

          {alternatives.length > 0 && (
            <>
              <div className="mt-3 mb-1.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                <span>其它候选</span>
                <span className="flex-1 h-px bg-gray-200/70 dark:bg-gray-700/70" />
              </div>
              <div className="max-h-[200px] overflow-auto space-y-1 pr-0.5">
                {alternatives.map((alternative) => {
                  const key = `${alternative.platform}:${alternative.id}`
                  const isPending = pendingAction === key
                  const durationLabel = formatDuration(alternative.duration)
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={Boolean(pendingAction)}
                      onClick={() => handlePick(alternative)}
                      className={cn(
                        'group w-full rounded-lg px-2.5 py-1.5 text-left transition-colors',
                        'hover:bg-gray-100 dark:hover:bg-gray-700/50',
                        'disabled:cursor-not-allowed disabled:opacity-60',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span className={cn(
                          'mt-1 inline-flex h-4 min-w-[28px] items-center justify-center rounded-full px-1.5 text-[9px] font-medium',
                          'bg-gray-200 text-[var(--text-secondary)] dark:bg-gray-700 dark:text-[var(--text-secondary)]',
                        )}>
                          {getPlatformName(alternative.platform).slice(0, 2)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium text-[var(--text-primary)] truncate">
                            {alternative.name}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] truncate">
                            {alternative.artist}
                            {alternative.album ? ` · ${alternative.album}` : ''}
                            {durationLabel ? ` · ${durationLabel}` : ''}
                          </div>
                        </div>
                        <span className="mt-0.5 shrink-0">
                          {isPending ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
                          ) : (
                            <Check className="w-3.5 h-3.5 opacity-0 text-blue-500 group-hover:opacity-100 transition-opacity" />
                          )}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div className="mt-3 border-t border-gray-200/70 pt-2 text-[10px] text-[var(--text-muted)] dark:border-gray-700/70 dark:text-[var(--text-muted)]">
            {alternatives.length > 0
              ? '原音源不可用时自动匹配，如果不是你想听的，请选择其他候选或拒绝当前结果。'
              : fallbackLabel || '原音源不可用，已自动寻找可播放的同名曲目。'}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
